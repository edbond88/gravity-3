// ---------------------------------------------------------------------------
// Trails glow, taper from the star to the tail and run white-hot where the
// star moved fast — or, coloured by energy, blue while bound and orange once
// escaping. Colour and width change smoothly from point to point.
// ---------------------------------------------------------------------------
import { Strokes } from './strokes.js';

export class Trails {
  constructor(scene) {
    this.strokes = new Strokes();
    scene.add(this.strokes.mesh);
  }

  update(opacity) {
    const s = this.strokes;
    s.opacity = opacity;
    s.begin();
    if (showTrails) bodies.forEach((b, i) => this.trail(b, i));
    s.end();
  }

  trail(b, i) {
    const pts = b.trail.concat({ x: b.x, y: b.y, t: simTime, v: Math.hypot(b.vx, b.vy), e: escapeRatio(bodies, i, softening) });
    // skip the part that has already faded out
    let first = 0;
    while (first < pts.length - 2 && 1 - (simTime - pts[first + 1].t) / trailDuration < 0.03) first++;
    const n = pts.length - first;
    if (n < 2) return;

    const byEnergy = trailColor === 'energy';
    let vMin = Infinity, vMax = 0;
    for (let k = first; k < pts.length; k++) { vMin = Math.min(vMin, pts[k].v); vMax = Math.max(vMax, pts[k].v); }
    const vSpan = Math.max(vMax - vMin, vMax * 0.2, 1e-9);
    const base = COLOR_RGB[b.color];
    const widthScale = 0.8 + 0.25 * Math.sqrt(b.mass);

    const xy = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      xy[2 * k] = toScreenX(pts[first + k].x);
      xy[2 * k + 1] = toScreenY(pts[first + k].y);
    }
    this.strokes.line(xy, (k, out) => {
      const p = pts[first + k];
      const fresh = Math.max(0, 1 - (simTime - p.t) / trailDuration);
      const hot = byEnergy
        ? 0.5 + 0.5 * Math.tanh(2.5 * p.e) // white only close to escape speed
        : Math.min(1, (p.v - vMin) / vSpan);
      const c = byEnergy ? energyColor(hot, base) : mix(base, WHITE, hot ** 1.5 * 0.45);
      const alpha = fresh ** 1.5;
      const w = (0.6 + 2 * fresh) * widthScale;
      out[0] = c[0] / 255; out[1] = c[1] / 255; out[2] = c[2] / 255;
      out[3] = alpha * 0.7;  // bright core
      out[4] = w;
      out[5] = w * 5;        // wide soft glow
      out[6] = alpha * 0.1;
    });
  }
}
