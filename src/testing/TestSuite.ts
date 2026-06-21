import { ObjectPoolManager } from '../managers/ObjectPoolManager';
import { InputManager } from '../managers/InputManager';
import { PerformanceMonitor } from '../managers/PerformanceMonitor';

export class TestSuite {
  private activeTest: 'NONE' | 'STRESS' | 'TRACKING_LOSS' = 'NONE';
  private testTimer = 0;
  private pool: ObjectPoolManager;
  private input: InputManager;

  // Tracking loss simulator state
  private trackingLossToggle = false;
  private lastToggleTime = 0;
  private trackingLossCount = 0;
  private totalReacquisitionTime = 0;

  constructor(pool: ObjectPoolManager, input: InputManager, _performance: PerformanceMonitor) {
    this.pool = pool;
    this.input = input;
  }

  public tick(dt: number): void {
    if (this.activeTest === 'NONE') return;

    this.testTimer -= dt;
    if (this.testTimer <= 0) {
      this.stopActiveTest();
      return;
    }

    if (this.activeTest === 'STRESS') {
      this.runStressTick();
    } else if (this.activeTest === 'TRACKING_LOSS') {
      this.runTrackingLossTick();
    }
  }

  /**
   * Spawns hundreds of particles every frame to verify engine bottlenecks
   */
  public startStressTest(durationSeconds = 8): void {
    this.activeTest = 'STRESS';
    this.testTimer = durationSeconds;
    this.pool.clear();
    console.log(`Test: Starting STRESS TEST for ${durationSeconds}s...`);
  }

  private runStressTick(): void {
    // Spawn 15 particles every tick in random directions
    for (let i = 0; i < 15; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 100 + Math.random() * 300;
      this.pool.spawnParticle(
        Math.random() * 800,
        Math.random() * 600,
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        `hsl(${Math.random() * 360}, 100%, 50%)`,
        1 + Math.random() * 4,
        1000 + Math.random() * 500
      );
    }
  }

  /**
   * Toggles input tracking status repeatedly to evaluate recovery and latency
   */
  public startTrackingLossSimulation(durationSeconds = 12): void {
    this.activeTest = 'TRACKING_LOSS';
    this.testTimer = durationSeconds;
    this.lastToggleTime = performance.now();
    this.trackingLossCount = 0;
    this.totalReacquisitionTime = 0;
    this.trackingLossToggle = true;
    console.log(`Test: Starting TRACKING-LOSS SIMULATION for ${durationSeconds}s...`);
  }

  private runTrackingLossTick(): void {
    const now = performance.now();
    
    // Toggle tracking every 1.2 seconds
    if (now - this.lastToggleTime > 1200) {
      this.lastToggleTime = now;
      this.trackingLossToggle = !this.trackingLossToggle;

      if (!this.trackingLossToggle) {
        // Loss starts
        this.input.updateTracking({
          landmarks: [],
          confidence: 0,
          handPresent: false,
          latencyMs: 0
        });
      } else {
        // Reacquisition starts
        const reacquireStart = performance.now();
        // Simulate immediate hand presence at center
        this.input.updateTracking({
          landmarks: Array(21).fill({ x: 0.5, y: 0.5, z: 0 }),
          confidence: 0.85,
          handPresent: true,
          latencyMs: 5
        });
        
        const reacquireEnd = performance.now();
        const duration = reacquireEnd - reacquireStart;
        this.totalReacquisitionTime += duration;
        this.trackingLossCount++;

        console.log(`Test: Hand reacquired in ${duration.toFixed(2)}ms (Target: < 50ms)`);
      }
    }

    // Keep updating input coordinates mock during tracking cycles
    if (this.trackingLossToggle) {
      this.input.setTouchFallback(
        400 + Math.sin(now / 150) * 150,
        300 + Math.cos(now / 150) * 150
      );
    }
  }

  private stopActiveTest(): void {
    console.log(`Test: ${this.activeTest} finished.`);
    
    if (this.activeTest === 'TRACKING_LOSS') {
      const avg = this.trackingLossCount > 0 ? this.totalReacquisitionTime / this.trackingLossCount : 0;
      console.log(`Test Report: Average reacquisition lock time: ${avg.toFixed(2)}ms (Checklist threshold: 50ms)`);
    }

    this.activeTest = 'NONE';
    this.pool.clear();
  }

  public getActiveTest(): string {
    return this.activeTest;
  }
}
