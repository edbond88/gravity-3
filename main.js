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

const MOBILE_WIDTH = 760;        // px — matches the media query in style.css

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
  generateBackground();
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Background: a nebula and three layers of distant stars. Each layer follows
// the camera's zoom and offset by a different amount, so the sky has depth.
// ---------------------------------------------------------------------------
const BG_LAYERS = [
  { depth: 0.08, density: 1 / 9000, rMax: 0.7, alpha: 0.3, drift: 1.5 },
  { depth: 0.2, density: 1 / 14000, rMax: 1.1, alpha: 0.45, drift: 3 },
  { depth: 0.4, density: 1 / 40000, rMax: 1.7, alpha: 0.6, drift: 6 },
];
const NEBULA_MARGIN = 1.6; // nebula canvas covers this × the screen, so zooming out shows no edge
const NEBULA_RES = 0.35;   // it's all soft gradients, so a low resolution is plenty
const nebula = document.createElement('canvas');
let haze = null;

function generateBackground() {
  for (const layer of BG_LAYERS) {
    const count = Math.round(width * height * layer.density);
    layer.stars = Array.from({ length: count }, () => ({
      u: Math.random(),
      v: Math.random(),
      r: Math.random() ** 3 * layer.rMax + 0.25,
      a: layer.alpha * (0.2 + Math.random() * 0.8),
      tint: Math.random() < 0.15 ? (Math.random() < 0.5 ? '255,215,190' : '190,215,255') : '205,212,255',
      twinkle: Math.random() < 0.25 ? 1 + Math.random() * 2.5 : 0, // Hz, 0 = steady
      phase: Math.random() * Math.PI * 2,
    }));
  }

  const nw = width * NEBULA_MARGIN, nh = height * NEBULA_MARGIN;
  nebula.width = Math.max(1, Math.round(nw * NEBULA_RES));
  nebula.height = Math.max(1, Math.round(nh * NEBULA_RES));
  const n = nebula.getContext('2d');
  n.setTransform(NEBULA_RES, 0, 0, NEBULA_RES, 0, 0);
  const palette = ['90,50,160', '40,90,170', '150,50,120', '30,120,140'];
  const clouds = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < clouds; i++) {
    const x = nw * (0.15 + Math.random() * 0.7);
    const y = nh * (0.15 + Math.random() * 0.7);
    const r = Math.max(nw, nh) * (0.15 + Math.random() * 0.25);
    const g = n.createRadialGradient(x, y, 0, x, y, r);
    const c = palette[i % palette.length];
    const a = 0.025 + Math.random() * 0.035;
    g.addColorStop(0, `rgba(${c},${a})`);
    g.addColorStop(0.5, `rgba(${c},${a * 0.4})`);
    g.addColorStop(1, `rgba(${c},0)`);
    n.fillStyle = g;
    n.fillRect(0, 0, nw, nh);
  }

  // faint violet haze near the bottom, fixed to the screen
  haze = bg.createRadialGradient(width * 0.55, height * 1.05, 0, width * 0.55, height * 1.05, height * 0.8);
  haze.addColorStop(0, 'rgba(90, 50, 160, 0.12)');
  haze.addColorStop(1, 'rgba(90, 50, 160, 0)');
}

// Wraps v into [-period/2, period/2).
const wrap = (v, period) => ((((v + period / 2) % period) + period) % period) - period / 2;

function drawBackground(now) {
  bg.setTransform(dpr, 0, 0, dpr, 0, 0);
  bg.clearRect(0, 0, width, height);
  bg.fillStyle = haze;
  bg.fillRect(0, 0, width, height);

  // How far the camera has zoomed out from its closest view (1 = fully in).
  const zoom = camera.scale ? Math.min(1, camera.scale / closestScale()) : 1;
  const cx = width / 2, cy = height / 2;
  const time = reducedMotion ? 0 : now;

  const ns = Math.max(1 / NEBULA_MARGIN, zoom ** 0.05);
  const nw = width * NEBULA_MARGIN * ns, nh = height * NEBULA_MARGIN * ns;
  bg.drawImage(nebula, cx - nw / 2 + camera.ox * camera.scale * 0.03, cy - nh / 2 + camera.oy * camera.scale * 0.03, nw, nh);

  for (const layer of BG_LAYERS) {
    const s = Math.max(0.5, zoom ** layer.depth);
    // The star field is a tile of the screen's size, scaled by s and repeated.
    const pw = width * s, ph = height * s;
    const offX = camera.ox * camera.scale * layer.depth + time * layer.drift;
    const offY = camera.oy * camera.scale * layer.depth;
    const nx = Math.ceil(width / pw / 2), ny = Math.ceil(height / ph / 2);
    const rs = Math.sqrt(s);
    for (const st of layer.stars) {
      let a = st.a;
      if (st.twinkle && time) a *= 0.65 + 0.35 * Math.sin(time * st.twinkle * 2 * Math.PI + st.phase);
      bg.fillStyle = `rgba(${st.tint},${a})`;
      const bx = wrap((st.u - 0.5) * pw + offX, pw);
      const by = wrap((st.v - 0.5) * ph + offY, ph);
      for (let i = -nx; i <= nx; i++) {
        const x = cx + bx + i * pw;
        if (x < -2 || x > width + 2) continue;
        for (let j = -ny; j <= ny; j++) {
          const y = cy + by + j * ph;
          if (y < -2 || y > height + 2) continue;
          bg.beginPath();
          bg.arc(x, y, st.r * rs, 0, Math.PI * 2);
          bg.fill();
        }
      }
    }
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
      tr.push({ x: b.x, y: b.y, t, v: Math.hypot(b.vx, b.vy) });
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
      spawnBurst(a, b, (a.x * a.mass + b.x * b.mass) / (a.mass + b.mass), (a.y * a.mass + b.y * b.mass) / (a.mass + b.mass), intensity);
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

const controlsEl = document.querySelector('.controls');

function viewport() {
  const top = statsEl.getBoundingClientRect().bottom + 30;
  // On phones the controls span the full width, so keep the stars above them.
  const bottom = width <= MOBILE_WIDTH
    ? controlsEl.getBoundingClientRect().top - 20
    : height - 50;
  return {
    cx: width / 2,
    cy: (top + bottom) / 2,
    halfW: width / 2 - 60,
    halfH: Math.max(80, (bottom - top) / 2),
  };
}

const MIN_EXTENT = 2.5;   // AU — never zoom in further than this
const VIEW_MARGIN = 1.15;

// The scale of the closest view the camera allows.
const closestScale = () => viewport().halfH / (MIN_EXTENT * VIEW_MARGIN);

function updateCamera(realDt) {
  const vp = viewport();
  camera.cx = vp.cx;
  camera.cy = vp.cy;
  if (drag) return; // hold the view still while a star is being placed
  const settle = Math.exp(-realDt * 2.5);
  camera.ox *= settle;
  camera.oy *= settle;
  let extent = MIN_EXTENT;
  for (const b of bodies) {
    extent = Math.max(extent, Math.abs(b.x + camera.ox) * vp.halfH / vp.halfW, Math.abs(b.y + camera.oy));
  }
  const target = vp.halfH / (extent * VIEW_MARGIN);
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

function drawTrail(b) {
  const tr = b.trail;
  if (tr.length < 2) return;
  const pts = tr.concat({ x: b.x, y: b.y, t: simTime, v: Math.hypot(b.vx, b.vy) });
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
    const rgb = mix(base, WHITE, hot ** 1.5 * 0.45).join(',');
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
    const h = Math.min(1, (q.v - vMin) / vSpan);
    const k = Math.round(f * TRAIL_BUCKETS) * (TRAIL_BUCKETS + 1) + Math.round(h * 6);
    if (k !== key) {
      flush();
      key = k; fresh = Math.round(f * TRAIL_BUCKETS) / TRAIL_BUCKETS; hot = Math.round(h * 6) / 6;
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
// Close-encounter bursts: a flash, an expanding ring and a spray of sparks at
// the point of closest approach. Positions are in world space so a burst stays
// where it happened; the stars involved flare up for a moment.
// ---------------------------------------------------------------------------
const MAX_BURSTS = 12;
let bursts = [];
let frameNow = 0; // seconds, real time of the current frame

function spawnBurst(a, b, wx, wy, intensity) {
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
    const flash = I * Math.exp(-age * 9);
    if (flash > 0.01) {
      const fr = (25 + 70 * I) * k;
      const g = ctx.createRadialGradient(x, y, 0, x, y, fr);
      g.addColorStop(0, `rgba(255,255,255,${0.8 * flash})`);
      g.addColorStop(0.3, `rgba(${s.color},${0.4 * flash})`);
      g.addColorStop(1, `rgba(${s.color},0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, fr, 0, Math.PI * 2);
      ctx.fill();
    }

    // shock ring
    const ringR = 6 + (40 + 150 * I) * k * (1 - (1 - p) ** 3);
    ctx.strokeStyle = `rgba(${s.color},${0.55 * I * (1 - p) ** 2})`;
    ctx.lineWidth = 1 + 2.5 * I * (1 - p);
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.stroke();

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
  for (const b of bodies) drawTrail(b);
  ctx.globalCompositeOperation = 'lighter';
  drawBursts();
  bodies.forEach((b, i) => drawStar(b, i, frameNow));
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
  bursts = [];
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

// On phones the start/masses panel is a sheet toggled from the controls bar;
// it sits right above the bar, whose height changes as it wraps.
function setSettings(open) {
  document.body.classList.toggle('settings-open', open);
}

document.getElementById('btn-settings').addEventListener('click', () => {
  setSettings(!document.body.classList.contains('settings-open'));
});
canvas.addEventListener('pointerdown', () => setSettings(false));
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--controls-h', `${controlsEl.offsetHeight}px`);
}).observe(controlsEl);

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
  if (e.code === 'Escape') { setSettings(false); return; }
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
  frameNow = now / 1000;

  if (!paused) {
    advance(realDt * rate);
    if (!restarting && systemDissolved(bodies)) restart();
  }
  updateCamera(realDt);
  drawBackground(frameNow);
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
