# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.2] - 2026-06-27

### Added
- **Privacy-Safe Skeleton Wireframe Preview**: Replaced the raw camera feed in the picture-in-picture preview window with a neon-colored hand skeleton wireframe, hiding the user's face and room background by default.
- **Preview Toggle Support**: Added an interactive toggle button (`👁` / `🦴`) allowing users to switch between the skeleton view and the raw video feed, with an overlay warning informing them when the camera feed is visible.
- **Dynamic Control Mode Selector**: Added settings controls to switch between "Hand Gestures" (Camera-based) and "Touch Screen" (Mouse/Swipe-based) at any time. When "Touch Screen" is chosen, the camera stream shuts down completely to conserve power.
- **Virtual Gesture Buttons**: Rendered HUD action buttons for Shield and EMP Shockwave when in touch mode.

## [1.0.1] - 2026-06-27

### Fixed
- **Shield Timer Decay**: Changed shield decay calculation to scale with the actual frame delta (`dt`) instead of a hardcoded `1/60` decrement, fixing accelerated shield decay on high refresh-rate screens.
- **Adaptive Smoother Latency Calculation**: Reordered the tracking update sequence inside `InputManager` to calculate `dt` before overwriting the last valid tracking timestamp. This restores correct speed-dependent filtering behavior.
- **Hand Gesture Tracking**: Removed the problematic handedness classification confidence filter (`confidenceThreshold`) in `InputManager` that previously discarded valid hand tracking when left-vs-right hand identification was ambiguous.

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
