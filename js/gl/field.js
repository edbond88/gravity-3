// ---------------------------------------------------------------------------
// Gravity field overlay (maths in js/field.js). The heat map is computed for
// every pixel in a shader, isolines included; the rubber sheet and the
// equilibrium markers are lines.
// ---------------------------------------------------------------------------
import { OVER, SCREEN_VERTEX, material, quad } from './common.js';
import { Strokes } from './strokes.js';

// HEAT_RAMP as a GLSL function of the level, returning rgb (0…1) and alpha.
const rampGlsl = HEAT_RAMP.slice(1).map(([f, r, g, b, a], i) => {
  const [f0, r0, g0, b0, a0] = HEAT_RAMP[i];
  const c0 = `vec4(${r0 / 255}, ${g0 / 255}, ${b0 / 255}, ${a0})`, c1 = `vec4(${r / 255}, ${g / 255}, ${b / 255}, ${a})`;
  return `if (f <= ${f.toFixed(4)}) return mix(${c0}, ${c1}, (f - ${f0.toFixed(4)}) / ${(f - f0).toFixed(4)});`;
}).join('\n    ');

const heatFragment = /* glsl */ `
  uniform vec2 uResolution;   // device pixels
  uniform float uDpr;
  uniform vec3 uCamera;       // centre x, y (px), scale (px per AU)
  uniform vec2 uOffset;       // camera offset, AU
  uniform vec3 uBodies[3];    // x, y, mass
  uniform vec3 uScale;        // R, a², M — see fieldScale()
  uniform float uOpacity;

  vec4 ramp(float f) {
    ${rampGlsl}
    return vec4(0.0);
  }

  void main() {
    vec2 px = vec2(gl_FragCoord.x, uResolution.y - gl_FragCoord.y) / uDpr;
    vec2 w = (px - uCamera.xy) / uCamera.z - uOffset;
    float p = 0.0;
    for (int i = 0; i < 3; i++) {
      vec2 d = w - uBodies[i].xy;
      p += uBodies[i].z / sqrt(dot(d, d) + uScale.y);
    }
    float lnp = log(p * uScale.x / uScale.z);
    float level = clamp((lnp - ${Math.log(0.7)}) / (${Math.log(30) - Math.log(0.7)}), 0.0, 1.0);
    vec4 heat = ramp(level);
    vec4 c = vec4(heat.rgb * heat.a, heat.a);

    // isolines, one CSS pixel wide; they fade out where they crowd together
    float v = lnp / ${HEAT_LEVELS.toFixed(4)};
    float fw = fwidth(v);
    float dist = abs(v - floor(v + 0.5)) / max(fw, 1e-6);
    float line = clamp(0.5 * uDpr - dist + 0.5, 0.0, 1.0) * (1.0 - smoothstep(0.6, 1.0, fw * uDpr));
    float la = 0.16 * line;
    c = vec4(vec3(210.0, 220.0, 255.0) / 255.0 * la, la) + c * (1.0 - la);
    gl_FragColor = c * uOpacity;
  }
`;

export class Field {
  constructor(scene) {
    this.uniforms = {
      uResolution: { value: [1, 1] }, uDpr: { value: 1 }, uCamera: { value: [0, 0, 1] }, uOffset: { value: [0, 0] },
      uBodies: { value: new Array(9).fill(0) }, uScale: { value: [1, 1, 1] }, uOpacity: { value: 1 },
    };
    this.heat = quad(material({
      vertexShader: SCREEN_VERTEX, fragmentShader: heatFragment, uniforms: this.uniforms, blend: OVER,
    }));
    scene.add(this.heat);
    this.lines = new Strokes(OVER);
    scene.add(this.lines.mesh);
  }

  update(opacity) {
    const on = fieldMode !== 'off' && camera.scale && bodies.length;
    this.heat.visible = on && fieldMode === 'heat';
    const lines = this.lines;
    lines.opacity = opacity;
    lines.begin();
    if (on) {
      if (fieldMode === 'heat') this.updateHeat(opacity);
      else this.grid();
      this.markers();
    }
    lines.end();
  }

  updateHeat(opacity) {
    const u = this.uniforms;
    const { R, a2, M } = fieldScale();
    u.uResolution.value = [Math.round(width * dpr), Math.round(height * dpr)];
    u.uDpr.value = dpr;
    u.uCamera.value = [camera.cx, camera.cy, camera.scale];
    u.uOffset.value = [camera.ox, camera.oy];
    u.uBodies.value = bodies.flatMap((b) => [b.x, b.y, b.mass]);
    u.uScale.value = [R, a2, M];
    u.uOpacity.value = opacity;
  }

  grid() {
    for (const { points, levels } of gridLines()) {
      this.lines.line(points, (i, out) => {
        const f = levels[i];
        out[0] = (120 + 100 * f) / 255; out[1] = (140 + 30 * f) / 255; out[2] = 1;
        out[3] = 0.08 + 0.3 * f;
        out[4] = 1; out[5] = 0; out[6] = 0;
      });
    }
  }

  // ⌖ at every equilibrium point: a small ring and four ticks.
  markers() {
    const style = (_, out) => {
      out[0] = 235 / 255; out[1] = 240 / 255; out[2] = 1; out[3] = 0.55;
      out[4] = 1; out[5] = 0; out[6] = 0;
    };
    for (const [x, y] of equilibria()) {
      const ring = [];
      for (let k = 0; k <= 20; k++) {
        const a = (k / 20) * Math.PI * 2;
        ring.push(x + 4.5 * Math.cos(a), y + 4.5 * Math.sin(a));
      }
      this.lines.line(ring, style);
      this.lines.line([x - 8, y, x - 2.5, y], style);
      this.lines.line([x + 2.5, y, x + 8, y], style);
      this.lines.line([x, y - 8, x, y - 2.5], style);
      this.lines.line([x, y + 2.5, x, y + 8], style);
    }
  }
}
