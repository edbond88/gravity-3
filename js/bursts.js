'use strict';

// ---------------------------------------------------------------------------
// Close-encounter bursts: a flash, a shock wave, a spray of sparks and a few
// lingering embers at the point of closest approach. Positions are in world
// space so a burst stays where it happened; the stars involved flare up for a
// moment. This is their state; the renderer draws them.
// ---------------------------------------------------------------------------
const MAX_BURSTS = 12;
let bursts = [];
let frameNow = 0; // seconds, real time of the current frame

function spawnBurst(a, b, wx, wy, intensity) {
  if (!showBursts) return;
  if (bursts.length >= MAX_BURSTS) bursts.shift();
  const colors = [COLOR_RGB[a.color], COLOR_RGB[b.color]];
  const pick = () => colors[Math.random() < 0.5 ? 0 : 1];
  const sparks = reducedMotion ? 0 : Math.round(14 + 26 * intensity);
  const embers = reducedMotion ? 0 : Math.round(10 + 20 * intensity);
  bursts.push({
    x: wx, y: wy, born: frameNow, intensity, a, b,
    life: 1.2 + 0.8 * intensity,
    color: mix(colors[0], colors[1], 0.5),
    // fast, short-lived streaks of white-hot matter: most fairly slow, a few very fast
    sparks: Array.from({ length: sparks }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: (50 + 330 * Math.random() ** 2.5) * (0.6 + intensity),
      color: pick(),
      life: 0.3 + Math.random() * 0.5,
    })),
    // slow glowing motes that linger and flicker after the sparks are gone
    embers: Array.from({ length: embers }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: (15 + 60 * Math.random()) * (0.6 + intensity),
      color: mix(pick(), WHITE, 0.3),
      life: 0.6 + Math.random() * 0.4,
      flicker: 6 + Math.random() * 10, // Hz
      phase: Math.random() * Math.PI * 2,
    })),
  });
}

// 0…1: how strongly a star is flaring from a recent burst it took part in.
function starFlare(body) {
  let f = 0;
  for (const s of bursts) {
    if (s.a !== body && s.b !== body) continue;
    const age = frameNow - s.born;
    f = Math.max(f, s.intensity * Math.exp(-age * 6));
  }
  return f;
}

// Forget bursts that have faded out.
function pruneBursts() {
  bursts = bursts.filter((s) => frameNow - s.born < s.life);
}
