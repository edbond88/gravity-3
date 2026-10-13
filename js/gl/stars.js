// ---------------------------------------------------------------------------
// The three stars. Each is one sprite whose shader paints, all added up: a
// soft halo in the star's colour, diffraction rays — a slowly turning cross,
// each arm breathing on its own, plus faint glints that flare up at random
// angles and fade — and a white-hot core rimmed by its surface colour.
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

// Gradients are interpolated in premultiplied colour, as the canvas did.
const fragmentShader = /* glsl */ `
  #define RAYS ${RAYS}
  uniform vec3 uColor;        // the star's identifying colour
  uniform vec3 uTemp;         // its surface colour
  uniform vec3 uHalo;         // radius, alpha at the centre, alpha a quarter out
  uniform float uCore;        // radius of the core
  uniform vec4 uRays[RAYS];   // angle, half-length, width, alpha (0 = off)
  uniform float uOpacity;
  varying vec2 vPos;

  vec3 halo(float r) {
    float t = r / uHalo.x;
    if (t >= 1.0) return vec3(0.0);
    if (t < 0.25) return uColor * mix(uHalo.y, uHalo.z, t / 0.25);
    return uColor * mix(uHalo.z, 0.0, (t - 0.25) / 0.75);
  }

  vec3 ray(vec4 r) {
    vec2 dir = vec2(cos(r.x), sin(r.x));
    float along = dot(vPos, dir) / r.y;
    float across = abs(dot(vPos, vec2(-dir.y, dir.x)));
    float s = abs(along) * 0.5; // 0 at the star, 0.5 at either tip
    if (s >= 0.5) return vec3(0.0);
    float cover = clamp(r.z * 0.5 - across + 0.5, 0.0, 1.0);
    vec3 c = s < 0.08
      ? mix(vec3(0.7 * r.w), uColor * 0.35 * r.w, s / 0.08)
      : mix(uColor * 0.35 * r.w, vec3(0.0), (s - 0.08) / 0.42);
    return c * cover;
  }

  vec4 core(float r) {
    float t = r / uCore;
    if (t >= 1.0) return vec4(0.0);
    if (t < 0.35) return mix(vec4(1.0), vec4(vec3(0.95), 0.95), t / 0.35);
    if (t < 0.55) return mix(vec4(vec3(0.95), 0.95), vec4(uTemp, 1.0), (t - 0.35) / 0.2);
    if (t < 0.75) return mix(vec4(uTemp, 1.0), vec4(uColor * 0.9, 0.9), (t - 0.55) / 0.2);
    return mix(vec4(uColor * 0.9, 0.9), vec4(0.0), (t - 0.75) / 0.25);
  }

  void main() {
    float r = length(vPos);
    vec3 c = halo(r);
    for (int i = 0; i < RAYS; i++) {
      if (uRays[i].w > 0.0) c += ray(uRays[i]);
    }
    vec4 k = core(r);
    c += k.rgb;
    float a = clamp(max(max(c.r, c.g), c.b), 0.0, 1.0);
    gl_FragColor = vec4(c, a) * uOpacity;
  }
`;

export class Stars {
  constructor(scene) {
    this.sprites = [0, 1, 2].map(() => {
      const uniforms = {
        uSize: { value: 1 }, uColor: { value: [1, 1, 1] }, uTemp: { value: [1, 1, 1] },
        uHalo: { value: [1, 0, 0] }, uCore: { value: 1 }, uOpacity: { value: 1 },
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

    const haloR = (45 + b.mass * 25) * tw * Math.sqrt(flare);
    u.uHalo.value = [haloR, Math.min(0.6, 0.28 * flare), 0.1 * flare];

    const coreR = 2.5 + b.mass * 1.5;
    u.uCore.value = coreR * 1.6 * (0.97 + 0.03 * tw * 2);

    const baseLen = coreR * (7 + 3 * b.mass ** 0.5) * tw * flare;
    const axis = i * 0.7 + t * SPIN[i];
    const rays = u.uRays.value;
    let reach = 0;
    const setRay = (k, angle, len, w, alpha) => {
      rays.splice(k * 4, 4, angle, len, w, alpha);
      if (alpha > 0) reach = Math.max(reach, len);
    };
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
    const size = 2 * Math.max(haloR, reach) + 4;
    u.uSize.value = size;
    mesh.scale.set(size, size, 1);
    mesh.position.set(toScreenX(b.x), toScreenY(b.y), 0);
  }
}
