import { TrackingResult } from '../types';

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

  // Callback hooks
  private onResults: (res: TrackingResult) => void;
  private onStateChange: (state: 'LOADING' | 'READY' | 'ERROR' | 'LIGHT_WARN' | 'RECOVERING', msg?: string) => void;

  // Tiny canvas for low-light estimation
  private lightCanvas: OffscreenCanvas | null = null;
  private lightCtx: OffscreenCanvasRenderingContext2D | null = null;
  private lastLightCheck = 0;

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
    this.lightCtx = this.lightCanvas.getContext('2d', { alpha: false });
  }

  public async start(): Promise<void> {
    this.onStateChange('LOADING', 'Accessing camera...');
    try {
      this.video = document.createElement('video');
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('muted', '');
      
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
      
      await new Promise<void>((resolve) => {
        if (!this.video) return;
        this.video.onloadedmetadata = () => {
          this.video!.play().then(() => resolve());
        };
      });

      this.isTracking = true;
      this.initWorker();
      this.startSupervisor();
      this.loop();
    } catch (err) {
      this.onStateChange('ERROR', 'Camera access denied or unavailable. Falling back to Touch.');
      console.error('Camera init error:', err);
    }
  }

  public stop(): void {
    this.isTracking = false;
    if (this.trackingFrameId) {
      cancelAnimationFrame(this.trackingFrameId);
    }
    this.stopSupervisor();

    if (this.video && this.video.srcObject) {
      const stream = this.video.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      this.video.srcObject = null;
    }

    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerInitialized = false;
  }

  private initWorker(): void {
    if (this.worker) {
      this.worker.terminate();
    }

    this.isWorkerBusy = false;
    this.workerInitialized = false;
    this.lastHeartbeat = performance.now();

    // Spawn the worker using Vite URLs
    this.worker = new Worker(new URL('../workers/tracking.worker.ts', import.meta.url), {
      type: 'module'
    });

    this.worker.onmessage = (e: MessageEvent) => {
      const { type } = e.data;
      this.lastHeartbeat = performance.now();

      if (type === 'INITIALIZED') {
        this.workerInitialized = true;
        this.onStateChange('READY');
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
      } else if (type === 'ERROR') {
        console.error('Worker error:', e.data.error);
        this.isWorkerBusy = false;
      }
    };

    this.worker.onerror = (err) => {
      console.error('Worker supervisor detected thread crash:', err);
      this.recoverWorker();
    };

    this.worker.postMessage({ type: 'INIT' });
  }

  private loop = (): void => {
    if (!this.isTracking) return;

    this.trackingFrameId = requestAnimationFrame(this.loop);

    if (!this.video || !this.worker || !this.workerInitialized || this.isWorkerBusy) {
      return;
    }

    try {
      // 1. Draw video frame to offscreen canvas
      if (this.offscreenCtx && this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
        this.offscreenCtx.drawImage(this.video, 0, 0, this.width, this.height);
        
        // 2. Transfer ImageBitmap (Zero-copy transfer)
        const bitmap = this.offscreenCanvas!.transferToImageBitmap();
        this.isWorkerBusy = true;
        this.worker.postMessage(
          {
            type: 'PROCESS_FRAME',
            bitmap,
            timestamp: performance.now()
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

    // Under 30% intensity is considered low-light
    if (brightnessPct < 0.28) {
      this.onStateChange('LIGHT_WARN', 'Low lighting detected. Ensure your hand is visible.');
    }
  }

  private startSupervisor(): void {
    this.heartbeatIntervalId = window.setInterval(() => {
      if (!this.worker) return;

      // Send ping to worker
      this.worker.postMessage({ type: 'PING' });

      // Check if thread is hanging (no responses for > 3.5 seconds)
      const elapsed = performance.now() - this.lastHeartbeat;
      if (elapsed > 3500) {
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

  private recoverWorker(): void {
    this.onStateChange('RECOVERING', 'Reconnecting hand tracking service...');
    this.initWorker();
  }
}
