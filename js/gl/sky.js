// ---------------------------------------------------------------------------
// Background: a nebula and three layers of distant stars. Each layer follows
// the camera's zoom and offset by a different amount, so the sky has depth.
// ---------------------------------------------------------------------------
import { BufferAttribute, BufferGeometry, CanvasTexture, DynamicDrawUsage, NearestFilter, Points } from 'three';
import { OVER, SCREEN_VERTEX, material, quad } from './common.js';

const BG_LAYERS = [
  { depth: 0.08, density: 1 / 3000, rMax: 0.7, alpha: 0.3, drift: 1.5 },
  { depth: 0.2, density: 1 / 5500, rMax: 1.1, alpha: 0.45, drift: 3 },
  { depth: 0.4, density: 1 / 16000, rMax: 1.7, alpha: 0.6, drift: 6 },
];
const TINTS = { warm: [255, 215, 190], cool: [190, 215, 255], plain: [205, 212, 255] };
const MAX_TILES = 9; // a layer zoomed out to half size repeats at most 3 × 3 times

const nebulaFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  void main() { gl_FragColor = texture2D(uMap, gl_FragCoord.xy / uResolution); }
`;

const starVertex = /* glsl */ `
  attribute vec4 color; // rgb, alpha
  attribute float radius;
  uniform float uDpr;
  varying vec4 vColor;
  varying float vRadius;
  varying float vSize;
  void main() {
    // Below half a pixel a star only gets dimmer: same light, smaller area.
    vRadius = max(radius, 0.5);
    vColor = vec4(color.rgb, color.a * min(1.0, pow(radius / 0.5, 2.0)));
    vSize = 2.0 * vRadius + 2.0;
    gl_PointSize = vSize * uDpr;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, 0.0, 1.0);
  }
`;

const starFragment = /* glsl */ `
  varying vec4 vColor;
  varying float vRadius;
  varying float vSize;
  void main() {
    float d = length(gl_PointCoord - 0.5) * vSize;
    float a = vColor.a * clamp(vRadius - d + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(vColor.rgb * a, a);
  }
`;

export class Sky {
  constructor(scene) {
    this.nebulaUniforms = { uMap: { value: null }, uResolution: { value: [1, 1] } };
    this.nebula = quad(material({
      vertexShader: SCREEN_VERTEX, fragmentShader: nebulaFragment, uniforms: this.nebulaUniforms, blend: OVER,
    }));
    scene.add(this.nebula);

    this.starUniforms = { uDpr: { value: 1 } };
    this.geometry = new BufferGeometry();
    this.points = new Points(this.geometry, material({
      vertexShader: starVertex, fragmentShader: starFragment, uniforms: this.starUniforms, blend: OVER,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  // New stars and a new nebula for the new screen size.
  generate() {
    let total = 0;
    for (const layer of BG_LAYERS) {
      const count = Math.round(width * height * layer.density);
      total += count;
      layer.stars = Array.from({ length: count }, () => ({
        u: Math.random(),
        v: Math.random(),
        r: Math.random() ** 3 * layer.rMax + 0.25,
        a: layer.alpha * (0.2 + Math.random() * 0.8),
        tint: Math.random() < 0.15 ? (Math.random() < 0.5 ? TINTS.warm : TINTS.cool) : TINTS.plain,
        twinkle: Math.random() < 0.25 ? 1 + Math.random() * 2.5 : 0, // Hz, 0 = steady
        phase: Math.random() * Math.PI * 2,
      }));
    }
    const n = total * MAX_TILES;
    this.geometry.dispose(); // frees the old buffers on the GPU
    const attr = (size) => new BufferAttribute(new Float32Array(n * size), size).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', attr(2));
    this.geometry.setAttribute('color', attr(4));
    this.geometry.setAttribute('radius', attr(1));
    this.starUniforms.uDpr.value = dpr;

    this.paintNebula();
  }

  // The page's own background, a faint violet haze near the bottom and a few
  // clouds of colour, painted once at full resolution. Drawn 1:1 — scaling it
  // would also scale the browser's gradient dithering into a visible grid, and
  // a little noise on top breaks up banding in the faint colours.
  paintNebula() {
    const c = document.createElement('canvas');
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const n = c.getContext('2d');
    n.setTransform(dpr, 0, 0, dpr, 0, 0);

    // style.css: radial-gradient(ellipse at 50% 40%, …) — the ellipse has the
    // proportions of the closest sides and reaches the farthest corner.
    const ex = width * 0.5, ey = height * 0.4;
    const aspect = ex / ey;
    const ry = Math.hypot((width - ex) / aspect, height - ey);
    n.save();
    n.translate(ex, ey);
    n.scale(aspect, 1);
    const page = n.createRadialGradient(0, 0, 0, 0, 0, ry);
    page.addColorStop(0, '#0d1124');
    page.addColorStop(0.55, '#070912');
    page.addColorStop(1, '#04050b');
    n.fillStyle = page;
    n.fillRect(-ex / aspect, -ey, width / aspect, height);
    n.restore();

    const haze = n.createRadialGradient(width * 0.55, height * 1.05, 0, width * 0.55, height * 1.05, height * 0.8);
    haze.addColorStop(0, 'rgba(90, 50, 160, 0.12)');
    haze.addColorStop(1, 'rgba(90, 50, 160, 0)');
    n.fillStyle = haze;
    n.fillRect(0, 0, width, height);

    const palette = ['90,50,160', '40,90,170', '150,50,120', '30,120,140'];
    const clouds = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < clouds; i++) {
      const x = width * (0.05 + Math.random() * 0.9);
      const y = height * (0.05 + Math.random() * 0.9);
      const r = Math.max(width, height) * (0.25 + Math.random() * 0.35);
      const g = n.createRadialGradient(x, y, 0, x, y, r);
      const col = palette[i % palette.length];
      const a = 0.025 + Math.random() * 0.035;
      g.addColorStop(0, `rgba(${col},${a})`);
      g.addColorStop(0.5, `rgba(${col},${a * 0.4})`);
      g.addColorStop(1, `rgba(${col},0)`);
      n.fillStyle = g;
      n.fillRect(0, 0, width, height);
    }
    if (c.width && c.height) {
      const img = n.getImageData(0, 0, c.width, c.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const noise = Math.floor(Math.random() * 3) - 1;
        d[i] += noise; d[i + 1] += noise; d[i + 2] += noise;
      }
      n.putImageData(img, 0, 0);
    }
    // A texture's size is fixed once uploaded, so a new size needs a new one.
    this.nebulaUniforms.uMap.value?.dispose();
    const texture = new CanvasTexture(c);
    texture.minFilter = texture.magFilter = NearestFilter; // drawn 1:1
    texture.generateMipmaps = false;
    this.nebulaUniforms.uMap.value = texture;
    this.nebulaUniforms.uResolution.value = [c.width, c.height];
  }

  update(now) {
    // How far the camera has zoomed out from its closest view (1 = fully in).
    const zoom = camera.scale ? Math.min(1, camera.scale / closestScale()) : 1;
    const cx = width / 2, cy = height / 2;
    const time = reducedMotion ? 0 : now;
    const pos = this.geometry.getAttribute('position');
    const col = this.geometry.getAttribute('color');
    const rad = this.geometry.getAttribute('radius');
    let k = 0;

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
        const bx = wrap((st.u - 0.5) * pw + offX, pw);
        const by = wrap((st.v - 0.5) * ph + offY, ph);
        for (let i = -nx; i <= nx; i++) {
          const x = cx + bx + i * pw;
          if (x < -2 || x > width + 2) continue;
          for (let j = -ny; j <= ny; j++) {
            const y = cy + by + j * ph;
            if (y < -2 || y > height + 2) continue;
            pos.array[k * 2] = x; pos.array[k * 2 + 1] = y;
            col.array[k * 4] = st.tint[0] / 255; col.array[k * 4 + 1] = st.tint[1] / 255;
            col.array[k * 4 + 2] = st.tint[2] / 255; col.array[k * 4 + 3] = a;
            rad.array[k] = st.r * rs;
            k++;
          }
        }
      }
    }
    for (const a of [pos, col, rad]) a.needsUpdate = true;
    this.geometry.setDrawRange(0, k);
  }
}
