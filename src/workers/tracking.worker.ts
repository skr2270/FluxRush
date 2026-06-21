import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let handLandmarker: HandLandmarker | null = null;
let isInitializing = false;

async function initHandTracking() {
  if (handLandmarker || isInitializing) return;
  isInitializing = true;

  try {
    // Fetch WASM files from jsdelivr CDN
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm'
    );

    // Create HandLandmarker with GPU delegate and single hand tracking limit
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    self.postMessage({ type: 'INITIALIZED' });
  } catch (error) {
    self.postMessage({
      type: 'ERROR',
      error: error instanceof Error ? error.message : String(error)
    });
    isInitializing = false;
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

    if (!handLandmarker) {
      if (bitmap) {
        (bitmap as ImageBitmap).close();
      }
      return;
    }

    try {
      const startTime = performance.now();
      const result = handLandmarker.detectForVideo(bitmap, timestamp);
      const inferenceTime = performance.now() - startTime;

      const handPresent = result.landmarks && result.landmarks.length > 0;
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
        timestamp
      });
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      if (bitmap) {
        (bitmap as ImageBitmap).close(); // Critical: prevent GPU/CPU memory leak
      }
    }
  }
};
