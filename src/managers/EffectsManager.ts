import { Vec2, GameParticle, GameCollectible, GameHazard, FloatingText } from '../types';

interface GridNode {
  x: number; y: number;
  vx: number; vy: number;
  ox: number; oy: number;
}

export class EffectsManager {
  // Layered Canvas contexts
  private bgCtx: CanvasRenderingContext2D;
  private gameCtx: CanvasRenderingContext2D;
  private fxCtx: CanvasRenderingContext2D;

  private width = 800;
  private height = 600;

  // Sprite Cache for neon glows (pre-renders shadow blurs to avoid runtime overhead)
  private playerGlow: HTMLCanvasElement;
  private energyGlow: HTMLCanvasElement;
  private hazardGlow: HTMLCanvasElement;
  private shieldGlow: HTMLCanvasElement;

  // Spring Grid Warp state
  private gridNodes: GridNode[] = [];
  private gridCols = 24;
  private gridRows = 18;
  private springK = 35; // Spring stiffness
  private damping = 2.0; // Spring damping

  // Cursor trail history
  private trailHistory: Vec2[] = [];
  private maxTrailLen = 40;

  // Screen shake state
  private shakeTime = 0;
  private shakeDuration = 0;
  private shakeIntensity = 0;

  constructor(
    bgCanvas: HTMLCanvasElement,
    gameCanvas: HTMLCanvasElement,
    fxCanvas: HTMLCanvasElement,
    _uiCanvas: HTMLCanvasElement
  ) {
    this.bgCtx = bgCanvas.getContext('2d')!;
    this.gameCtx = gameCanvas.getContext('2d')!;
    this.fxCtx = fxCanvas.getContext('2d')!;

    // Create glow cache templates
    this.playerGlow = this.createGlowSprite(30, '#00ffff', 25);
    this.energyGlow = this.createGlowSprite(18, '#39ff14', 15);
    this.hazardGlow = this.createGlowSprite(24, '#ff003c', 20);
    this.shieldGlow = this.createGlowSprite(40, '#bd00ff', 30);

    this.resize(bgCanvas.width, bgCanvas.height);
  }

  public resize(w: number, h: number): void {
    this.width = w;
    this.height = h;

    // Reset and initialize warping grid nodes
    this.gridNodes = [];
    const colStep = w / (this.gridCols - 1);
    const rowStep = h / (this.gridRows - 1);

    for (let r = 0; r < this.gridRows; r++) {
      for (let c = 0; c < this.gridCols; c++) {
        const ox = c * colStep;
        const oy = r * rowStep;
        this.gridNodes.push({ x: ox, y: oy, vx: 0, vy: 0, ox, oy });
      }
    }
  }

  /**
   * Generates a pre-rendered neon glow circular sprite
   */
  private createGlowSprite(radius: number, color: string, glowSize: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const size = (radius + glowSize) * 2;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    ctx.shadowBlur = glowSize;
    ctx.shadowColor = color;
    ctx.fillStyle = color;

    ctx.beginPath();
    ctx.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    ctx.fill();

    return canvas;
  }

  public triggerShake(durationMs: number, intensity: number): void {
    this.shakeDuration = durationMs;
    this.shakeTime = durationMs;
    this.shakeIntensity = intensity;
  }

  /**
   * Updates spring grid physics and screen shakes.
   */
  public update(cursorX: number, cursorY: number, dt: number, isHandVisible: boolean, quality: 'LOW' | 'MEDIUM' | 'HIGH'): void {
    // 1. Decelerate shake
    if (this.shakeTime > 0) {
      this.shakeTime -= dt * 1000;
    }

    // 2. Adjust trail length based on quality tier
    this.maxTrailLen = quality === 'HIGH' ? 40 : quality === 'MEDIUM' ? 20 : 8;

    // Record trail position
    if (isHandVisible) {
      this.trailHistory.push({ x: cursorX, y: cursorY });
      if (this.trailHistory.length > this.maxTrailLen) {
        this.trailHistory.shift();
      }
    } else if (this.trailHistory.length > 0) {
      this.trailHistory.shift(); // gradually clear trail
    }

    // 3. Update spring grid nodes (Skip entirely in Low quality)
    if (quality === 'LOW') return;

    // Apply grid updates
    const cursorForceRadius = 160;
    const cursorForce = -600; // negative pulls in, positive pushes out

    const len = this.gridNodes.length;
    for (let i = 0; i < len; i++) {
      const node = this.gridNodes[i];

      // Hook's law: force pulling back to origin: F = -k * x
      const ax = (node.ox - node.x) * this.springK - node.vx * this.damping;
      const ay = (node.oy - node.y) * this.springK - node.vy * this.damping;

      node.vx += ax * dt;
      node.vy += ay * dt;

      // Cursor warp force
      if (isHandVisible) {
        const dx = node.x - cursorX;
        const dy = node.y - cursorY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < cursorForceRadius && dist > 10) {
          const factor = (1.0 - dist / cursorForceRadius); // linear falloff
          const pushForce = factor * cursorForce * dt;
          node.vx += (dx / dist) * pushForce;
          node.vy += (dy / dist) * pushForce;
        }
      }

      node.x += node.vx * dt;
      node.y += node.vy * dt;
    }
  }

  /**
   * Draws the warp grid onto the Background canvas.
   */
  public drawBackground(quality: 'LOW' | 'MEDIUM' | 'HIGH'): void {
    this.bgCtx.fillStyle = '#0a0a14'; // dark space blue
    this.bgCtx.fillRect(0, 0, this.width, this.height);

    if (quality === 'LOW') return;

    this.bgCtx.strokeStyle = 'rgba(0, 255, 255, 0.06)';
    this.bgCtx.lineWidth = 1;

    // Draw horizontal grid lines
    for (let r = 0; r < this.gridRows; r++) {
      this.bgCtx.beginPath();
      for (let c = 0; c < this.gridCols; c++) {
        const idx = r * this.gridCols + c;
        const node = this.gridNodes[idx];
        if (c === 0) {
          this.bgCtx.moveTo(node.x, node.y);
        } else {
          this.bgCtx.lineTo(node.x, node.y);
        }
      }
      this.bgCtx.stroke();
    }

    // Draw vertical grid lines
    for (let c = 0; c < this.gridCols; c++) {
      this.bgCtx.beginPath();
      for (let r = 0; r < this.gridRows; r++) {
        const idx = r * this.gridCols + c;
        const node = this.gridNodes[idx];
        if (r === 0) {
          this.bgCtx.moveTo(node.x, node.y);
        } else {
          this.bgCtx.lineTo(node.x, node.y);
        }
      }
      this.bgCtx.stroke();
    }
  }

  /**
   * Clears game canvases and applies shake offsets.
   */
  public prepareCanvases(): void {
    this.gameCtx.clearRect(0, 0, this.width, this.height);
    this.fxCtx.clearRect(0, 0, this.width, this.height);

    this.gameCtx.save();
    this.fxCtx.save();

    // Apply screen shake
    if (this.shakeTime > 0) {
      const shakeFactor = this.shakeTime / this.shakeDuration;
      const dx = (Math.random() - 0.5) * this.shakeIntensity * shakeFactor;
      const dy = (Math.random() - 0.5) * this.shakeIntensity * shakeFactor;
      
      this.gameCtx.translate(dx, dy);
      this.fxCtx.translate(dx, dy);
    }
  }

  public finalizeCanvases(): void {
    this.gameCtx.restore();
    this.fxCtx.restore();
  }

  /**
   * Renders the player trail and glowing cursor.
   */
  public drawCursor(x: number, y: number, isHandVisible: boolean, isShieldActive: boolean, quality: 'LOW' | 'MEDIUM' | 'HIGH'): void {
    if (!isHandVisible) return;

    // 1. Draw trailing path
    if (this.trailHistory.length > 1) {
      this.fxCtx.strokeStyle = 'rgba(0, 255, 255, 0.25)';
      this.fxCtx.lineWidth = 4;
      this.fxCtx.lineCap = 'round';
      this.fxCtx.beginPath();
      this.fxCtx.moveTo(this.trailHistory[0].x, this.trailHistory[0].y);
      for (let i = 1; i < this.trailHistory.length; i++) {
        this.fxCtx.lineTo(this.trailHistory[i].x, this.trailHistory[i].y);
      }
      this.fxCtx.stroke();
    }

    // 2. Draw cached glow circle
    const sprite = isShieldActive ? this.shieldGlow : this.playerGlow;
    const r = isShieldActive ? 40 : 30;
    const glow = isShieldActive ? 30 : 25;
    
    if (quality !== 'LOW') {
      this.gameCtx.drawImage(sprite, x - r - glow, y - r - glow);
    } else {
      // Draw flat circle if Low Quality
      this.gameCtx.fillStyle = isShieldActive ? '#bd00ff' : '#00ffff';
      this.gameCtx.beginPath();
      this.gameCtx.arc(x, y, r, 0, Math.PI * 2);
      this.gameCtx.fill();
    }
  }

  /**
   * Draws collectibles using cached sprites.
   */
  public drawCollectibles(collectibles: GameCollectible[], quality: 'LOW' | 'MEDIUM' | 'HIGH'): void {
    const len = collectibles.length;
    for (let i = 0; i < len; i++) {
      const c = collectibles[i];
      if (!c.active) continue;

      if (quality !== 'LOW') {
        const offset = c.size + 15;
        this.gameCtx.drawImage(this.energyGlow, c.pos.x - offset, c.pos.y - offset, offset * 2, offset * 2);
      } else {
        this.gameCtx.fillStyle = '#39ff14';
        this.gameCtx.beginPath();
        this.gameCtx.arc(c.pos.x, c.pos.y, c.size, 0, Math.PI * 2);
        this.gameCtx.fill();
      }
    }
  }

  /**
   * Draws hazards using cached sprites and rotating paths.
   */
  public drawHazards(hazards: GameHazard[], quality: 'LOW' | 'MEDIUM' | 'HIGH'): void {
    const len = hazards.length;
    for (let i = 0; i < len; i++) {
      const h = hazards[i];
      if (!h.active) continue;

      this.gameCtx.save();
      this.gameCtx.translate(h.pos.x, h.pos.y);
      this.gameCtx.rotate(h.angle);

      if (quality !== 'LOW') {
        const offset = h.size + 20;
        // Draw the cached circular glow under the hazard first
        this.gameCtx.drawImage(this.hazardGlow, -offset, -offset, offset * 2, offset * 2);
      }

      // Draw the triangular spike structure on top
      this.gameCtx.strokeStyle = '#ff003c';
      this.gameCtx.lineWidth = 3;
      this.gameCtx.fillStyle = '#0a0a14';
      this.gameCtx.beginPath();
      
      // Draw neon triangle
      const size = h.size;
      this.gameCtx.moveTo(0, -size);
      this.gameCtx.lineTo(size * 0.86, size * 0.5);
      this.gameCtx.lineTo(-size * 0.86, size * 0.5);
      this.gameCtx.closePath();
      this.gameCtx.fill();
      this.gameCtx.stroke();

      this.gameCtx.restore();
    }
  }

  /**
   * Renders active particles.
   */
  public drawParticles(particles: GameParticle[]): void {
    const len = particles.length;
    for (let i = 0; i < len; i++) {
      const p = particles[i];
      if (!p.active) continue;

      this.fxCtx.fillStyle = p.color;
      this.fxCtx.globalAlpha = p.alpha;
      this.fxCtx.beginPath();
      this.fxCtx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2);
      this.fxCtx.fill();
    }
    this.fxCtx.globalAlpha = 1.0;
  }

  /**
   * Renders floating texts.
   */
  public drawFloatingTexts(texts: FloatingText[]): void {
    const len = texts.length;
    for (let i = 0; i < len; i++) {
      const t = texts[i];
      if (!t.active) continue;

      this.fxCtx.save();
      this.fxCtx.fillStyle = t.color;
      this.fxCtx.globalAlpha = t.alpha;
      this.fxCtx.font = `bold ${t.size}px Outfit, sans-serif`;
      this.fxCtx.textAlign = 'center';
      this.fxCtx.fillText(t.text, t.pos.x, t.pos.y);
      this.fxCtx.restore();
    }
  }
}
