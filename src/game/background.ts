import * as THREE from 'three';
import type { Graphics } from './graphics';

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
attribute vec3 aColor;
uniform vec2 uOffset;
uniform vec2 uSize;
uniform float uTime;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 p = (fract(position.xy + uOffset) - 0.5) * uSize;
  vColor = aColor;
  vAlpha = 0.55 + 0.45 * sin(uTime * (1.2 + aPhase * 0.4) + aPhase * 6.2831);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, position.z, 1.0);
  gl_PointSize = max(1.0, aSize * uScale);
}`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r = dot(c, c);
  if (r > 1.0) discard;
  float a = (1.0 - r);
  a *= a;
  gl_FragColor = vec4(vColor, a * vAlpha);
}`;

const NEB_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const NEB_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec2 uOffset;
uniform float uTime;
uniform float uAspect;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  vec2 p = vec2(vUv.x * uAspect, vUv.y) * 2.2 + uOffset;
  float t = uTime * 0.015;
  float n1 = fbm(p + vec2(t, -t * 0.6));
  float n2 = fbm(p * 1.7 - vec2(t * 0.8, t) + n1 * 1.5);
  vec3 purple = vec3(0.16, 0.035, 0.26);
  vec3 teal = vec3(0.015, 0.11, 0.2);
  vec3 col = mix(teal, purple, smoothstep(0.3, 0.75, n2));
  float mask = smoothstep(0.38, 0.85, n1 * 0.6 + n2 * 0.6);
  vec3 base = vec3(0.008, 0.01, 0.028);
  gl_FragColor = vec4(base + col * mask * 0.75, 1.0);
}`;

interface Layer {
  points: THREE.Points;
  mat: THREE.ShaderMaterial;
  parallax: number;
}

/** Parallax starfield (3 layers) over a slowly churning nebula. */
export class Background {
  private layers: Layer[] = [];
  private nebula: THREE.Mesh;
  private nebMat: THREE.ShaderMaterial;
  private gfx: Graphics;
  private drift = new THREE.Vector2();

  constructor(gfx: Graphics) {
    this.gfx = gfx;
    this.nebMat = new THREE.ShaderMaterial({
      vertexShader: NEB_VERT,
      fragmentShader: NEB_FRAG,
      uniforms: { uOffset: { value: new THREE.Vector2() }, uTime: { value: 0 }, uAspect: { value: 1 } },
      depthWrite: false,
    });
    this.nebula = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.nebMat);
    this.nebula.position.z = -200;
    this.nebula.renderOrder = -10;
    gfx.scene.add(this.nebula);

    const specs = [
      { count: 220, size: [0.18, 0.3], parallax: 0.004, z: -150, bright: 0.6 },
      { count: 110, size: [0.28, 0.45], parallax: 0.01, z: -120, bright: 0.85 },
      { count: 45, size: [0.4, 0.62], parallax: 0.02, z: -100, bright: 1.25 },
    ];
    const tints = [new THREE.Color(0xffffff), new THREE.Color(0xbfd4ff), new THREE.Color(0xffe2c0), new THREE.Color(0xd8c0ff)];
    for (const s of specs) {
      const pos = new Float32Array(s.count * 3);
      const size = new Float32Array(s.count);
      const phase = new Float32Array(s.count);
      const col = new Float32Array(s.count * 3);
      for (let i = 0; i < s.count; i++) {
        pos[i * 3] = Math.random();
        pos[i * 3 + 1] = Math.random();
        pos[i * 3 + 2] = s.z;
        size[i] = s.size[0] + Math.random() * (s.size[1] - s.size[0]);
        phase[i] = Math.random();
        const t = tints[(Math.random() * tints.length) | 0];
        const b = s.bright * (0.6 + Math.random() * 0.4);
        col[i * 3] = t.r * b;
        col[i * 3 + 1] = t.g * b;
        col[i * 3 + 2] = t.b * b;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
      geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
      geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        uniforms: {
          uOffset: { value: new THREE.Vector2() },
          uSize: { value: new THREE.Vector2(100, 60) },
          uTime: { value: 0 },
          uScale: { value: 10 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.renderOrder = -5;
      gfx.scene.add(points);
      this.layers.push({ points, mat, parallax: s.parallax });
    }
    gfx.onResize(() => this.resize());
    this.resize();
  }

  private resize(): void {
    const w = this.gfx.halfW * 2 * 1.08;
    const h = this.gfx.halfH * 2 * 1.08;
    this.nebula.scale.set(w * 1.1, h * 1.1, 1);
    this.nebMat.uniforms.uAspect.value = w / h;
    for (const l of this.layers) {
      (l.mat.uniforms.uSize.value as THREE.Vector2).set(w, h);
      l.mat.uniforms.uScale.value = this.gfx.pxPerUnit * this.gfx.dpr;
    }
  }

  /** `focus` is the point of interest (the ship); layers shift against it for parallax. */
  update(dt: number, time: number, focus: THREE.Vector2): void {
    this.drift.x += dt * 0.004;
    this.drift.y += dt * 0.0015;
    for (const l of this.layers) {
      const o = l.mat.uniforms.uOffset.value as THREE.Vector2;
      o.set(-focus.x * l.parallax * 0.1 + this.drift.x * l.parallax * 60, -focus.y * l.parallax * 0.1 + this.drift.y * l.parallax * 60);
      l.mat.uniforms.uTime.value = time;
    }
    (this.nebMat.uniforms.uOffset.value as THREE.Vector2).set(-focus.x * 0.0015 + this.drift.x, -focus.y * 0.0015 + this.drift.y);
    this.nebMat.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.nebula.geometry.dispose();
    this.nebMat.dispose();
    for (const l of this.layers) {
      l.points.geometry.dispose();
      l.mat.dispose();
    }
  }
}
