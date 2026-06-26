# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.1] - 2026-06-27

### Fixed
- **Shield Timer Decay**: Changed shield decay calculation to scale with the actual frame delta (`dt`) instead of a hardcoded `1/60` decrement, fixing accelerated shield decay on high refresh-rate screens.
- **Adaptive Smoother Latency Calculation**: Reordered the tracking update sequence inside `InputManager` to calculate `dt` before overwriting the last valid tracking timestamp. This restores correct speed-dependent filtering behavior.

## [1.0.0] - 2026-06-26

This is the initial release of FluxRush, a production-quality, low-latency, finger-tracking web arcade game.

### Added
- **Asynchronous Web Worker Hand Tracking**: Off-loaded MediaPipe HandLandmarker inference (using transferable `ImageBitmap` frames) to a dedicated worker thread.
- **Low-Latency Smoothing Pipeline**:
  - 2D Kalman filter for velocity estimation and coordinate projection during frame updates.
  - `AdaptiveSmoother` (1Euro filter concepts) for speed-dependent noise filtration.
  - `VelocityPredictor` for dead-reckoning extrapolation and recovery.
  - Dual-loop decoupled architecture separating variable tracking FPS (20–30 FPS) from rendering/game updates (60–120 FPS).
- **Multi-Canvas Layered Renderer**: Stacked 4 CSS-layered canvases (`Background`, `Gameplay`, `Effects`, `UI`) to minimize canvas redrawing overhead.
- **Glow Sprite Cache**: Double-buffered offscreen cache replacing heavy `shadowBlur` path operations with GPU-accelerated `drawImage` calls.
- **Broad-Phase Collision Spatial Hash**: Grid bucketing utility reducing circle-collision search complexity from $O(N \cdot M)$ to $O(1)$.
- **Procedural WebAudio Synthesizer**: Procedural, zero-loading-delay synthesizers for pickup alerts, detuned sci-fi ambient pad music, score triggers, and hit explosions.
- **Performance Watchdog & Scaling**: An adaptive quality monitor auto-degrading/upgrading graphics configurations between `High`, `Medium`, and `Low` tiers.
- **Heartbeat & Supervisor watchdog**: Automated Web Worker crash recovery, falling back to touch/pointer inputs gracefully.
- **Built-In Testing Suite**: Stress tests (1000+ moving particles) and tracking-loss simulations to verify locking recovery.
- **Project Documentation**: Created `README.md` and `walkthrough.md` detailing architecture, options, and build structures.
