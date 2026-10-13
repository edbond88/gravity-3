// ---------------------------------------------------------------------------
// Close-encounter bursts (state in js/bursts.js): a short, concentrated flash,
// and a shock wave racing outwards that bends the picture behind it — this
// works out where it is, js/gl/post.js does the bending. Sparks are streaks of
// white-hot matter: a bright head that cools into the stars' colour, and a tail
// that tapers and fades, as long as the spark is fast — motion blur. Embers are
// slow motes that linger and flicker. Heads are brighter than white, so the
// bloom makes them glow.
// ---------------------------------------------------------------------------
import { SPRITE_VERTEX, material, quad, rgb } from './common.js';
import { Strokes } from './strokes.js';

const flashFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFlash;   // 0…1, fading fast
  uniform float uScale;   // smaller on small screens
  uniform float uOpacity;
  uniform float uSize;
  varying vec2 vPos;
  void main() {
    float r = length(vPos);
    float edge = 1.0 - smoothstep(0.7, 1.0, r / (uSize * 0.5));

    // flash: a brighter-than-white core inside a soft glare in the pair's colour
    float f = uFlash;
    float cs = 7.0 * uScale;
    float x = r / (16.0 * uScale);
    vec3 c = vec3(1.0, 0.97, 0.92) * 2.4 * f * exp(-r * r / (2.0 * cs * cs))
      + mix(vec3(1.0), uColor, 0.6) * 0.55 * f * pow(1.0 + x * x, -1.5);

    gl_FragColor = vec4(c * edge, 0.0) * uOpacity;
  }
`;

const SPARK_DECAY = 2.5; // 1/s — sparks slow down…
const EMBER_DECAY = 1.5; // …embers too, more gently

export class Flashes {
  constructor(scene) {
    this.flashes = Array.from({ length: MAX_BURSTS }, () => {
      const uniforms = {
        uSize: { value: 1 }, uColor: { value: [1, 1, 1] }, uFlash: { value: 0 }, uScale: { value: 1 }, uOpacity: { value: 1 },
      };
      const mesh = quad(material({ vertexShader: SPRITE_VERTEX, fragmentShader: flashFragment, uniforms }));
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, uniforms };
    });
    this.sparks = new Strokes();
    scene.add(this.sparks.mesh);
    this.waves = []; // for post-processing
  }

  update(opacity) {
    const k = Math.min(1, Math.min(width, height) / 700); // smaller bursts on small screens
    const sparks = this.sparks;
    sparks.opacity = opacity;
    sparks.begin();
    this.waves = [];
    this.flashes.forEach((f, n) => {
      const s = bursts[n];
      f.mesh.visible = false;
      if (!s) return;
      const age = frameNow - s.born;
      const x = toScreenX(s.x), y = toScreenY(s.y);
      const I = s.intensity;
      if (showWaves) this.wave(s, x, y, age, k, opacity);
      if (!showBursts) return;
      this.flash(f, s, x, y, age, k, opacity);
      for (const sp of s.sparks) this.spark(sp, x, y, age, k, I);
      for (const em of s.embers) this.ember(em, x, y, age, k);
    });
    sparks.end();
  }

  flash({ mesh, uniforms: u }, s, x, y, age, k, opacity) {
    const I = s.intensity;
    const flash = I * Math.exp(-age * 9);
    if (flash < 0.005) return;
    const size = 220 * k + 4;
    mesh.visible = true;
    mesh.position.set(x, y, 0);
    mesh.scale.set(size, size, 1);
    u.uSize.value = size;
    u.uColor.value = rgb(s.color);
    u.uFlash.value = flash;
    u.uScale.value = k;
    u.uOpacity.value = opacity;
  }

  // The shock wave: fast at first, slowing as it spreads, widening and fading.
  wave(s, x, y, age, k, opacity) {
    const p = Math.min(1, age / 1.1);
    const push = 16 * s.intensity * k * (1 - p) ** 2 * opacity;
    if (push < 0.05 || reducedMotion) return;
    this.waves.push({
      x, y, push,
      radius: (60 + 140 * s.intensity) * k * (1 - Math.exp(-age * 4)),
      width: (10 + 26 * p) * k,
    });
  }

  // A white-hot head cooling into the star's colour, with a tapering tail.
  spark(sp, x, y, age, k, I) {
    const q = age / sp.life;
    if (q >= 1) return;
    const dist = (sp.speed * k / SPARK_DECAY) * (1 - Math.exp(-age * SPARK_DECAY));
    const vel = sp.speed * k * Math.exp(-age * SPARK_DECAY);
    const tail = Math.min(dist, 2 + vel * 0.07);
    const cos = Math.cos(sp.angle), sin = Math.sin(sp.angle);
    const heat = (1 - q) ** 1.5;
    const head = rgb(mix(WHITE, sp.color, Math.min(1, q * 1.4)));
    const tip = rgb(sp.color);
    this.sparks.line([
      x + cos * (dist - tail), y + sin * (dist - tail),
      x + cos * dist, y + sin * dist,
    ], (i, out) => {
      if (i === 0) { // tail
        out[0] = tip[0]; out[1] = tip[1]; out[2] = tip[2]; out[3] = 0;
        out[4] = 0.4; out[5] = 0; out[6] = 0;
      } else {       // head
        out[0] = head[0]; out[1] = head[1]; out[2] = head[2]; out[3] = (0.8 + 1.2 * I) * heat;
        out[4] = 1.3; out[5] = 6; out[6] = 0.12 * heat;
      }
    });
  }

  // A small mote drifting out and flickering as it fades.
  ember(em, x, y, age, k) {
    const q = age / em.life;
    if (q >= 1) return;
    const dist = (em.speed * k / EMBER_DECAY) * (1 - Math.exp(-age * EMBER_DECAY));
    const cos = Math.cos(em.angle), sin = Math.sin(em.angle);
    const flicker = reducedMotion ? 1 : 0.55 + 0.45 * Math.sin(age * em.flicker * Math.PI * 2 + em.phase);
    const a = (1 - q) ** 2 * flicker;
    const c = rgb(em.color);
    const ex = x + cos * dist, ey = y + sin * dist;
    this.sparks.line([ex - cos * 0.4, ey - sin * 0.4, ex + cos * 0.4, ey + sin * 0.4], (_, out) => {
      out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = 1.1 * a;
      out[4] = 1.5; out[5] = 5; out[6] = 0.15 * a;
    });
  }
}
