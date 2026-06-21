import { GameParticle, GameCollectible, GameHazard, FloatingText } from '../types';

export class ObjectPoolManager {
  private particles: GameParticle[];
  private collectibles: GameCollectible[];
  private hazards: GameHazard[];
  private floatingTexts: FloatingText[];

  private particleIndex = 0;
  private collectibleIndex = 0;
  private hazardIndex = 0;
  private textIndex = 0;

  constructor(maxParticles = 600, maxCollectibles = 100, maxHazards = 100, maxTexts = 50) {
    // 1. Pre-allocate Particles
    this.particles = new Array(maxParticles);
    for (let i = 0; i < maxParticles; i++) {
      this.particles[i] = {
        active: false,
        spawnTime: 0,
        id: i,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        color: '#0ff',
        size: 2,
        life: 0,
        maxLife: 0,
        alpha: 1,
        reset() {
          this.active = false;
        }
      };
    }

    // 2. Pre-allocate Collectibles
    this.collectibles = new Array(maxCollectibles);
    for (let i = 0; i < maxCollectibles; i++) {
      this.collectibles[i] = {
        active: false,
        spawnTime: 0,
        id: i,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        size: 10,
        type: 'ENERGY',
        pulseTimer: 0,
        reset() {
          this.active = false;
        }
      };
    }

    // 3. Pre-allocate Hazards
    this.hazards = new Array(maxHazards);
    for (let i = 0; i < maxHazards; i++) {
      this.hazards[i] = {
        active: false,
        spawnTime: 0,
        id: i,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        size: 15,
        angle: 0,
        rotSpeed: 0,
        pulseTimer: 0,
        hazardType: 'BASIC',
        reset() {
          this.active = false;
        }
      };
    }

    // 4. Pre-allocate Floating Texts
    this.floatingTexts = new Array(maxTexts);
    for (let i = 0; i < maxTexts; i++) {
      this.floatingTexts[i] = {
        active: false,
        spawnTime: 0,
        id: i,
        pos: { x: 0, y: 0 },
        vel: { x: 0, y: 0 },
        text: '',
        color: '#fff',
        alpha: 1,
        size: 16,
        reset() {
          this.active = false;
        }
      };
    }
  }

  // Ring buffer reuse for particles (if full, overwrite the oldest active one)
  public spawnParticle(
    x: number, y: number,
    vx: number, vy: number,
    color: string, size: number,
    lifeMs: number
  ): GameParticle {
    const particle = this.particles[this.particleIndex];
    particle.active = true;
    particle.spawnTime = performance.now();
    particle.pos.x = x;
    particle.pos.y = y;
    particle.vel.x = vx;
    particle.vel.y = vy;
    particle.color = color;
    particle.size = size;
    particle.life = lifeMs;
    particle.maxLife = lifeMs;
    particle.alpha = 1;

    this.particleIndex = (this.particleIndex + 1) % this.particles.length;
    return particle;
  }

  public spawnCollectible(
    x: number, y: number,
    vx: number, vy: number,
    size: number, type: 'ENERGY' | 'COMBO_BOOST' | 'SHIELD'
  ): GameCollectible | null {
    // Find first inactive collectible
    let found: GameCollectible | null = null;
    const len = this.collectibles.length;
    for (let i = 0; i < len; i++) {
      const idx = (this.collectibleIndex + i) % len;
      if (!this.collectibles[idx].active) {
        found = this.collectibles[idx];
        this.collectibleIndex = (idx + 1) % len;
        break;
      }
    }

    if (!found) return null; // Pool full (ignore spawn)

    found.active = true;
    found.spawnTime = performance.now();
    found.pos.x = x;
    found.pos.y = y;
    found.vel.x = vx;
    found.vel.y = vy;
    found.size = size;
    found.type = type;
    found.pulseTimer = 0;

    return found;
  }

  public spawnHazard(
    x: number, y: number,
    vx: number, vy: number,
    size: number, type: 'BASIC' | 'SEEKER' | 'PULSAR'
  ): GameHazard | null {
    let found: GameHazard | null = null;
    const len = this.hazards.length;
    for (let i = 0; i < len; i++) {
      const idx = (this.hazardIndex + i) % len;
      if (!this.hazards[idx].active) {
        found = this.hazards[idx];
        this.hazardIndex = (idx + 1) % len;
        break;
      }
    }

    if (!found) return null;

    found.active = true;
    found.spawnTime = performance.now();
    found.pos.x = x;
    found.pos.y = y;
    found.vel.x = vx;
    found.vel.y = vy;
    found.size = size;
    found.angle = Math.random() * Math.PI * 2;
    found.rotSpeed = (Math.random() - 0.5) * 2;
    found.pulseTimer = 0;
    found.hazardType = type;

    return found;
  }

  public spawnFloatingText(
    x: number, y: number,
    text: string, color: string,
    size = 18
  ): FloatingText | null {
    let found: FloatingText | null = null;
    const len = this.floatingTexts.length;
    for (let i = 0; i < len; i++) {
      const idx = (this.textIndex + i) % len;
      if (!this.floatingTexts[idx].active) {
        found = this.floatingTexts[idx];
        this.textIndex = (idx + 1) % len;
        break;
      }
    }

    if (!found) return null;

    found.active = true;
    found.spawnTime = performance.now();
    found.pos.x = x;
    found.pos.y = y;
    found.vel.x = (Math.random() - 0.5) * 40;
    found.vel.y = -80 - Math.random() * 40; // float upwards
    found.text = text;
    found.color = color;
    found.alpha = 1;
    found.size = size;

    return found;
  }

  // Getters for active entities (avoids allocating new filter arrays)
  public getParticles(): GameParticle[] {
    return this.particles;
  }

  public getCollectibles(): GameCollectible[] {
    return this.collectibles;
  }

  public getHazards(): GameHazard[] {
    return this.hazards;
  }

  public getFloatingTexts(): FloatingText[] {
    return this.floatingTexts;
  }

  public clear(): void {
    this.particles.forEach(p => p.active = false);
    this.collectibles.forEach(c => c.active = false);
    this.hazards.forEach(h => h.active = false);
    this.floatingTexts.forEach(t => t.active = false);
  }
}
