// ---------------------------------------------------------------------------
// Anti-aliased lines of any width, rebuilt on the CPU each frame as ribbons of
// triangles in screen pixels. A line has a solid core and, optionally, a wider
// soft glow; colour, alpha and width can change from point to point. Alpha may
// go above 1: the scene is drawn in high dynamic range, for the bloom. Joins are
// mitred, so a line is one continuous strip — no overlaps that show as beads.
// A line can also carry two free numbers per point (`flow`) for a custom
// fragment shader to texture it with.
// ---------------------------------------------------------------------------
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh } from 'three';
import { ADD, material } from './common.js';

const MAX_MITER = 3; // a sharp turn can't push the corner further out than this

const vertexShader = /* glsl */ `
  attribute vec4 color;  // rgb, core alpha
  attribute vec4 shape;  // signed distance from the centre line, core half-width, glow half-width, glow alpha
  attribute vec2 flow;
  varying vec4 vColor;
  varying vec4 vShape;
  varying vec2 vFlow;
  void main() {
    vColor = color;
    vShape = shape;
    vFlow = flow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  varying vec4 vColor;
  varying vec4 vShape;
  void main() {
    float d = abs(vShape.x);
    float core = clamp(vShape.y - d + 0.5, 0.0, 1.0);
    // the glow fades smoothly to nothing — no visible band edge — with the
    // same total light as a flat band of its width
    float g = d / max(vShape.z, 1e-3);
    float glow = 2.2 * exp(-4.0 * g * g);
    float a = (vColor.a * core + vShape.w * glow) * uOpacity;
    gl_FragColor = vec4(vColor.rgb * a, a);
  }
`;

export class Strokes {
  constructor(blend = ADD, { fragmentShader = FRAGMENT, uniforms = {} } = {}) {
    this.uniforms = { uOpacity: { value: 1 }, ...uniforms };
    this.geometry = new BufferGeometry();
    this.mesh = new Mesh(this.geometry, material({ vertexShader, fragmentShader, uniforms: this.uniforms, blend }));
    this.mesh.frustumCulled = false;
    this.capacity = 0;
    this.grow(4096);
  }

  set opacity(v) { this.uniforms.uOpacity.value = v; }

  grow(points) {
    while (this.capacity < points) this.capacity = Math.max(4096, this.capacity * 2);
    const n = this.capacity * 2; // two vertices per point
    this.geometry.dispose(); // frees the old buffers on the GPU
    this.pos = new Float32Array(n * 2);
    this.col = new Float32Array(n * 4);
    this.shp = new Float32Array(n * 4);
    this.flw = new Float32Array(n * 2);
    this.idx = new Uint32Array(this.capacity * 6);
    const attr = (array, size) => new BufferAttribute(array, size).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', attr(this.pos, 2));
    this.geometry.setAttribute('color', attr(this.col, 4));
    this.geometry.setAttribute('shape', attr(this.shp, 4));
    this.geometry.setAttribute('flow', attr(this.flw, 2));
    this.geometry.setIndex(attr(this.idx, 1));
  }

  begin() {
    this.points = 0;
    this.indices = 0;
  }

  // xy: [x0, y0, x1, y1, …] in px. style(i, out) fills out with the look at
  // point i: [r, g, b (0…1), core alpha, core width, glow width, glow alpha,
  // flow x, flow y].
  line(xy, style) {
    const n = xy.length / 2;
    if (n < 2) return;
    if (this.points + n > this.capacity) {
      // keep what is already built this frame
      const { pos, col, shp, flw, idx } = this;
      this.grow(this.points + n);
      this.pos.set(pos); this.col.set(col); this.shp.set(shp); this.flw.set(flw); this.idx.set(idx);
    }
    const { pos, col, shp, flw, idx } = this;
    const s = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    let nx = 0, ny = 0; // normal of the previous segment
    for (let i = 0; i < n; i++) {
      const x = xy[2 * i], y = xy[2 * i + 1];
      // normals of the segments before and after this point
      let ax = 0, ay = 0, bx = 0, by = 0;
      if (i > 0) {
        const dx = x - xy[2 * i - 2], dy = y - xy[2 * i - 1], l = Math.hypot(dx, dy);
        if (l > 1e-6) { ax = -dy / l; ay = dx / l; nx = ax; ny = ay; } else { ax = nx; ay = ny; }
      }
      if (i < n - 1) {
        const dx = xy[2 * i + 2] - x, dy = xy[2 * i + 3] - y, l = Math.hypot(dx, dy);
        if (l > 1e-6) { bx = -dy / l; by = dx / l; } else { bx = ax; by = ay; }
      }
      if (i === 0) { ax = bx; ay = by; }
      if (i === n - 1) { bx = ax; by = ay; }
      // the mitre: halfway between the two normals, long enough to keep the width
      let mx = ax + bx, my = ay + by;
      const ml = Math.hypot(mx, my);
      if (ml < 1e-6) { mx = ax; my = ay; } else { mx /= ml; my /= ml; }
      const k = Math.min(MAX_MITER, 1 / Math.max(1e-6, mx * ax + my * ay));

      style(i, s);
      const core = s[4] / 2, glow = s[5] / 2;
      const half = Math.max(core, glow) + 1; // room for the anti-aliased edge
      const v = (this.points + i) * 2;
      for (let side = 0; side < 2; side++) {
        const sign = side ? 1 : -1, o = v + side;
        pos[o * 2] = x + mx * half * k * sign;
        pos[o * 2 + 1] = y + my * half * k * sign;
        col[o * 4] = s[0]; col[o * 4 + 1] = s[1]; col[o * 4 + 2] = s[2]; col[o * 4 + 3] = s[3];
        shp[o * 4] = half * sign; shp[o * 4 + 1] = core; shp[o * 4 + 2] = glow; shp[o * 4 + 3] = s[6];
        flw[o * 2] = s[7]; flw[o * 2 + 1] = s[8];
      }
      if (i > 0) {
        const j = this.indices;
        idx[j] = v - 2; idx[j + 1] = v - 1; idx[j + 2] = v;
        idx[j + 3] = v - 1; idx[j + 4] = v + 1; idx[j + 5] = v;
        this.indices += 6;
      }
    }
    this.points += n;
  }

  end() {
    const g = this.geometry;
    for (const name of ['position', 'color', 'shape', 'flow']) {
      const a = g.getAttribute(name);
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.points * 2 * a.itemSize);
      a.needsUpdate = true;
    }
    g.index.clearUpdateRanges();
    g.index.addUpdateRange(0, this.indices);
    g.index.needsUpdate = true;
    g.setDrawRange(0, this.indices);
  }
}
