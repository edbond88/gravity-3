'use strict';

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const mix = (c1, c2, f) => c1.map((v, i) => Math.round(v + (c2[i] - v) * f));
const toRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const COLOR_RGB = Object.fromEntries(COLORS.map((hex) => [hex, toRgb(hex)]));
const rgba = (hex, a) => `rgba(${COLOR_RGB[hex]},${a})`;
const WHITE = [255, 250, 240];

// Trails glow, taper from the star to the tail and run white-hot where the
// star moved fast. Neighbouring segments look alike, so runs of them that fall
// into the same bucket are stroked as one path.
const TRAIL_BUCKETS = 24;

// Energy colouring: bound → blue, at escape speed → white, escaping → orange.
// A little of the star's own colour stays in, so trails can still be told apart.
const BOUND_RGB = [80, 130, 255];
const ESCAPE_RGB = [255, 125, 50];

function energyColor(level, base) {
  const c = level < 0.5 ? mix(BOUND_RGB, WHITE, level * 2) : mix(WHITE, ESCAPE_RGB, level * 2 - 1);
  return mix(c, base, 0.2);
}

function drawTrail(b, i) {
  const tr = b.trail;
  if (tr.length < 2) return;
  const pts = tr.concat({ x: b.x, y: b.y, t: simTime, v: Math.hypot(b.vx, b.vy), e: escapeRatio(bodies, i, softening) });
  const byEnergy = trailColor === 'energy';
  const levels = byEnergy ? 12 : 6;
  let vMin = Infinity, vMax = 0;
  for (const p of pts) { vMin = Math.min(vMin, p.v); vMax = Math.max(vMax, p.v); }
  const vSpan = Math.max(vMax - vMin, vMax * 0.2, 1e-9);
  const base = COLOR_RGB[b.color];
  const widthScale = 0.8 + 0.25 * Math.sqrt(b.mass);

  // butt caps: round ones would overlap where runs meet and show as beads
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';

  let key = -1, fresh = 0, hot = 0;
  const flush = () => {
    if (key < 0) return;
    const alpha = fresh ** 1.5;
    const rgb = (byEnergy ? energyColor(hot, base) : mix(base, WHITE, hot ** 1.5 * 0.45)).join(',');
    const w = (0.6 + 2 * fresh) * widthScale;
    ctx.strokeStyle = `rgba(${rgb},${alpha * 0.1})`;  // wide soft glow
    ctx.lineWidth = w * 5;
    ctx.stroke();
    ctx.strokeStyle = `rgba(${rgb},${alpha * 0.7})`;  // bright core
    ctx.lineWidth = w;
    ctx.stroke();
  };

  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    const f = Math.max(0, 1 - (simTime - q.t) / trailDuration);
    if (f < 0.03) continue;
    const h = byEnergy
      ? 0.5 + 0.5 * Math.tanh(2.5 * q.e) // white only close to escape speed
      : Math.min(1, (q.v - vMin) / vSpan);
    const k = Math.round(f * TRAIL_BUCKETS) * (levels + 1) + Math.round(h * levels);
    if (k !== key) {
      flush();
      key = k; fresh = Math.round(f * TRAIL_BUCKETS) / TRAIL_BUCKETS; hot = Math.round(h * levels) / levels;
      ctx.beginPath();
      ctx.moveTo(toScreenX(p.x), toScreenY(p.y));
    }
    ctx.lineTo(toScreenX(q.x), toScreenY(q.y));
  }
  flush();
  ctx.globalCompositeOperation = 'source-over';
}

// Surface colour by mass, like main-sequence stars: light ones burn orange,
// heavy ones blue-white.
const TEMPERATURE = [
  [0.2, [255, 160, 90]],
  [0.6, [255, 205, 150]],
  [1.2, [255, 245, 230]],
  [2.5, [215, 230, 255]],
  [5, [165, 195, 255]],
];

function temperatureColor(mass) {
  const m = Math.max(TEMPERATURE[0][0], Math.min(TEMPERATURE.at(-1)[0], mass));
  let i = 0;
  while (m > TEMPERATURE[i + 1][0]) i++;
  const [m0, c0] = TEMPERATURE[i], [m1, c1] = TEMPERATURE[i + 1];
  return mix(c0, c1, Math.log(m / m0) / Math.log(m1 / m0)).join(',');
}

// Rays: a slowly turning cross, each arm breathing on its own, plus faint
// glints that flare up at random angles and fade away.
const SPIKES = [
  { angle: 0, length: 1, freq: 1.3 }, { angle: Math.PI / 2, length: 0.6, freq: 1.9 },
  { angle: Math.PI / 4, length: 0.35, freq: 2.7 }, { angle: -Math.PI / 4, length: 0.35, freq: 2.3 },
];
const GLINTS = 5;
const SPIN = [0.07, -0.05, 0.09]; // rad/s, per star — a full turn takes a minute or two

// Deterministic 0…1 noise from two integers.
const hash = (a, b) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

function drawRay(x, y, angle, len, width, color, alpha) {
  const dx = Math.cos(angle) * len, dy = Math.sin(angle) * len;
  const g = ctx.createLinearGradient(x - dx, y - dy, x + dx, y + dy);
  g.addColorStop(0, rgba(color, 0));
  g.addColorStop(0.42, rgba(color, 0.35 * alpha));
  g.addColorStop(0.5, `rgba(255,255,255,${0.7 * alpha})`);
  g.addColorStop(0.58, rgba(color, 0.35 * alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x - dx, y - dy);
  ctx.lineTo(x + dx, y + dy);
  ctx.stroke();
}

function drawStar(b, i, now) {
  const x = toScreenX(b.x), y = toScreenY(b.y);
  const t = reducedMotion ? 0 : now;
  // flicker: two incommensurate sines per star
  const tw = 1 + 0.05 * Math.sin(t * 5.3 + i * 2.1) + 0.035 * Math.sin(t * 11.7 + i * 4.7);
  const flare = 1 + starFlare(b) * 1.5;
  const temp = temperatureColor(b.mass);

  // soft halo
  const haloR = (45 + b.mass * 25) * tw * Math.sqrt(flare);
  const halo = ctx.createRadialGradient(x, y, 0, x, y, haloR);
  halo.addColorStop(0, rgba(b.color, Math.min(0.6, 0.28 * flare)));
  halo.addColorStop(0.25, rgba(b.color, 0.1 * flare));
  halo.addColorStop(1, rgba(b.color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, haloR, 0, Math.PI * 2);
  ctx.fill();

  // rays
  const coreR = 2.5 + b.mass * 1.5;
  const baseLen = coreR * (7 + 3 * b.mass ** 0.5) * tw * flare;
  const axis = i * 0.7 + t * SPIN[i];
  ctx.lineCap = 'round';
  for (const [k, sp] of SPIKES.entries()) {
    const breathe = t ? 0.78 + 0.22 * Math.sin(t * sp.freq + i * 1.7 + k * 2.4) : 1;
    const len = baseLen * sp.length * breathe;
    drawRay(x, y, axis + sp.angle, len, k === 0 ? 1.3 : 0.9, b.color, Math.min(1, sp.length * 1.4) * breathe);
  }
  for (let g = 0; g < GLINTS && t; g++) {
    // each glint lives for `period` seconds, then reappears at a new angle
    const period = 1.6 + hash(i, g) * 2.4;
    const phase = t / period + hash(g, i + 7);
    const cycle = Math.floor(phase);
    const life = phase - cycle;
    const alpha = Math.sin(Math.PI * life) ** 3 * 0.5;
    if (alpha < 0.02) continue;
    const angle = hash(cycle, g * 13 + i) * Math.PI;
    const len = baseLen * (0.3 + 0.4 * hash(cycle + 3, g + i));
    drawRay(x, y, angle, len, 0.6, b.color, alpha);
  }

  // white-hot core, the star's surface colour, then its identifying colour
  const r = coreR * 1.6 * (0.97 + 0.03 * tw * 2);
  const core = ctx.createRadialGradient(x, y, 0, x, y, r);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.35, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.55, `rgba(${temp},1)`);
  core.addColorStop(0.75, rgba(b.color, 0.9));
  core.addColorStop(1, rgba(b.color, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Close-encounter bursts: a flash and a spray of sparks at the point of
// closest approach. Positions are in world space so a burst stays where it
// happened; the stars involved flare up for a moment.
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
    color: mix(colors[0], colors[1], 0.5).join(','),
    sparks: Array.from({ length: count }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: (60 + Math.random() * 220) * (0.5 + intensity),
      color: mix(colors[Math.random() < 0.5 ? 0 : 1], WHITE, Math.random() * 0.6).join(','),
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

function drawBursts() {
  bursts = bursts.filter((s) => frameNow - s.born < s.life);
  for (const s of bursts) {
    const age = frameNow - s.born;
    const p = age / s.life;
    const x = toScreenX(s.x), y = toScreenY(s.y);
    const I = s.intensity;
    const k = Math.min(1, Math.min(width, height) / 700); // smaller bursts on small screens

    // flash
    const flash = I * Math.exp(-age * 7);
    if (flash > 0.01) {
      const fr = (28 + 80 * I) * k;
      const g = ctx.createRadialGradient(x, y, 0, x, y, fr);
      g.addColorStop(0, `rgba(255,255,255,${Math.min(1, 1.1 * flash)})`);
      g.addColorStop(0.12, `rgba(255,255,255,${0.75 * flash})`);
      g.addColorStop(0.35, `rgba(${s.color},${0.45 * flash})`);
      g.addColorStop(1, `rgba(${s.color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, fr, 0, Math.PI * 2);
      ctx.fill();
    }

    // sparks fly out and slow down; each is drawn as a short streak
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.3;
    for (const sp of s.sparks) {
      const sa = age / (sp.life * s.life);
      if (sa >= 1) continue;
      const decay = 3;
      const dist = (sp.speed * k / decay) * (1 - Math.exp(-age * decay));
      const vel = sp.speed * Math.exp(-age * decay);
      const cos = Math.cos(sp.angle), sin = Math.sin(sp.angle);
      const tail = Math.min(dist, 4 + vel * 0.04);
      ctx.strokeStyle = `rgba(${sp.color},${(1 - sa) ** 1.5})`;
      ctx.beginPath();
      ctx.moveTo(x + cos * (dist - tail), y + sin * (dist - tail));
      ctx.lineTo(x + cos * dist, y + sin * dist);
      ctx.stroke();
    }
  }
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawField();
  if (showTrails) bodies.forEach(drawTrail);
  ctx.globalCompositeOperation = 'lighter';
  drawBursts();
  bodies.forEach((b, i) => drawStar(b, i, frameNow));
  ctx.globalCompositeOperation = 'source-over';
}
