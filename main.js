'use strict';

// ---------------------------------------------------------------------------
// Units: AU, years, solar masses. In these units G = 4π².
// ---------------------------------------------------------------------------
const G = 4 * Math.PI * Math.PI;
const AU_PER_YEAR_TO_KM_S = 4.7406;

const SOFTENING = 0.02;          // AU — keeps close encounters finite
const ETA = 0.004;               // adaptive step accuracy factor
const MAX_STEPS_PER_FRAME = 20000;
const BASE_RATE = 1;             // simulated years per real second at 1×

const TRAIL_DURATION = 3;        // years of history kept in a trail
const TRAIL_MIN_DIST = 0.015;    // AU between stored trail points
const TRAIL_MAX_POINTS = 4000;

const COLORS = ['#6fd0ff', '#ff6fae', '#ffd36e'];

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

const rand = (a, b) => a + Math.random() * (b - a);

function createBodies() {
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
    const mass = rand(0.8, 2.0);
    // mix of overall rotation and random motion
    const va = rand(0, Math.PI * 2);
    return {
      mass,
      color: COLORS[i],
      x: p.x, y: p.y,
      vx: -p.y * spin * 0.6 + Math.cos(va) * rand(0.3, 1),
      vy: p.x * spin * 0.6 + Math.sin(va) * rand(0.3, 1),
      ax: 0, ay: 0,
      trail: [],
    };
  });

  // Move to the centre-of-mass frame: zero total momentum, COM at origin.
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

  // Scale velocities so the system is bound: KE = q·|PE| with q < 1.
  const pe = potentialEnergy(list);
  const ke = kineticEnergy(list);
  const q = rand(0.25, 0.45);
  const k = Math.sqrt((q * Math.abs(pe)) / ke);
  for (const b of list) { b.vx *= k; b.vy *= k; }

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
      const r2 = dx * dx + dy * dy + SOFTENING * SOFTENING;
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
      const r = Math.sqrt(dx * dx + dy * dy + SOFTENING * SOFTENING);
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
    while (n < b.trail.length - 1 && t - b.trail[n].t > TRAIL_DURATION) n++;
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
const camera = { scale: 0, cx: 0, cy: 0 };

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
  let extent = 2.5;
  for (const b of bodies) extent = Math.max(extent, Math.abs(b.x) * vp.halfH / vp.halfW, Math.abs(b.y));
  const target = vp.halfH / (extent * 1.15);
  if (!camera.scale) { camera.scale = target; return; }
  const speed = target < camera.scale ? 3 : 0.6; // zoom out quickly, in gently
  camera.scale += (target - camera.scale) * (1 - Math.exp(-realDt * speed));
}

const toScreenX = (x) => camera.cx + x * camera.scale;
const toScreenY = (y) => camera.cy + y * camera.scale;

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
    const age = (simTime - tr[i + 1].t) / TRAIL_DURATION;
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
  paused = p;
  pauseBtn.textContent = paused ? 'Play' : 'Pause';
}

function setSpeed(exp) {
  exp = Math.max(-2, Math.min(2, exp));
  speedRange.value = exp;
  rate = BASE_RATE * 2 ** exp;
  const m = 2 ** exp;
  speedLabel.textContent = (m < 1 ? m.toFixed(2).replace(/0$/, '') : m.toFixed(m % 1 ? 1 : 0)) + '×';
}

function reset() {
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
  soundBtn.textContent = sound.enabled ? 'Sound: on' : 'Sound: off';
}

pauseBtn.addEventListener('click', () => setPaused(!paused));
restartBtn.addEventListener('click', restart);
soundBtn.addEventListener('click', toggleSound);
speedRange.addEventListener('input', () => setSpeed(parseFloat(speedRange.value)));

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); setPaused(!paused); }
  else if (e.code === 'KeyR') restart();
  else if (e.code === 'KeyM') toggleSound();
  else if (e.key === '+' || e.key === '=') setSpeed(parseFloat(speedRange.value) + 0.25);
  else if (e.key === '-' || e.key === '_') setSpeed(parseFloat(speedRange.value) - 0.25);
});

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
setSpeed(0);
reset();
requestAnimationFrame(frame);
