'use strict';

// ---------------------------------------------------------------------------
// Background: a nebula and three layers of distant stars. Each layer follows
// the camera's zoom and offset by a different amount, so the sky has depth.
// ---------------------------------------------------------------------------
const BG_LAYERS = [
  { depth: 0.08, density: 1 / 9000, rMax: 0.7, alpha: 0.3, drift: 1.5 },
  { depth: 0.2, density: 1 / 14000, rMax: 1.1, alpha: 0.45, drift: 3 },
  { depth: 0.4, density: 1 / 40000, rMax: 1.7, alpha: 0.6, drift: 6 },
];
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

  // The nebula is rendered once at full resolution and drawn 1:1 — scaling
  // it would also scale the browser's ordered gradient dithering into a
  // visible grid. Random noise on top breaks up banding in the faint colours.
  nebula.width = Math.round(width * dpr);
  nebula.height = Math.round(height * dpr);
  const n = nebula.getContext('2d');
  n.setTransform(dpr, 0, 0, dpr, 0, 0);
  const palette = ['90,50,160', '40,90,170', '150,50,120', '30,120,140'];
  const clouds = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < clouds; i++) {
    const x = width * (0.05 + Math.random() * 0.9);
    const y = height * (0.05 + Math.random() * 0.9);
    const r = Math.max(width, height) * (0.25 + Math.random() * 0.35);
    const g = n.createRadialGradient(x, y, 0, x, y, r);
    const c = palette[i % palette.length];
    const a = 0.025 + Math.random() * 0.035;
    g.addColorStop(0, `rgba(${c},${a})`);
    g.addColorStop(0.5, `rgba(${c},${a * 0.4})`);
    g.addColorStop(1, `rgba(${c},0)`);
    n.fillStyle = g;
    n.fillRect(0, 0, width, height);
  }
  if (nebula.width && nebula.height) {
    const img = n.getImageData(0, 0, nebula.width, nebula.height);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i]) d[i] = Math.max(0, d[i] + Math.floor(Math.random() * 3) - 1);
    }
    n.putImageData(img, 0, 0);
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

  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.drawImage(nebula, 0, 0);
  bg.setTransform(dpr, 0, 0, dpr, 0, 0);

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
