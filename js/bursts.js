'use strict';

// ---------------------------------------------------------------------------
// Close-encounter bursts: a flash and a spray of sparks at the point of
// closest approach. Positions are in world space so a burst stays where it
// happened; the stars involved flare up for a moment. This is their state; the
// renderer draws them.
// ---------------------------------------------------------------------------
const MAX_BURSTS = 12;
let bursts = [];
let frameNow = 0; // seconds, real time of the current frame

function spawnBurst(a, b, wx, wy, intensity) {
  if (!showBursts) return;
  if (bursts.length >= MAX_BURSTS) bursts.shift();
  const colors = [COLOR_RGB[a.color], COLOR_RGB[b.color]];
  const count = reducedMotion ? 0 : Math.round(10 + 30 * intensity);
  bursts.push({
    x: wx, y: wy, born: frameNow, intensity, a, b,
    life: 0.9 + 0.8 * intensity,
    color: mix(colors[0], colors[1], 0.5),
    sparks: Array.from({ length: count }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: (60 + Math.random() * 220) * (0.5 + intensity),
      color: mix(colors[Math.random() < 0.5 ? 0 : 1], WHITE, Math.random() * 0.6),
      life: 0.4 + Math.random() * 0.6,
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
