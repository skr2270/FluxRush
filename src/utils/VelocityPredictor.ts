import { Vec2 } from '../types';

export class VelocityPredictor {
  private prevX = 0;
  private prevY = 0;
  private vx = 0;
  private vy = 0;
  private ax = 0;
  private ay = 0;
  private lastTimestamp = 0;
  private hasHistory = false;

  // Smoothing factors for velocity and acceleration
  private readonly velocityWeight = 0.7; // Exponential smoothing factor for velocity
  private readonly accelerationWeight = 0.4; // Exponential smoothing factor for acceleration
  private readonly maxPredictDt = 0.15; // Max prediction window in seconds (150ms)
  private readonly dragFactor = 0.90; // Deceleration damping factor during tracking loss

  public reset(): void {
    this.hasHistory = false;
    this.prevX = 0;
    this.prevY = 0;
    this.vx = 0;
    this.vy = 0;
    this.ax = 0;
    this.ay = 0;
    this.lastTimestamp = 0;
  }

  /**
   * Updates state with a new raw position and timestamp (in ms).
   */
  public update(x: number, y: number, timestampMs: number): void {
    if (this.lastTimestamp === 0 || timestampMs <= this.lastTimestamp) {
      this.prevX = x;
      this.prevY = y;
      this.lastTimestamp = timestampMs;
      this.vx = 0;
      this.vy = 0;
      this.ax = 0;
      this.ay = 0;
      this.hasHistory = true;
      return;
    }

    const dt = (timestampMs - this.lastTimestamp) / 1000.0; // convert to seconds
    this.lastTimestamp = timestampMs;

    // Calculate instantaneous velocity
    const instVx = (x - this.prevX) / dt;
    const instVy = (y - this.prevY) / dt;

    // Apply exponential smoothing to velocity
    const nextVx = this.vx + this.velocityWeight * (instVx - this.vx);
    const nextVy = this.vy + this.velocityWeight * (instVy - this.vy);

    // Calculate instantaneous acceleration
    const instAx = (nextVx - this.vx) / dt;
    const instAy = (nextVy - this.vy) / dt;

    // Apply exponential smoothing to acceleration
    this.ax = this.ax + this.accelerationWeight * (instAx - this.ax);
    this.ay = this.ay + this.accelerationWeight * (instAy - this.ay);

    this.vx = nextVx;
    this.vy = nextVy;
    this.prevX = x;
    this.prevY = y;
  }

  /**
   * Extrapolates position to current time (currentTimestampMs) using velocity and acceleration.
   */
  public predict(currentTimestampMs: number, out: Vec2): void {
    if (!this.hasHistory) {
      out.x = 0;
      out.y = 0;
      return;
    }

    const dt = (currentTimestampMs - this.lastTimestamp) / 1000.0;

    // If request timestamp is in the past, return the last known position
    if (dt <= 0) {
      out.x = this.prevX;
      out.y = this.prevY;
      return;
    }

    // Bound the prediction time window to prevent wild runaway values during long tracking losses
    const predictionDt = Math.min(dt, this.maxPredictDt);

    // Apply a drag/deceleration multiplier when we are extrapolating beyond normal tracking update intervals
    // (normal interval is ~33ms at 30fps. If dt > 45ms, start damping velocity to prevent cursor fly-offs)
    let damping = 1.0;
    if (dt > 0.04) {
      damping = Math.pow(this.dragFactor, (dt - 0.04) / 0.016);
    }

    // Kinematic motion equation: X_new = X + V * dt + 0.5 * A * dt^2
    out.x = this.prevX + (this.vx * predictionDt + 0.5 * this.ax * predictionDt * predictionDt) * damping;
    out.y = this.prevY + (this.vy * predictionDt + 0.5 * this.ay * predictionDt * predictionDt) * damping;
  }

  public getVelocity(): Vec2 {
    return { x: this.vx, y: this.vy };
  }
}
