import { PerformanceStats, QualityTier } from '../types';

export class PerformanceMonitor {
  private currentQuality: QualityTier = 'HIGH';
  private fps = 60;
  private frameBudgetUtil = 0;
  private cpuPaintTimeMs = 0;

  // Frame counting state
  private frameCount = 0;
  private lastFpsUpdate = 0;
  private jsTimeAccumulator = 0;
  private paintTimeAccumulator = 0;

  // Adaptive threshold timers
  private lowFpsTimeAccumulator = 0;
  private highFpsTimeAccumulator = 0;
  private qualityLock = false; // Locks quality if we degraded once to prevent thrashing

  private onQualityChange: (quality: QualityTier) => void;

  constructor(onQualityChange: (quality: QualityTier) => void) {
    this.onQualityChange = onQualityChange;
    this.lastFpsUpdate = performance.now();
  }

  /**
   * Records frame performance statistics.
   * @param frameDurationMs Total frame duration (time between requestAnimationFrames)
   * @param jsDurationMs Time spent executing Javascript in the frame
   * @param paintDurationMs Time spent rendering canvas commands
   */
  public recordFrame(_frameDurationMs: number, jsDurationMs: number, paintDurationMs: number): void {
    const now = performance.now();
    this.frameCount++;

    this.jsTimeAccumulator += jsDurationMs;
    this.paintTimeAccumulator += paintDurationMs;

    const timeDelta = now - this.lastFpsUpdate;

    // Calculate FPS and averages every 500ms
    if (timeDelta >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / timeDelta);

      // Estimate baseline frame budget (16.6ms for 60FPS, 8.3ms for 120FPS)
      const targetFrameBudget = this.fps > 75 ? 8.33 : 16.67;

      const avgJsTime = this.jsTimeAccumulator / this.frameCount;
      this.frameBudgetUtil = Math.min(100, (avgJsTime / targetFrameBudget) * 100);
      this.cpuPaintTimeMs = this.paintTimeAccumulator / this.frameCount;

      // Reset accumulators
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      this.jsTimeAccumulator = 0;
      this.paintTimeAccumulator = 0;

      // Evaluate performance scaling
      this.evaluateAdaptiveQuality(timeDelta / 1000);
    }
  }

  private evaluateAdaptiveQuality(dt: number): void {
    // 1. Degrade Quality: If FPS drops below 55 OR JS budget utilization exceeds 90%
    if (this.fps < 54 || this.frameBudgetUtil > 90) {
      this.lowFpsTimeAccumulator += dt;
      this.highFpsTimeAccumulator = 0;

      if (this.lowFpsTimeAccumulator >= 3.0) {
        this.lowFpsTimeAccumulator = 0;
        this.degradeQuality();
      }
    } 
    // 2. Upgrade Quality: If FPS is stable (> 58 FPS for 60Hz or > 110 FPS for 120Hz) AND budget usage < 35%
    else if (this.fps >= 58 && this.frameBudgetUtil < 35) {
      this.highFpsTimeAccumulator += dt;
      this.lowFpsTimeAccumulator = 0;

      if (this.highFpsTimeAccumulator >= 10.0 && !this.qualityLock) {
        this.highFpsTimeAccumulator = 0;
        this.upgradeQuality();
      }
    } else {
      this.lowFpsTimeAccumulator = 0;
      this.highFpsTimeAccumulator = 0;
    }
  }

  private degradeQuality(): void {
    if (this.currentQuality === 'HIGH') {
      this.currentQuality = 'MEDIUM';
      this.onQualityChange('MEDIUM');
      console.log('Performance Monitor: Degraded quality to MEDIUM due to frame drops.');
    } else if (this.currentQuality === 'MEDIUM') {
      this.currentQuality = 'LOW';
      this.onQualityChange('LOW');
      this.qualityLock = true; // Stay on LOW to prevent oscillation
      console.log('Performance Monitor: Degraded quality to LOW due to persistent frame drops.');
    }
  }

  private upgradeQuality(): void {
    if (this.currentQuality === 'LOW' && !this.qualityLock) {
      this.currentQuality = 'MEDIUM';
      this.onQualityChange('MEDIUM');
    } else if (this.currentQuality === 'MEDIUM') {
      this.currentQuality = 'HIGH';
      this.onQualityChange('HIGH');
    }
  }

  public getStats(): PerformanceStats {
    let heapLimit = 0;
    if (performance && (performance as unknown as { memory: { usedJSHeapSize: number } }).memory) {
      heapLimit = (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / (1024 * 1024);
    }

    return {
      fps: this.fps,
      frameBudgetUtil: Math.round(this.frameBudgetUtil),
      cpuPaintTimeMs: Number(this.cpuPaintTimeMs.toFixed(2)),
      memoryHeapSizeMb: Math.round(heapLimit),
      quality: this.currentQuality
    };
  }

  public getQuality(): QualityTier {
    return this.currentQuality;
  }

  public setQuality(quality: QualityTier): void {
    this.currentQuality = quality;
    this.onQualityChange(quality);
    this.qualityLock = true; // User overrides performance monitor, lock it
  }
}
