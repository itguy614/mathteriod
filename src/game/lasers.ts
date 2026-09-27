import * as THREE from 'three';
import { DynamicColor } from './colors';
import { LASER } from './constants';
import { wrapCoord, type Graphics } from './graphics';

/**
 * Laser bolts. Styles are purely cosmetic: every style shares the same
 * speed, lifetime and hit radius.
 */
export interface Laser {
  pos: THREE.Vector2;
  prev: THREE.Vector2;
  vel: THREE.Vector2;
  age: number;
  life: number;
  obj: THREE.Group;
  bolt: THREE.Line | null; // lightning only
  phase: number;
  scale: number;
  /** Cosmetic-only lasers (hangar) never hit anything. */
  cosmetic: boolean;
}

const LIGHTNING_POINTS = 9;

export class Lasers {
  readonly list: Laser[] = [];
  private style = 'pulse';
  private color = new DynamicColor('cyan');
  private coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.4) });
  private glowMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  private lineMat = new THREE.LineBasicMaterial({ transparent: true });
  private geoms: Record<string, THREE.BufferGeometry>;

  constructor(private gfx: Graphics) {
    const capsule = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 4, 8);
    this.geoms = {
      pulseCore: capsule(0.14, 1.5),
      pulseGlow: capsule(0.32, 1.9),
      twinCore: capsule(0.08, 2.2),
      twinGlow: capsule(0.18, 2.4),
      plasmaCore: new THREE.SphereGeometry(0.3, 12, 8),
      plasmaGlow: new THREE.SphereGeometry(0.62, 14, 10),
      spark: new THREE.SphereGeometry(0.24, 8, 6),
    };
  }

  setStyle(style: string, colorId: string): void {
    this.style = style;
    this.color = new DynamicColor(colorId, 0.5);
    this.clear();
  }

  get count(): number {
    let n = 0;
    for (const l of this.list) if (!l.cosmetic) n++;
    return n;
  }

  fire(x: number, y: number, angle: number, baseVx: number, baseVy: number, opts: { scale?: number; cosmetic?: boolean } = {}): Laser {
    const scale = opts.scale ?? 1;
    const fx = -Math.sin(angle);
    const fy = Math.cos(angle);
    const obj = new THREE.Group();
    obj.rotation.z = angle;
    obj.scale.setScalar(scale);
    let bolt: THREE.Line | null = null;
    const g = this.geoms;
    switch (this.style) {
      case 'twin':
        for (const off of [-0.42, 0.42]) {
          const core = new THREE.Mesh(g.twinCore, this.coreMat);
          const glow = new THREE.Mesh(g.twinGlow, this.glowMat);
          core.position.x = off;
          glow.position.x = off;
          obj.add(glow, core);
        }
        break;
      case 'plasma':
        obj.add(new THREE.Mesh(g.plasmaGlow, this.glowMat), new THREE.Mesh(g.plasmaCore, this.coreMat));
        break;
      case 'lightning': {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LIGHTNING_POINTS * 3), 3));
        bolt = new THREE.Line(geo, this.lineMat);
        obj.add(bolt, new THREE.Mesh(g.spark, this.coreMat));
        const glow = new THREE.Mesh(g.spark, this.glowMat);
        glow.scale.setScalar(1.9);
        obj.add(glow);
        break;
      }
      default:
        obj.add(new THREE.Mesh(g.pulseGlow, this.glowMat), new THREE.Mesh(g.pulseCore, this.coreMat));
    }
    const speed = LASER.speed * (opts.cosmetic ? 0.6 : 1);
    const l: Laser = {
      pos: new THREE.Vector2(x, y),
      prev: new THREE.Vector2(x, y),
      vel: new THREE.Vector2(fx * speed + baseVx, fy * speed + baseVy),
      age: 0,
      life: opts.cosmetic ? 2.0 : LASER.life,
      obj,
      bolt,
      phase: Math.random() * 10,
      scale,
      cosmetic: opts.cosmetic ?? false,
    };
    if (bolt) this.zigzag(bolt);
    obj.position.set(x, y, 1);
    this.gfx.scene.add(obj);
    this.list.push(l);
    return l;
  }

  private zigzag(bolt: THREE.Line): void {
    const attr = bolt.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < LIGHTNING_POINTS; i++) {
      const t = i / (LIGHTNING_POINTS - 1);
      const jitter = i === 0 || i === LIGHTNING_POINTS - 1 ? 0 : (Math.random() - 0.5) * 0.9;
      attr.setXYZ(i, jitter, -t * 3.2, 0);
    }
    attr.needsUpdate = true;
  }

  update(dt: number, time: number, wrap: boolean): void {
    const c = this.color.update(time);
    this.glowMat.color.copy(c).multiplyScalar(2.2);
    this.lineMat.color.copy(c).lerp(new THREE.Color(1, 1, 1), 0.3).multiplyScalar(3);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const l = this.list[i];
      l.age += dt;
      if (l.age >= l.life) {
        this.removeAt(i);
        continue;
      }
      l.prev.copy(l.pos);
      l.pos.x += l.vel.x * dt;
      l.pos.y += l.vel.y * dt;
      if (wrap) {
        const wx = wrapCoord(l.pos.x, this.gfx.halfW, 1);
        const wy = wrapCoord(l.pos.y, this.gfx.halfH, 1);
        if (wx !== l.pos.x || wy !== l.pos.y) {
          l.pos.set(wx, wy);
          l.prev.copy(l.pos);
        }
      }
      l.obj.position.set(l.pos.x, l.pos.y, 1);
      l.obj.rotation.z = Math.atan2(-l.vel.x, l.vel.y); // follows aim-assist curving
      const fade = l.life - l.age < 0.12 ? (l.life - l.age) / 0.12 : 1;
      if (this.style === 'plasma') {
        const w = 1 + Math.sin(time * 28 + l.phase) * 0.18;
        l.obj.scale.set(l.scale * w * fade, l.scale * (2 - w) * fade, l.scale);
      } else {
        l.obj.scale.setScalar(l.scale * (0.4 + 0.6 * fade));
      }
      if (l.bolt && Math.floor((time + l.phase) * 30) !== Math.floor((time + l.phase - dt) * 30)) this.zigzag(l.bolt);
    }
  }

  remove(l: Laser): void {
    const i = this.list.indexOf(l);
    if (i >= 0) this.removeAt(i);
  }

  private removeAt(i: number): void {
    const l = this.list[i];
    this.list.splice(i, 1);
    l.obj.removeFromParent();
    if (l.bolt) l.bolt.geometry.dispose();
  }

  clear(): void {
    for (let i = this.list.length - 1; i >= 0; i--) this.removeAt(i);
  }

  dispose(): void {
    this.clear();
    for (const g of Object.values(this.geoms)) g.dispose();
    this.coreMat.dispose();
    this.glowMat.dispose();
    this.lineMat.dispose();
  }
}
