// ---------------------------------------------------------------------------
// Tails: the gas a star leaves behind. Right behind the star it is a narrow,
// white-hot jet; further back it cools to the star's colour and then to a
// dim, warmer glow, spreads out and comes apart into slowly churning wisps —
// like smoke left hanging in space. The wisps are anchored to where the star
// was, not to the star, so they stay put while it moves on. Colour shows speed
// (brighter where the star moved fast) or, coloured by energy, blue while
// bound and orange once escaping.
// ---------------------------------------------------------------------------
import { Strokes } from './strokes.js';

const HEAT_LENGTH = 45;   // px behind the star over which the jet is white-hot
const WISP_SCALE = 3;     // wisps per AU travelled

// vFlow: (distance the star had travelled there, in wisps; age, 0 at the star … 1 at the end)
const fragmentShader = /* glsl */ `
  uniform float uOpacity;
  uniform float uTime;
  varying vec4 vColor;
  varying vec4 vShape;
  varying vec2 vFlow;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    return 0.55 * noise(p) + 0.3 * noise(p * 2.1 + 3.7) + 0.15 * noise(p * 4.3 + 9.1);
  }

  void main() {
    float d = vShape.x;
    float along = vFlow.x, age = vFlow.y;
    float spread = smoothstep(0.02, 0.4, age);   // how far the gas has come apart

    // the core: a thin, solid filament
    float core = clamp(vShape.y - abs(d) + 0.5, 0.0, 1.0);

    // the glow meanders a little and breaks into wisps, stretched along the tail
    float across = d / max(vShape.z, 1e-3);
    float wobble = (noise(vec2(along * 0.6, uTime * 0.12)) - 0.5) * 0.35 * spread;
    float g = across - wobble;
    float wisps = fbm(vec2(along - uTime * 0.03, g * 4.0 + uTime * 0.08));
    wisps = mix(1.0, 2.4 * smoothstep(0.35, 0.8, wisps), spread);
    float edge = 1.0 - smoothstep(0.7, 1.0, abs(across));   // nothing reaches the strip's edge
    float glow = 2.6 * exp(-6.0 * g * g) * wisps * edge;

    float a = (vColor.a * core + vShape.w * glow) * uOpacity;
    gl_FragColor = vec4(vColor.rgb * a, a);
  }
`;

// Cooling gas: from the star's colour towards a dim ember.
const cool = (c, k) => [c[0] * (1 - 0.15 * k), c[1] * (1 - 0.4 * k), c[2] * (1 - 0.55 * k)];

export class Trails {
  constructor(scene) {
    this.strokes = new Strokes(undefined, { fragmentShader, uniforms: { uTime: { value: 0 } } });
    scene.add(this.strokes.mesh);
  }

  update(now, opacity) {
    const s = this.strokes;
    s.opacity = opacity;
    s.uniforms.uTime.value = reducedMotion ? 0 : now;
    s.begin();
    if (showTrails) bodies.forEach((b, i) => this.trail(b, i));
    s.end();
  }

  trail(b, i) {
    const last = b.trail[b.trail.length - 1];
    const head = {
      x: b.x, y: b.y, t: simTime, v: Math.hypot(b.vx, b.vy), e: escapeRatio(bodies, i, softening),
      d: last ? last.d + Math.hypot(b.x - last.x, b.y - last.y) : 0,
    };
    const pts = b.trail.concat(head);
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
    // distance behind the star along the tail, in px
    const behind = new Float32Array(n);
    for (let k = n - 2; k >= 0; k--) {
      behind[k] = behind[k + 1] + Math.hypot(xy[2 * k + 2] - xy[2 * k], xy[2 * k + 3] - xy[2 * k + 1]);
    }

    this.strokes.line(xy, (k, out) => {
      const p = pts[first + k];
      const fresh = Math.max(0, 1 - (simTime - p.t) / trailDuration);
      const age = 1 - fresh;
      const fast = byEnergy
        ? 0.5 + 0.5 * Math.tanh(2.5 * p.e) // white only close to escape speed
        : Math.min(1, (p.v - vMin) / vSpan);
      const heat = Math.exp(-behind[k] / (HEAT_LENGTH * widthScale));
      let c = byEnergy ? energyColor(fast, base) : mix(base, WHITE, fast ** 1.5 * 0.35);
      c = mix(cool(c, age ** 0.7), WHITE, heat * 0.85);
      const bright = byEnergy ? 1 : 0.75 + 0.5 * fast;
      out[0] = c[0] / 255; out[1] = c[1] / 255; out[2] = c[2] / 255;
      out[3] = (fresh ** 3 * 0.6 + heat * 1.4) * bright;                  // core, hot right behind the star
      out[4] = (0.4 + 1.6 * fresh ** 1.5 + 1.2 * heat) * widthScale;     // thins out as it ages
      out[5] = (5 + 14 * age ** 0.8) * widthScale;                       // the gas spreads out…
      out[6] = 0.24 * fresh ** 0.8 / (1 + 1.2 * age) * bright;           // …and thins
      out[7] = p.d * WISP_SCALE;
      out[8] = age;
    });
  }
}
