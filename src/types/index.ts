export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type GameState = 'MENU' | 'PLAYING' | 'GAMEOVER' | 'PAUSED';

export type QualityTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface TrackingResult {
  landmarks: Vec3[];
  confidence: number;
  handPresent: boolean;
  latencyMs: number;
}

export interface PerformanceStats {
  fps: number;
  frameBudgetUtil: number; // percentage of 16.6ms or 8.3ms frame budget used
  cpuPaintTimeMs: number; // CPU duration of canvas drawing commands
  memoryHeapSizeMb: number; // heap limit/usage if available
  quality: QualityTier;
}

// Poolable entities in the game
export interface Poolable {
  active: boolean;
  spawnTime: number;
  id: number;
  reset(): void;
}

export interface GameParticle extends Poolable {
  pos: Vec2;
  vel: Vec2;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  alpha: number;
}

export interface GameCollectible extends Poolable {
  pos: Vec2;
  vel: Vec2;
  size: number;
  type: 'ENERGY' | 'COMBO_BOOST' | 'SHIELD';
  pulseTimer: number;
}

export interface GameHazard extends Poolable {
  pos: Vec2;
  vel: Vec2;
  size: number;
  angle: number;
  rotSpeed: number;
  pulseTimer: number;
  hazardType: 'BASIC' | 'SEEKER' | 'PULSAR';
}

export interface FloatingText extends Poolable {
  pos: Vec2;
  vel: Vec2;
  text: string;
  color: string;
  alpha: number;
  size: number;
}
