import * as THREE from 'three';
import type { GalaxyPos, GalaxyStop, ShipLoadout } from '../types';
import { GALAXY } from './constants';
import type { Graphics } from './graphics';
import { makeLabelSprite, type LabelFactory } from './labels';
import type { Particles } from './particles';
import { Ship } from './ship';

/**
 * The galaxy Base: every mission stage is a planet on a winding route, and the
 * player's own ship sits on the route at its progress. The camera stays put;
 * the whole galaxy (a `world` group, plus its labels in the overlay) slides
 * under it, so the starfield's parallax sells the flight.
 *
 * Positions on the route are GalaxyPos { stage, t }: t in 0..1 is the way from
 * planet `stage` to planet `stage + 1`.
 */

const OP_COLOR: Record<GalaxyStop['op'], number> = {
  add: 0x22e4ff,
  sub: 0x8dff3b,
  mul: 0xff3bd4,
  div: 0xffa53b,
  mixed: 0xffd23b,
};

interface Planet {
  stop: GalaxyStop;
  pos: THREE.Vector2;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  ring: THREE.Mesh | null;
  label: THREE.Sprite;
  labelAspect: number;
  spin: number;
}

type Flight = { from: number; to: number; t: number; dur: number; resolve: () => void; promotion: boolean };

export class GalaxyView {
  readonly ship: Ship;
  private world = new THREE.Group();
  private labelsGroup = new THREE.Group();
  private planets: Planet[] = [];
  private curve: THREE.CatmullRomCurve3;
  private routeDone: THREE.Line;
  private routeAhead: THREE.Line;
  private routeMat: THREE.LineDashedMaterial;
  private routeAheadMat: THREE.LineDashedMaterial;
  private sphere = new THREE.SphereGeometry(1, 32, 20);
  private ringGeo = new THREE.TorusGeometry(1.6, 0.12, 8, 48);
  /** Ship position on the route as one number: stage + t. */
  private u: number;
  private flight: Flight | null = null;
  private launching: { t: number; resolve: () => void } | null = null;
  /** Camera (world point shown at the framing center), and the kid's drag offset from it. */
  private cam = new THREE.Vector2();
  private drag = 0;
  private dragging = false;
  private releaseT = 0;
  private cx = 0.5;
  private cy = 0.5;
  private info: { sprite: THREE.Sprite; t: number } | null = null;
  private time = 0;

  constructor(
    private gfx: Graphics,
    private labels: LabelFactory,
    private particles: Particles,
    stops: GalaxyStop[],
    loadout: ShipLoadout,
    at: GalaxyPos,
  ) {
    const pts = stops.map((_, i) => this.planetPoint(i));
    this.curve = new THREE.CatmullRomCurve3(pts.length > 1 ? pts : [pts[0], pts[0].clone().add(new THREE.Vector3(1, 0, 0))]);

    stops.forEach((stop, i) => this.planets.push(this.makePlanet(stop, i)));

    // the route: travelled part bright, the rest dim
    this.routeMat = new THREE.LineDashedMaterial({ color: 0x9fe8ff, dashSize: 1.6, gapSize: 1.2, transparent: true, opacity: 0.9 });
    this.routeAheadMat = new THREE.LineDashedMaterial({ color: 0x6a6f9a, dashSize: 1.2, gapSize: 1.6, transparent: true, opacity: 0.55 });
    this.routeDone = new THREE.Line(new THREE.BufferGeometry(), this.routeMat);
    this.routeAhead = new THREE.Line(new THREE.BufferGeometry(), this.routeAheadMat);
    this.world.add(this.routeDone, this.routeAhead);

    this.ship = new Ship(loadout);
    this.ship.shieldUp = false;
    this.ship.group.scale.setScalar(GALAXY.shipScale);
    this.world.add(this.ship.group);

    gfx.scene.add(this.world);
    gfx.overlay.add(this.labelsGroup);

    this.u = this.toU(at);
    this.updateRoute();
    this.placeShip(0);
    const p = this.routePoint(this.u);
    this.cam.set(p.x, p.y);
  }

  // -------------------------------------------------------------------------
  // Layout

  /** Planet i on a gently winding route, left to right. */
  private planetPoint(i: number): THREE.Vector3 {
    const G = GALAXY;
    return new THREE.Vector3(i * G.gap, G.wave * Math.sin(i * 1.15) + G.wave * 0.5 * Math.sin(i * 0.41 + 1), 0);
  }

  private routePoint(u: number): THREE.Vector3 {
    const n = this.planets.length;
    if (n <= 1) return this.planetPoint(0);
    return this.curve.getPoint(THREE.MathUtils.clamp(u / (n - 1), 0, 1));
  }

  private clampU(u: number): number {
    return THREE.MathUtils.clamp(u, 0, Math.max(0, this.planets.length - 1));
  }

  /**
   * Route spot for a GalaxyPos. t covers only the open space between two
   * planets' surfaces, so t = 0 parks the ship just past its planet, never on it.
   */
  private toU(p: GalaxyPos): number {
    const last = this.planets.length - 1;
    if (p.stage >= last) return Math.max(0, last);
    const edge = GALAXY.parkGap / GALAXY.gap;
    return this.clampU(p.stage + edge + THREE.MathUtils.clamp(p.t, 0, 1) * (1 - 2 * edge));
  }

  private makePlanet(stop: GalaxyStop, i: number): Planet {
    const color = new THREE.Color(OP_COLOR[stop.op]);
    const locked = stop.state === 'locked';
    const mat = new THREE.MeshStandardMaterial({
      color: locked ? new THREE.Color(0x3a3d58) : color.clone().multiplyScalar(GALAXY.surface),
      emissive: locked ? new THREE.Color(0x0a0b18) : color.clone().multiplyScalar(stop.state === 'current' ? GALAXY.glowCurrent : GALAXY.glowDone),
      roughness: 0.75,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(this.sphere, mat);
    const r = stop.state === 'current' ? GALAXY.planetRadius * 1.2 : GALAXY.planetRadius;
    mesh.scale.setScalar(r);
    const p = this.planetPoint(i);
    mesh.position.copy(p);
    this.world.add(mesh);
    let ring: THREE.Mesh | null = null;
    if (stop.boss) {
      // review stages (boss planets) get a ring
      ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: locked ? 0x50557a : color.clone().multiplyScalar(1.4) }));
      ring.scale.setScalar(r);
      ring.rotation.set(1.2, 0.35, 0);
      ring.position.copy(p);
      this.world.add(ring);
    }
    const text = `${stop.state === 'done' ? '✓ ' : stop.state === 'locked' ? '🔒 ' : ''}${stop.name}${stop.boss ? ' 👾' : ''}`;
    const { tex, aspect } = this.labels.numberTexture(text);
    const label = makeLabelSprite(tex);
    (label.material as THREE.SpriteMaterial).opacity = locked ? 0.6 : 1;
    this.labelsGroup.add(label);
    return { stop, pos: new THREE.Vector2(p.x, p.y), mesh, mat, ring, label, labelAspect: aspect, spin: 0.15 + (i % 3) * 0.06 };
  }

  /** Rebuild the two route lines around the ship's current spot. */
  private updateRoute(): void {
    const n = this.planets.length;
    const split = this.u / Math.max(1, n - 1);
    const done: THREE.Vector3[] = [];
    const ahead: THREE.Vector3[] = [];
    const steps = Math.max(2, n * 24);
    for (let k = 0; k <= steps; k++) {
      const f = k / steps;
      const p = this.curve.getPoint(f);
      p.z = -1;
      if (f <= split) done.push(p);
      if (f >= split) ahead.push(p);
    }
    const shipP = this.routePoint(this.u);
    shipP.z = -1;
    done.push(shipP);
    ahead.unshift(shipP.clone());
    for (const [line, pts] of [
      [this.routeDone, done],
      [this.routeAhead, ahead],
    ] as const) {
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      line.computeLineDistances();
    }
  }

  // -------------------------------------------------------------------------
  // Control (from the engine)

  /** Where to frame the ship, in viewport fractions (0..1, y down), so UI panels don't cover it. */
  setCenter(x: number, y: number): void {
    this.cx = THREE.MathUtils.clamp(x, 0.1, 0.9);
    this.cy = THREE.MathUtils.clamp(y, 0.1, 0.9);
  }

  /** Fly along the route to `to` (never backwards). A new stage plays the longer arrival. */
  flyTo(to: GalaxyPos): Promise<void> {
    const target = this.toU(to);
    if (target <= this.u + 1e-3) return Promise.resolve();
    this.finishFlight();
    const promotion = Math.floor(target) > Math.floor(this.u);
    const dist = target - this.u;
    const dur = promotion ? GALAXY.arriveSec + dist * 0.8 : GALAXY.nudgeSec + dist * 2;
    return new Promise((resolve) => {
      this.flight = { from: this.u, to: target, t: 0, dur, resolve, promotion };
    });
  }

  /** Mission launch: the ship boosts off along the route; resolves after the dive (or a tap). */
  launch(): Promise<void> {
    this.finishFlight();
    if (this.launching) return Promise.resolve();
    return new Promise((resolve) => {
      this.launching = { t: 0, resolve };
    });
  }

  /** Skip whatever animation is playing (a tap). */
  skip(): void {
    this.finishFlight();
    if (this.launching) {
      const r = this.launching.resolve;
      this.launching = null;
      r();
    }
  }

  dragBy(dxPx: number): void {
    if (this.launching) return;
    this.dragging = true;
    this.drag -= dxPx / (this.gfx.pxPerUnit || 1);
    const n = this.planets.length;
    const shipX = this.routePoint(this.u).x;
    this.drag = THREE.MathUtils.clamp(this.drag, -shipX - GALAXY.gap, (n - 1) * GALAXY.gap - shipX + GALAXY.gap);
  }

  release(): void {
    this.dragging = false;
    this.releaseT = GALAXY.dragHoldSec;
  }

  /** A tap at a world point (screen-space world coords): show that planet's name and status. */
  tapAt(wx: number, wy: number): boolean {
    const ox = this.world.position.x;
    const oy = this.world.position.y;
    const pad = 18 / (this.gfx.pxPerUnit || 1);
    const hit = this.planets.find((p) => Math.hypot(p.pos.x + ox - wx, p.pos.y + oy - wy) <= GALAXY.planetRadius * 1.3 + pad);
    if (!hit) return false;
    const s = hit.stop;
    const status = s.state === 'done' ? '✓ Done' : s.state === 'current' ? '🚀 You are here' : '🔒 Locked';
    this.showInfo(hit, `${s.name}${s.boss ? ' 👾' : ''} · ${status}`);
    return true;
  }

  private showInfo(p: Planet, text: string): void {
    this.clearInfo();
    const { tex, aspect } = this.labels.numberTexture(text);
    const sprite = makeLabelSprite(tex);
    const h = this.gfx.labelSize(3, 30);
    sprite.scale.set(h * aspect, h, 1);
    sprite.userData.planet = p;
    this.labelsGroup.add(sprite);
    this.info = { sprite, t: GALAXY.infoSec };
  }

  private clearInfo(): void {
    if (!this.info) return;
    (this.info.sprite.material as THREE.SpriteMaterial).dispose();
    this.info.sprite.removeFromParent();
    this.info = null;
  }

  private finishFlight(): void {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    this.u = f.to;
    this.updateRoute();
    if (f.promotion) this.lightUp(Math.floor(f.to));
    f.resolve();
  }

  /** Restyle a planet (and its label) for a new state. */
  private setState(p: Planet, state: GalaxyStop['state']): void {
    p.stop = { ...p.stop, state };
    const color = new THREE.Color(OP_COLOR[p.stop.op]);
    const r = GALAXY.planetRadius * (state === 'current' ? 1.2 : 1);
    p.mat.color.copy(state === 'locked' ? new THREE.Color(0x3a3d58) : color.clone().multiplyScalar(GALAXY.surface));
    p.mat.emissive.copy(color).multiplyScalar(state === 'current' ? GALAXY.glowCurrent : state === 'done' ? GALAXY.glowDone : 0);
    p.mat.emissiveIntensity = 1;
    p.mesh.scale.setScalar(r);
    p.ring?.scale.setScalar(r);
    const text = `${state === 'done' ? '✓ ' : state === 'locked' ? '🔒 ' : ''}${p.stop.name}${p.stop.boss ? ' 👾' : ''}`;
    const { tex, aspect } = this.labels.numberTexture(text);
    const mat = p.label.material as THREE.SpriteMaterial;
    mat.map = tex;
    mat.opacity = state === 'locked' ? 0.6 : 1;
    mat.needsUpdate = true;
    p.labelAspect = aspect;
  }

  /** Arrival at a new planet: it lights up as the current stop, and the ones behind are done. */
  private lightUp(i: number): void {
    const p = this.planets[i];
    if (!p) return;
    for (let k = 0; k < i; k++) if (this.planets[k].stop.state !== 'done') this.setState(this.planets[k], 'done');
    this.setState(p, 'current');
    const color = new THREE.Color(OP_COLOR[p.stop.op]);
    this.gfx.pulseBloom(0.8);
    const sx = p.pos.x + this.world.position.x;
    const sy = p.pos.y + this.world.position.y;
    this.particles.burst(sx, sy, 70, 26, 1.1, 1.2, color, new THREE.Color(1, 1, 1), { intensity: 2.2, drag: 1.6, twinkle: true });
  }

  // -------------------------------------------------------------------------
  // Frame

  update(dt: number, time: number): THREE.Vector2 {
    this.time = time;
    const s = this.ship;
    let moving = 0;
    const f = this.flight;
    if (f) {
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // ease in-out
      const prev = this.u;
      this.u = f.from + (f.to - f.from) * e;
      moving = Math.abs(this.u - prev) / Math.max(dt, 1e-4);
      this.updateRoute();
      if (k >= 1) this.finishFlight();
    }

    // ship: on the route, facing along it
    const offRoute = this.launching ? this.launchOffset(dt) : 0;
    this.placeShip(offRoute);
    s.thrustAmt = this.launching ? 1 : f ? Math.min(1, 0.35 + moving * 0.6) : 0.25 + 0.1 * Math.sin(time * 1.6);
    const color = s.color.update(time);
    s.model.update(time, s.thrustAmt, color);
    s.bank.rotation.y = Math.sin(time * 0.9) * 0.12;
    s.vel.set(0, 0);
    s.emitTrail(dt, time, this.particles, GALAXY.shipScale * 0.55, this.launching ? 1.4 : f ? 0.9 : 0.35);

    // camera: follow the ship (not during the launch dive), plus the kid's drag
    if (!this.dragging && this.releaseT > 0) this.releaseT -= dt;
    if (!this.dragging && this.releaseT <= 0) this.drag *= Math.exp(-dt * 3);
    if (!this.launching) {
      const sp = this.routePoint(this.u);
      const k = 1 - Math.exp(-dt * (f ? 6 : 3));
      this.cam.x += (sp.x + this.drag - this.cam.x) * k;
      this.cam.y += (sp.y - this.cam.y) * k;
    }
    const g = this.gfx;
    const fx = (this.cx - 0.5) * 2 * g.halfW;
    const fy = (0.5 - this.cy) * 2 * g.halfH;
    this.world.position.set(fx - this.cam.x, fy - this.cam.y, 0);
    this.labelsGroup.position.copy(this.world.position);

    // planets turn; the current one breathes
    const lh = g.labelSize(2.4, 22);
    for (const p of this.planets) {
      p.mesh.rotation.y += dt * p.spin;
      if (p.ring) p.ring.rotation.z += dt * 0.2;
      const r = p.mesh.scale.x;
      p.label.scale.set(lh * p.labelAspect, lh, 1);
      p.label.position.set(p.pos.x, p.pos.y - r - lh * 0.9, 5);
      if (p.stop.state === 'current' && !this.flight) p.mat.emissiveIntensity = 1 + 0.4 * Math.sin(time * 2.4);
    }
    if (this.info) {
      this.info.t -= dt;
      const p = this.info.sprite.userData.planet as Planet;
      this.info.sprite.position.set(p.pos.x, p.pos.y + p.mesh.scale.x + this.info.sprite.scale.y, 6);
      (this.info.sprite.material as THREE.SpriteMaterial).opacity = Math.min(1, this.info.t * 2);
      if (this.info.t <= 0) this.clearInfo();
    }

    // the focus drives the starfield parallax
    return this.cam;
  }

  /** Launch dive: distance boosted ahead of the route spot; resolves when done. */
  private launchOffset(dt: number): number {
    const l = this.launching!;
    l.t += dt;
    const k = l.t / GALAXY.launchSec;
    if (k >= 1) {
      this.launching = null;
      l.resolve();
      return 0;
    }
    if (l.t - dt <= 0) this.gfx.pulseBloom(0.5);
    return k * k * GALAXY.launchDistance;
  }

  private placeShip(ahead: number): void {
    const s = this.ship;
    const p = this.routePoint(this.u);
    const n = this.planets.length;
    const tan = this.curve.getTangent(THREE.MathUtils.clamp(this.u / Math.max(1, n - 1), 0, 1));
    // angle 0 = nose up (+y)
    const angle = Math.atan2(-tan.x, tan.y);
    const bob = this.flight || this.launching ? 0 : Math.sin(this.time * 1.2) * 0.5;
    // drawn in front of the planets (z toward the camera)
    s.group.position.set(p.x + tan.x * ahead, p.y + tan.y * ahead + bob, GALAXY.planetRadius * 1.5 + 2);
    s.group.rotation.set(0, 0, angle);
  }

  dispose(): void {
    this.clearInfo();
    for (const p of this.planets) {
      p.mat.dispose();
      if (p.ring) (p.ring.material as THREE.Material).dispose();
      (p.label.material as THREE.SpriteMaterial).dispose();
    }
    this.routeDone.geometry.dispose();
    this.routeAhead.geometry.dispose();
    this.routeMat.dispose();
    this.routeAheadMat.dispose();
    this.sphere.dispose();
    this.ringGeo.dispose();
    this.ship.dispose();
    this.world.removeFromParent();
    this.labelsGroup.removeFromParent();
    const f = this.flight;
    this.flight = null;
    f?.resolve();
    const l = this.launching;
    this.launching = null;
    l?.resolve();
  }
}
