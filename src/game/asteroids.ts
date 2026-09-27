import * as THREE from 'three';
import { ASTEROID, type AsteroidSize } from './constants';
import { wrapCoord, type Graphics } from './graphics';
import { makeLabelSprite, type LabelFactory } from './labels';

const VARIANTS = 6;
const RIM_BASE = new THREE.Color(0x8f7bff);
/** >1 pushes the neon edges past the bloom threshold so rocks read as "neon vector". */
const RIM_GLOW = 3.2;

function noise3(x: number, y: number, z: number, seed: number): number {
  return (
    Math.sin(x * 1.7 + seed) * Math.cos(y * 1.3 + seed * 1.9) * 0.5 +
    Math.sin(y * 2.9 + z * 1.1 + seed * 0.7) * 0.3 +
    Math.cos(z * 3.7 + x * 2.3 + seed * 2.3) * 0.2 +
    Math.sin((x + y + z) * 5.1 + seed * 3.1) * 0.1
  );
}

/** A lumpy unit rock: icosahedron with deterministic noise displacement, faceted. */
function rockGeometry(seed: number): { geo: THREE.BufferGeometry; edges: THREE.EdgesGeometry } {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const stretch = new THREE.Vector3(1 + Math.sin(seed) * 0.12, 1 + Math.cos(seed * 1.3) * 0.12, 0.9);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // quantize so shared vertices (non-indexed geometry) get identical offsets
    const qx = Math.round(v.x * 1000) / 1000;
    const qy = Math.round(v.y * 1000) / 1000;
    const qz = Math.round(v.z * 1000) / 1000;
    const n = noise3(qx * 2, qy * 2, qz * 2, seed);
    const d = 1 + n * 0.26;
    v.set(qx * d * stretch.x, qy * d * stretch.y, qz * d * stretch.z);
    pos.setXYZ(i, v.x, v.y, v.z);
    const shade = 0.62 + n * 0.4;
    colors[i * 3] = shade * 1.0;
    colors[i * 3 + 1] = shade * 0.93;
    colors[i * 3 + 2] = shade * 0.88;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const edges = new THREE.EdgesGeometry(geo, 22);
  return { geo, edges };
}

export class Asteroid {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector2();
  readonly vel = new THREE.Vector2();
  readonly radius: number;
  value: number | null;
  label: THREE.Sprite | null = null;
  labelAspect = 1;
  alive = true;
  /** Visual feedback timers. */
  shakeT = 0;
  flashT = 0;
  fadeIn = 0;
  private spinAxis: THREE.Vector3;
  private spinRate: number;
  private mesh: THREE.Mesh;
  readonly rimMat: THREE.LineBasicMaterial;
  private tmpQ = new THREE.Quaternion();

  constructor(
    readonly id: number,
    readonly size: AsteroidSize,
    value: number | null,
    geo: THREE.BufferGeometry,
    edges: THREE.EdgesGeometry,
    rockMat: THREE.Material,
  ) {
    this.value = value;
    this.radius = ASTEROID.radius[size];
    this.mesh = new THREE.Mesh(geo, rockMat);
    this.rimMat = new THREE.LineBasicMaterial({ color: RIM_BASE.clone().multiplyScalar(RIM_GLOW), transparent: true });
    const lines = new THREE.LineSegments(edges, this.rimMat);
    lines.scale.setScalar(1.004);
    this.mesh.add(lines);
    this.mesh.scale.setScalar(this.radius);
    this.mesh.quaternion.random();
    this.group.add(this.mesh);
    this.spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.spinRate = (0.25 + Math.random() * 0.6) * (4 / (this.radius + 1)) * (Math.random() < 0.5 ? -1 : 1);
  }

  get hitRadius(): number {
    return this.radius * ASTEROID.hitScale;
  }

  update(dt: number, halfW: number, halfH: number): void {
    const m = this.radius;
    this.pos.x = wrapCoord(this.pos.x + this.vel.x * dt, halfW, m);
    this.pos.y = wrapCoord(this.pos.y + this.vel.y * dt, halfH, m);
    this.tmpQ.setFromAxisAngle(this.spinAxis, this.spinRate * dt);
    this.mesh.quaternion.premultiply(this.tmpQ);
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    if (this.fadeIn < 1) this.fadeIn = Math.min(1, this.fadeIn + dt * 1.5);

    let ox = 0;
    let oy = 0;
    if (this.shakeT > 0) {
      const k = this.shakeT / 0.45;
      ox = Math.sin(this.shakeT * 70) * 0.7 * k;
      oy = Math.cos(this.shakeT * 55) * 0.25 * k;
    }
    this.group.position.set(this.pos.x + ox, this.pos.y + oy, 0);
    this.group.scale.setScalar(0.3 + 0.7 * easeOut(this.fadeIn));
    const f = this.flashT > 0 ? this.flashT / 0.35 : 0;
    this.rimMat.color.copy(RIM_BASE).lerp(new THREE.Color(1, 1, 1), f).multiplyScalar(RIM_GLOW + f * 2.5);
    this.rimMat.opacity = this.fadeIn;
    if (this.label) {
      this.label.position.set(this.group.position.x, this.group.position.y, 5);
      (this.label.material as THREE.SpriteMaterial).opacity = this.fadeIn;
    }
  }

  dispose(): void {
    this.rimMat.dispose();
    this.group.removeFromParent();
    if (this.label) {
      (this.label.material as THREE.SpriteMaterial).dispose();
      this.label.removeFromParent();
      this.label = null;
    }
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** All live asteroids. Rocks live in the bloomed scene; number labels in the overlay. */
export class AsteroidField {
  readonly list: Asteroid[] = [];
  private variants: Array<{ geo: THREE.BufferGeometry; edges: THREE.EdgesGeometry }> = [];
  private rockMat: THREE.MeshStandardMaterial;
  private nextId = 1;

  constructor(
    private gfx: Graphics,
    private labels: LabelFactory,
  ) {
    for (let i = 0; i < VARIANTS; i++) this.variants.push(rockGeometry(1.3 + i * 2.17));
    this.rockMat = new THREE.MeshStandardMaterial({
      color: 0x625a54,
      roughness: 0.93,
      metalness: 0.05,
      flatShading: true,
      vertexColors: true,
      emissive: 0x120a22,
    });
    gfx.onResize(() => this.refreshLabelSizes());
  }

  spawn(size: AsteroidSize, value: number | null, x: number, y: number, vx: number, vy: number, fadeIn = false): Asteroid {
    const v = this.variants[(Math.random() * this.variants.length) | 0];
    const a = new Asteroid(this.nextId++, size, value, v.geo, v.edges, this.rockMat);
    a.pos.set(x, y);
    a.vel.set(vx, vy);
    a.fadeIn = fadeIn ? 0 : 1;
    this.setValue(a, value);
    this.gfx.scene.add(a.group);
    this.list.push(a);
    a.update(0, this.gfx.halfW, this.gfx.halfH);
    return a;
  }

  setValue(a: Asteroid, value: number | null): void {
    a.value = value;
    if (value === null) {
      if (a.label) {
        (a.label.material as THREE.SpriteMaterial).dispose();
        a.label.removeFromParent();
        a.label = null;
      }
      return;
    }
    const { tex, aspect } = this.labels.numberTexture(value);
    if (!a.label) {
      a.label = makeLabelSprite(tex);
      this.gfx.overlay.add(a.label);
    } else {
      const mat = a.label.material as THREE.SpriteMaterial;
      mat.map = tex;
      mat.needsUpdate = true;
    }
    a.labelAspect = aspect;
    this.sizeLabel(a);
  }

  private sizeLabel(a: Asteroid): void {
    if (!a.label) return;
    const h = this.gfx.labelSize(ASTEROID.labelHeight[a.size], ASTEROID.labelMinPx[a.size]);
    a.label.scale.set(h * a.labelAspect, h, 1);
  }

  private refreshLabelSizes(): void {
    for (const a of this.list) this.sizeLabel(a);
  }

  remove(a: Asteroid): void {
    const i = this.list.indexOf(a);
    if (i >= 0) this.list.splice(i, 1);
    a.alive = false;
    a.dispose();
  }

  liveValues(): number[] {
    const out: number[] = [];
    for (const a of this.list) if (a.value !== null) out.push(a.value);
    return out;
  }

  update(dt: number): void {
    for (const a of this.list) a.update(dt, this.gfx.halfW, this.gfx.halfH);
  }

  clear(): void {
    for (const a of this.list) {
      a.alive = false;
      a.dispose();
    }
    this.list.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const v of this.variants) {
      v.geo.dispose();
      v.edges.dispose();
    }
    this.rockMat.dispose();
  }
}
