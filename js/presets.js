'use strict';

// ---------------------------------------------------------------------------
// Starting configurations. Each `create(masses)` returns a list of bodies in
// the centre-of-mass frame; periodic ones also carry `list.period` in years.
// ---------------------------------------------------------------------------
const COLORS = ['#6fd0ff', '#ff6f6f', '#ffd36e'];

const rand = (a, b) => a + Math.random() * (b - a);

function makeBody(i, mass, x, y, vx, vy) {
  return { mass, color: COLORS[i], x, y, vx, vy, ax: 0, ay: 0, trail: [] };
}

function createRandomBodies(masses) {
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

function createLagrange(masses) {
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

function createEuler(masses) {
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

function createHierarchical(masses) {
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
