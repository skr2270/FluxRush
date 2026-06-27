import { Vec3 } from '../types';

/**
 * Hand landmark bone connections (standard MediaPipe 21-joint hand skeleton).
 * Each pair [a, b] represents a bone connecting landmark index a to b.
 */
const HAND_CONNECTIONS: [number, number][] = [
  // Thumb
  [0, 1], [1, 2], [2, 3], [3, 4],
  // Index finger
  [0, 5], [5, 6], [6, 7], [7, 8],
  // Middle finger
  [0, 9], [9, 10], [10, 11], [11, 12],
  // Ring finger
  [0, 13], [13, 14], [14, 15], [15, 16],
  // Pinky
  [0, 17], [17, 18], [18, 19], [19, 20],
  // Palm outline
  [5, 9], [9, 13], [13, 17],
];

/** Index fingertip landmark (highlighted differently since it controls the cursor) */
const INDEX_TIP = 8;

type PreviewMode = 'skeleton' | 'video';

export class HandPreviewRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private container: HTMLElement;

  private landmarks: Vec3[] = [];
  private handPresent = false;
  private mode: PreviewMode = 'skeleton';

  // Video element reference (set externally after camera starts)
  private video: HTMLVideoElement | null = null;

  // Toggle button and privacy notice
  private toggleBtn: HTMLButtonElement;
  private privacyNotice: HTMLDivElement;
  private privacyTimeout: number | null = null;

  constructor(container: HTMLElement) {
    this.container = container;

    // Create the skeleton canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = 120;
    this.canvas.height = 90;
    this.canvas.id = 'hand-preview-canvas';
    this.ctx = this.canvas.getContext('2d')!;
    this.container.appendChild(this.canvas);

    // Create the toggle button
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.id = 'preview-toggle-btn';
    this.toggleBtn.title = 'Toggle camera preview mode';
    this.toggleBtn.textContent = '👁';
    this.toggleBtn.addEventListener('click', () => this.toggle());
    this.container.appendChild(this.toggleBtn);

    // Create the privacy notice overlay
    this.privacyNotice = document.createElement('div');
    this.privacyNotice.id = 'preview-privacy-notice';
    this.privacyNotice.textContent = 'Camera feed visible — your face and surroundings are shown on screen.';
    this.container.appendChild(this.privacyNotice);
  }

  /**
   * Sets the video element reference for raw video mode.
   * The video is kept hidden until the user explicitly toggles to it.
   */
  public setVideo(video: HTMLVideoElement): void {
    this.video = video;
    this.video.style.display = 'none';
    this.container.insertBefore(this.video, this.canvas);
  }

  /** Updates the latest hand landmarks from the tracking worker. */
  public updateLandmarks(landmarks: Vec3[], handPresent: boolean): void {
    this.landmarks = landmarks;
    this.handPresent = handPresent;
  }

  /** Toggles between skeleton and raw video preview modes. */
  public toggle(): void {
    if (this.mode === 'skeleton') {
      this.setMode('video');
    } else {
      this.setMode('skeleton');
    }
  }

  private setMode(mode: PreviewMode): void {
    this.mode = mode;

    if (mode === 'video') {
      // Switch to raw video
      this.canvas.style.display = 'none';
      if (this.video) {
        this.video.style.display = 'block';
      }
      this.toggleBtn.textContent = '🦴';
      this.toggleBtn.title = 'Switch to skeleton view (privacy-safe)';

      // Show privacy notice for 4 seconds
      this.showPrivacyNotice();
    } else {
      // Switch to skeleton
      this.canvas.style.display = 'block';
      if (this.video) {
        this.video.style.display = 'none';
      }
      this.toggleBtn.textContent = '👁';
      this.toggleBtn.title = 'Switch to camera view';

      this.hidePrivacyNotice();
    }
  }

  private showPrivacyNotice(): void {
    this.privacyNotice.classList.add('visible');
    if (this.privacyTimeout !== null) {
      clearTimeout(this.privacyTimeout);
    }
    this.privacyTimeout = window.setTimeout(() => {
      this.hidePrivacyNotice();
    }, 4000);
  }

  private hidePrivacyNotice(): void {
    this.privacyNotice.classList.remove('visible');
    if (this.privacyTimeout !== null) {
      clearTimeout(this.privacyTimeout);
      this.privacyTimeout = null;
    }
  }

  /**
   * Renders the skeleton wireframe. Called from the game loop at ~30 FPS.
   * Only draws when in skeleton mode (video mode uses the raw HTMLVideoElement).
   */
  public draw(): void {
    if (this.mode !== 'skeleton') return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear with dark background
    this.ctx.fillStyle = '#0a0a14';
    this.ctx.fillRect(0, 0, w, h);

    if (!this.handPresent || this.landmarks.length < 21) {
      // No hand detected — show placeholder text
      this.ctx.fillStyle = '#8c8ca3';
      this.ctx.font = '9px Outfit, sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('No hand detected', w / 2, h / 2 + 3);
      return;
    }

    // Draw bone connections
    this.ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)';
    this.ctx.lineWidth = 1.5;
    this.ctx.lineCap = 'round';

    for (const [a, b] of HAND_CONNECTIONS) {
      const la = this.landmarks[a];
      const lb = this.landmarks[b];

      // Mirror X (camera is mirrored) and scale to preview canvas
      const ax = (1.0 - la.x) * w;
      const ay = la.y * h;
      const bx = (1.0 - lb.x) * w;
      const by = lb.y * h;

      this.ctx.beginPath();
      this.ctx.moveTo(ax, ay);
      this.ctx.lineTo(bx, by);
      this.ctx.stroke();
    }

    // Draw joint dots
    for (let i = 0; i < this.landmarks.length; i++) {
      const lm = this.landmarks[i];
      const x = (1.0 - lm.x) * w;
      const y = lm.y * h;

      if (i === INDEX_TIP) {
        // Highlight the index fingertip (active tracking point)
        this.ctx.fillStyle = '#39ff14';
        this.ctx.beginPath();
        this.ctx.arc(x, y, 4, 0, Math.PI * 2);
        this.ctx.fill();
      } else {
        this.ctx.fillStyle = '#00ffff';
        this.ctx.beginPath();
        this.ctx.arc(x, y, 2, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }
}
