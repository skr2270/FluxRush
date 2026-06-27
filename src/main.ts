import { ObjectPoolManager } from './managers/ObjectPoolManager';
import { InputManager } from './managers/InputManager';
import { HandTrackingManager } from './managers/HandTrackingManager';
import { HandPreviewRenderer } from './managers/HandPreviewRenderer';
import { EffectsManager } from './managers/EffectsManager';
import { AudioManager } from './managers/AudioManager';
import { PerformanceMonitor } from './managers/PerformanceMonitor';
import { GameManager } from './managers/GameManager';
import { TestSuite } from './testing/TestSuite';

// DOM Element caching
const bgCanvas = document.getElementById('bg-canvas') as HTMLCanvasElement;
const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const fxCanvas = document.getElementById('fx-canvas') as HTMLCanvasElement;
const uiCanvas = document.getElementById('ui-canvas') as HTMLCanvasElement;

const startScreen = document.getElementById('start-screen')!;
const gameoverScreen = document.getElementById('gameover-screen')!;
const cameraPreview = document.getElementById('camera-preview-container')!;

// Buttons
const startBtn = document.getElementById('start-btn')!;
const restartBtn = document.getElementById('restart-btn')!;
const stressBtn = document.getElementById('test-stress-btn')!;
const trackingBtn = document.getElementById('test-tracking-btn')!;
const controlSetupBtn = document.getElementById('control-setup-btn')!;
const controlToggleHud = document.getElementById('control-toggle-hud')!;

// Touch actions for gesture fallbacks
const touchActions = document.getElementById('touch-actions')!;
const touchShieldBtn = document.getElementById('touch-shield-btn')!;
const touchEmpBtn = document.getElementById('touch-emp-btn')!;

// HUD Text elements (cached to avoid redundant updates)
const scoreText = document.getElementById('score-val')!;
const healthText = document.getElementById('health-val')!;
const finalScoreText = document.getElementById('final-score-val')!;
const highscoreText = document.getElementById('highscore-val')!;
const qualityBadge = document.getElementById('quality-badge')!;
const statsMonitor = document.getElementById('stats-monitor')!;

// Global States
let lastTime = performance.now();
let bgTimer = 0;
let prevScore = -1;
let prevHealth = -1;

// Instantiate Managers
const pool = new ObjectPoolManager();
const input = new InputManager();
const audio = new AudioManager();
const effects = new EffectsManager(bgCanvas, gameCanvas, fxCanvas, uiCanvas);

const perf = new PerformanceMonitor((q) => {
  qualityBadge.textContent = `QUALITY: ${q}`;
});

const game = new GameManager(pool, input, audio, effects);
const test = new TestSuite(pool, input, perf);

// Hand skeleton preview renderer (privacy-safe by default)
const handPreview = new HandPreviewRenderer(cameraPreview);

// Coordinate tracking manager mapping raw worker data
const tracking = new HandTrackingManager(
  (res) => {
    input.updateTracking(res);
    handPreview.updateLandmarks(res.landmarks, res.handPresent);
  },
  (state, msg) => {
    console.log(`Tracking state changed to: ${state} (${msg || ''})`);
    if (state === 'ERROR' || state === 'LIGHT_WARN') {
      pool.spawnFloatingText(400, 300, msg || 'LIGHT WARNING', '#ff003c');
    }
  }
);

// Resizing handling
function fitViewport(): void {
  const w = gameCanvas.clientWidth;
  const h = gameCanvas.clientHeight;
  input.resize(w, h);
  effects.resize(w, h);
  game.resize(w, h);
}
window.addEventListener('resize', fitViewport);
fitViewport();

function updateControlMode(mode: 'hand' | 'touch'): void {
  input.setControlMode(mode);
  
  controlToggleHud.textContent = `CONTROL: ${mode === 'hand' ? 'GESTURE' : 'TOUCH'}`;
  controlSetupBtn.textContent = mode === 'hand' ? 'GESTURE (CAMERA)' : 'TOUCH SCREEN';

  if (mode === 'touch') {
    cameraPreview.style.display = 'none';
    tracking.stop();
    touchActions.style.display = 'flex';
  } else {
    cameraPreview.style.display = 'block';
    touchActions.style.display = 'none';
    tracking.start().then(() => {
      if (tracking['video']) {
        handPreview.setVideo(tracking['video']);
      }
    });
  }
}

// Start camera stream on startup
tracking.start().then(() => {
  if (tracking['video']) {
    handPreview.setVideo(tracking['video']);
  }
});

// UI Event listeners
controlSetupBtn.addEventListener('click', () => {
  const currentMode = input.getControlMode();
  updateControlMode(currentMode === 'hand' ? 'touch' : 'hand');
});

controlToggleHud.addEventListener('click', () => {
  const currentMode = input.getControlMode();
  updateControlMode(currentMode === 'hand' ? 'touch' : 'hand');
});

touchShieldBtn.addEventListener('click', () => {
  input.triggerTouchShield();
});

touchEmpBtn.addEventListener('click', () => {
  input.triggerTouchEMP();
});

startBtn.addEventListener('click', () => {
  audio.init();
  startScreen.style.display = 'none';
  // Ensure the UI matches the current control mode
  const currentMode = input.getControlMode();
  updateControlMode(currentMode);
  game.startGame();
});

restartBtn.addEventListener('click', () => {
  gameoverScreen.style.display = 'none';
  const currentMode = input.getControlMode();
  updateControlMode(currentMode);
  game.startGame();
});

stressBtn.addEventListener('click', () => {
  audio.init();
  startScreen.style.display = 'none';
  game.startGame();
  test.startStressTest(10);
});

trackingBtn.addEventListener('click', () => {
  audio.init();
  startScreen.style.display = 'none';
  game.startGame();
  test.startTrackingLossSimulation(12);
});

// Fallback Touch Controls: mapped directly to game canvas local coordinates
const canvasContainer = document.getElementById('canvas-stack')!;
canvasContainer.addEventListener('pointerdown', handlePointerInput);
canvasContainer.addEventListener('pointermove', handlePointerInput);

function handlePointerInput(e: PointerEvent): void {
  if (game.getGameState() !== 'PLAYING') return;
  
  const rect = gameCanvas.getBoundingClientRect();
  const scaleX = 800 / rect.width;
  const scaleY = 600 / rect.height;
  
  const touchX = (e.clientX - rect.left) * scaleX;
  const touchY = (e.clientY - rect.top) * scaleY;
  
  input.setTouchFallback(touchX, touchY);
}

// Main decoupled loop (60/120 FPS)
function gameLoop(timestamp: number): void {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((timestamp - lastTime) / 1000.0, 0.1); // Clamp maximum step size
  lastTime = timestamp;

  const frameStart = performance.now();

  // 1. Tick calculations
  input.tick(dt);
  game.tick(dt);
  test.tick(dt);

  const quality = perf.getQuality();
  effects.update(input.getCursor().x, input.getCursor().y, dt, input.isHandVisible(), quality);

  const logicEnd = performance.now();
  const jsTime = logicEnd - frameStart;

  // 2. Painting pipeline
  effects.prepareCanvases();

  // Draw background grid at 30 FPS max to save mobile CPUs
  bgTimer += dt;
  if (bgTimer >= 0.033) {
    bgTimer = 0;
    effects.drawBackground(quality);
    handPreview.draw();
  }

  // Draw entities
  effects.drawCursor(input.getCursor().x, input.getCursor().y, input.isHandVisible(), game.isShieldActive(), quality);
  effects.drawCollectibles(pool.getCollectibles(), quality);
  effects.drawHazards(pool.getHazards(), quality);
  effects.drawParticles(pool.getParticles());
  effects.finalizeCanvases();

  const paintEnd = performance.now();
  const paintTime = paintEnd - logicEnd;

  // 3. UI and HUD DOM Synchronization (Updates only on delta changes)
  updateHUD();

  // 4. Performance recording
  perf.recordFrame(dt * 1000, jsTime, paintTime);
}

function updateHUD(): void {
  const score = game.getScore();
  const health = game.getHealth();
  const state = game.getGameState();

  if (state === 'PLAYING') {
    if (score !== prevScore) {
      scoreText.textContent = score.toString().padStart(5, '0');
      prevScore = score;
    }
    if (health !== prevHealth) {
      healthText.textContent = health.toString();
      prevHealth = health;
    }
  } else if (state === 'GAMEOVER' && gameoverScreen.style.display !== 'flex') {
    finalScoreText.textContent = score.toString();
    highscoreText.textContent = game.getHighScore().toString();
    gameoverScreen.style.display = 'flex';
  }

  // Update Stats Monitor overlay once every FPS refresh cycle
  const stats = perf.getStats();
  statsMonitor.innerHTML = `
    FPS: ${stats.fps}<br>
    JS UTIL: ${stats.frameBudgetUtil}%<br>
    CPU PAINT: ${stats.cpuPaintTimeMs}ms<br>
    HEAP: ${stats.memoryHeapSizeMb}MB
  `;
}

// Boot the loop
requestAnimationFrame(gameLoop);
