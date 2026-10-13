// ---------------------------------------------------------------------------
// The WebGL renderer: one canvas, one scene, an orthographic camera in CSS
// pixels with y pointing down. Layers are drawn in the order they are added,
// back to front: nebula, background stars, gravity field, trails, burst
// flashes and sparks, the stars.
// ---------------------------------------------------------------------------
import { LinearSRGBColorSpace, OrthographicCamera, Scene, WebGLRenderer } from 'three';
import { Field } from './field.js';
import { Flashes } from './flashes.js';
import { Sky } from './sky.js';
import { Stars } from './stars.js';
import { Trails } from './trails.js';

export class Renderer {
  constructor(canvas) {
    // Shaders produce the same sRGB values the 2D canvas did, so no colour
    // management, and lines are anti-aliased by their own shaders.
    this.gl = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = LinearSRGBColorSpace;
    this.gl.setClearColor(0x04050b, 1);
    this.gl.sortObjects = false; // keep the layers in order
    this.scene = new Scene();
    this.camera = new OrthographicCamera(0, 1, 0, 1, -1, 1);
    this.sky = new Sky(this.scene);
    this.field = new Field(this.scene);
    this.trails = new Trails(this.scene);
    this.flashes = new Flashes(this.scene);
    this.stars = new Stars(this.scene);
    this.opacity = 1; // of everything but the sky; fades out and in on restart
  }

  resize() {
    this.gl.setPixelRatio(dpr);
    this.gl.setSize(width, height, false);
    Object.assign(this.camera, { left: 0, right: width, top: 0, bottom: height });
    this.camera.updateProjectionMatrix();
    this.sky.generate();
  }

  render(now, realDt) {
    const step = realDt / FADE_TIME;
    this.opacity = fadeTarget > this.opacity
      ? Math.min(fadeTarget, this.opacity + step)
      : Math.max(fadeTarget, this.opacity - step);
    const o = this.opacity * this.opacity * (3 - 2 * this.opacity); // eased

    this.sky.update(now);
    this.field.update(o);
    this.trails.update(o);
    this.flashes.update(o);
    this.stars.update(now, o);
    this.gl.render(this.scene, this.camera);
  }
}
