export class AdaptiveSmoother {
  private fcMin: number;
  private beta: number;
  private dCutoff: number;

  private prevX = 0;
  private prevY = 0;
  private prevRawX = 0;
  private prevRawY = 0;
  private prevDx = 0;
  private prevDy = 0;
  private hasPrev = false;

  /**
   * @param fcMin Minimum cutoff frequency in Hz (lower = more smoothing at rest, e.g., 0.5 - 1.5)
   * @param beta Speed coefficient (higher = less lag during fast movements, e.g., 0.005 - 0.02)
   * @param dCutoff Cutoff frequency for derivative smoothing in Hz (usually 1.0)
   */
  constructor(fcMin = 0.8, beta = 0.015, dCutoff = 1.0) {
    this.fcMin = fcMin;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  public reset(): void {
    this.hasPrev = false;
    this.prevX = 0;
    this.prevY = 0;
    this.prevRawX = 0;
    this.prevRawY = 0;
    this.prevDx = 0;
    this.prevDy = 0;
  }

  /**
   * Applies 1Euro filter equations to smooth (x, y) coordinates.
   * Modifies outputs in-place or returns them, allocation-free.
   */
  public filter(rawX: number, rawY: number, dt: number, out: { x: number; y: number }): void {
    if (dt <= 0) {
      out.x = this.prevX;
      out.y = this.prevY;
      return;
    }

    if (!this.hasPrev) {
      this.prevRawX = rawX;
      this.prevRawY = rawY;
      this.prevX = rawX;
      this.prevY = rawY;
      this.prevDx = 0;
      this.prevDy = 0;
      this.hasPrev = true;

      out.x = rawX;
      out.y = rawY;
      return;
    }

    // 1. Calculate velocity (dx, dy)
    const dx = (rawX - this.prevRawX) / dt;
    const dy = (rawY - this.prevRawY) / dt;

    // 2. Smooth velocity (using simple exponential smoothing with constant cutoff dCutoff)
    const alphaD = this.calculateAlpha(this.dCutoff, dt);
    const smoothedDx = this.prevDx + alphaD * (dx - this.prevDx);
    const smoothedDy = this.prevDy + alphaD * (dy - this.prevDy);

    // 3. Compute speed (magnitude of smoothed velocity)
    const speed = Math.sqrt(smoothedDx * smoothedDx + smoothedDy * smoothedDy);

    // 4. Calculate adaptive cutoff frequency and alpha for position
    const fc = this.fcMin + this.beta * speed;
    const alpha = this.calculateAlpha(fc, dt);

    // 5. Smooth position
    const smoothedX = this.prevX + alpha * (rawX - this.prevX);
    const smoothedY = this.prevY + alpha * (rawY - this.prevY);

    // 6. Save current state
    this.prevRawX = rawX;
    this.prevRawY = rawY;
    this.prevX = smoothedX;
    this.prevY = smoothedY;
    this.prevDx = smoothedDx;
    this.prevDy = smoothedDy;

    // Output values
    out.x = smoothedX;
    out.y = smoothedY;
  }

  private calculateAlpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }
}
