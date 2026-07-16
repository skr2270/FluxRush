import { GameState, Vec2, GameCollectible, GameHazard } from '../types';
import { ObjectPoolManager } from './ObjectPoolManager';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { EffectsManager } from './EffectsManager';
import { SpatialHash } from '../utils/SpatialHash';

class SafeStorage {
  private static memoryStorage: Record<string, string> = {};

  public static getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      console.warn('localStorage is blocked or unavailable, falling back to memory:', e);
      return this.memoryStorage[key] || null;
    }
  }

  public static setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      console.warn('localStorage is blocked or unavailable, falling back to memory:', e);
      this.memoryStorage[key] = value;
    }
  }
}

export class GameManager {
  private state: GameState = 'MENU';
  private score = 0;
  private highScore = 0;
  private health = 100;
  private combo = 0;
  private comboMultiplier = 1;
  private comboTimer = 0; // decays in playing state
  private readonly comboMaxTime = 4.0; // 4 seconds to maintain combo

  // Difficulty metrics
  private level = 1;
  private gameTime = 0;
  private lastDifficultyInc = 0;

  // Powerups
  private shieldActive = false;
  private shieldTimer = 0;
  private lastShieldActivation = 0;
  private invincibilityTimer = 0;

  // Spawning intervals (seconds)
  private collectibleTimer = 0;
  private hazardTimer = 0;

  // Managers
  private pool: ObjectPoolManager;
  private input: InputManager;
  private audio: AudioManager;
  private effects: EffectsManager;

  // Spatial Partitioning for broad-phase collisions
  private spatialHash: SpatialHash<GameCollectible | GameHazard>;
  private candidateList: (GameCollectible | GameHazard)[] = [];

  private width = 800;
  private height = 600;

  constructor(
    pool: ObjectPoolManager,
    input: InputManager,
    audio: AudioManager,
    effects: EffectsManager
  ) {
    this.pool = pool;
    this.input = input;
    this.audio = audio;
    this.effects = effects;
    this.spatialHash = new SpatialHash<GameCollectible | GameHazard>(this.width, this.height, 100);

    const storedHighScore = SafeStorage.getItem('gesture_game_highscore');
    if (storedHighScore) {
      this.highScore = parseInt(storedHighScore, 10);
    }
  }

  public resize(w: number, h: number): void {
    this.width = w;
    this.height = h;
    this.spatialHash.resize(w, h);
  }

  public startGame(): void {
    if (this.state === 'PLAYING') return;

    this.state = 'PLAYING';
    this.score = 0;
    this.health = 100;
    this.combo = 0;
    this.comboMultiplier = 1;
    this.comboTimer = 0;
    this.level = 1;
    this.gameTime = 0;
    this.lastDifficultyInc = 0;
    this.shieldActive = false;
    this.shieldTimer = 0;
    this.invincibilityTimer = 0;
    this.collectibleTimer = 0;
    this.hazardTimer = 0;

    this.pool.clear();
    this.audio.init();
    this.audio.startBgm();

    this.pool.spawnFloatingText(this.width / 2, this.height / 2 - 50, 'START SYSTEM', '#00ffff', 24);
  }

  public stopGame(): void {
    this.state = 'GAMEOVER';
    this.audio.stopBgm();
    this.audio.playHit(); // Heavy explosion sound

    if (this.score > this.highScore) {
      this.highScore = this.score;
      SafeStorage.setItem('gesture_game_highscore', this.score.toString());
    }
  }

  /**
   * Main gameplay tick running inside requestAnimationFrame (60/120 FPS).
   */
  public tick(dt: number): void {
    if (this.state !== 'PLAYING') return;

    this.gameTime += dt;
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.invincibilityTimer = Math.max(0, this.invincibilityTimer - dt);

    // 1. Difficulty Scaling (every 15 seconds increase level)
    if (this.gameTime - this.lastDifficultyInc > 15) {
      this.level++;
      this.lastDifficultyInc = this.gameTime;
      this.audio.playCombo(this.level + 4);
      this.pool.spawnFloatingText(this.width / 2, 80, `LEVEL ${this.level}`, '#00ffff', 22);
    }

    // 2. Gesture checking
    const cursor = this.input.getCursor();
    this.checkGestures(cursor, dt);

    // 3. Spawn collectibles and hazards
    this.spawnSpawners(dt);

    // 4. Update elements, particles, and populate spatial partitioning grid
    this.spatialHash.clear();
    this.updateEntities(dt);

    // 5. Broad-phase Collision checking using the Spatial Hash Grid
    if (this.input.isHandVisible()) {
      this.checkCollisions(cursor);
    }
  }

  private checkGestures(cursor: Vec2, dt: number): void {
    const now = performance.now();

    // 1. Fist Gesture -> Active Shield (3-second duration, 6-second cooldown)
    if (this.input.getFist() && !this.shieldActive && now - this.lastShieldActivation > 6000) {
      this.shieldActive = true;
      this.shieldTimer = 3.0; // 3 seconds
      this.lastShieldActivation = now;
      this.audio.playShieldActivate();
      this.pool.spawnFloatingText(cursor.x, cursor.y - 40, 'SHIELD ACTIVE', '#bd00ff', 18);
    }

    if (this.shieldActive) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) {
        this.shieldActive = false;
        this.audio.playShieldExpire();
      }
    }

    // 2. Pinch Gesture -> EMP Shockwave (destroys nearby hazards, costs combo)
    if (this.input.getPinch() && this.combo >= 5) {
      this.combo -= 5;
      this.comboMultiplier = Math.max(1, Math.floor(this.combo / 5) + 1);
      this.audio.playEmpPulse();
      this.effects.triggerShake(300, 8);

      // Spawn visual expansion wave ring
      for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
        this.pool.spawnParticle(
          cursor.x, cursor.y,
          Math.cos(angle) * 350, Math.sin(angle) * 350,
          '#bd00ff', 3, 400
        );
      }

      this.pool.spawnFloatingText(cursor.x, cursor.y - 40, 'EMP PULSE', '#bd00ff', 18);

      // Kill nearby hazards
      const hazards = this.pool.getHazards();
      for (let i = 0; i < hazards.length; i++) {
        const h = hazards[i];
        if (!h.active) continue;
        const dx = h.pos.x - cursor.x;
        const dy = h.pos.y - cursor.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 220) {
          h.active = false;
          this.score += 20 * this.comboMultiplier;
          this.spawnExplosion(h.pos.x, h.pos.y, '#ff003c', 10);
        }
      }
    }
  }

  private spawnSpawners(dt: number): void {
    this.collectibleTimer += dt;
    this.hazardTimer += dt;

    // Collectible Spawning (every 1.5 to 0.8 seconds)
    const collectInterval = Math.max(0.8, 1.6 - this.level * 0.1);
    if (this.collectibleTimer >= collectInterval) {
      this.collectibleTimer = 0;
      this.pool.spawnCollectible(
        Math.random() * (this.width - 60) + 30,
        -20, // Spawn just off-screen top
        (Math.random() - 0.5) * 60,
        80 + this.level * 10,
        10,
        Math.random() > 0.85 ? 'SHIELD' : 'ENERGY'
      );
    }

    // Hazard Spawning (every 1.2 to 0.5 seconds)
    const hazardInterval = Math.max(0.45, 1.3 - this.level * 0.08);
    if (this.hazardTimer >= hazardInterval) {
      this.hazardTimer = 0;

      // Spawn from sides or top
      const side = Math.floor(Math.random() * 3);
      let sx = 0, sy = 0;
      let vx = 0, vy = 0;
      
      const speed = 120 + this.level * 15;

      if (side === 0) { // Top
        sx = Math.random() * this.width;
        sy = -20;
        vx = (Math.random() - 0.5) * 100;
        vy = speed;
      } else if (side === 1) { // Left
        sx = -20;
        sy = Math.random() * (this.height - 100);
        vx = speed;
        vy = (Math.random() - 0.5) * 100;
      } else { // Right
        sx = this.width + 20;
        sy = Math.random() * (this.height - 100);
        vx = -speed;
        vy = (Math.random() - 0.5) * 100;
      }

      const hType = Math.random() > 0.7 ? 'SEEKER' : 'BASIC';
      this.pool.spawnHazard(sx, sy, vx, vy, 14, hType);
    }
  }

  private updateEntities(dt: number): void {
    const now = performance.now();

    // 1. Update Collectibles
    const collectibles = this.pool.getCollectibles();
    for (let i = 0; i < collectibles.length; i++) {
      const c = collectibles[i];
      if (!c.active) continue;

      c.pos.x += c.vel.x * dt;
      c.pos.y += c.vel.y * dt;

      // Out of bounds cleanup
      if (c.pos.y > this.height + 40 || c.pos.x < -40 || c.pos.x > this.width + 40) {
        c.active = false;
      } else {
        this.spatialHash.insert(c);
      }
    }

    // 2. Update Hazards
    const hazards = this.pool.getHazards();
    const cursor = this.input.getCursor();
    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (!h.active) continue;

      // Seeker logic: adjust velocity towards player
      if (h.hazardType === 'SEEKER' && this.input.isHandVisible()) {
        const dx = cursor.x - h.pos.x;
        const dy = cursor.y - h.pos.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 5) {
          const steerSpeed = 60 + this.level * 10;
          h.vel.x += (dx / dist) * steerSpeed * dt;
          h.vel.y += (dy / dist) * steerSpeed * dt;
          
          // Cap hazard velocity
          const currentSpeed = Math.sqrt(h.vel.x * h.vel.x + h.vel.y * h.vel.y);
          const maxSpeed = 160 + this.level * 10;
          if (currentSpeed > maxSpeed) {
            h.vel.x = (h.vel.x / currentSpeed) * maxSpeed;
            h.vel.y = (h.vel.y / currentSpeed) * maxSpeed;
          }
        }
      }

      h.pos.x += h.vel.x * dt;
      h.pos.y += h.vel.y * dt;
      h.angle += h.rotSpeed * dt;

      if (h.pos.y > this.height + 40 || h.pos.x < -40 || h.pos.x > this.width + 40) {
        h.active = false;
      } else {
        this.spatialHash.insert(h);
      }
    }

    // 3. Update Particles
    const particles = this.pool.getParticles();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!p.active) continue;

      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
      
      const elapsed = now - p.spawnTime;
      p.alpha = Math.max(0, 1.0 - elapsed / p.life);

      if (elapsed >= p.life) {
        p.active = false;
      }
    }

    // 4. Update Floating Texts
    const texts = this.pool.getFloatingTexts();
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      if (!t.active) continue;

      t.pos.x += t.vel.x * dt;
      t.pos.y += t.vel.y * dt;
      
      const elapsed = now - t.spawnTime;
      t.alpha = Math.max(0, 1.0 - elapsed / 1000); // 1-second text lifetime

      if (elapsed >= 1000) {
        t.active = false;
      }
    }
  }

  private checkCollisions(cursor: Vec2): void {
    const cursorRadius = this.shieldActive ? 40 : 20;
    
    // Broad-phase query: grab items in the spatial grid around cursor
    const count = this.spatialHash.query(cursor.x, cursor.y, cursorRadius + 30, this.candidateList);

    for (let i = 0; i < count; i++) {
      const entity = this.candidateList[i];
      if (!entity.active) continue;

      const dx = entity.pos.x - cursor.x;
      const dy = entity.pos.y - cursor.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Narrow-phase check: circle vs circle collision
      if (dist < cursorRadius + entity.size) {
        entity.active = false;

        // Determine if it is a collectible
        if ('type' in entity) {
          const c = entity as GameCollectible;
          if (c.type === 'SHIELD') {
            this.shieldActive = true;
            this.shieldTimer = 4.0;
            this.audio.playCombo(8);
            this.pool.spawnFloatingText(c.pos.x, c.pos.y, 'SHIELD LOADED', '#bd00ff');
          } else {
            // Collect Energy Point
            this.combo++;
            this.comboMultiplier = Math.floor(this.combo / 5) + 1;
            this.comboTimer = this.comboMaxTime;
            
            const addedScore = 10 * this.comboMultiplier;
            this.score += addedScore;

            this.audio.playCollect();
            this.audio.playCombo(this.comboMultiplier);

            this.spawnExplosion(c.pos.x, c.pos.y, '#39ff14', 8);
            this.pool.spawnFloatingText(c.pos.x, c.pos.y, `+${addedScore}`, '#39ff14');
          }
        } 
        // Or a hazard
        else {
          const h = entity as GameHazard;
          if (this.shieldActive) {
            // Deflected hazard
            this.spawnExplosion(h.pos.x, h.pos.y, '#bd00ff', 12);
            this.audio.playCollect();
            this.effects.triggerShake(150, 4);
            this.pool.spawnFloatingText(h.pos.x, h.pos.y, 'BLOCKED', '#bd00ff');
          } else if (this.invincibilityTimer > 0) {
            // Invincible: do not take damage, just spark
            this.spawnExplosion(h.pos.x, h.pos.y, '#ff003c', 6);
            this.pool.spawnFloatingText(h.pos.x, h.pos.y, 'EVADED', '#8c8ca3');
          } else {
            // Player hit by obstacle
            this.health = Math.max(0, this.health - 25);
            this.combo = 0;
            this.comboMultiplier = 1;
            this.comboTimer = 0;
            this.invincibilityTimer = 0.5; // 500ms grace period

            this.audio.playHit();
            this.effects.triggerShake(400, 16);
            this.spawnExplosion(h.pos.x, h.pos.y, '#ff003c', 25);
            this.pool.spawnFloatingText(h.pos.x, h.pos.y, 'CRITICAL IMPACT', '#ff003c');

            if (this.health <= 0) {
              this.stopGame();
            }
          }
        }
      }
    }
  }

  private spawnExplosion(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 140;
      this.pool.spawnParticle(
        x, y,
        Math.cos(angle) * speed, Math.sin(angle) * speed,
        color,
        2 + Math.random() * 3,
        400 + Math.random() * 400
      );
    }
  }

  // Getters
  public getScore(): number { return this.score; }
  public getHighScore(): number { return this.highScore; }
  public getHealth(): number { return this.health; }
  public getLevel(): number { return this.level; }
  public getComboMultiplier(): number { return this.comboMultiplier; }
  public getComboTimerRatio(): number {
    return this.combo === 0 ? 0 : this.comboTimer / this.comboMaxTime;
  }
  public getShieldTimerRatio(): number {
    return !this.shieldActive ? 0 : this.shieldTimer / 4.0;
  }
  public getShieldCooldownRatio(): number {
    const now = performance.now();
    const elapsed = now - this.lastShieldActivation;
    if (this.shieldActive) return 1.0;
    if (elapsed > 6000) return 0;
    return (6000 - elapsed) / 6000;
  }
  public getShieldStatusText(): string {
    if (this.shieldActive) return 'ACTIVE';
    const now = performance.now();
    const elapsed = now - this.lastShieldActivation;
    if (elapsed > 6000) return 'READY';
    const remainingSecs = Math.ceil((6000 - elapsed) / 1000);
    return `${remainingSecs}s`;
  }
  public getInvincibilityTimer(): number { return this.invincibilityTimer; }
  public isShieldActive(): boolean { return this.shieldActive; }
  public getGameState(): GameState { return this.state; }
}
