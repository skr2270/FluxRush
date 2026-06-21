export class KalmanFilter {
  // State variables: position (x, y) and velocity (vx, vy)
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;

  // Covariance matrix P (4x4 flat representation for performance)
  private p00 = 1; private p01 = 0; private p02 = 0; private p03 = 0;
  private p10 = 0; private p11 = 1; private p12 = 0; private p13 = 0;
  private p20 = 0; private p21 = 0; private p22 = 1; private p23 = 0;
  private p30 = 0; private p31 = 0; private p32 = 0; private p33 = 1;

  // Process Noise Q (diagonal components)
  private q_pos = 0.05; // noise in position
  private q_vel = 0.2;  // noise in velocity

  // Measurement Noise R (diagonal components)
  private r_pos = 0.15; // noise in tracking coordinates

  constructor() {
    this.reset(0, 0);
  }

  public reset(startX: number, startY: number): void {
    this.x = startX;
    this.y = startY;
    this.vx = 0;
    this.vy = 0;

    // Reset error covariance to small identity
    this.p00 = 1; this.p01 = 0; this.p02 = 0; this.p03 = 0;
    this.p10 = 0; this.p11 = 1; this.p12 = 0; this.p13 = 0;
    this.p20 = 0; this.p21 = 0; this.p22 = 1; this.p23 = 0;
    this.p30 = 0; this.p31 = 0; this.p32 = 0; this.p33 = 1;
  }

  /**
   * Predict the next state based on dt (time delta in seconds).
   * Allocation-free updates to class members.
   */
  public predict(dt: number): void {
    // 1. State prediction: x = x + vx * dt
    this.x = this.x + this.vx * dt;
    this.y = this.y + this.vy * dt;

    // F matrix: transition matrix
    // [1  0  dt  0]
    // [0  1  0  dt]
    // [0  0  1   0]
    // [0  0  0   1]

    // P_new = F * P * F^T + Q
    // We compute this in-place to avoid array allocations.
    const dt2 = dt * dt;

    // Let's make it simpler and mathematically solid using intermediate state.
    // The state transition elements:
    const p00_t = this.p00 + dt * (this.p20 + this.p02) + dt2 * this.p22 + this.q_pos;
    const p01_t = this.p01 + dt * (this.p30 + this.p03) + dt2 * this.p32;
    const p02_t = this.p02 + dt * this.p22;
    const p03_t = this.p03 + dt * this.p23;

    const p10_t = this.p10 + dt * (this.p20 + this.p12) + dt2 * this.p32;
    const p11_t = this.p11 + dt * (this.p31 + this.p13) + dt2 * this.p33 + this.q_pos;
    const p12_t = this.p12 + dt * this.p23;
    const p13_t = this.p13 + dt * this.p33;

    const p20_t = this.p20 + dt * this.p22;
    const p21_t = this.p21 + dt * this.p32;
    const p22_t = this.p22 + this.q_vel;
    const p23_t = this.p23;

    const p30_t = this.p30 + dt * this.p23;
    const p31_t = this.p31 + dt * this.p33;
    const p32_t = this.p32;
    const p33_t = this.p33 + this.q_vel;

    this.p00 = p00_t; this.p01 = p01_t; this.p02 = p02_t; this.p03 = p03_t;
    this.p10 = p10_t; this.p11 = p11_t; this.p12 = p12_t; this.p13 = p13_t;
    this.p20 = p20_t; this.p21 = p21_t; this.p22 = p22_t; this.p23 = p23_t;
    this.p30 = p30_t; this.p31 = p31_t; this.p32 = p32_t; this.p33 = p33_t;
  }

  /**
   * Correct the state with new sensor measurements (mx, my).
   * Allocation-free updates.
   */
  public correct(mx: number, my: number): void {
    // Measurement matrix H:
    // [1  0  0  0]
    // [0  1  0  0]
    
    // Innovation S = H * P * H^T + R
    // H * P is the first 2 rows of P.
    // H * P * H^T is the upper-left 2x2 of P.
    const s00 = this.p00 + this.r_pos;
    const s01 = this.p01;
    const s10 = this.p10;
    const s11 = this.p11 + this.r_pos;

    // Determinant of S for inversion
    const detS = s00 * s11 - s01 * s10;
    if (Math.abs(detS) < 1e-6) return;

    const invS00 = s11 / detS;
    const invS01 = -s01 / detS;
    const invS10 = -s10 / detS;
    const invS11 = s00 / detS;

    // Kalman Gain K = P * H^T * invS
    // P * H^T is the first two columns of P
    const k00 = this.p00 * invS00 + this.p01 * invS10;
    const k01 = this.p00 * invS01 + this.p01 * invS11;

    const k10 = this.p10 * invS00 + this.p11 * invS10;
    const k11 = this.p10 * invS01 + this.p11 * invS11;

    const k20 = this.p20 * invS00 + this.p21 * invS10;
    const k21 = this.p20 * invS01 + this.p21 * invS11;

    const k30 = this.p30 * invS00 + this.p31 * invS10;
    const k31 = this.p30 * invS01 + this.p31 * invS11;

    // Measurement residual (innovation) Y = Z - H * X
    const dyX = mx - this.x;
    const dyY = my - this.y;

    // Update state state X = X + K * Y
    this.x += k00 * dyX + k01 * dyY;
    this.y += k10 * dyX + k11 * dyY;
    this.vx += k20 * dyX + k21 * dyY;
    this.vy += k30 * dyX + k31 * dyY;

    // Update covariance P = (I - K * H) * P
    // I_KH = 4x4 matrix
    const ikh00 = 1 - k00; const ikh01 = -k01;
    const ikh10 = -k10;   const ikh11 = 1 - k11;
    
    // We compute (I - K * H) * P in-place.
    const p00_c = ikh00 * this.p00 + ikh01 * this.p10;
    const p01_c = ikh00 * this.p01 + ikh01 * this.p11;
    const p02_c = ikh00 * this.p02 + ikh01 * this.p12;
    const p03_c = ikh00 * this.p03 + ikh01 * this.p13;

    const p10_c = ikh10 * this.p00 + ikh11 * this.p10;
    const p11_c = ikh10 * this.p01 + ikh11 * this.p11;
    const p12_c = ikh10 * this.p02 + ikh11 * this.p12;
    const p13_c = ikh10 * this.p03 + ikh11 * this.p13;

    const p20_c = -k20 * this.p00 - k21 * this.p10 + this.p20;
    const p21_c = -k20 * this.p01 - k21 * this.p11 + this.p21;
    const p22_c = -k20 * this.p02 - k21 * this.p12 + this.p22;
    const p23_c = -k20 * this.p03 - k21 * this.p13 + this.p23;

    const p30_c = -k30 * this.p00 - k31 * this.p10 + this.p30;
    const p31_c = -k30 * this.p01 - k31 * this.p11 + this.p31;
    const p32_c = -k30 * this.p02 - k31 * this.p12 + this.p32;
    const p33_c = -k30 * this.p03 - k31 * this.p13 + this.p33;

    this.p00 = p00_c; this.p01 = p01_c; this.p02 = p02_c; this.p03 = p03_c;
    this.p10 = p10_c; this.p11 = p11_c; this.p12 = p12_c; this.p13 = p13_c;
    this.p20 = p20_c; this.p21 = p21_c; this.p22 = p22_c; this.p23 = p23_c;
    this.p30 = p30_c; this.p31 = p31_c; this.p32 = p32_c; this.p33 = p33_c;
  }

  public getPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  public getVelocity(): { x: number; y: number } {
    return { x: this.vx, y: this.vy };
  }
}
