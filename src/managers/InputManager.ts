import { TrackingResult, Vec2, Vec3 } from '../types';
import { KalmanFilter } from '../utils/KalmanFilter';
import { AdaptiveSmoother } from '../utils/AdaptiveSmoother';
import { VelocityPredictor } from '../utils/VelocityPredictor';

/** A gesture must hold steady this long before it counts as intentional. */
const GESTURE_CONFIRM_MS = 90;
/** Landmark-space thresholds. Separate enter/exit values give hysteresis so a
 *  hand hovering on the boundary cannot chatter the gesture on and off. */
const PINCH_ENTER = 0.050;
const PINCH_EXIT = 0.080;
const FIST_ENTER = 0.085;
const FIST_EXIT = 0.115;
/** Losing the hand for longer than this restarts the filters instead of
 *  interpolating across the gap (which produced a long cursor slide). */
const REACQUIRE_RESET_MS = 500;

export class InputManager {
  private kalman = new KalmanFilter();
  private smoother = new AdaptiveSmoother(0.8, 0.015, 1.0);
  private predictor = new VelocityPredictor();

  // Current smoothed screen cursor coordinates
  private cursor: Vec2 = { x: 0, y: 0 };
  private extrapolatedCursor: Vec2 = { x: 0, y: 0 };

  // Cursor position captured the moment tracking was lost. Dead reckoning is
  // applied as a displacement from this anchor, never as an absolute position.
  private lossAnchor: Vec2 = { x: 0, y: 0 };
  private wasHandPresent = false;

  // Gesture flags — `raw` is this frame's geometry, `held` is the debounced
  // state, and `edge` is a one-shot pulse consumed by the reader.
  private rawPinch = false;
  private rawFist = false;
  private pinchHeld = false;
  private fistHeld = false;
  private pinchEdge = false;
  private fistEdge = false;
  private pinchSince = 0;
  private fistSince = 0;

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
    this.clearGestures();
    this.triggerShieldForce = false;
    this.triggerEMPForce = false;
    if (mode === 'touch') {
      this.handPresent = false;
    }
  }

  public getControlMode(): 'hand' | 'touch' {
    return this.controlMode;
  }

  /**
   * Drops every gesture flag, including pending edges. Called whenever the
   * hand leaves the frame or the control mode changes — otherwise the last
   * gesture stays latched and keeps re-firing shields and EMPs on its own.
   */
  private clearGestures(): void {
    this.rawPinch = false;
    this.rawFist = false;
    this.pinchHeld = false;
    this.fistHeld = false;
    this.pinchEdge = false;
    this.fistEdge = false;
    this.pinchSince = 0;
    this.fistSince = 0;
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

  /** Rejects malformed landmark payloads before they poison the filters with NaN. */
  private isValidLandmarkSet(landmarks: Vec3[] | undefined | null): boolean {
    if (!landmarks || landmarks.length < 21) return false;
    for (let i = 0; i < 21; i++) {
      const lm = landmarks[i];
      if (!lm) return false;
      if (!Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return false;
    }
    return true;
  }

  /**
   * Processes raw hand landmarks received asynchronously from the Web Worker.
   */
  public updateTracking(result: TrackingResult): void {
    if (this.controlMode === 'touch') {
      this.handPresent = false;
      this.clearGestures();
      return;
    }

    const now = performance.now();
    this.rawConfidence = result.confidence;

    if (!result.handPresent || !this.isValidLandmarkSet(result.landmarks)) {
      this.handPresent = false;
      // The hand is gone, so no gesture is being made. Without this the last
      // fist/pinch stayed true forever and the game kept acting on it.
      this.clearGestures();
      return;
    }

    const gapMs = this.lastValidTrackingTime === 0 ? Infinity : now - this.lastValidTrackingTime;
    if (gapMs > REACQUIRE_RESET_MS) {
      // Long gap: start clean rather than filtering across the discontinuity.
      this.smoother.reset();
      this.predictor.reset();
      this.kalman.reset(this.cursor.x, this.cursor.y);
    }

    this.handPresent = true;
    const dt = Number.isFinite(gapMs) ? gapMs / 1000.0 : 0.016;
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
    this.smoother.filter(rawScreenX, rawScreenY, Math.min(Math.max(dt, 0.005), 0.1), this.tempVec);

    // 3. Feed the filtered position into the Kalman Filter for velocity-based tracking
    this.kalman.correct(this.tempVec.x, this.tempVec.y);

    // 4. Compute gestures geometrically from 21 landmarks
    this.detectGestures(result.landmarks, now);
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
      if (Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
        this.cursor.x = pos.x;
        this.cursor.y = pos.y;
      } else {
        // Numerical blow-up in the filter: re-seed rather than propagate NaN,
        // which would otherwise make every collision test silently fail.
        this.kalman.reset(this.cursor.x, this.cursor.y);
      }
      this.wasHandPresent = true;
    } else {
      // Tracking loss mode: dead-reckoning extrapolation
      this.trackingLossDuration = now - this.lastValidTrackingTime;

      if (this.wasHandPresent) {
        // Anchor to where the cursor actually is right now, so the handoff
        // from filtered tracking to dead reckoning is continuous.
        this.lossAnchor.x = this.cursor.x;
        this.lossAnchor.y = this.cursor.y;
        this.wasHandPresent = false;
      }

      if (this.trackingLossDuration < 150) {
        // Less than 150ms: carry the cursor along its velocity vector.
        // Applied as a displacement from the anchor — predict() returns an
        // absolute position based on the last RAW landmark, and using it here
        // snapped the cursor by the full smoothing lag on every dropped frame.
        this.predictor.predictDelta(now, this.extrapolatedCursor);
        this.cursor.x = this.lossAnchor.x + this.extrapolatedCursor.x;
        this.cursor.y = this.lossAnchor.y + this.extrapolatedCursor.y;
      }

      // Prevent the Kalman filter from drifting while the hand is out of frame
      this.kalman.reset(this.cursor.x, this.cursor.y);
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
    this.wasHandPresent = true;
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

  /**
   * One-shot read of the EMP trigger. Returns true only on the frame a new
   * pinch is confirmed; holding the pinch does not re-fire it.
   */
  public getPinch(): boolean {
    if (this.controlMode === 'touch') {
      const val = this.triggerEMPForce;
      this.triggerEMPForce = false;
      return val;
    }
    const val = this.pinchEdge;
    this.pinchEdge = false;
    return val;
  }

  /**
   * One-shot read of the shield trigger. Returns true only on the frame a new
   * fist is confirmed; holding the fist does not re-fire it.
   */
  public getFist(): boolean {
    if (this.controlMode === 'touch') {
      const val = this.triggerShieldForce;
      this.triggerShieldForce = false;
      return val;
    }
    const val = this.fistEdge;
    this.fistEdge = false;
    return val;
  }

  /**
   * Discards any pending gesture edge. Called when a round starts so a gesture
   * made on the menu screen does not fire the instant gameplay begins.
   */
  public clearGestureEdges(): void {
    this.pinchEdge = false;
    this.fistEdge = false;
    this.triggerShieldForce = false;
    this.triggerEMPForce = false;
  }

  /** Debounced hold state, for HUD/feedback that wants the continuous value. */
  public isPinchHeld(): boolean { return this.pinchHeld; }
  public isFistHeld(): boolean { return this.fistHeld; }

  public getConfidence(): number {
    return this.rawConfidence;
  }

  /**
   * Geometric calculation of hand gestures.
   */
  private detectGestures(landmarks: Vec3[], now: number): void {
    // 1. Fist: distance between fingertips and their knuckles.
    // Knuckles: 5 (index), 9 (middle), 13 (ring), 17 (pinky)
    // Tips: 8 (index), 12 (middle), 16 (ring), 20 (pinky)
    let totalTipToKnuckleDist = 0;
    const jointPairs = [[8, 5], [12, 9], [16, 13], [20, 17]];

    for (const pair of jointPairs) {
      const tip = landmarks[pair[0]];
      const knuckle = landmarks[pair[1]];
      const jx = tip.x - knuckle.x;
      const jy = tip.y - knuckle.y;
      const jz = (tip.z || 0) - (knuckle.z || 0);
      totalTipToKnuckleDist += Math.sqrt(jx * jx + jy * jy + jz * jz);
    }

    // A fist has curled fingers, so the tips sit close to the knuckles.
    const avgTipKnuckleDist = totalTipToKnuckleDist / 4;
    this.rawFist = this.rawFist
      ? avgTipKnuckleDist < FIST_EXIT
      : avgTipKnuckleDist < FIST_ENTER;

    // 2. Pinch: distance between thumb tip (4) and index tip (8).
    const tTip = landmarks[4];
    const iTip = landmarks[8];
    const dx = tTip.x - iTip.x;
    const dy = tTip.y - iTip.y;
    const dz = (tTip.z || 0) - (iTip.z || 0);
    const pinchDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const pinchGeometry = this.rawPinch
      ? pinchDist < PINCH_EXIT
      : pinchDist < PINCH_ENTER;

    // A closed fist also puts the thumb tip next to the index tip. Without
    // this exclusion a single fist fired the shield and the EMP together.
    this.rawPinch = pinchGeometry && !this.rawFist;

    this.fistEdge = this.updateGestureLatch('fist', this.rawFist, now) || this.fistEdge;
    this.pinchEdge = this.updateGestureLatch('pinch', this.rawPinch, now) || this.pinchEdge;
  }

  /**
   * Debounces one raw gesture signal. Returns true on the frame the gesture
   * transitions from released to confirmed-held.
   */
  private updateGestureLatch(which: 'fist' | 'pinch', raw: boolean, now: number): boolean {
    const held = which === 'fist' ? this.fistHeld : this.pinchHeld;
    let since = which === 'fist' ? this.fistSince : this.pinchSince;
    let rising = false;

    if (raw) {
      if (since === 0) since = now;
      if (!held && now - since >= GESTURE_CONFIRM_MS) {
        rising = true;
        if (which === 'fist') this.fistHeld = true; else this.pinchHeld = true;
      }
    } else {
      since = 0;
      if (which === 'fist') this.fistHeld = false; else this.pinchHeld = false;
    }

    if (which === 'fist') this.fistSince = since; else this.pinchSince = since;
    return rising;
  }
}
