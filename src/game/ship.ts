import * as THREE from 'three';
import type { ControlMode, ShipLoadout } from '../types';
import { DynamicColor } from './colors';
import { DIRECT, SHIP } from './constants';
import { wrapCoord } from './graphics';
import type { Particles } from './particles';
import { buildShipModel, type ShipModel } from './shipModels';
import { emitTrail } from './trails';

export interface Controls {
  /** -1 (right/clockwise) .. 1 (left/counter-clockwise). */
  turn: number;
  /** 0..1 */
  thrust: number;
  /** 0..1, 'rotate' mode Down/S. */
  brake: number;
  /** 'direct' mode keyboard direction, screen-space (+y up), each -1..1. */
  moveX: number;
  moveY: number;
  fire: boolean;
  /** Touch joystick, screen-space with +y up, magnitude 0..1. */
  stickX: number;
  stickY: number;
  stickActive: boolean;
}

const SHIELD_VERT = /* glsl */ `
varying vec3 vN;
void main() {
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SHIELD_FRAG = /* glsl */ `
varying vec3 vN;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
void main() {
  float f = pow(1.0 - abs(vN.z), 2.2);
  float band = 0.5 + 0.5 * sin((vN.x + vN.y) * 10.0 + uTime * 3.0);
  gl_FragColor = vec4(uColor, (f * 0.95 + 0.07 + band * f * 0.25) * uAlpha);
}`;

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * The player's ship: flight model plus visuals (model, bank, shield bubble,
 * blinking invulnerability, exhaust trail). Also used for the hangar preview.
 */
export class Ship {
  /** World transform (position + heading). */
  readonly group = new THREE.Group();
  /** Inner group for banking / display tilt. */
  readonly bank = new THREE.Group();
  readonly pos = new THREE.Vector2();
  readonly vel = new THREE.Vector2();
  angle = 0;
  thrustAmt = 0;
  turnAmt = 0;
  alive = true;
  invuln = 0;
  shieldUp = false;
  agile = false;
  color!: DynamicColor;
  trail = 'ion';
  model!: ShipModel;

  private shield: THREE.Mesh;
  private shieldMat: THREE.ShaderMaterial;
  private shieldPop = 0;
  private trailAcc: Array<{ v: number }> = [];
  private tmpV = new THREE.Vector3();
  private tmpD = new THREE.Vector3();

  constructor(loadout: ShipLoadout) {
    this.bank.scale.setScalar(SHIP.visualScale);
    this.group.add(this.bank);
    this.shieldMat = new THREE.ShaderMaterial({
      vertexShader: SHIELD_VERT,
      fragmentShader: SHIELD_FRAG,
      uniforms: { uColor: { value: new THREE.Color() }, uAlpha: { value: 1 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(3.4 * SHIP.visualScale, 28, 18), this.shieldMat);
    this.shield.visible = false;
    this.group.add(this.shield);
    this.setLoadout(loadout);
  }

  setLoadout(loadout: ShipLoadout): void {
    if (this.model) {
      this.bank.remove(this.model.root);
      this.model.dispose();
    }
    this.model = buildShipModel(loadout.body);
    this.bank.add(this.model.root);
    this.color = new DynamicColor(loadout.color);
    this.trail = loadout.trail;
    this.agile = loadout.perks.includes('agile');
    this.trailAcc = this.model.engines.map(() => ({ v: 0 }));
  }

  /** Unit forward vector in world XY. */
  forwardX(): number {
    return -Math.sin(this.angle);
  }
  forwardY(): number {
    return Math.cos(this.angle);
  }

  reset(x = 0, y = 0): void {
    this.pos.set(x, y);
    this.vel.set(0, 0);
    this.angle = 0;
    this.thrustAmt = 0;
    this.turnAmt = 0;
    this.alive = true;
  }

  /**
   * Flight model with screen wrap.
   * 'rotate': turn, thrust with inertia, gentle drag, Down brakes hard.
   * 'direct': keys push the ship in that screen direction; it turns to face its motion.
   * The touch joystick (turn toward the stick + thrust) works the same in both modes.
   */
  fly(dt: number, c: Controls, halfW: number, halfH: number, mode: ControlMode = 'rotate'): void {
    if (mode === 'direct' && !c.stickActive) this.flyDirect(dt, c);
    else this.flyRotate(dt, c);
    this.pos.x = wrapCoord(this.pos.x + this.vel.x * dt, halfW, 2);
    this.pos.y = wrapCoord(this.pos.y + this.vel.y * dt, halfH, 2);
  }

  private flyDirect(dt: number, c: Controls): void {
    const mult = this.agile ? SHIP.agileMult : 1;
    let mx = c.moveX;
    let my = c.moveY;
    const mag = Math.hypot(mx, my);
    let turn = 0;
    if (mag > 0.01) {
      mx /= mag;
      my /= mag;
      const a = DIRECT.accel * mult * Math.min(1, mag) * dt;
      this.vel.x += mx * a;
      this.vel.y += my * a;
      this.vel.multiplyScalar(Math.exp(-DIRECT.drag * dt));
      // turn quickly to face the direction of travel (never overshoot)
      const d = angleDiff(this.angle, Math.atan2(-mx, my));
      const step = DIRECT.turnRate * mult * dt;
      this.angle += THREE.MathUtils.clamp(d, -step, step);
      turn = THREE.MathUtils.clamp(d * 2, -1, 1);
      this.thrustAmt = Math.min(1, mag);
    } else {
      this.vel.multiplyScalar(Math.exp(-DIRECT.releaseDrag * dt));
      this.thrustAmt = 0;
      // tap-to-target may still rotate the ship in place
      if (c.turn !== 0) {
        this.angle += c.turn * SHIP.turnRate * mult * dt;
        turn = THREE.MathUtils.clamp(c.turn, -1, 1);
      }
    }
    this.turnAmt = turn;
    const sp = this.vel.length();
    if (sp > DIRECT.maxSpeed) this.vel.multiplyScalar(DIRECT.maxSpeed / sp);
  }

  private flyRotate(dt: number, c: Controls): void {
    const mult = this.agile ? SHIP.agileMult : 1;
    let turn = c.turn;
    let thrust = c.thrust;
    if (c.stickActive) {
      const mag = Math.min(1, Math.hypot(c.stickX, c.stickY));
      if (mag > SHIP.stickDeadzone) {
        const target = Math.atan2(-c.stickX, c.stickY);
        const d = angleDiff(this.angle, target);
        turn = THREE.MathUtils.clamp(d * 3.5, -1, 1);
        const align = Math.max(0, Math.cos(d));
        const m = (mag - SHIP.stickDeadzone) / (1 - SHIP.stickDeadzone);
        thrust = Math.max(thrust, m * align * align);
      }
    }
    this.turnAmt = turn;
    this.angle += turn * SHIP.turnRate * mult * dt;
    this.thrustAmt = thrust;
    if (thrust > 0) {
      const a = SHIP.thrust * mult * thrust * dt;
      this.vel.x += this.forwardX() * a;
      this.vel.y += this.forwardY() * a;
    }
    this.vel.multiplyScalar(Math.exp(-(SHIP.drag + (c.stickActive ? 0 : c.brake * SHIP.brakeDrag)) * dt));
    const sp = this.vel.length();
    if (sp > SHIP.maxSpeed) this.vel.multiplyScalar(SHIP.maxSpeed / sp);
  }

  popShield(): void {
    this.shieldUp = false;
    this.shieldPop = 0.45;
  }

  /** Visual update for in-level flight. */
  updateVisual(dt: number, time: number, particles: Particles | null): void {
    const color = this.color.update(time);
    this.group.position.set(this.pos.x, this.pos.y, 0);
    this.group.rotation.z = this.angle;
    this.bank.rotation.y += (-THREE.MathUtils.clamp(this.turnAmt, -1, 1) * 0.45 - this.bank.rotation.y) * Math.min(1, dt * 8);
    this.model.update(time, this.thrustAmt, color);

    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    const blinkOff = this.invuln > 0 && Math.floor(time * 12) % 2 === 0;
    this.bank.visible = this.alive && !blinkOff;

    this.updateShield(dt, time, color);

    if (particles && this.alive && this.thrustAmt > 0.02) this.emitTrail(dt, time, particles, 1);
  }

  updateShield(dt: number, time: number, color: THREE.Color): void {
    if (this.shieldPop > 0) this.shieldPop = Math.max(0, this.shieldPop - dt);
    const show = (this.shieldUp && this.alive) || this.shieldPop > 0;
    this.shield.visible = show;
    if (show) {
      const u = this.shieldMat.uniforms;
      (u.uColor.value as THREE.Color).copy(color).lerp(new THREE.Color(0.6, 0.9, 1), 0.4).multiplyScalar(1.4);
      u.uTime.value = time;
      if (this.shieldPop > 0) {
        const k = this.shieldPop / 0.45;
        this.shield.scale.setScalar(1 + (1 - k) * 0.8);
        u.uAlpha.value = k * 1.5;
      } else {
        this.shield.scale.setScalar(1 + Math.sin(time * 4) * 0.03);
        u.uAlpha.value = 0.75;
      }
    }
  }

  /** Emit exhaust from every engine, in world space (works for scaled/tilted hangar display too). */
  emitTrail(dt: number, time: number, particles: Particles, scale: number, intensity = 1): void {
    const color = this.color.color;
    this.group.updateMatrixWorld(true);
    const root = this.model.root;
    // world-space exhaust direction (−Y local), projected on the play plane
    this.tmpD.set(0, -1, 0).transformDirection(root.matrixWorld);
    let dx = this.tmpD.x;
    let dy = this.tmpD.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    this.model.engines.forEach((e, i) => {
      this.tmpV.copy(e).applyMatrix4(root.matrixWorld);
      emitTrail(
        particles,
        this.trail,
        this.trailAcc[i],
        this.tmpV.x,
        this.tmpV.y,
        this.tmpV.z + 1,
        dx,
        dy,
        this.vel.x * 0.15,
        this.vel.y * 0.15,
        color,
        this.thrustAmt,
        dt,
        time,
        scale,
        intensity,
      );
    });
  }

  /** World position of the laser muzzle. */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateMatrixWorld(true);
    return out.copy(this.model.muzzle).applyMatrix4(this.model.root.matrixWorld);
  }

  dispose(): void {
    this.model.dispose();
    this.shield.geometry.dispose();
    this.shieldMat.dispose();
    this.group.removeFromParent();
  }
}
