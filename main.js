'use strict';

// ---------------------------------------------------------------------------
// Units: AU, years, solar masses. In these units G = 4π².
// ---------------------------------------------------------------------------
const G = 4 * Math.PI * Math.PI;
const AU_PER_YEAR_TO_KM_S = 4.7406;

const SOFTENING = 0.02;          // AU — keeps close encounters finite
const PRESET_SOFTENING = 0.0005; // periodic orbits pass within ~0.02 AU, so barely soften
const ETA = 0.004;               // adaptive step accuracy factor
const MAX_STEPS_PER_FRAME = 20000;
const BASE_RATE = 1;             // simulated years per real second at 1×

const TRAIL_DURATION = 3;        // years of history kept in a trail (chaos)
const TRAIL_MAX_DURATION = 12;   // presets show one full period, up to this
const TRAIL_MIN_DIST = 0.015;    // AU between stored trail points
const TRAIL_MAX_POINTS = 8000;

const COLORS = ['#6fd0ff', '#ff6f6f', '#ffd36e'];

// ---------------------------------------------------------------------------
// Canvas setup
// ---------------------------------------------------------------------------
const bgCanvas = document.getElementById('bg');
const bg = bgCanvas.getContext('2d');
const canvas = document.getElementById('sim');
const ctx = canvas.getContext('2d');
const statsEl = document.querySelector('.stats');

let width = 0, height = 0, dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  for (const c of [bgCanvas, canvas]) {
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
  }
  drawBackground();
}

function drawBackground() {
  bg.setTransform(dpr, 0, 0, dpr, 0, 0);
  bg.clearRect(0, 0, width, height);

  // faint violet haze near the bottom
  const haze = bg.createRadialGradient(width * 0.55, height * 1.05, 0, width * 0.55, height * 1.05, height * 0.8);
  haze.addColorStop(0, 'rgba(90, 50, 160, 0.12)');
  haze.addColorStop(1, 'rgba(90, 50, 160, 0)');
  bg.fillStyle = haze;
  bg.fillRect(0, 0, width, height);

  // static field of distant stars
  const count = Math.round((width * height) / 5000);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    const r = Math.random() ** 3 * 1.1 + 0.25;
    bg.fillStyle = `rgba(200, 210, 255, ${0.08 + Math.random() * 0.4})`;
    bg.beginPath();
    bg.arc(x, y, r, 0, Math.PI * 2);
    bg.fill();
  }
}

// ---------------------------------------------------------------------------
// Simulation state
// ---------------------------------------------------------------------------
let bodies = [];
let simTime = 0;
let paused = false;
let rate = BASE_RATE;
let restarting = false;
let masses = [1, 1, 1];
let preset = 'chaos';
let softening = SOFTENING;
let trailDuration = TRAIL_DURATION;

const rand = (a, b) => a + Math.random() * (b - a);

function makeBody(i, mass, x, y, vx, vy) {
  return { mass, color: COLORS[i], x, y, vx, vy, ax: 0, ay: 0, trail: [] };
}

// Move to the centre-of-mass frame: zero total momentum, COM at origin.
function toComFrame(list) {
  const M = list.reduce((s, b) => s + b.mass, 0);
  let cx = 0, cy = 0, cvx = 0, cvy = 0;
  for (const b of list) {
    cx += b.mass * b.x; cy += b.mass * b.y;
    cvx += b.mass * b.vx; cvy += b.mass * b.vy;
  }
  cx /= M; cy /= M; cvx /= M; cvy /= M;
  for (const b of list) {
    b.x -= cx; b.y -= cy;
    b.vx -= cvx; b.vy -= cvy;
  }
}

// Rotate a whole configuration so presets don't always look identical.
function rotate(list, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (const b of list) {
    [b.x, b.y] = [c * b.x - s * b.y, s * b.x + c * b.y];
    [b.vx, b.vy] = [c * b.vx - s * b.vy, s * b.vx + c * b.vy];
  }
}

function createRandomBodies() {
  // Positions: random, but not too close to each other.
  let pos;
  do {
    pos = [0, 1, 2].map(() => {
      const r = rand(1.5, 4.5);
      const a = rand(0, Math.PI * 2);
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  } while (
    Math.hypot(pos[0].x - pos[1].x, pos[0].y - pos[1].y) < 2 ||
    Math.hypot(pos[1].x - pos[2].x, pos[1].y - pos[2].y) < 2 ||
    Math.hypot(pos[2].x - pos[0].x, pos[2].y - pos[0].y) < 2
  );

  const spin = Math.random() < 0.5 ? -1 : 1;
  const list = pos.map((p, i) => {
    // mix of overall rotation and random motion
    const va = rand(0, Math.PI * 2);
    return makeBody(i, masses[i], p.x, p.y,
      -p.y * spin * 0.6 + Math.cos(va) * rand(0.3, 1),
      p.x * spin * 0.6 + Math.sin(va) * rand(0.3, 1));
  });
  toComFrame(list);

  // Scale velocities so the system is bound: KE = q·|PE| with q < 1.
  const pe = potentialEnergy(list);
  const ke = kineticEnergy(list);
  const q = rand(0.25, 0.45);
  const k = Math.sqrt((q * Math.abs(pe)) / ke);
  for (const b of list) { b.vx *= k; b.vy *= k; }
  return list;
}

// Chenciner–Montgomery figure-eight: three equal masses chase each other along
// one curve. Initial conditions (Simó) are for G = m = 1; scaling lengths by L
// means scaling velocities by √(G/L) in our units. Period ≈ 6.326·L^1.5/2π years.
const FIGURE8_L = 2;

function createFigure8() {
  const k = Math.sqrt(G / FIGURE8_L);
  const x = 0.97000436 * FIGURE8_L, y = -0.24308753 * FIGURE8_L;
  const vx = 0.93240737 * k, vy = 0.86473146 * k;
  const list = [
    makeBody(0, 1, x, y, vx / 2, vy / 2),
    makeBody(1, 1, -x, -y, vx / 2, vy / 2),
    makeBody(2, 1, 0, 0, -vx, -vy),
  ];
  rotate(list, rand(0, Math.PI * 2));
  list.period = (6.32591398 * FIGURE8_L ** 1.5) / (2 * Math.PI);
  return list;
}

// Lagrange's equilateral solution: any three masses at the corners of an
// equilateral triangle, rotating rigidly about the COM with ω² = G·M / s³.
// It is unstable unless one mass dominates, so sooner or later it breaks apart.
const LAGRANGE_SIDE = 3;

function createLagrange() {
  const s = LAGRANGE_SIDE;
  const list = [0, 1, 2].map((i) => {
    const a = (i * 2 * Math.PI) / 3;
    const r = s / Math.sqrt(3);
    return makeBody(i, masses[i], r * Math.cos(a), r * Math.sin(a), 0, 0);
  });
  toComFrame(list);
  const M = masses.reduce((a, b) => a + b, 0);
  const w = Math.sqrt((G * M) / (s * s * s)) * (Math.random() < 0.5 ? -1 : 1);
  for (const b of list) { b.vx = -w * b.y; b.vy = w * b.x; }
  rotate(list, rand(0, Math.PI * 2));
  list.period = (2 * Math.PI) / Math.abs(w);
  return list;
}

// Euler's collinear solution: the three stars stay on a rotating line, star 1
// in the middle. The spacing ratio depends on the masses (Euler's quintic), so
// find it by bisection: the outer stars must need the same ω² = −a / (x − x_com).
const EULER_LENGTH = 4;

function eulerOmega2(m, xs) {
  const M = m[0] + m[1] + m[2];
  const xc = (m[0] * xs[0] + m[1] * xs[1] + m[2] * xs[2]) / M;
  return [0, 2].map((i) => {
    let a = 0;
    for (let j = 0; j < 3; j++) {
      if (j === i) continue;
      const d = xs[j] - xs[i];
      a += (G * m[j] * Math.sign(d)) / (d * d);
    }
    return -a / (xs[i] - xc);
  });
}

function createEuler() {
  const m = masses;
  const at = (lam) => [0, EULER_LENGTH / (1 + lam), EULER_LENGTH];
  let lo = Math.log(1e-3), hi = Math.log(1e3);
  for (let n = 0; n < 60; n++) {
    const mid = (lo + hi) / 2;
    const [w0, w2] = eulerOmega2(m, at(Math.exp(mid)));
    if (w0 > w2) hi = mid; else lo = mid;
  }
  const xs = at(Math.exp(lo));
  const w2 = eulerOmega2(m, xs)[0];
  const list = xs.map((x, i) => makeBody(i, m[i], x, 0, 0, 0));
  toComFrame(list);
  const w = Math.sqrt(w2) * (Math.random() < 0.5 ? -1 : 1);
  for (const b of list) { b.vx = -w * b.y; b.vy = w * b.x; }
  rotate(list, rand(0, Math.PI * 2));
  list.period = (2 * Math.PI) / Math.abs(w);
  return list;
}

// Šuvakov & Dmitrašinović (2013) periodic orbits, equal masses, G = m = 1:
// x1 = (−1, 0), x2 = (1, 0), x3 = (0, 0); v1 = v2 = (p1, p2), v3 = −2·(p1, p2).
// Scaled like the figure-eight. Initial conditions have five digits, and the
// orbits are unstable, so each survives a few periods before turning chaotic.
const SUVAKOV_L = 2;

function suvakov(p1, p2, T) {
  return () => {
    const k = Math.sqrt(G / SUVAKOV_L);
    const vx = p1 * k, vy = p2 * k;
    const list = [
      makeBody(0, 1, -SUVAKOV_L, 0, vx, vy),
      makeBody(1, 1, SUVAKOV_L, 0, vx, vy),
      makeBody(2, 1, 0, 0, -2 * vx, -2 * vy),
    ];
    rotate(list, rand(0, Math.PI * 2));
    list.period = (T * SUVAKOV_L ** 1.5) / (2 * Math.PI);
    return list;
  };
}

// Hierarchical triple: a tight binary (stars 0 and 1) with star 2 on a wide
// circular orbit around it — like the Sun–Earth–Moon or α Centauri. Stable.
const HIER_INNER = 0.7;
const HIER_OUTER = 6;

function createHierarchical() {
  const [m0, m1, m2] = masses;
  const mi = m0 + m1, M = mi + m2;
  const vIn = Math.sqrt((G * mi) / HIER_INNER);
  const vOut = Math.sqrt((G * M) / HIER_OUTER);
  const spin = Math.random() < 0.5 ? -1 : 1;
  // inner pair around its own COM, which sits at the origin for now
  const list = [
    makeBody(0, m0, (-m1 / mi) * HIER_INNER, 0, 0, (-m1 / mi) * vIn * spin),
    makeBody(1, m1, (m0 / mi) * HIER_INNER, 0, 0, (m0 / mi) * vIn * spin),
    makeBody(2, m2, HIER_OUTER, 0, 0, vOut * spin),
  ];
  toComFrame(list);
  rotate(list, rand(0, Math.PI * 2));
  list.period = 2 * Math.PI * Math.sqrt(HIER_OUTER ** 3 / (G * M));
  return list;
}

// Order matches the <select> and the 1…9, 0 keys.
// `equal`: the solution only exists for three equal masses.
const PRESETS = {
  chaos:        { create: createRandomBodies },
  lagrange:     { create: createLagrange },
  euler:        { create: createEuler },
  figure8:      { create: createFigure8, equal: true },
  butterfly:    { create: suvakov(0.30689, 0.12551, 6.2356), equal: true },
  moth:         { create: suvakov(0.46444, 0.39606, 14.8939), equal: true },
  goggles:      { create: suvakov(0.08330, 0.12789, 10.4668), equal: true },
  dragonfly:    { create: suvakov(0.08058, 0.58884, 21.2710), equal: true },
  yinyang:      { create: suvakov(0.51394, 0.30474, 17.3284), equal: true },
  hierarchical: { create: createHierarchical },
};

function createBodies() {
  const list = PRESETS[preset].create();
  softening = preset === 'chaos' ? SOFTENING : PRESET_SOFTENING;
  trailDuration = list.period ? Math.min(list.period, TRAIL_MAX_DURATION) : TRAIL_DURATION;
  computeAccelerations(list);
  return list;
}

function kineticEnergy(list) {
  return list.reduce((s, b) => s + 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy), 0);
}

function potentialEnergy(list) {
  let pe = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const r = Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y);
      pe -= (G * list[i].mass * list[j].mass) / r;
    }
  }
  return pe;
}

function computeAccelerations(list) {
  for (const b of list) { b.ax = 0; b.ay = 0; }
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const r2 = dx * dx + dy * dy + softening * softening;
      const inv = G / (r2 * Math.sqrt(r2));
      a.ax += dx * inv * b.mass; a.ay += dy * inv * b.mass;
      b.ax -= dx * inv * a.mass; b.ay -= dy * inv * a.mass;
    }
  }
}

// Step size shrinks during close encounters.
function adaptiveDt(list) {
  let dt = Infinity;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const r = Math.sqrt(dx * dx + dy * dy + softening * softening);
      const v = Math.hypot(b.vx - a.vx, b.vy - a.vy) + 1e-9;
      const tDyn = Math.sqrt((r * r * r) / (G * (a.mass + b.mass)));
      dt = Math.min(dt, tDyn, r / v);
    }
  }
  return dt * ETA * 2 * Math.PI;
}

// Velocity Verlet (kick–drift–kick).
function step(list, dt) {
  for (const b of list) {
    b.vx += 0.5 * dt * b.ax; b.vy += 0.5 * dt * b.ay;
    b.x += dt * b.vx; b.y += dt * b.vy;
  }
  computeAccelerations(list);
  for (const b of list) {
    b.vx += 0.5 * dt * b.ax; b.vy += 0.5 * dt * b.ay;
  }
}

function recordTrails(list, t) {
  for (const b of list) {
    const tr = b.trail;
    const last = tr[tr.length - 1];
    if (!last || Math.hypot(b.x - last.x, b.y - last.y) > TRAIL_MIN_DIST || t - last.t > 0.1) {
      tr.push({ x: b.x, y: b.y, t });
      if (tr.length > TRAIL_MAX_POINTS) tr.shift();
    }
  }
}

function pruneTrails(list, t) {
  for (const b of list) {
    let n = 0;
    while (n < b.trail.length - 1 && t - b.trail[n].t > trailDuration) n++;
    if (n) b.trail.splice(0, n);
  }
}

function advance(years) {
  let left = years;
  let steps = 0;
  while (left > 0 && steps < MAX_STEPS_PER_FRAME) {
    const dt = Math.min(adaptiveDt(bodies), left);
    step(bodies, dt);
    simTime += dt;
    left -= dt;
    steps++;
    recordTrails(bodies, simTime);
    detectEncounters();
  }
  pruneTrails(bodies, simTime);
}

// Close encounters → bass thump at the moment of closest approach. After a
// thump the pair re-arms once it has moved apart to REARM_FACTOR × that distance.
const ENCOUNTER_NEAR = 1.2;  // AU — closest approach must be below this
const REARM_FACTOR = 1.5;
const PAIRS = [[0, 1], [1, 2], [0, 2]];
let encounters = [];

function resetEncounters() {
  encounters = PAIRS.map(() => ({ armed: true, falling: false, prev: Infinity, min: 0 }));
}

function detectEncounters() {
  PAIRS.forEach(([i, j], k) => {
    const a = bodies[i], b = bodies[j], e = encounters[k];
    const r = Math.hypot(a.x - b.x, a.y - b.y);
    if (r > e.min * REARM_FACTOR) e.armed = true;
    if (e.armed && e.falling && r > e.prev && e.prev < ENCOUNTER_NEAR) {
      e.armed = false;
      e.min = e.prev;
      const closeness = 1 - e.prev / ENCOUNTER_NEAR;
      const intensity = 0.15 + 0.85 * closeness;
      const x = toScreenX((a.x * a.mass + b.x * b.mass) / (a.mass + b.mass));
      const pan = Math.max(-1, Math.min(1, (x / width) * 2 - 1)) * 0.7;
      const pitch = Math.sqrt(2.4 / (a.mass + b.mass)); // heavier pair → lower
      sound.thump(intensity, pan, pitch);
    }
    e.falling = r < e.prev;
    e.prev = r;
  });
}

// A star has escaped when it is unbound from the remaining pair, moving away,
// and far from it. The system has dissolved — time for a new one.
function systemDissolved(list) {
  for (let i = 0; i < 3; i++) {
    const s = list[i];
    const p = list[(i + 1) % 3], q = list[(i + 2) % 3];
    const M = p.mass + q.mass;
    const px = (p.x * p.mass + q.x * q.mass) / M;
    const py = (p.y * p.mass + q.y * q.mass) / M;
    const pvx = (p.vx * p.mass + q.vx * q.mass) / M;
    const pvy = (p.vy * p.mass + q.vy * q.mass) / M;
    const dx = s.x - px, dy = s.y - py;
    const dvx = s.vx - pvx, dvy = s.vy - pvy;
    const r = Math.hypot(dx, dy);
    const pairSep = Math.hypot(p.x - q.x, p.y - q.y);
    const energy = 0.5 * (dvx * dvx + dvy * dvy) - (G * (M + s.mass)) / r;
    const receding = dx * dvx + dy * dvy > 0;
    if (energy > 0 && receding && r > 10 && r > 5 * pairSep) return true;
    if (r > 60) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Camera: centred on the COM (the origin), zooms to keep all stars in view.
// ---------------------------------------------------------------------------
// (ox, oy) is a world-space offset that eases back to zero, so recentring the
// COM after a star is dragged doesn't make the picture jump.
const camera = { scale: 0, cx: 0, cy: 0, ox: 0, oy: 0 };

function viewport() {
  const top = statsEl.getBoundingClientRect().bottom + 30;
  const bottom = height - 50;
  return {
    cx: width / 2,
    cy: (top + bottom) / 2,
    halfW: width / 2 - 60,
    halfH: Math.max(80, (bottom - top) / 2),
  };
}

function updateCamera(realDt) {
  const vp = viewport();
  camera.cx = vp.cx;
  camera.cy = vp.cy;
  if (drag) return; // hold the view still while a star is being placed
  const settle = Math.exp(-realDt * 2.5);
  camera.ox *= settle;
  camera.oy *= settle;
  let extent = 2.5;
  for (const b of bodies) {
    extent = Math.max(extent, Math.abs(b.x + camera.ox) * vp.halfH / vp.halfW, Math.abs(b.y + camera.oy));
  }
  const target = vp.halfH / (extent * 1.15);
  if (!camera.scale) { camera.scale = target; return; }
  const speed = target < camera.scale ? 3 : 0.6; // zoom out quickly, in gently
  camera.scale += (target - camera.scale) * (1 - Math.exp(-realDt * speed));
}

const toScreenX = (x) => camera.cx + (x + camera.ox) * camera.scale;
const toScreenY = (y) => camera.cy + (y + camera.oy) * camera.scale;
const toWorldX = (sx) => (sx - camera.cx) / camera.scale - camera.ox;
const toWorldY = (sy) => (sy - camera.cy) / camera.scale - camera.oy;

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const RGB = Object.fromEntries(COLORS.map((hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [hex, `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`];
}));
const rgba = (hex, a) => `rgba(${RGB[hex]},${a})`;

function drawTrail(b) {
  const tr = b.trail;
  if (tr.length < 2) return;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  // each segment gets its own alpha: opaque at the star, transparent at the tail
  for (let i = 0; i < tr.length - 1; i++) {
    const age = (simTime - tr[i + 1].t) / trailDuration;
    const alpha = Math.max(0, 1 - age) ** 1.5 * 0.85;
    if (alpha < 0.005) continue;
    ctx.strokeStyle = rgba(b.color, alpha);
    ctx.beginPath();
    ctx.moveTo(toScreenX(tr[i].x), toScreenY(tr[i].y));
    ctx.lineTo(toScreenX(tr[i + 1].x), toScreenY(tr[i + 1].y));
    ctx.stroke();
  }
  // connect last stored point to the star's current position
  const last = tr[tr.length - 1];
  ctx.strokeStyle = rgba(b.color, 0.85);
  ctx.beginPath();
  ctx.moveTo(toScreenX(last.x), toScreenY(last.y));
  ctx.lineTo(toScreenX(b.x), toScreenY(b.y));
  ctx.stroke();
}

function drawStar(b) {
  const x = toScreenX(b.x), y = toScreenY(b.y);

  // soft halo
  const haloR = 45 + b.mass * 25;
  const halo = ctx.createRadialGradient(x, y, 0, x, y, haloR);
  halo.addColorStop(0, rgba(b.color, 0.28));
  halo.addColorStop(0.25, rgba(b.color, 0.1));
  halo.addColorStop(1, rgba(b.color, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, haloR, 0, Math.PI * 2);
  ctx.fill();

  // bright core with a coloured rim
  const coreR = 2.5 + b.mass * 1.5;
  const core = ctx.createRadialGradient(x, y, 0, x, y, coreR * 1.6);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.45, 'rgba(255,255,255,0.95)');
  core.addColorStop(0.65, rgba(b.color, 1));
  core.addColorStop(1, rgba(b.color, 0));
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, coreR * 1.6, 0, Math.PI * 2);
  ctx.fill();
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  for (const b of bodies) drawTrail(b);
  ctx.globalCompositeOperation = 'lighter';
  for (const b of bodies) drawStar(b);
  ctx.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const timeEl = document.getElementById('time');
const speedEls = [0, 1, 2].map((i) => document.getElementById(`speed-${i}`));
const massEls = [0, 1, 2].map((i) => document.getElementById(`mass-${i}`));
let hudTimer = 0;

function updateHud(realDt) {
  hudTimer -= realDt;
  if (hudTimer > 0) return;
  hudTimer = 0.1;
  timeEl.textContent = Math.floor(simTime).toString();
  bodies.forEach((b, i) => {
    speedEls[i].textContent = Math.round(Math.hypot(b.vx, b.vy) * AU_PER_YEAR_TO_KM_S).toString();
    massEls[i].textContent = b.mass.toFixed(2);
  });
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const pauseBtn = document.getElementById('btn-pause');
const restartBtn = document.getElementById('btn-restart');
const speedRange = document.getElementById('speed-range');
const speedLabel = document.getElementById('speed-label');

function setPaused(p) {
  if (!p && drag) dropStar();
  paused = p;
  pauseBtn.textContent = t(paused ? 'play' : 'pause');
  document.body.classList.toggle('paused', paused);
  if (!paused) canvas.style.cursor = '';
}

function setSpeed(exp) {
  exp = Math.max(-2, Math.min(2, exp));
  speedRange.value = exp;
  rate = BASE_RATE * 2 ** exp;
  const m = 2 ** exp;
  speedLabel.textContent = (m < 1 ? m.toFixed(2).replace(/0$/, '') : m.toFixed(m % 1 ? 1 : 0)) + '×';
}

const massRanges = [0, 1, 2].map((i) => document.getElementById(`mass-range-${i}`));
const massLabels = [0, 1, 2].map((i) => document.getElementById(`mass-label-${i}`));

function setMass(i, m) {
  masses[i] = m;
  massRanges[i].value = m;
  massLabels[i].textContent = m.toFixed(2);
}

function randomizeMasses() {
  for (let i = 0; i < 3; i++) setMass(i, Math.round(rand(0.8, 2.0) * 20) / 20);
}

const presetSelect = document.getElementById('preset');
const presetNote = document.getElementById('preset-note');

function setPreset(p) {
  preset = p;
  presetSelect.value = p;
  presetNote.textContent = t(presetSelect.selectedOptions[0].dataset.note);
  if (PRESETS[p].equal) for (let i = 0; i < 3; i++) setMass(i, 1);
  restart();
}

function reset() {
  drag = null;
  camera.ox = camera.oy = 0;
  bodies = createBodies();
  resetEncounters();
  simTime = 0;
  camera.scale = 0;
  hudTimer = 0;
}

function restart() {
  if (restarting) return;
  restarting = true;
  canvas.style.opacity = '0';
  setTimeout(() => {
    reset();
    canvas.style.opacity = '1';
    restarting = false;
  }, 900);
}

const soundBtn = document.getElementById('btn-sound');

function toggleSound() {
  sound.setEnabled(!sound.enabled);
  soundBtn.textContent = t(sound.enabled ? 'sound.on' : 'sound.off');
}

pauseBtn.addEventListener('click', () => setPaused(!paused));
restartBtn.addEventListener('click', restart);
soundBtn.addEventListener('click', toggleSound);
speedRange.addEventListener('input', () => setSpeed(parseFloat(speedRange.value)));
massRanges.forEach((el, i) => {
  // Label follows the thumb; the simulation restarts once the drag ends.
  el.addEventListener('input', () => setMass(i, parseFloat(el.value)));
  // Equal-mass orbits don't exist for other masses, so fall back to chaos.
  el.addEventListener('change', () => (PRESETS[preset].equal ? setPreset('chaos') : restart()));
});
document.getElementById('btn-random-masses').addEventListener('click', shuffleMasses);
presetSelect.addEventListener('change', () => {
  setPreset(presetSelect.value);
  presetSelect.blur(); // keep keyboard shortcuts working
});

function shuffleMasses() {
  randomizeMasses();
  if (PRESETS[preset].equal) setPreset('chaos');
  else restart();
}

const helpEl = document.getElementById('help');

function setHelp(open) {
  helpEl.hidden = !open;
}

document.getElementById('btn-help').addEventListener('click', () => setHelp(true));
document.getElementById('help-close').addEventListener('click', () => setHelp(false));
helpEl.addEventListener('click', (e) => { if (e.target === helpEl) setHelp(false); });

window.addEventListener('keydown', (e) => {
  if (e.key === '?' || e.code === 'KeyH') { setHelp(helpEl.hidden); return; }
  if (!helpEl.hidden) {
    if (e.code === 'Escape') setHelp(false);
    return; // other shortcuts are off while help is open
  }
  if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
  else if (e.code === 'KeyR') restart();
  else if (e.code === 'KeyM') toggleSound();
  else if (e.code === 'KeyN') shuffleMasses();
  else if (/^Digit\d$/.test(e.code)) {
    // 1…9, then 0 for the tenth preset
    const n = (parseInt(e.code.slice(5), 10) + 9) % 10;
    const keys = Object.keys(PRESETS);
    if (n < keys.length) setPreset(keys[n]);
  }
  else if (e.key === '+' || e.key === '=') setSpeed(parseFloat(speedRange.value) + 0.25);
  else if (e.key === '-' || e.key === '_') setSpeed(parseFloat(speedRange.value) - 0.25);
});

// ---------------------------------------------------------------------------
// Dragging stars (while paused)
// ---------------------------------------------------------------------------
const DRAG_RADIUS = 24; // px around a star that still grabs it
let drag = null;        // { body, dx, dy } — grab offset in world units

function starAt(sx, sy) {
  let best = null, bestD = DRAG_RADIUS;
  for (const b of bodies) {
    const d = Math.hypot(toScreenX(b.x) - sx, toScreenY(b.y) - sy);
    if (d < bestD) { best = b; bestD = d; }
  }
  return best;
}

// Velocities are untouched, so total momentum stays zero; only the COM moved.
// Shift everything back so it sits at the origin, and let the camera catch up.
function dropStar() {
  drag = null;
  const M = bodies.reduce((s, b) => s + b.mass, 0);
  const cx = bodies.reduce((s, b) => s + b.mass * b.x, 0) / M;
  const cy = bodies.reduce((s, b) => s + b.mass * b.y, 0) / M;
  for (const b of bodies) {
    b.x -= cx; b.y -= cy;
    for (const p of b.trail) { p.x -= cx; p.y -= cy; }
  }
  camera.ox += cx;
  camera.oy += cy;
  computeAccelerations(bodies);
  resetEncounters();
}

canvas.addEventListener('pointerdown', (e) => {
  if (!paused || restarting) return;
  const b = starAt(e.clientX, e.clientY);
  if (!b) return;
  drag = { body: b, dx: b.x - toWorldX(e.clientX), dy: b.y - toWorldY(e.clientY) };
  b.trail = []; // its history no longer leads to where it is
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('pointermove', (e) => {
  if (drag) {
    drag.body.x = toWorldX(e.clientX) + drag.dx;
    drag.body.y = toWorldY(e.clientY) + drag.dy;
  } else if (paused) {
    canvas.style.cursor = starAt(e.clientX, e.clientY) ? 'grab' : '';
  }
});

function endDrag() {
  if (!drag) return;
  dropStar();
  canvas.style.cursor = 'grab';
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastFrame = performance.now();

function frame(now) {
  const realDt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  if (!paused) {
    advance(realDt * rate);
    if (!restarting && systemDissolved(bodies)) restart();
  }
  updateCamera(realDt);
  render();
  updateHud(realDt);
  requestAnimationFrame(frame);
}

canvas.style.transition = 'opacity 0.9s ease';
window.addEventListener('resize', resize);
resize();
window.addEventListener('langchange', () => {
  pauseBtn.textContent = t(paused ? 'play' : 'pause');
  soundBtn.textContent = t(sound.enabled ? 'sound.on' : 'sound.off');
  presetNote.textContent = t(presetSelect.selectedOptions[0].dataset.note);
});
applyLang();
setSpeed(0);
randomizeMasses();
reset();
requestAnimationFrame(frame);
