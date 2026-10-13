'use strict';

// ---------------------------------------------------------------------------
// Gravitational field overlay, drawn under the trails. Two looks:
//   grid — a rubber sheet whose lines are pulled into each star's well;
//   heat — the depth of the potential as a colour map with isolines.
// Both mark the equilibrium points, where the stars' pulls cancel out.
// Uses the simulation's globals (bodies, camera, ctx, …) at draw time only.
// ---------------------------------------------------------------------------
const FIELD_MODES = ['off', 'grid', 'heat'];

const HEAT_CELL = 6;          // px per sample of the colour map
const HEAT_LEVELS = 0.28;     // isoline spacing, in ln(depth)
const GRID_STEP = 40;         // px between sheet lines (smaller on phones)
const GRID_SAMPLE = 8;        // px between points along a sheet line
const GRID_BUCKETS = 8;       // brightness levels; lines are batched by them
const WELL_SOFTENING = 14;    // px — keeps the wells finite at the stars

let fieldMode = FIELD_MODES.includes(localStorage.getItem('field')) ? localStorage.getItem('field') : 'off';

const heatCanvas = document.createElement('canvas');
const heatCtx = heatCanvas.getContext('2d');
let heatImage = null;

// Potential depth at a world point, made dimensionless so it reads the same at
// any zoom: 1 means "as deep as the whole system seen from the edge of the view".
function depthAt(x, y, R, a2, M) {
  let p = 0;
  for (const b of bodies) {
    const dx = x - b.x, dy = y - b.y;
    p += b.mass / Math.sqrt(dx * dx + dy * dy + a2);
  }
  return (p * R) / M;
}

// Shared scale for both looks.
function fieldScale() {
  const R = viewport().halfH / camera.scale;      // AU from the centre to the edge of the view
  const a = WELL_SOFTENING / camera.scale;
  const M = bodies.reduce((s, b) => s + b.mass, 0);
  return { R, a2: a * a, M };
}

// ln(depth) → 0…1 for colouring: the open sky is 0, the bottom of a well 1.
const DEPTH_LO = Math.log(0.7), DEPTH_HI = Math.log(30);
const depthLevel = (lnp) => Math.max(0, Math.min(1, (lnp - DEPTH_LO) / (DEPTH_HI - DEPTH_LO)));

// Colour ramp of the heat map: [level, r, g, b, alpha].
const HEAT_RAMP = [
  [0, 20, 30, 90, 0],
  [0.25, 35, 45, 140, 0.22],
  [0.5, 105, 50, 170, 0.32],
  [0.75, 195, 60, 140, 0.4],
  [1, 255, 150, 80, 0.5],
];

function heatColor(f) {
  let i = 0;
  while (i < HEAT_RAMP.length - 2 && f > HEAT_RAMP[i + 1][0]) i++;
  const a = HEAT_RAMP[i], b = HEAT_RAMP[i + 1];
  const k = (f - a[0]) / (b[0] - a[0]);
  return [1, 2, 3, 4].map((j) => a[j] + (b[j] - a[j]) * k);
}

function drawHeat() {
  const { R, a2, M } = fieldScale();
  const cols = Math.ceil(width / HEAT_CELL) + 1, rows = Math.ceil(height / HEAT_CELL) + 1;
  if (heatCanvas.width !== cols || heatCanvas.height !== rows) {
    heatCanvas.width = cols;
    heatCanvas.height = rows;
    heatImage = heatCtx.createImageData(cols, rows);
  }
  const d = heatImage.data;
  const lnp = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    const wy = toWorldY(j * HEAT_CELL);
    for (let i = 0; i < cols; i++) {
      const v = Math.log(depthAt(toWorldX(i * HEAT_CELL), wy, R, a2, M));
      lnp[j * cols + i] = v;
      const [r, g, b, al] = heatColor(depthLevel(v));
      const o = (j * cols + i) * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = al * 255;
    }
  }
  heatCtx.putImageData(heatImage, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // sample (i, j) sits at pixel (i, j) × HEAT_CELL, so shift by half a cell
  ctx.drawImage(heatCanvas, -HEAT_CELL / 2, -HEAT_CELL / 2, cols * HEAT_CELL, rows * HEAT_CELL);

  // Isolines by marching squares, all levels in one path.
  ctx.beginPath();
  const lerp = (a, b, level) => (level - a) / (b - a);
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const v0 = lnp[j * cols + i] / HEAT_LEVELS, v1 = lnp[j * cols + i + 1] / HEAT_LEVELS;
      const v2 = lnp[(j + 1) * cols + i + 1] / HEAT_LEVELS, v3 = lnp[(j + 1) * cols + i] / HEAT_LEVELS;
      const lo = Math.ceil(Math.min(v0, v1, v2, v3)), hi = Math.floor(Math.max(v0, v1, v2, v3));
      if (lo > hi || hi - lo > 6) continue; // flat, or too steep to be legible (inside a well)
      const x = i * HEAT_CELL, y = j * HEAT_CELL, c = HEAT_CELL;
      for (let L = lo; L <= hi; L++) {
        // crossings on the four edges: top, right, bottom, left
        const pts = [];
        if ((v0 < L) !== (v1 < L)) pts.push(x + c * lerp(v0, v1, L), y);
        if ((v1 < L) !== (v2 < L)) pts.push(x + c, y + c * lerp(v1, v2, L));
        if ((v3 < L) !== (v2 < L)) pts.push(x + c * lerp(v3, v2, L), y + c);
        if ((v0 < L) !== (v3 < L)) pts.push(x, y + c * lerp(v0, v3, L));
        for (let k = 0; k + 3 < pts.length; k += 4) {
          ctx.moveTo(pts[k], pts[k + 1]);
          ctx.lineTo(pts[k + 2], pts[k + 3]);
        }
      }
    }
  }
  ctx.strokeStyle = 'rgba(210, 220, 255, 0.16)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Where a sheet point at world (x, y) is pulled to. Each star draws points in
// by a weight that is ~1 next to it and falls off as 1/r² far away.
function sheetPoint(x, y, R) {
  let ox = 0, oy = 0, w = 0;
  for (const b of bodies) {
    const dx = b.x - x, dy = b.y - y;
    const c = b.mass * (0.14 * R) ** 2;
    const k = c / (c + dx * dx + dy * dy);
    ox += dx * k; oy += dy * k; w += k;
  }
  if (w > 0.95) { ox *= 0.95 / w; oy *= 0.95 / w; }
  return [toScreenX(x + ox), toScreenY(y + oy)];
}

function drawGrid() {
  const { R, a2, M } = fieldScale();
  const step = width <= MOBILE_WIDTH ? GRID_STEP * 0.75 : GRID_STEP;
  // anchor the lines to the centre of mass so the sheet moves with the camera
  const x0 = wrap(toScreenX(0), step), y0 = wrap(toScreenY(0), step);
  const paths = Array.from({ length: GRID_BUCKETS }, () => new Path2D());
  const pad = step * 2;

  const line = (sx0, sy0, dx, dy, n) => {
    let prev = null, prevLevel = 0;
    for (let s = 0; s <= n; s++) {
      const sx = sx0 + dx * s, sy = sy0 + dy * s;
      const wx = toWorldX(sx), wy = toWorldY(sy);
      const p = sheetPoint(wx, wy, R);
      const level = depthLevel(Math.log(depthAt(wx, wy, R, a2, M)));
      if (prev) {
        const bucket = Math.min(GRID_BUCKETS - 1, Math.floor(((level + prevLevel) / 2) * GRID_BUCKETS));
        paths[bucket].moveTo(prev[0], prev[1]);
        paths[bucket].lineTo(p[0], p[1]);
      }
      prev = p; prevLevel = level;
    }
  };
  for (let y = y0 - pad; y <= height + pad; y += step) {
    line(-pad, y, GRID_SAMPLE, 0, Math.ceil((width + 2 * pad) / GRID_SAMPLE));
  }
  for (let x = x0 - pad; x <= width + pad; x += step) {
    line(x, -pad, 0, GRID_SAMPLE, Math.ceil((height + 2 * pad) / GRID_SAMPLE));
  }

  ctx.lineWidth = 1;
  paths.forEach((path, k) => {
    const f = (k + 0.5) / GRID_BUCKETS;
    ctx.strokeStyle = `rgba(${Math.round(120 + 100 * f)},${Math.round(140 + 30 * f)},255,${0.08 + 0.3 * f})`;
    ctx.stroke(path);
  });
}

// Equilibrium points: where the net pull vanishes (saddles of the potential,
// between the stars). Found on a coarse grid of |force|, then refined.
const EQ_CELL = 16; // px

function pullAt(x, y, a2) {
  let fx = 0, fy = 0;
  for (const b of bodies) {
    const dx = b.x - x, dy = b.y - y;
    const r2 = dx * dx + dy * dy + a2;
    const k = b.mass / (r2 * Math.sqrt(r2));
    fx += dx * k; fy += dy * k;
  }
  return [fx, fy];
}

function findEquilibria(a2) {
  const cols = Math.ceil(width / EQ_CELL), rows = Math.ceil(height / EQ_CELL);
  const f = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const [fx, fy] = pullAt(toWorldX((i + 0.5) * EQ_CELL), toWorldY((j + 0.5) * EQ_CELL), a2);
      f[j * cols + i] = Math.hypot(fx, fy);
    }
  }
  const found = [];
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      const v = f[j * cols + i];
      let isMin = true;
      for (let dj = -1; dj <= 1 && isMin; dj++) {
        for (let di = -1; di <= 1; di++) {
          if ((di || dj) && f[(j + dj) * cols + i + di] <= v) { isMin = false; break; }
        }
      }
      if (!isMin) continue;
      // Newton's method on the force, with a numerical Jacobian
      let x = toWorldX((i + 0.5) * EQ_CELL), y = toWorldY((j + 0.5) * EQ_CELL);
      const h = EQ_CELL / camera.scale / 20;
      let ok = false;
      for (let it = 0; it < 8; it++) {
        const [fx, fy] = pullAt(x, y, a2);
        const [fx1, fy1] = pullAt(x + h, y, a2);
        const [fx2, fy2] = pullAt(x, y + h, a2);
        const a = (fx1 - fx) / h, b = (fx2 - fx) / h, c = (fy1 - fy) / h, d = (fy2 - fy) / h;
        const det = a * d - b * c;
        if (!det) break;
        const sx = (d * fx - b * fy) / det, sy = (a * fy - c * fx) / det;
        x -= sx; y -= sy;
        if (Math.hypot(sx, sy) < h) { ok = det < 0; break; } // det < 0: a saddle
      }
      if (!ok) continue;
      const sx = toScreenX(x), sy = toScreenY(y);
      // skip points that collapsed into a star or duplicate one already found
      if (bodies.some((bd) => Math.hypot(toScreenX(bd.x) - sx, toScreenY(bd.y) - sy) < 20)) continue;
      if (found.some((p) => Math.hypot(p[0] - sx, p[1] - sy) < 8)) continue;
      found.push([sx, sy]);
    }
  }
  return found;
}

function drawEquilibria() {
  const a = WELL_SOFTENING / camera.scale;
  ctx.strokeStyle = 'rgba(235, 240, 255, 0.55)';
  ctx.lineWidth = 1;
  for (const [x, y] of findEquilibria(a * a)) {
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.moveTo(x - 8, y); ctx.lineTo(x - 2.5, y);
    ctx.moveTo(x + 2.5, y); ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8); ctx.lineTo(x, y - 2.5);
    ctx.moveTo(x, y + 2.5); ctx.lineTo(x, y + 8);
    ctx.stroke();
  }
}

function drawField() {
  if (fieldMode === 'off' || !camera.scale) return;
  if (fieldMode === 'heat') drawHeat();
  else drawGrid();
  drawEquilibria();
}
