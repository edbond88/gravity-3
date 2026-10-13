// ---------------------------------------------------------------------------
// The three stars. Each is one sprite whose shader paints, all added up: the
// star's glare, diffraction rays — a slowly turning cross, each arm breathing
// on its own, plus faint glints that flare up at random angles and fade — and
// a white-hot core.
// ---------------------------------------------------------------------------
import { SPRITE_VERTEX, material, quad, rgb } from './common.js';

const SPIKES = [
  { angle: 0, length: 1, freq: 1.3 }, { angle: Math.PI / 2, length: 0.6, freq: 1.9 },
  { angle: Math.PI / 4, length: 0.35, freq: 2.7 }, { angle: -Math.PI / 4, length: 0.35, freq: 2.3 },
];
const GLINTS = 5;
const RAYS = SPIKES.length + GLINTS;
const SPIN = [0.07, -0.05, 0.09]; // rad/s, per star — a full turn takes a minute or two

// Deterministic 0…1 noise from two integers.
const hash = (a, b) => {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

// Light is modelled the way a telescope spreads a point of light, not as
// painted discs: a tiny, brighter-than-white core (the scene is drawn in high
// dynamic range, so the bloom makes it glow and the screen clips it to white),
// a Moffat profile — the standard model of a star's glare, falling off as a
// power of the distance with no edge — and a faint wide scatter. Near the core
// the light is white; the star's colour shows further out, in the wings.
const fragmentShader = /* glsl */ `
  #define RAYS ${RAYS}
  uniform vec3 uColor;        // the star's identifying colour
  uniform vec3 uTemp;         // its surface colour
  uniform vec3 uHalo;         // radius the light reaches, its strength, core width
  uniform vec4 uRays[RAYS];   // angle, length, width, alpha (0 = off)
  uniform float uOpacity;
  varying vec2 vPos;

  vec3 ray(vec4 r, float edge) {
    vec2 dir = vec2(cos(r.x), sin(r.x));
    float t = abs(dot(vPos, dir)) / r.y;        // 0 at the star, 1 at the tip
    if (t >= 1.0) return vec3(0.0);
    float across = dot(vPos, vec2(-dir.y, dir.x));
    float w = r.z * (0.6 + 1.2 * t);            // spikes widen and soften outwards
    float profile = exp(-across * across / (w * w));
    float fall = pow(1.0 - t, 1.5) / (1.0 + 2.0 * t);
    return mix(vec3(1.0), uColor, sqrt(t)) * 1.6 * r.w * profile * fall * edge;
  }

  void main() {
    float r = length(vPos);
    float t = r / uHalo.x;
    if (t >= 1.0) discard;
    float edge = 1.0 - smoothstep(0.55, 1.0, t);  // fades to nothing well before the sprite's edge

    float s = uHalo.z;
    float core = 3.0 * exp(-r * r / (s * s));
    float x = t / 0.055;
    float glare = 0.8 * uHalo.y / (1.0 + x * x);
    float scatter = 0.2 * uHalo.y * exp(-5.0 * t);

    // white-ish in the surface colour near the core, the star's own colour out in the wings
    vec3 hue = mix(mix(uTemp, uColor, 0.35), uColor, smoothstep(0.0, 0.2, t));
    vec3 c = vec3(1.0, 0.98, 0.95) * core + (hue * glare + uColor * scatter) * edge;
    for (int i = 0; i < RAYS; i++) {
      if (uRays[i].w > 0.0) c += ray(uRays[i], edge);
    }
    gl_FragColor = vec4(c, clamp(max(max(c.r, c.g), c.b), 0.0, 1.0)) * uOpacity;
  }
`;

export class Stars {
  constructor(scene) {
    this.sprites = [0, 1, 2].map(() => {
      const uniforms = {
        uSize: { value: 1 }, uColor: { value: [1, 1, 1] }, uTemp: { value: [1, 1, 1] },
        uHalo: { value: [1, 0, 1] }, uOpacity: { value: 1 },
        uRays: { value: Array.from({ length: RAYS }, () => [0, 1, 1, 0]).flat() },
      };
      const mesh = quad(material({ vertexShader: SPRITE_VERTEX, fragmentShader, uniforms }));
      scene.add(mesh);
      return { mesh, uniforms };
    });
  }

  update(now, opacity) {
    this.sprites.forEach((sp, i) => {
      const b = bodies[i];
      sp.mesh.visible = !!b;
      if (b) this.star(sp, b, i, now, opacity);
    });
  }

  star({ mesh, uniforms: u }, b, i, now, opacity) {
    const t = reducedMotion ? 0 : now;
    // flicker: two incommensurate sines per star
    const tw = 1 + 0.05 * Math.sin(t * 5.3 + i * 2.1) + 0.035 * Math.sin(t * 11.7 + i * 4.7);
    const flare = 1 + starFlare(b) * 1.5;

    const haloR = (45 + b.mass * 25) * tw * Math.sqrt(flare) * 1.6;
    const coreR = 2.5 + b.mass * 1.5;
    // the encounter's own flash is drawn separately; the star only brightens a little
    u.uHalo.value = [haloR, 1 + (flare - 1) * 0.4, coreR * 0.75 * (0.97 + 0.06 * tw)];

    const baseLen = coreR * (7 + 3 * b.mass ** 0.5) * tw * flare;
    const axis = i * 0.7 + t * SPIN[i];
    const rays = u.uRays.value;
    const setRay = (k, angle, len, w, alpha) => rays.splice(k * 4, 4, angle, len, w, alpha);
    SPIKES.forEach((sp, k) => {
      const breathe = t ? 0.78 + 0.22 * Math.sin(t * sp.freq + i * 1.7 + k * 2.4) : 1;
      setRay(k, axis + sp.angle, baseLen * sp.length * breathe, k === 0 ? 1.3 : 0.9, Math.min(1, sp.length * 1.4) * breathe);
    });
    for (let g = 0; g < GLINTS; g++) {
      let alpha = 0, angle = 0, len = 1;
      if (t) {
        // each glint lives for `period` seconds, then reappears at a new angle
        const period = 1.6 + hash(i, g) * 2.4;
        const phase = t / period + hash(g, i + 7);
        const cycle = Math.floor(phase);
        alpha = Math.sin(Math.PI * (phase - cycle)) ** 3 * 0.5;
        if (alpha < 0.02) alpha = 0;
        angle = hash(cycle, g * 13 + i) * Math.PI;
        len = baseLen * (0.3 + 0.4 * hash(cycle + 3, g + i));
      }
      setRay(SPIKES.length + g, angle, len, 0.6, alpha);
    }

    u.uColor.value = rgb(COLOR_RGB[b.color]);
    u.uTemp.value = rgb(temperatureColor(b.mass));
    u.uOpacity.value = opacity;
    const size = 2 * haloR + 4;
    u.uSize.value = size;
    mesh.scale.set(size, size, 1);
    mesh.position.set(toScreenX(b.x), toScreenY(b.y), 0);
  }
}
