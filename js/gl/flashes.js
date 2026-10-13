// ---------------------------------------------------------------------------
// Close-encounter bursts (state in js/bursts.js): a white flash fading into the
// pair's colours, and sparks that fly out, slow down and are drawn as streaks.
// ---------------------------------------------------------------------------
import { SPRITE_VERTEX, material, quad, rgb } from './common.js';
import { Strokes } from './strokes.js';

const flashFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uFlash;   // 0…1
  uniform float uOpacity;
  uniform float uSize;
  varying vec2 vPos;
  void main() {
    float t = length(vPos) / (uSize * 0.5);
    if (t >= 1.0) discard;
    float f = uFlash;
    vec3 c = t < 0.12 ? mix(vec3(min(1.0, 1.1 * f)), vec3(0.75 * f), t / 0.12)
      : t < 0.35 ? mix(vec3(0.75 * f), uColor * 0.45 * f, (t - 0.12) / 0.23)
      : mix(uColor * 0.45 * f, vec3(0.0), (t - 0.35) / 0.65);
    gl_FragColor = vec4(c, 0.0) * uOpacity;
  }
`;

export class Flashes {
  constructor(scene) {
    this.flashes = Array.from({ length: MAX_BURSTS }, () => {
      const uniforms = { uSize: { value: 1 }, uColor: { value: [1, 1, 1] }, uFlash: { value: 0 }, uOpacity: { value: 1 } };
      const mesh = quad(material({ vertexShader: SPRITE_VERTEX, fragmentShader: flashFragment, uniforms }));
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, uniforms };
    });
    this.sparks = new Strokes();
    scene.add(this.sparks.mesh);
  }

  update(opacity) {
    const k = Math.min(1, Math.min(width, height) / 700); // smaller bursts on small screens
    const sparks = this.sparks;
    sparks.opacity = opacity;
    sparks.begin();
    this.flashes.forEach((f, n) => {
      const s = bursts[n];
      f.mesh.visible = false;
      if (!s) return;
      const age = frameNow - s.born;
      const x = toScreenX(s.x), y = toScreenY(s.y);

      const flash = s.intensity * Math.exp(-age * 7);
      if (flash > 0.01) {
        const size = 2 * (28 + 80 * s.intensity) * k;
        f.mesh.visible = true;
        f.mesh.position.set(x, y, 0);
        f.mesh.scale.set(size, size, 1);
        f.uniforms.uSize.value = size;
        f.uniforms.uColor.value = rgb(s.color);
        f.uniforms.uFlash.value = flash;
        f.uniforms.uOpacity.value = opacity;
      }

      for (const sp of s.sparks) {
        const sa = age / (sp.life * s.life);
        if (sa >= 1) continue;
        const decay = 3;
        const dist = (sp.speed * k / decay) * (1 - Math.exp(-age * decay));
        const vel = sp.speed * Math.exp(-age * decay);
        const cos = Math.cos(sp.angle), sin = Math.sin(sp.angle);
        const tail = Math.min(dist, 4 + vel * 0.04);
        const c = rgb(sp.color), a = (1 - sa) ** 1.5;
        sparks.line([x + cos * (dist - tail), y + sin * (dist - tail), x + cos * dist, y + sin * dist], (_, out) => {
          out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; out[3] = a;
          out[4] = 1.3; out[5] = 0; out[6] = 0;
        });
      }
    });
    sparks.end();
  }
}
