// ---------------------------------------------------------------------------
// Background: a nebula and three layers of distant stars. Each layer follows
// the camera's zoom and offset by a different amount, so the sky has depth.
// Like the real sky: thousands of faint stars and a few bright ones, which get
// tiny diffraction spikes and are bright enough for the bloom to make glow;
// mostly white and yellowish, some orange, some blue; gathered into clouds.
// ---------------------------------------------------------------------------
import { BufferAttribute, BufferGeometry, CanvasTexture, DynamicDrawUsage, NearestFilter, Points } from 'three';
import { ADD, OVER, SCREEN_VERTEX, material, quad } from './common.js';

// size: the largest width (Gaussian σ, px) a star of the layer gets;
// bright: the share of its stars that are bright ones.
const BG_LAYERS = [
  { depth: 0.08, density: 1 / 1700, size: 0.5, alpha: 0.6, bright: 0, drift: 1.5 },
  { depth: 0.2, density: 1 / 3300, size: 0.7, alpha: 0.85, bright: 0.006, drift: 3 },
  { depth: 0.4, density: 1 / 10000, size: 0.9, alpha: 1, bright: 0.03, drift: 6 },
];

// Star colours by how common they are: [share, rgb].
const TINTS = [
  [0.45, [255, 248, 240]],  // white
  [0.2, [255, 236, 205]],   // yellowish, like the Sun
  [0.12, [255, 210, 165]],  // orange
  [0.05, [255, 180, 150]],  // red
  [0.13, [215, 228, 255]],  // blue-white
  [0.05, [180, 205, 255]],  // blue
];

function tint() {
  let x = Math.random();
  for (const [share, rgb] of TINTS) {
    if ((x -= share) < 0) return rgb;
  }
  return TINTS[0][1];
}

// 0…1 star density over the tile: smooth clouds and gaps. Whole-number
// frequencies keep it periodic, so tiles join without seams.
const PHASES = Array.from({ length: 3 }, () => Math.random() * Math.PI * 2);
function clouds(u, v) {
  const t = Math.PI * 2;
  const n = Math.sin(t * (2 * u + v) + PHASES[0]) * Math.sin(t * (u - 2 * v) + PHASES[1])
    + 0.5 * Math.sin(t * (3 * u + 4 * v) + PHASES[2]);
  return 0.5 + n / 3;
}

const MAX_TILES = 9; // a layer zoomed out to half size repeats at most 3 × 3 times
const MARGIN = 12;   // px — stars this far off screen may still show a spike

const nebulaFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec2 uResolution;
  void main() { gl_FragColor = texture2D(uMap, gl_FragCoord.xy / uResolution); }
`;

// Each star is a Gaussian spot of light; bright ones add a faint cross.
const starVertex = /* glsl */ `
  attribute vec4 color;  // rgb, peak brightness (may exceed 1)
  attribute vec2 shape;  // Gaussian σ in px, spike strength 0…1
  uniform float uDpr;
  varying vec4 vColor;
  varying vec2 vShape;
  varying float vSize;
  void main() {
    // Narrower than about half a device pixel, a spot would flicker as it drifts
    // across pixels; widen it instead, keeping the same total light.
    float sigma = max(shape.x, 0.55 / uDpr);
    vColor = vec4(color.rgb, color.a * pow(shape.x / sigma, 2.0));
    vShape = vec2(sigma, shape.y);
    vSize = ceil(sigma * (6.0 + 14.0 * shape.y)) + 2.0;
    gl_PointSize = vSize * uDpr;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, 0.0, 1.0);
  }
`;

const starFragment = /* glsl */ `
  varying vec4 vColor;
  varying vec2 vShape;
  varying float vSize;
  void main() {
    vec2 p = (gl_PointCoord - 0.5) * vSize;
    float s = vShape.x;
    float light = exp(-dot(p, p) / (2.0 * s * s));
    vec2 q = abs(p);
    float spikes = exp(-q.y * q.y * 4.0 - q.x / (2.5 * s)) + exp(-q.x * q.x * 4.0 - q.y / (2.5 * s));
    light += 0.35 * vShape.y * spikes;
    gl_FragColor = vec4(vColor.rgb * vColor.a * light, 0.0);
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
      vertexShader: starVertex, fragmentShader: starFragment, uniforms: this.starUniforms, blend: ADD,
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
      layer.stars = Array.from({ length: count }, () => {
        // where: rejection sampling against the clouds
        let u, v;
        do { u = Math.random(); v = Math.random(); } while (Math.random() > 0.15 + 0.85 * clouds(u, v) ** 2);
        // how bright: most stars faint, a few bright — roughly as star magnitudes go
        const b = Math.random() ** 3;
        const bright = Math.random() < layer.bright;
        return {
          u, v,
          size: bright ? 0.7 + 0.3 * Math.random() : 0.35 + layer.size * 0.5 * b,
          peak: bright ? 1.3 + 1.7 * Math.random() : layer.alpha * (0.22 + 0.78 * b),
          spike: bright ? 0.6 + 0.4 * Math.random() : 0,
          tint: tint(),
          twinkle: Math.random() < 0.3 ? 1 + Math.random() * 2.5 : 0, // Hz, 0 = steady
          phase: Math.random() * Math.PI * 2,
        };
      });
    }
    const n = total * MAX_TILES;
    this.geometry.dispose(); // frees the old buffers on the GPU
    const attr = (size) => new BufferAttribute(new Float32Array(n * size), size).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', attr(2));
    this.geometry.setAttribute('color', attr(4));
    this.geometry.setAttribute('shape', attr(2));
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
    const shp = this.geometry.getAttribute('shape');
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
        let a = st.peak;
        if (st.twinkle && time) a *= 0.7 + 0.3 * Math.sin(time * st.twinkle * 2 * Math.PI + st.phase);
        const bx = wrap((st.u - 0.5) * pw + offX, pw);
        const by = wrap((st.v - 0.5) * ph + offY, ph);
        for (let i = -nx; i <= nx; i++) {
          const x = cx + bx + i * pw;
          if (x < -MARGIN || x > width + MARGIN) continue;
          for (let j = -ny; j <= ny; j++) {
            const y = cy + by + j * ph;
            if (y < -MARGIN || y > height + MARGIN) continue;
            pos.array[k * 2] = x; pos.array[k * 2 + 1] = y;
            col.array[k * 4] = st.tint[0] / 255; col.array[k * 4 + 1] = st.tint[1] / 255;
            col.array[k * 4 + 2] = st.tint[2] / 255; col.array[k * 4 + 3] = a;
            shp.array[k * 2] = st.size * rs; shp.array[k * 2 + 1] = st.spike;
            k++;
          }
        }
      }
    }
    for (const a of [pos, col, shp]) a.needsUpdate = true;
    this.geometry.setDrawRange(0, k);
  }
}
