import { TrackingResult, Vec2, Vec3 } from '../types';
import { KalmanFilter } from '../utils/KalmanFilter';
import { AdaptiveSmoother } from '../utils/AdaptiveSmoother';
import { VelocityPredictor } from '../utils/VelocityPredictor';

export class InputManager {
  private kalman = new KalmanFilter();
  private smoother = new AdaptiveSmoother(0.8, 0.015, 1.0);
  private predictor = new VelocityPredictor();

  // Current smoothed screen cursor coordinates
  private cursor: Vec2 = { x: 0, y: 0 };
  private extrapolatedCursor: Vec2 = { x: 0, y: 0 };

  // Gesture flags
  private isPinching = false;
  private isFist = false;
  private handPresent = false;
  private rawConfidence = 0;

  private controlMode: 'hand' | 'touch' = 'hand';
  private triggerShieldForce = false;
  private triggerEMPForce = false;

  private screenWidth = 800;
  private screenHeight = 600;

  // Tracking loss timers
  private lastValidTrackingTime = 0;
  private trackingLossDuration = 0;

  // Temporary container to avoid allocations in update ticks
  private tempVec: Vec2 = { x: 0, y: 0 };

  constructor() {
  }

  public setControlMode(mode: 'hand' | 'touch'): void {
    this.controlMode = mode;
    if (mode === 'touch') {
      this.handPresent = false;
      this.isFist = false;
      this.isPinching = false;
      this.triggerShieldForce = false;
      this.triggerEMPForce = false;
    }
  }

  public getControlMode(): 'hand' | 'touch' {
    return this.controlMode;
  }

  public triggerTouchShield(): void {
    if (this.controlMode === 'touch') {
      this.triggerShieldForce = true;
    }
  }

  public triggerTouchEMP(): void {
    if (this.controlMode === 'touch') {
      this.triggerEMPForce = true;
    }
  }

  public resize(width: number, height: number): void {
    this.screenWidth = width;
    this.screenHeight = height;
  }

  /**
   * Processes raw hand landmarks received asynchronously from the Web Worker.
   */
  public updateTracking(result: TrackingResult): void {
    if (this.controlMode === 'touch') {
      this.handPresent = false;
      return;
    }

    const now = performance.now();
    this.rawConfidence = result.confidence;

    if (!result.handPresent || result.landmarks.length < 21) {
      this.handPresent = false;
      return;
    }

    this.handPresent = true;
    const dt = this.lastValidTrackingTime === 0 ? 0.016 : (now - this.lastValidTrackingTime) / 1000.0;
    this.lastValidTrackingTime = now;
    this.trackingLossDuration = 0;

    // Index fingertip is landmark 8
    const indexTip = result.landmarks[8];

    // Mirror X coordinate because camera feeds are mirrored
    const rawScreenX = (1.0 - indexTip.x) * this.screenWidth;
    const rawScreenY = indexTip.y * this.screenHeight;

    // 1. Predict and update velocity predictor with new raw points
    this.predictor.update(rawScreenX, rawScreenY, now);

    // 2. Apply adaptive exponential smoothing to filter high-frequency noise
    this.smoother.filter(rawScreenX, rawScreenY, Math.max(dt, 0.005), this.tempVec);

    // 3. Feed the filtered position into the Kalman Filter for velocity-based tracking
    this.kalman.correct(this.tempVec.x, this.tempVec.y);

    // 4. Compute gestures geometrically from 21 landmarks
    this.detectGestures(result.landmarks);
  }

  /**
   * Called on every animation frame (60/120 FPS). Updates the current cursor position.
   * Extrapolates coordinates between worker ticks or during brief tracking losses.
   */
  public tick(dt: number): void {
    const now = performance.now();
    this.kalman.predict(dt);

    if (this.controlMode === 'touch') {
      // In touch/keyboard fallback mode, do not apply Kalman prediction drift during idle frames.
      // The cursor should stay exactly where the pointer or keyboard set it.
      this.cursor.x = Math.max(0, Math.min(this.cursor.x, this.screenWidth));
      this.cursor.y = Math.max(0, Math.min(this.cursor.y, this.screenHeight));
      return;
    }

    if (this.handPresent) {
      // Direct reading from Kalman filter
      const pos = this.kalman.getPosition();
      this.cursor.x = pos.x;
      this.cursor.y = pos.y;
    } else {
      // Tracking loss mode: dead-reckoning extrapolation
      this.trackingLossDuration = now - this.lastValidTrackingTime;

      if (this.trackingLossDuration < 150) {
        // Less than 150ms: project cursor along its velocity vector
        this.predictor.predict(now, this.extrapolatedCursor);
        this.cursor.x = this.extrapolatedCursor.x;
        this.cursor.y = this.extrapolatedCursor.y;

        // Correct the Kalman state to match the prediction to prevent a jump when tracking returns
        this.kalman.reset(this.cursor.x, this.cursor.y);
      } else {
        // Decelerate and stay at exit point, do not teleport
        const velocity = this.predictor.getVelocity();
        velocity.x *= 0.90;
        velocity.y *= 0.90;
      }
    }

    // Keep cursor inside screen bounds
    this.cursor.x = Math.max(0, Math.min(this.cursor.x, this.screenWidth));
    this.cursor.y = Math.max(0, Math.min(this.cursor.y, this.screenHeight));
  }

  /**
   * Fallback touch input support if camera permission is denied or hand not tracked.
   */
  public setTouchFallback(x: number, y: number): void {
    this.handPresent = true;
    this.lastValidTrackingTime = performance.now();
    this.trackingLossDuration = 0;
    this.kalman.correct(x, y);
    this.cursor.x = x;
    this.cursor.y = y;
  }

  public getCursor(): Vec2 {
    return this.cursor;
  }

  public isHandVisible(): boolean {
    return this.handPresent && this.trackingLossDuration < 150;
  }

  public getPinch(): boolean {
    if (this.controlMode === 'touch') {
      const val = this.triggerEMPForce;
      this.triggerEMPForce = false;
      return val;
    }
    return this.isPinching;
  }

  public getFist(): boolean {
    if (this.controlMode === 'touch') {
      const val = this.triggerShieldForce;
      this.triggerShieldForce = false;
      return val;
    }
    return this.isFist;
  }

  public getConfidence(): number {
    return this.rawConfidence;
  }

  /**
   * Geometric calculation of hand gestures.
   */
  private detectGestures(landmarks: Vec3[]): void {
    // 1. Pinch: Distance between thumb tip (4) and index tip (8)
    const tTip = landmarks[4];
    const iTip = landmarks[8];

    const dx = tTip.x - iTip.x;
    const dy = tTip.y - iTip.y;
    const dz = tTip.z - iTip.z;
    const pinchDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    this.isPinching = pinchDist < 0.055;

    // 2. Fist: Distance between fingertip knuckles and base nodes.
    // Knuckles: 5 (index), 9 (middle), 13 (ring), 17 (pinky)
    // Tips: 8 (index), 12 (middle), 16 (ring), 20 (pinky)
    let totalTipToKnuckleDist = 0;
    const jointPairs = [[8, 5], [12, 9], [16, 13], [20, 17]];
    
    for (const pair of jointPairs) {
      const tip = landmarks[pair[0]];
      const knuckle = landmarks[pair[1]];
      const jx = tip.x - knuckle.x;
      const jy = tip.y - knuckle.y;
      const jz = tip.z - knuckle.z;
      totalTipToKnuckleDist += Math.sqrt(jx * jx + jy * jy + jz * jz);
    }

    // A fist has curled fingers, so the tips are close to knuckles (average distance < 0.08)
    const avgTipKnuckleDist = totalTipToKnuckleDist / 4;
    this.isFist = avgTipKnuckleDist < 0.085;
  }
}
