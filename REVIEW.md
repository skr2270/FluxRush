# Release Review — FluxRush (Web App)

_Reviewed: 2026-07-16 — Reviewer: AI Code Review_

---

## STATUS: CONDITIONALLY APPROVED

The web app is functionally complete and playable. The core gameplay loop, gesture tracking pipeline, and visual effects are polished. However, there are several issues and improvements that should be addressed before a public market release to ensure reliability, accessibility, and player retention.

---

## 🐛 Bugs & Issues

### P0 — Critical (Must Fix Before Release)

1. **Combo timer silently decays without visual indicator.**
   - `comboTimer` decays in `GameManager.ts` (L133), and `getComboTimerRatio()` is exposed (L452), but neither the HUD nor any visual element displays the remaining combo time. Players have no idea their combo multiplier is about to expire, making the combo system invisible and frustrating.
   - **Impact:** Core gameplay mechanic is hidden from the player.

2. **Level indicator missing from HUD.**
   - `getLevel()` is exposed (L450) but never rendered in the HUD. Players cannot see their current level or understand why difficulty is increasing.
   - **Impact:** Player cannot gauge progression.

3. **Shield cooldown timer not displayed.**
   - `getShieldTimerRatio()` is available (L455–L457) but not shown anywhere. Players have no feedback on when shield expires or when the 6-second cooldown ends, leading to wasted fist gestures.
   - **Impact:** Players spam fist gesture with no understanding of cooldown state.

4. **`handlePointerInput` uses hardcoded 800×600 coordinate space.**
   - In `main.ts` L231–232, touch coordinates are scaled using `scaleX = 800 / rect.width` and `scaleY = 600 / rect.height`. After the `fitViewport()` resize, the canvas dimensions dynamically match `clientWidth/clientHeight`, meaning the 800/600 denominators are stale on non-800×600 viewports (e.g., fullscreen mobile browsers).
   - **Impact:** Touch coordinates are wrong on mobile browsers in landscape fullscreen mode.

### P1 — High (Should Fix Before Release)

5. **BGM detuning ramp is finite and never resets.**
   - In `AudioManager.ts` L130, the BGM oscillator frequency ramps from `freq` to `freq + 0.5` over 3 seconds, then stays flat forever. The ambient drone becomes static after 3 seconds of play.
   - **Impact:** Audio becomes monotonous quickly.

6. **`innerHTML` used for stats monitor updates every frame.**
   - In `main.ts` L333–338, `statsMonitor.innerHTML` is set on every frame (even when stats haven't changed), forcing layout reflow and DOM parsing. This is a performance anti-pattern, especially on low-end devices.
   - **Impact:** Unnecessary CPU work on every frame.

7. **Keyboard fallback controls only move horizontally.**
   - Arrow Up/Down and W/S keys are not registered in `main.ts` L252–259. The player is stuck at `keyboardY = 450` with no vertical movement, making keyboard-only play unfair.
   - **Impact:** Keyboard players cannot dodge vertically.

8. **No pause/resume functionality.**
   - There is no way to pause the game during active play. If the player needs to step away, the game continues ticking and they will die.
   - **Impact:** Poor UX for any interruption scenario.

### P2 — Medium (Should Fix Post-Launch)

9. **`gameLoop` does not guard against first-frame dt spike.**
   - `lastTime` is initialized to `performance.now()` at module load time (L47), but the first `requestAnimationFrame` callback may fire hundreds of milliseconds later (e.g., if the browser tab was backgrounded). The `Math.min(dt, 0.1)` clamp at L244 mitigates the worst case, but 100ms is still a large spike that spawns hazards and moves entities significantly on the very first frame.

10. **No volume controls or mute toggle.**
    - Players cannot adjust audio volume or mute the game. The master gain is hardcoded to 0.3.

11. **Collectible/Hazard differentiation relies solely on color.**
    - Green circles vs red triangles are the only visual distinction. Colorblind players (deuteranopia) cannot distinguish red from green, making the game unplayable for ~8% of males.

12. **No HTTPS camera warning.**
    - `getUserMedia` requires HTTPS in production. If deployed on HTTP, camera access silently fails with a generic error. There is no user-facing message explaining this requirement.

---

## 💡 Suggested Improvements for Best Gameplay Experience

### Gameplay & Engagement

1. **Add a combo meter/bar to the HUD** — Show a glowing progress bar that drains as `comboTimer` decays. When it empties, the combo resets. This creates urgency and rewards fast play.

2. **Display current level in the HUD** — A simple `LEVEL: N` badge gives players a sense of progression and achievement.

3. **Add shield cooldown ring around the cursor** — Draw a circular arc around the player orb that fills as the 6-second shield cooldown completes. This gives clear visual feedback without cluttering the HUD.

4. **Implement a pause screen** — Add a pause button (or ESC key binding) that freezes `game.tick()` and shows an overlay with Resume/Quit options.

5. **Add vertical keyboard controls** — Register ArrowUp/ArrowDown and W/S keys to move `keyboardY`, making keyboard-only play viable.

6. **Add screen-edge warning indicators** — When hazards approach from off-screen sides, show small red arrows or pulsing edges to warn the player. This is critical for side-spawning hazards that appear without warning.

7. **Add an invincibility grace period on hit** — Currently, multiple hazards can overlap the cursor in the same frame, dealing 25 HP each (L413). A 500ms invincibility window after being hit would prevent unfair multi-hit deaths.

8. **Add a leaderboard or share score button** — After game over, allow players to share their score via the Web Share API or copy-to-clipboard. This drives organic virality.

### Audio & Feedback

9. **Loop the BGM with evolving intensity** — Use `LFO` (low-frequency oscillation) modulation on the drone frequency to create a breathing, evolving ambient soundscape that intensifies with level progression.

10. **Add a volume slider and mute toggle** — Allow players to control master volume and mute/unmute from the start screen and pause screen.

11. **Add distinct sound cues for shield activation, shield expiry, and EMP** — Currently shield/EMP reuse `playCombo()` and `playHit()`, which are generic. Unique audio cues improve game feel.

### Accessibility

12. **Add colorblind-safe mode** — Use shape differentiation (circles for collectibles, crosses for hazards) or add configurable color palettes (e.g., blue/orange instead of green/red).

13. **Add ARIA labels to interactive buttons** — The control toggle, shield, and EMP buttons lack `aria-label` attributes, making them invisible to screen readers.

14. **Add a tutorial/onboarding overlay** — First-time players should see an animated tutorial showing how to move their hand, make a fist, and pinch. The text instructions on the start screen are easily skipped.

### Performance & Technical

15. **Throttle `statsMonitor.innerHTML` updates** — Only update the stats DOM when values change (like the score/health delta pattern already used).

16. **Use `textContent` instead of `innerHTML` for stats** — Avoids HTML parsing overhead on every frame.

17. **Add service worker for offline play** — Cache the compiled assets for instant reload and offline capability. The CDN-loaded MediaPipe WASM would fall back to touch mode.

18. **Add error boundary for WebGL context loss** — If the GPU context is lost during play, the game silently breaks. Add a `webglcontextlost` event handler that pauses the game and shows a recovery prompt.