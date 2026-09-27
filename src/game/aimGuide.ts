import * as THREE from 'three';
import { AIM_GUIDE } from './constants';
import type { Graphics } from './graphics';

const VERT = /* glsl */ `
attribute float aT;
uniform float uSize;
uniform float uFlow;
uniform float uCount;
varying float vAlpha;
void main() {
  // dots creep forward and recycle; fade in at the muzzle, fade out at the far end
  float t = fract((aT + uFlow) / uCount);
  vec3 p = position;
  p.y = t;
  vAlpha = smoothstep(0.0, 0.05, t) * (1.0 - t * t);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (1.0 - t * 0.35);
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  // bright core with a thin dark rim so the dots read on bright nebulae too
  float a = smoothstep(0.5, 0.4, d);
  vec3 col = mix(vec3(0.02, 0.02, 0.08), uColor, smoothstep(0.42, 0.3, d));
  gl_FragColor = vec4(col, a * vAlpha * uOpacity);
  #include <colorspace_fragment>
}`;

/**
 * Faint dotted line from the ship's nose along the firing direction, in the
 * laser color. Small round dots that drift forward, so it reads as a guide and
 * never as a shot. Drawn in the overlay (no bloom), below the number labels.
 */
export class AimGuide {
  readonly obj: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private count: number;
  private flow = 0;

  constructor(private gfx: Graphics) {
    this.count = Math.max(2, Math.round(AIM_GUIDE.length / AIM_GUIDE.spacing));
    const pos = new Float32Array(this.count * 3);
    const t = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) t[i] = i;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uOpacity: { value: AIM_GUIDE.opacity },
        uSize: { value: 5 },
        uFlow: { value: 0 },
        uCount: { value: this.count },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.obj = new THREE.Points(geo, this.mat);
    this.obj.frustumCulled = false;
    this.obj.renderOrder = 5;
    gfx.overlay.add(this.obj);
  }

  /** Place at the muzzle, pointing along `angle` (ship convention: 0 = +Y). */
  update(dt: number, x: number, y: number, angle: number, color: THREE.Color, visible: boolean): void {
    this.obj.visible = visible;
    if (!visible) return;
    this.flow = (this.flow + (dt * AIM_GUIDE.flow) / AIM_GUIDE.spacing) % this.count;
    const u = this.mat.uniforms;
    u.uFlow.value = this.flow;
    u.uSize.value = AIM_GUIDE.dotPx * this.gfx.dpr;
    (u.uColor.value as THREE.Color).copy(color).lerp(new THREE.Color(1, 1, 1), 0.25);
    // local +Y spans [0,1] in the shader; scale it to the guide length
    const fx = -Math.sin(angle);
    const fy = Math.cos(angle);
    this.obj.position.set(x + fx * AIM_GUIDE.startGap, y + fy * AIM_GUIDE.startGap, 4);
    this.obj.rotation.z = angle;
    this.obj.scale.set(1, AIM_GUIDE.length, 1);
  }

  dispose(): void {
    this.obj.geometry.dispose();
    this.mat.dispose();
    this.obj.removeFromParent();
  }
}
