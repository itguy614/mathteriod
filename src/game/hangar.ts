import * as THREE from 'three';
import type { ShipLoadout } from '../types';
import { SHIP } from './constants';
import type { Graphics } from './graphics';
import type { Lasers } from './lasers';
import type { Particles } from './particles';
import { Ship } from './ship';

const TILT = -0.95;
const FIRE_EVERY = 2.4;

/** Shop preview: the ship large, slowly spinning, trail and laser idling. */
export class HangarView {
  readonly ship: Ship;
  private spin = 0.6;
  private cx = 0.5;
  private cy = 0.5;
  private fireT = 1.2;
  private tmp = new THREE.Vector3();
  private tmpD = new THREE.Vector3();

  constructor(
    private gfx: Graphics,
    private lasers: Lasers,
    loadout: ShipLoadout,
  ) {
    this.ship = new Ship(loadout);
    this.ship.shieldUp = false;
    lasers.setStyle(loadout.laser, loadout.laserColor);
    gfx.scene.add(this.ship.group);
  }

  setLoadout(loadout: ShipLoadout): void {
    this.ship.setLoadout(loadout);
    this.lasers.setStyle(loadout.laser, loadout.laserColor);
    this.fireT = 0.6;
  }

  /** Frame the ship at viewport fractions (0..1, y down like CSS). */
  setCenter(x: number, y: number): void {
    this.cx = THREE.MathUtils.clamp(Number.isFinite(x) ? x : 0.5, 0.05, 0.95);
    this.cy = THREE.MathUtils.clamp(Number.isFinite(y) ? y : 0.5, 0.05, 0.95);
  }

  /** Scale so the ship (~3.6 model units radius) fits the room around its center. */
  private get scale(): number {
    const g = this.gfx;
    const room = Math.min(Math.min(this.cx, 1 - this.cx) * 2 * g.halfW, Math.min(this.cy, 1 - this.cy) * 2 * g.halfH);
    return THREE.MathUtils.clamp((room * 0.8) / (3.6 * SHIP.visualScale), 1.0, 3.4);
  }

  update(dt: number, time: number, particles: Particles): void {
    const s = this.ship;
    const scale = this.scale;
    this.spin += dt * 0.45;
    const g = this.gfx;
    const px = (this.cx - 0.5) * 2 * g.halfW;
    const py = (0.5 - this.cy) * 2 * g.halfH;
    s.group.position.set(px, py + Math.sin(time * 0.8) * 0.6, 0);
    s.group.scale.setScalar(scale);
    s.group.rotation.set(TILT, 0, this.spin);
    s.bank.rotation.y = Math.sin(time * 0.7) * 0.18;
    s.bank.visible = true;
    s.thrustAmt = 0.75 + 0.25 * Math.sin(time * 1.3);
    s.vel.set(0, 0);
    const color = s.color.update(time);
    s.model.update(time, s.thrustAmt, color);
    s.emitTrail(dt, time, particles, scale * 0.5, 0.45);

    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = FIRE_EVERY;
      const m = s.muzzleWorld(this.tmp);
      this.tmpD.set(0, 1, 0).transformDirection(s.model.root.matrixWorld);
      const angle = Math.atan2(-this.tmpD.x, this.tmpD.y);
      this.lasers.fire(m.x, m.y, angle, 0, 0, { scale: scale * 0.7, cosmetic: true });
    }
    this.lasers.update(dt, time, false);
  }

  dispose(): void {
    this.lasers.clear();
    this.ship.dispose();
  }
}
