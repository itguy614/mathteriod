import * as THREE from 'three';
import type { Graphics } from './graphics';

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
attribute float aShape;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vShape = aShape;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float a;
  if (vShape < 0.5) {
    a = clamp(1.0 - r, 0.0, 1.0);
    a *= a;
  } else {
    // four-point twinkle star
    float cross = max(0.0, 1.0 - abs(p.x) * 7.0) * max(0.0, 1.0 - abs(p.y)) +
                  max(0.0, 1.0 - abs(p.y) * 7.0) * max(0.0, 1.0 - abs(p.x));
    a = clamp(cross + smoothstep(0.45, 0.0, r), 0.0, 1.0);
  }
  if (a <= 0.001) discard;
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

export interface ParticleSpec {
  x: number;
  y: number;
  z?: number;
  vx: number;
  vy: number;
  life: number;
  size0: number;
  size1: number;
  /** Start color (linear RGB; may exceed 1 for extra bloom). */
  r: number;
  g: number;
  b: number;
  /** End color; defaults to start color. */
  r2?: number;
  g2?: number;
  b2?: number;
  drag?: number;
  shape?: 0 | 1;
  twinkle?: boolean;
}

/**
 * One pooled, additive point cloud for every particle effect (explosions,
 * exhaust, sparks). A single draw call; dead particles are swap-removed so the
 * live ones stay contiguous.
 */
export class Particles {
  readonly max: number;
  private count = 0;
  private points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private shape: Float32Array;
  // simulation state
  private vel: Float32Array;
  private lifeT: Float32Array; // [age, life]
  private sizes: Float32Array; // [size0, size1]
  private c0: Float32Array;
  private c1: Float32Array;
  private drag: Float32Array;
  private twinkle: Uint8Array;
  private gfx: Graphics;

  constructor(gfx: Graphics, max = 2400) {
    this.gfx = gfx;
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.shape = new Float32Array(max);
    this.vel = new Float32Array(max * 2);
    this.lifeT = new Float32Array(max * 2);
    this.sizes = new Float32Array(max * 2);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.drag = new Float32Array(max);
    this.twinkle = new Uint8Array(max);

    this.geo = new THREE.BufferGeometry();
    const mk = (arr: Float32Array, n: number) => {
      const a = new THREE.BufferAttribute(arr, n);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.geo.setAttribute('position', mk(this.pos, 3));
    this.geo.setAttribute('aColor', mk(this.col, 3));
    this.geo.setAttribute('aSize', mk(this.size, 1));
    this.geo.setAttribute('aAlpha', mk(this.alpha, 1));
    this.geo.setAttribute('aShape', mk(this.shape, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 10 } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    gfx.scene.add(this.points);
  }

  /** Depth-tested in the hangar (3D ship), always-on-top on the play field. */
  setDepthTest(on: boolean): void {
    if (this.mat.depthTest !== on) {
      this.mat.depthTest = on;
      this.mat.needsUpdate = true;
    }
  }

  get live(): number {
    return this.count;
  }

  spawn(s: ParticleSpec): void {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = s.x;
    this.pos[i * 3 + 1] = s.y;
    this.pos[i * 3 + 2] = s.z ?? 2;
    this.vel[i * 2] = s.vx;
    this.vel[i * 2 + 1] = s.vy;
    this.lifeT[i * 2] = 0;
    this.lifeT[i * 2 + 1] = Math.max(0.01, s.life);
    this.sizes[i * 2] = s.size0;
    this.sizes[i * 2 + 1] = s.size1;
    this.c0[i * 3] = s.r;
    this.c0[i * 3 + 1] = s.g;
    this.c0[i * 3 + 2] = s.b;
    this.c1[i * 3] = s.r2 ?? s.r;
    this.c1[i * 3 + 1] = s.g2 ?? s.g;
    this.c1[i * 3 + 2] = s.b2 ?? s.b;
    this.drag[i] = s.drag ?? 0;
    this.shape[i] = s.shape ?? 0;
    this.twinkle[i] = s.twinkle ? 1 : 0;
  }

  /** Radial burst helper. */
  burst(
    x: number,
    y: number,
    n: number,
    speed: number,
    life: number,
    size: number,
    color: THREE.Color,
    endColor?: THREE.Color,
    opts: { intensity?: number; drag?: number; shape?: 0 | 1; twinkle?: boolean; baseVx?: number; baseVy?: number } = {},
  ): void {
    const k = opts.intensity ?? 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.25 + Math.random() * 0.75);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * sp + (opts.baseVx ?? 0),
        vy: Math.sin(a) * sp + (opts.baseVy ?? 0),
        life: life * (0.5 + Math.random() * 0.6),
        size0: size * (0.6 + Math.random() * 0.8),
        size1: 0,
        r: color.r * k,
        g: color.g * k,
        b: color.b * k,
        r2: endColor ? endColor.r * k : undefined,
        g2: endColor ? endColor.g * k : undefined,
        b2: endColor ? endColor.b * k : undefined,
        drag: opts.drag ?? 1.6,
        shape: opts.shape,
        twinkle: opts.twinkle,
      });
    }
  }

  update(dt: number, time: number): void {
    this.mat.uniforms.uScale.value = this.gfx.pxPerUnit * this.gfx.dpr;
    let i = 0;
    while (i < this.count) {
      const age = (this.lifeT[i * 2] += dt);
      const life = this.lifeT[i * 2 + 1];
      if (age >= life) {
        this.kill(i);
        continue;
      }
      const t = age / life;
      const d = this.drag[i];
      if (d > 0) {
        const f = Math.exp(-d * dt);
        this.vel[i * 2] *= f;
        this.vel[i * 2 + 1] *= f;
      }
      this.pos[i * 3] += this.vel[i * 2] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 2 + 1] * dt;
      this.size[i] = this.sizes[i * 2] + (this.sizes[i * 2 + 1] - this.sizes[i * 2]) * t;
      for (let c = 0; c < 3; c++) this.col[i * 3 + c] = this.c0[i * 3 + c] + (this.c1[i * 3 + c] - this.c0[i * 3 + c]) * t;
      let a = 1 - t * t;
      if (this.twinkle[i]) a *= 0.5 + 0.5 * Math.sin(time * 25 + i * 1.7);
      this.alpha[i] = a;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    const attrs = this.geo.attributes;
    for (const k of ['position', 'aColor', 'aSize', 'aAlpha', 'aShape']) {
      const attr = attrs[k] as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, this.count * attr.itemSize);
      attr.needsUpdate = true;
    }
  }

  private kill(i: number): void {
    const j = --this.count;
    if (i === j) return;
    const copy = (arr: Float32Array | Uint8Array, n: number) => {
      for (let c = 0; c < n; c++) arr[i * n + c] = arr[j * n + c];
    };
    copy(this.pos, 3);
    copy(this.col, 3);
    copy(this.size, 1);
    copy(this.alpha, 1);
    copy(this.shape, 1);
    copy(this.vel, 2);
    copy(this.lifeT, 2);
    copy(this.sizes, 2);
    copy(this.c0, 3);
    copy(this.c1, 3);
    copy(this.drag, 1);
    copy(this.twinkle, 1);
  }

  clear(): void {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.points.removeFromParent();
  }
}
