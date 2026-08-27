import { TrackingResult } from '../types';

/** Give the worker this long to load the WASM + model before the heartbeat
 *  supervisor is allowed to declare it hung. Model download plus synchronous
 *  WASM instantiation regularly blocks the worker thread for several seconds
 *  on a cold cache, and killing it mid-load produced an endless respawn loop. */
const INIT_GRACE_MS = 20000;
/** No worker message for this long (after init) means the thread is wedged. */
const HEARTBEAT_TIMEOUT_MS = 5000;
/** A single frame should never take this long; if it does, release the latch. */
const FRAME_TIMEOUT_MS = 4000;
/** Give up on hand tracking after this many failed respawns. */
const MAX_RECOVERY_ATTEMPTS = 3;
/** Minimum spacing between repeated low-light notifications. */
const LIGHT_WARN_COOLDOWN_MS = 20000;

export class HandTrackingManager {
  private video: HTMLVideoElement | null = null;
  private worker: Worker | null = null;
  private isWorkerBusy = false;
  private isMobile = false;

  private width = 640;
  private height = 480;

  // Offscreen canvas for frame capture (main thread side-car)
  private offscreenCanvas: OffscreenCanvas | null = null;
  private offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

  // Heartbeat & Supervisor state
  private lastHeartbeat = 0;
  private heartbeatIntervalId: number | null = null;
  private isTracking = false;
  private trackingFrameId = 0;
  private workerInitialized = false;
  private workerSpawnedAt = 0;
  private frameSentAt = 0;

  // Recovery back-off state
  private recoveryAttempts = 0;
  private recoveryTimeoutId: number | null = null;

  // Callback hooks
  private onResults: (res: TrackingResult) => void;
  private onStateChange: (state: 'LOADING' | 'READY' | 'ERROR' | 'LIGHT_WARN' | 'RECOVERING', msg?: string) => void;

  // Tiny canvas for low-light estimation
  private lightCanvas: OffscreenCanvas | null = null;
  private lightCtx: OffscreenCanvasRenderingContext2D | null = null;
  private lastLightCheck = 0;
  private lastLightWarn = 0;

  constructor(
    onResults: (res: TrackingResult) => void,
    onStateChange: (state: 'LOADING' | 'READY' | 'ERROR' | 'LIGHT_WARN' | 'RECOVERING', msg?: string) => void
  ) {
    this.onResults = onResults;
    this.onStateChange = onStateChange;
    this.isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    // Target resolutions: low-res is key for mobile WebAssembly speed
    if (this.isMobile) {
      this.width = 320;
      this.height = 240;
    } else {
      this.width = 480;
      this.height = 360;
    }

    this.offscreenCanvas = new OffscreenCanvas(this.width, this.height);
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { alpha: false, desynchronized: true });

    this.lightCanvas = new OffscreenCanvas(16, 16);
    this.lightCtx = this.lightCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
  }

  private startResolver: (() => void) | null = null;
  private startRejecter: ((err: any) => void) | null = null;
  private initTimeoutId: number | null = null;
  private startPromise: Promise<void> | null = null;

  /** True while a camera stream is live and the tracking loop is running. */
  public isActive(): boolean {
    return this.isTracking;
  }

  public async start(): Promise<void> {
    // Re-entrant guard: callers restart the game (and therefore the control
    // mode) far more often than the camera should be torn down. Tearing the
    // stream and worker down mid-session dropped players into touch mode.
    if (this.startPromise) return this.startPromise;
    if (this.isTracking && this.workerInitialized) return Promise.resolve();

    this.startPromise = this.beginSession();
    this.startPromise.catch(() => { /* surfaced to the caller's own catch */ });
    return this.startPromise;
  }

  private beginSession(): Promise<void> {
    // Stop any existing session first: stop() emits a hand-absent result, and
    // doing it before the LOADING notice keeps the status badge in order.
    this.stop();
    this.recoveryAttempts = 0;
    this.onStateChange('LOADING', 'Accessing camera...');

    return new Promise<void>(async (resolve, reject) => {
      const settleResolve = () => {
        this.startPromise = null;
        resolve();
      };
      const settleReject = (err: any) => {
        this.startPromise = null;
        reject(err);
      };
      this.startResolver = settleResolve;
      this.startRejecter = settleReject;

      // Allow the full init grace window for model + WASM loading.
      this.initTimeoutId = window.setTimeout(() => {
        this.stop();
        this.onStateChange('ERROR', 'MediaPipe tracker load timeout. Touch mode active.');
        settleReject(new Error('MediaPipe model load timeout'));
      }, INIT_GRACE_MS);

      try {
        this.video = document.createElement('video');
        this.video.setAttribute('playsinline', '');
        this.video.setAttribute('muted', '');
        this.video.muted = true;

        const constraints: MediaStreamConstraints = {
          video: {
            width: { ideal: this.width },
            height: { ideal: this.height },
            facingMode: 'user',
            frameRate: { ideal: 30 }
          },
          audio: false
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        this.video.srcObject = stream;

        await new Promise<void>((resolveVideo, rejectVideo) => {
          if (!this.video) {
            rejectVideo(new Error('Video element disposed during startup'));
            return;
          }
          this.video.onloadedmetadata = () => {
            this.video!.play().then(() => resolveVideo()).catch(rejectVideo);
          };
          this.video.onerror = () => rejectVideo(new Error('Video element failed to load the camera stream'));
        });

        this.isTracking = true;
        this.initWorker();
        this.startSupervisor();
        this.loop();
      } catch (err) {
        if (this.initTimeoutId) {
          clearTimeout(this.initTimeoutId);
          this.initTimeoutId = null;
        }
        this.stop();
        this.onStateChange('ERROR', 'Camera access denied or unavailable. Falling back to Touch.');
        console.error('Camera init error:', err);
        settleReject(err);
      }
    });
  }

  public stop(): void {
    this.isTracking = false;
    if (this.initTimeoutId) {
      clearTimeout(this.initTimeoutId);
      this.initTimeoutId = null;
    }
    if (this.recoveryTimeoutId) {
      clearTimeout(this.recoveryTimeoutId);
      this.recoveryTimeoutId = null;
    }
    this.startResolver = null;
    this.startRejecter = null;

    if (this.trackingFrameId) {
      cancelAnimationFrame(this.trackingFrameId);
      this.trackingFrameId = 0;
    }
    this.stopSupervisor();

    if (this.video && this.video.srcObject) {
      const stream = this.video.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.video.srcObject = null;
    }

    if (this.worker) {
      // Detach handlers first: a terminate() can still deliver a queued
      // onerror, which would re-enter recovery on an already-stopped session.
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.workerInitialized = false;
    this.isWorkerBusy = false;
    // Report a hand-absent frame so gesture state cannot stay latched.
    this.onResults({ landmarks: [], confidence: 0, handPresent: false, latencyMs: 0 });
  }

  private initWorker(): void {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }

    this.isWorkerBusy = false;
    this.workerInitialized = false;
    this.lastHeartbeat = performance.now();
    this.workerSpawnedAt = performance.now();

    // Spawn the worker using Vite URLs
    this.worker = new Worker(new URL('../workers/tracking.worker.ts', import.meta.url), {
      type: 'module'
    });

    this.worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data;
      this.lastHeartbeat = performance.now();

      if (type === 'INITIALIZED') {
        this.workerInitialized = true;
        this.recoveryAttempts = 0;
        if (this.initTimeoutId) {
          clearTimeout(this.initTimeoutId);
          this.initTimeoutId = null;
        }
        this.onStateChange('READY');
        if (this.startResolver) {
          const resolver = this.startResolver;
          this.startResolver = null;
          this.startRejecter = null;
          resolver();
        }
      } else if (type === 'PONG') {
        // Heartbeat verification response
      } else if (type === 'RESULTS') {
        this.isWorkerBusy = false;
        this.onResults({
          landmarks: e.data.landmarks,
          confidence: e.data.confidence,
          handPresent: e.data.handPresent,
          latencyMs: e.data.latencyMs
        });
      } else if (type === 'FRAME_SKIPPED') {
        // Recoverable per-frame failure: just release the latch and continue.
        this.isWorkerBusy = false;
      } else if (type === 'ERROR') {
        console.error('Worker error:', e.data.error);
        this.isWorkerBusy = false;
        if (this.initTimeoutId) {
          clearTimeout(this.initTimeoutId);
          this.initTimeoutId = null;
        }
        if (this.startRejecter) {
          const rejecter = this.startRejecter;
          this.startResolver = null;
          this.startRejecter = null;
          rejecter(new Error(e.data.error));
        } else {
          this.recoverWorker();
        }
      }
    };

    this.worker.onerror = (err) => {
      console.error('Worker supervisor detected thread crash:', err);
      if (this.initTimeoutId) {
        clearTimeout(this.initTimeoutId);
        this.initTimeoutId = null;
      }
      if (this.startRejecter) {
        const rejecter = this.startRejecter;
        this.startResolver = null;
        this.startRejecter = null;
        rejecter(err);
        return;
      }
      this.recoverWorker();
    };

    this.worker.postMessage({ type: 'INIT' });
  }

  private loop = (): void => {
    if (!this.isTracking) return;

    this.trackingFrameId = requestAnimationFrame(this.loop);

    if (!this.video || !this.worker || !this.workerInitialized) {
      return;
    }

    if (this.isWorkerBusy) {
      // Watchdog: a frame whose reply never arrives would otherwise wedge
      // tracking silently, because the heartbeat still answers PING.
      if (performance.now() - this.frameSentAt > FRAME_TIMEOUT_MS) {
        console.warn('Frame response timed out; releasing tracking latch.');
        this.isWorkerBusy = false;
      }
      return;
    }

    try {
      // 1. Draw video frame to offscreen canvas
      if (this.offscreenCtx && this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
        this.offscreenCtx.drawImage(this.video, 0, 0, this.width, this.height);

        // 2. Transfer ImageBitmap (Zero-copy transfer)
        const bitmap = this.offscreenCanvas!.transferToImageBitmap();
        this.isWorkerBusy = true;
        this.frameSentAt = performance.now();
        this.worker.postMessage(
          {
            type: 'PROCESS_FRAME',
            bitmap,
            timestamp: this.frameSentAt
          },
          [bitmap]
        );
      }
    } catch (err) {
      console.error('Failed to capture frame:', err);
      this.isWorkerBusy = false;
    }

    // 3. Sample ambient light levels once per second
    const now = performance.now();
    if (now - this.lastLightCheck > 1000) {
      this.lastLightCheck = now;
      this.checkAmbientLight();
    }
  };

  private checkAmbientLight(): void {
    if (!this.video || !this.lightCtx || this.video.readyState < this.video.HAVE_CURRENT_DATA) {
      return;
    }

    // Draw video scaled down to 16x16
    this.lightCtx.drawImage(this.video, 0, 0, 16, 16);
    const imgData = this.lightCtx.getImageData(0, 0, 16, 16);
    const data = imgData.data;

    let totalLuminance = 0;
    // Calculate relative luminance across 256 pixels: Y = 0.299R + 0.587G + 0.114B
    for (let i = 0; i < data.length; i += 4) {
      totalLuminance += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    const avgLuminance = totalLuminance / 256;
    const brightnessPct = avgLuminance / 255;

    // Under 28% intensity is considered low-light. Rate-limited: this used to
    // fire every second and bury the playfield in warning text.
    const now = performance.now();
    if (brightnessPct < 0.28 && now - this.lastLightWarn > LIGHT_WARN_COOLDOWN_MS) {
      this.lastLightWarn = now;
      this.onStateChange('LIGHT_WARN', 'Low lighting detected. Ensure your hand is visible.');
    }
  }

  private startSupervisor(): void {
    this.stopSupervisor();
    this.heartbeatIntervalId = window.setInterval(() => {
      if (!this.worker || !this.isTracking) return;

      // Send ping to worker
      this.worker.postMessage({ type: 'PING' });

      // Never declare a hang while the worker is still loading its model.
      if (!this.workerInitialized) {
        if (performance.now() - this.workerSpawnedAt > INIT_GRACE_MS) {
          console.warn('Worker failed to initialize within the grace window.');
          this.recoverWorker();
        }
        return;
      }

      // Check if thread is hanging (no responses for the timeout window)
      const elapsed = performance.now() - this.lastHeartbeat;
      if (elapsed > HEARTBEAT_TIMEOUT_MS) {
        console.warn('Worker thread hung. Terminating and recovering...');
        this.recoverWorker();
      }
    }, 1500);
  }

  private stopSupervisor(): void {
    if (this.heartbeatIntervalId !== null) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  /**
   * Respawns the tracking worker with exponential back-off and a hard attempt
   * cap. Unbounded immediate respawns re-downloaded the ~10MB WASM bundle on
   * every crash, which is what took the whole tab down.
   */
  private recoverWorker(): void {
    if (!this.isTracking) return;
    if (this.recoveryTimeoutId !== null) return; // a recovery is already queued

    this.recoveryAttempts++;
    if (this.recoveryAttempts > MAX_RECOVERY_ATTEMPTS) {
      console.error('Hand tracking failed repeatedly; disabling gesture input.');
      this.stop();
      this.onStateChange('ERROR', 'Hand tracking unavailable. Switched to Touch mode.');
      return;
    }

    // Tear the broken worker down immediately so it stops consuming the GPU.
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.workerInitialized = false;
    this.isWorkerBusy = false;

    const backoffMs = 500 * Math.pow(2, this.recoveryAttempts - 1);
    this.onStateChange('RECOVERING', 'Reconnecting hand tracking service...');
    this.recoveryTimeoutId = window.setTimeout(() => {
      this.recoveryTimeoutId = null;
      if (!this.isTracking) return;
      this.initWorker();
    }, backoffMs);
  }
}
