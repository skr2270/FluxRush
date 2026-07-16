# FluxRush ⚡

**FluxRush** is a production-quality, high-performance, finger-tracking web arcade game. Control a glowing energy orb with your index finger in real-time using your device camera, collect green energy particles, and avoid incoming red hazards.

Built with **Vite, TypeScript, and MediaPipe Hand Landmarker**, FluxRush features a fully decoupled off-thread ML pipeline and a layered canvas system to maintain **60–120 FPS with under 50ms of input latency** even on mid-range mobile browsers.

---

## 🚀 Key Features

*   **Decoupled Dual-Loop Threading**: Hand landmark inference runs inside a background Web Worker (typically at 20-30 FPS) while the main thread renders gameplay at 60-120 FPS. Gaps between tracking updates are filled in real-time by a **Velocity Predictor** using dead-reckoning extrapolation.
*   **Adaptive Smoothing (1Euro Filter)**: Decoupled velocity-based exponential smoothing. Aggressively filters sub-pixel tremors when stationary, but decreases smoothing (lowers lag) during rapid movement.
*   **Interactive Hand Gestures**:
    *   ✊ **Fist**: Activates a protective electromagnetic shield for 3 seconds (6-second cooldown).
    *   👌 **Pinch**: Costs 5 combo points to emit a radial **EMP Shockwave**, instantly clearing all hazards on screen.
*   **Layered Canvas Renderer**: Graphics are split across 4 CSS-layered canvases (`Background`, `Gameplay`, `Effects`, and `UI`) to reduce redraw overhead.
*   **Double-Buffered Glow Cache**: To avoid expensive CPU Gaussian blurs (`shadowBlur`) during gameplay, neon glows are pre-rendered into circular templates on offscreen canvases and painted via hardware-accelerated `drawImage` calls.
*   **Spatial Partitioning**: Divided the screen into grid buckets using `SpatialHash.ts` to reduce collision detection from $O(N \cdot M)$ to $O(1)$ operations on average.
*   **Procedural WebAudio Synthesis**: Zero static sound assets. Low-latency synth tones, coin pick-up bells, combo risers, hazard explosions, and background sci-fi drones are synthesized dynamically using the WebAudio API.
*   **Adaptive Quality Scaling**: A performance watchdog continuously monitors FPS and Javascript frame budget utilization. If FPS drops below 55 for 3 seconds, it degrades quality (High -> Medium -> Low), reducing particle counts and disabling the spring warp background grid.

---

## 🎮 How to Play

1.  Open the game and authorize camera access. (Make sure your environment is well-lit!).
2.  If camera access is denied, **fallback touch/pointer controls** and **keyboard controls (Left/Right Arrow keys or A/D keys)** are automatically initialized.
3.  Position your hand in front of the camera. The glowing cyan orb will lock onto your index fingertip.
4.  **Objective**:
    *   Touch green particles to collect them, increasing your score and combo multiplier.
    *   Avoid colliding with red rotating hazard triangles.
    *   Make a **fist** to load your shield.
    *   **Pinch** your index finger and thumb together to blow up all hazards nearby (requires at least 5 combo points).

---

## 🛠️ Local Setup & Run

Make sure you have [Node.js](https://nodejs.org) installed on your system.

1.  **Install Dependencies**:
    This project uses **Yarn v4** with Plug'n'Play (PnP) configuration to store packages in compressed files, avoiding Google Drive sync errors:
    ```bash
    yarn install
    ```

2.  **Run Development Server**:
    Start the local server with hot module replacement:
    ```bash
    yarn dev
    ```
    Open `http://localhost:3000` in your web browser.

3.  **Compile Production Bundle**:
    Build an optimized production release:
    ```bash
    yarn build
    ```
    The compiled bundle will be outputted to the `dist/` directory.

4.  **Local Preview**:
    Serve the production build locally:
    ```bash
    yarn preview
    ```

---

## 🧪 Built-In Validation & Stress Tests

FluxRush includes an integrated test suite accessible directly from the start screen:
*   **Stress Test**: Spawns 1000+ active particles to measure frame rate drops and rendering limits under high load.
*   **Tracking-Loss Simulation**: Artificially cycles hand visibility every 1.2 seconds to verify that lock-on reacquisition times are sub-50ms and that the velocity predictor prevents cursor teleportation.
