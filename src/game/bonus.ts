import * as THREE from 'three';
import { POWERUP, UFO } from './constants';
import { wrapCoord, type Graphics } from './graphics';
import { makeLabelSprite, type LabelFactory } from './labels';
import { buildShipModel, type ShipModel } from './shipModels';

/**
 * In-level surprises: power-up crystals (dropped by correct-answer streaks)
 * and the bonus UFO (a quick yes/no target). Neither ever picks the answer.
 */

export type PowerKind = 'slow' | 'wide' | 'magnet';

export const POWER_INFO: Record<PowerKind, { name: string; icon: string; color: number }> = {
  slow: { name: 'Slow-mo', icon: '🐢', color: 0x4fc3ff },
  wide: { name: 'Big blaster', icon: '💥', color: 0xffa53b },
  magnet: { name: 'Magnet', icon: '🧲', color: 0xff4fd8 },
};

export const POWER_KINDS = Object.keys(POWER_INFO) as PowerKind[];

/** A floating power-up crystal: fly into it or shoot it to collect. */
export class Crystal {
  readonly pos = new THREE.Vector2();
  readonly vel = new THREE.Vector2();
  readonly group = new THREE.Group();
  age = 0;
  private mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  /** The power-up's icon, floating over the crystal so kids can tell them apart. */
  readonly icon: THREE.Sprite;

  constructor(
    readonly kind: PowerKind,
    geo: THREE.BufferGeometry,
    labels: LabelFactory,
  ) {
    this.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(POWER_INFO[kind].color).multiplyScalar(1.3), transparent: true });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.group.add(this.mesh);
    this.icon = makeLabelSprite(labels.numberTexture(POWER_INFO[kind].icon).tex);
  }

  /** Returns false once it has expired. */
  update(dt: number, halfW: number, halfH: number): boolean {
    this.age += dt;
    this.pos.x = wrapCoord(this.pos.x + this.vel.x * dt, halfW, POWERUP.radius);
    this.pos.y = wrapCoord(this.pos.y + this.vel.y * dt, halfH, POWERUP.radius);
    this.mesh.rotation.y += dt * 2.4;
    this.mesh.rotation.x = 0.5;
    const s = 1 + 0.12 * Math.sin(this.age * 6);
    this.group.scale.setScalar(s);
    this.group.position.set(this.pos.x, this.pos.y, 1);
    this.icon.position.set(this.pos.x, this.pos.y, 7);
    // blink for the last couple of seconds
    const left = POWERUP.lifeSec - this.age;
    const op = left < 2.5 ? (Math.sin(this.age * 18) > 0 ? 1 : 0.25) : 1;
    this.mat.opacity = op;
    (this.icon.material as THREE.SpriteMaterial).opacity = op;
    return left > 0;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mat.dispose();
    (this.icon.material as THREE.SpriteMaterial).dispose();
    this.icon.removeFromParent();
  }
}

export class PowerUpField {
  readonly list: Crystal[] = [];
  private geo = new THREE.OctahedronGeometry(POWERUP.radius * 0.8, 0);

  constructor(
    private gfx: Graphics,
    private labels: LabelFactory,
  ) {}

  spawn(kind: PowerKind, x: number, y: number): Crystal {
    const c = new Crystal(kind, this.geo, this.labels);
    const h = this.gfx.labelSize(4.4, 48);
    c.icon.scale.set(h, h, 1);
    this.gfx.overlay.add(c.icon);
    c.pos.set(x, y);
    const a = Math.random() * Math.PI * 2;
    c.vel.set(Math.cos(a) * POWERUP.drift, Math.sin(a) * POWERUP.drift);
    this.gfx.scene.add(c.group);
    this.list.push(c);
    return c;
  }

  update(dt: number): void {
    for (const c of this.list.slice()) if (!c.update(dt, this.gfx.halfW, this.gfx.halfH)) this.remove(c);
  }

  remove(c: Crystal): void {
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
    c.dispose();
  }

  clear(): void {
    for (const c of this.list.slice()) this.remove(c);
  }

  dispose(): void {
    this.clear();
    this.geo.dispose();
  }
}

/** The bonus UFO: crosses the screen once, carrying a number. */
export class Ufo {
  readonly pos = new THREE.Vector2();
  readonly vel = new THREE.Vector2();
  readonly group = new THREE.Group();
  value = 0;
  private model: ShipModel;
  private label: THREE.Sprite;
  private labelAspect = 1;
  private color = new THREE.Color(0x7dff9b);
  private time = 0;

  constructor(
    private gfx: Graphics,
    private labels: LabelFactory,
    fromLeft: boolean,
    y: number,
  ) {
    this.model = buildShipModel('saucer');
    this.model.root.scale.setScalar(UFO.scale);
    this.model.root.rotation.x = -0.9; // tilt so the dome shows
    this.group.add(this.model.root);
    gfx.scene.add(this.group);
    this.label = makeLabelSprite(null);
    gfx.overlay.add(this.label);
    const startX = (fromLeft ? -1 : 1) * (gfx.halfW + UFO.radius * 2);
    this.pos.set(startX, y);
    const speed = (2 * (gfx.halfW + UFO.radius * 2)) / UFO.crossSec;
    this.vel.set(fromLeft ? speed : -speed, 0);
  }

  setValue(v: number): void {
    this.value = v;
    const { tex, aspect } = this.labels.numberTexture(v);
    const mat = this.label.material as THREE.SpriteMaterial;
    mat.map = tex;
    mat.needsUpdate = true;
    this.labelAspect = aspect;
  }

  /** Returns false once it has left the screen. */
  update(dt: number): boolean {
    this.time += dt;
    this.pos.x += this.vel.x * dt;
    const bob = Math.sin(this.time * 3) * 0.8;
    this.group.position.set(this.pos.x, this.pos.y + bob, 2);
    this.model.root.rotation.z += dt * 2;
    this.model.update(this.time, 0.4, this.color);
    const h = this.gfx.labelSize(4.2, 44);
    this.label.scale.set(h * this.labelAspect, h, 1);
    this.label.position.set(this.pos.x, this.pos.y + bob + UFO.radius + h * 0.45, 7);
    return Math.abs(this.pos.x) < this.gfx.halfW + UFO.radius * 3;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.model.dispose();
    (this.label.material as THREE.SpriteMaterial).dispose();
    this.label.removeFromParent();
  }
}
