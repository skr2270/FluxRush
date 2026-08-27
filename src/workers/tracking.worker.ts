import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let handLandmarker: HandLandmarker | null = null;
let isInitializing = false;

// MediaPipe's VIDEO running mode requires strictly increasing timestamps.
// A repeated or out-of-order value makes detectForVideo throw and, on some
// builds, corrupt the graph so every later frame throws too.
let lastTimestamp = -1;

async function createLandmarker(vision: any, delegate: 'GPU' | 'CPU') {
  return HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate
    },
    runningMode: 'VIDEO',
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
}

async function initHandTracking() {
  if (handLandmarker || isInitializing) return;
  isInitializing = true;

  try {
    // Fetch WASM files from jsdelivr CDN
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm'
    );

    // Bypassing Emscripten module-scoping limitations in ESM Workers (ModuleFactory not set)
    if (vision.wasmLoaderPath) {
      const response = await fetch(vision.wasmLoaderPath);
      const scriptContent = await response.text();
      // Execute the loader script in the worker global scope
      (self as any).ModuleFactory = undefined; // reset
      eval?.(scriptContent);

      // Prevent tasks-vision from attempting to re-fetch/re-execute the loader
      delete (vision as any).wasmLoaderPath;
    }

    // Prefer the GPU delegate, but fall back to CPU. Requesting GPU on a
    // machine without a usable WebGL2 context throws inside the WASM module,
    // which previously surfaced as a hard worker crash and a respawn loop.
    try {
      handLandmarker = await createLandmarker(vision, 'GPU');
    } catch (gpuError) {
      console.warn('GPU delegate unavailable, falling back to CPU:', gpuError);
      handLandmarker = await createLandmarker(vision, 'CPU');
    }

    lastTimestamp = -1;
    isInitializing = false;
    self.postMessage({ type: 'INITIALIZED' });
  } catch (error) {
    // Clear the flag so a later INIT (after supervisor recovery) can retry.
    isInitializing = false;
    self.postMessage({
      type: 'ERROR',
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

self.onmessage = async (event: MessageEvent) => {
  const { type } = event.data;

  if (type === 'INIT') {
    await initHandTracking();
    return;
  }

  if (type === 'PING') {
    self.postMessage({ type: 'PONG' });
    return;
  }

  if (type === 'PROCESS_FRAME') {
    const { bitmap, timestamp } = event.data;

    // Every PROCESS_FRAME must answer exactly once. The main thread holds an
    // `isWorkerBusy` latch that is only released by a reply; a silent return
    // here permanently stalls tracking with no error anywhere.
    if (!handLandmarker) {
      if (bitmap) (bitmap as ImageBitmap).close();
      self.postMessage({ type: 'FRAME_SKIPPED', reason: 'not-initialized' });
      return;
    }

    // Force a strictly increasing timestamp regardless of what the main thread sent.
    const safeTimestamp = timestamp > lastTimestamp ? timestamp : lastTimestamp + 1;
    lastTimestamp = safeTimestamp;

    try {
      const startTime = performance.now();
      const result = handLandmarker.detectForVideo(bitmap, safeTimestamp);
      const inferenceTime = performance.now() - startTime;

      const handPresent = !!(result.landmarks && result.landmarks.length > 0);
      const landmarks = handPresent ? result.landmarks[0] : [];
      const score = handPresent && result.handednesses && result.handednesses.length > 0 && result.handednesses[0].length > 0
        ? result.handednesses[0][0].score
        : 0;

      self.postMessage({
        type: 'RESULTS',
        handPresent,
        landmarks,
        confidence: score,
        latencyMs: inferenceTime,
        timestamp: safeTimestamp
      });
    } catch (err) {
      // A per-frame inference failure is recoverable: report it as a skipped
      // frame so the main thread releases the busy latch without tearing the
      // worker down and re-downloading the model.
      self.postMessage({
        type: 'FRAME_SKIPPED',
        reason: err instanceof Error ? err.message : String(err)
      });
    } finally {
      if (bitmap) {
        (bitmap as ImageBitmap).close(); // Critical: prevent GPU/CPU memory leak
      }
    }
  }
};
