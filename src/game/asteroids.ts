import * as THREE from 'three';
import { ASTEROID, ENTRY, type AsteroidSize } from './constants';
import { wrapCoord, type Graphics } from './graphics';
import { makeLabelSprite, type LabelFactory } from './labels';

const VARIANTS = 6;
const RIM_BASE = new THREE.Color(0x8f7bff);
/** >1 pushes the neon edges past the bloom threshold so rocks read as "neon vector". */
const RIM_GLOW = 3.2;
const RIM_HINT = new THREE.Color(0xffd23b);
const WHITE = new THREE.Color(1, 1, 1);

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

/** Offsets of the wrapped copies currently drawn (at most 3: horizontal, vertical, corner). */
interface Ghost {
  mesh: THREE.Mesh;
  ox: number;
  oy: number;
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
  /** Teaching hint: the rim pulses gold while true (the answer, after repeated misses). */
  hint = false;
  private hintPhase = 0;
  fadeIn = 0;
  /**
   * Flying in from off-screen: no wrapping, can't be shot, can't hit the ship.
   * Ends once the whole rock is inside the visible field.
   */
  entering = false;
  /** Seconds before an entering rock starts moving (it waits off-screen, hidden). */
  entryDelay = 0;
  private entryAge = 0;
  private entryDir = new THREE.Vector2();
  private entrySpeed0 = 0;
  private cruise = 0;
  private spinAxis: THREE.Vector3;
  private spinRate: number;
  private mesh: THREE.Mesh;
  private ghosts: Ghost[] = [];
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

  /** Radius for laser hits (generous). */
  get hitRadius(): number {
    return this.radius * ASTEROID.laserHitScale;
  }

  /** Radius for ship collisions (forgiving). */
  get bodyRadius(): number {
    return this.radius * ASTEROID.shipHitScale;
  }

  /** Can lasers, taps and the ship interact with this rock yet? */
  get active(): boolean {
    return this.alive && !this.entering;
  }

  /**
   * Fly in along `dirAngle` from the current (off-screen) position, arriving fully
   * on screen after about `duration` seconds and then drifting on at `cruise`.
   * `distance` is how far it must travel to be fully inside.
   */
  startEntry(dirAngle: number, cruise: number, distance: number, duration: number, delay: number): void {
    this.entering = true;
    this.entryDelay = Math.max(0, delay);
    this.entryAge = 0;
    this.entryDir.set(Math.cos(dirAngle), Math.sin(dirAngle));
    this.cruise = cruise;
    // distance(T) = c·T + (v0 − c)(1 − e^(−kT))/k  →  solve for v0
    const k = ENTRY.decay;
    const T = Math.max(0.1, duration);
    const extra = Math.max(0, distance - cruise * T);
    this.entrySpeed0 = cruise + (extra * k) / (1 - Math.exp(-k * T));
    this.vel.set(this.entryDir.x * this.entrySpeed0, this.entryDir.y * this.entrySpeed0);
    this.fadeIn = 1;
  }

  /** Is any part of the rock inside the visible field? */
  isOnScreen(halfW: number, halfH: number): boolean {
    return Math.abs(this.pos.x) - this.radius < halfW && Math.abs(this.pos.y) - this.radius < halfH;
  }

  /** Is the whole rock inside the visible field? */
  isFullyInside(halfW: number, halfH: number, pad = 0): boolean {
    return Math.abs(this.pos.x) + this.radius + pad <= halfW && Math.abs(this.pos.y) + this.radius + pad <= halfH;
  }

  /**
   * Every place this rock is drawn: its own position plus the wrapped copies
   * shown while it straddles a screen edge (so shots and collisions match what
   * the player sees).
   */
  images(out: THREE.Vector2[]): number {
    out[0] ??= new THREE.Vector2();
    out[0].copy(this.pos);
    let n = 1;
    for (const g of this.ghosts) {
      if (!g.mesh.visible) continue;
      out[n] ??= new THREE.Vector2();
      out[n].set(this.pos.x + g.ox, this.pos.y + g.oy);
      n++;
    }
    return n;
  }

  update(dt: number, halfW: number, halfH: number): void {
    if (this.entering) {
      this.updateEntry(dt, halfW, halfH);
    } else {
      const sp = this.vel.length();
      if (sp > ASTEROID.maxSpeed) this.vel.multiplyScalar(ASTEROID.maxSpeed / sp);
      // wrap when the center crosses the edge; the wrapped copy (ghost) shows the rest
      this.pos.x = wrapCoord(this.pos.x + this.vel.x * dt, halfW, 0);
      this.pos.y = wrapCoord(this.pos.y + this.vel.y * dt, halfH, 0);
    }
    this.tmpQ.setFromAxisAngle(this.spinAxis, this.spinRate * dt);
    this.mesh.quaternion.premultiply(this.tmpQ);
    if (this.shakeT > 0) this.shakeT = Math.max(0, this.shakeT - dt);
    if (this.flashT > 0) this.flashT = Math.max(0, this.flashT - dt);
    this.hintPhase = this.hint ? this.hintPhase + dt : 0;
    if (this.fadeIn < 1) this.fadeIn = Math.min(1, this.fadeIn + dt * 1.5);

    let ox = 0;
    let oy = 0;
    if (this.shakeT > 0) {
      const k = this.shakeT / 0.45;
      ox = Math.sin(this.shakeT * 70) * 0.7 * k;
      oy = Math.cos(this.shakeT * 55) * 0.25 * k;
    }
    this.group.position.set(this.pos.x + ox, this.pos.y + oy, 0);
    this.mesh.scale.setScalar(this.radius * (0.3 + 0.7 * easeOut(this.fadeIn)));
    this.group.visible = !(this.entering && this.entryDelay > 0);
    const f = this.flashT > 0 ? this.flashT / 0.35 : 0;
    this.rimMat.color.copy(RIM_BASE).lerp(WHITE, f).multiplyScalar(RIM_GLOW + f * 2.5);
    if (this.hint) {
      const pulse = 0.5 + 0.5 * Math.sin(this.hintPhase * 6);
      this.rimMat.color.copy(RIM_HINT).multiplyScalar(RIM_GLOW + 1 + pulse * 3);
    }
    this.rimMat.opacity = this.fadeIn;
    this.updateGhosts(halfW, halfH);
  }

  private updateEntry(dt: number, halfW: number, halfH: number): void {
    if (this.entryDelay > 0) {
      this.entryDelay -= dt;
      if (this.entryDelay > 0) return;
      dt = -this.entryDelay;
      this.entryDelay = 0;
    }
    this.entryAge += dt;
    const sp = this.cruise + (this.entrySpeed0 - this.cruise) * Math.exp(-ENTRY.decay * this.entryAge);
    this.vel.set(this.entryDir.x * sp, this.entryDir.y * sp);
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    if (this.isFullyInside(halfW, halfH) || this.entryAge > ENTRY.timeout) {
      this.entering = false;
      this.vel.set(this.entryDir.x * this.cruise, this.entryDir.y * this.cruise);
      this.pos.x = wrapCoord(this.pos.x, halfW, 0);
      this.pos.y = wrapCoord(this.pos.y, halfH, 0);
    }
  }

  private updateGhosts(halfW: number, halfH: number): void {
    let gx = 0;
    let gy = 0;
    if (!this.entering) {
      if (this.pos.x > halfW - this.radius) gx = -2 * halfW;
      else if (this.pos.x < -halfW + this.radius) gx = 2 * halfW;
      if (this.pos.y > halfH - this.radius) gy = -2 * halfH;
      else if (this.pos.y < -halfH + this.radius) gy = 2 * halfH;
    }
    const want: Array<[number, number]> = [];
    if (gx) want.push([gx, 0]);
    if (gy) want.push([0, gy]);
    if (gx && gy) want.push([gx, gy]);
    while (this.ghosts.length < want.length) {
      const mesh = this.mesh.clone(); // shares geometry + materials
      this.group.add(mesh);
      this.ghosts.push({ mesh, ox: 0, oy: 0 });
    }
    for (let i = 0; i < this.ghosts.length; i++) {
      const g = this.ghosts[i];
      const w = want[i];
      g.mesh.visible = !!w;
      if (!w) continue;
      g.ox = w[0];
      g.oy = w[1];
      g.mesh.position.set(w[0], w[1], 0);
      g.mesh.quaternion.copy(this.mesh.quaternion);
      g.mesh.scale.copy(this.mesh.scale);
    }
  }

  /**
   * Keep the number fully on screen: it follows the rock, clamped inside the
   * visible field (insets in world units). Hidden only while the rock itself is
   * completely off screen (waiting to fly in).
   */
  placeLabel(halfW: number, halfH: number, edge: number, top: number): void {
    const lbl = this.label;
    if (!lbl) return;
    const mat = lbl.material as THREE.SpriteMaterial;
    const visible = this.group.visible && this.isOnScreen(halfW, halfH);
    lbl.visible = visible;
    if (!visible) return;
    const hw = lbl.scale.x / 2;
    const hh = lbl.scale.y / 2;
    const x = clampRange(this.group.position.x, -halfW + edge + hw, halfW - edge - hw);
    const y = clampRange(this.group.position.y, -halfH + edge + hh, halfH - top - hh);
    lbl.position.set(x, y, 5);
    mat.opacity = this.fadeIn;
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

/** Axis-aligned rect in world units. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function wrapDelta(d: number, period: number): number {
  return d - period * Math.round(d / period);
}

function clampSpeed(a: Asteroid): void {
  const sp = a.vel.length();
  if (sp > ASTEROID.maxSpeed) a.vel.multiplyScalar(ASTEROID.maxSpeed / sp);
}

function clampRange(v: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return v < lo ? lo : v > hi ? hi : v;
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
    this.layoutLabels();
    return a;
  }

  /**
   * Spawn a rock just outside the screen at (x, y) that flies in along `dirAngle`
   * after `delay` seconds and then drifts at `cruise` speed.
   */
  spawnEntering(
    size: AsteroidSize,
    value: number | null,
    x: number,
    y: number,
    dirAngle: number,
    cruise: number,
    duration: number,
    delay: number,
  ): Asteroid {
    const a = this.spawn(size, value, x, y, 0, 0);
    a.pos.set(x, y); // spawn() wrapped it on screen; it starts outside
    const { halfW, halfH } = this.gfx;
    // distance along the heading until the whole rock is inside (plus a little)
    const dx = Math.cos(dirAngle);
    const dy = Math.sin(dirAngle);
    let need = 0;
    const r = a.radius + 0.3;
    if (Math.abs(x) + r > halfW && Math.abs(dx) > 1e-3) need = Math.max(need, (Math.abs(x) + r - halfW) / Math.abs(dx));
    if (Math.abs(y) + r > halfH && Math.abs(dy) > 1e-3) need = Math.max(need, (Math.abs(y) + r - halfH) / Math.abs(dy));
    a.startEntry(dirAngle, cruise, need, duration, delay);
    a.update(0, halfW, halfH);
    this.layoutLabels();
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
    this.layoutLabels();
  }

  private sizeLabel(a: Asteroid): void {
    if (!a.label) return;
    const h = this.gfx.labelSize(ASTEROID.labelHeight[a.size], ASTEROID.labelMinPx[a.size]);
    a.label.scale.set(h * a.labelAspect, h, 1);
  }

  private refreshLabelSizes(): void {
    for (const a of this.list) this.sizeLabel(a);
    this.layoutLabels();
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

  /** Screen areas labels must stay out of (touch controls, hint pill), in world units. */
  private blockers: Rect[] = [];

  setBlockers(rects: Rect[]): void {
    this.blockers = rects;
  }

  update(dt: number): void {
    for (const a of this.list) a.update(dt, this.gfx.halfW, this.gfx.halfH);
    if (dt > 0) this.separate(dt);
    this.layoutLabels();
  }

  /**
   * Soft rock-to-rock separation (only rocks that have finished flying in): an
   * inelastic bounce of the closing speed plus a gentle positional push for any
   * leftover overlap. Wrap-aware, and speeds stay under ASTEROID.maxSpeed.
   */
  private separate(dt: number): void {
    const { halfW, halfH } = this.gfx;
    const S = ASTEROID.separation;
    const rocks = this.list.filter((a) => a.active);
    for (let i = 0; i < rocks.length; i++) {
      const a = rocks[i];
      for (let j = i + 1; j < rocks.length; j++) {
        const b = rocks[j];
        let dx = wrapDelta(b.pos.x - a.pos.x, 2 * halfW);
        let dy = wrapDelta(b.pos.y - a.pos.y, 2 * halfH);
        const want = a.radius + b.radius + S.gap;
        const d2 = dx * dx + dy * dy;
        if (d2 >= want * want) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) {
          const r = Math.random() * Math.PI * 2;
          dx = Math.cos(r);
          dy = Math.sin(r);
          d = 1;
        } else {
          dx /= d;
          dy /= d;
        }
        const ma = a.radius * a.radius;
        const mb = b.radius * b.radius;
        const wa = mb / (ma + mb); // share of the correction the lighter rock takes
        const wb = ma / (ma + mb);
        // closing speed along the normal → bounce (softly)
        const vn = (b.vel.x - a.vel.x) * dx + (b.vel.y - a.vel.y) * dy;
        if (vn < 0) {
          const j2 = -(1 + S.restitution) * vn;
          a.vel.x -= dx * j2 * wa;
          a.vel.y -= dy * j2 * wa;
          b.vel.x += dx * j2 * wb;
          b.vel.y += dy * j2 * wb;
        }
        // leftover overlap: ease apart
        const push = (want - d) * Math.min(1, S.push * dt);
        a.pos.x -= dx * push * wa;
        a.pos.y -= dy * push * wa;
        b.pos.x += dx * push * wb;
        b.pos.y += dy * push * wb;
        clampSpeed(a);
        clampSpeed(b);
      }
    }
  }

  /**
   * Place every number label: on its rock, clamped inside the screen, then pushed
   * out of touch controls / the hint pill, then apart from each other vertically
   * so two numbers never overlap (e.g. right after a split).
   */
  private layoutLabels(): void {
    const { halfW, halfH } = this.gfx;
    const px = this.gfx.pxPerUnit || 1;
    const edge = ASTEROID.labelEdgePx / px;
    const top = ASTEROID.labelTopPx / px;
    const gap = ASTEROID.labelGapPx / px;
    const vis: Array<{ a: Asteroid; x: number; y: number; hw: number; hh: number }> = [];
    for (const a of this.list) {
      a.placeLabel(halfW, halfH, edge, top);
      if (a.label?.visible) {
        vis.push({ a, x: a.label.position.x, y: a.label.position.y, hw: a.label.scale.x / 2, hh: a.label.scale.y / 2 });
      }
    }
    if (vis.length === 0) return;
    const minX = -halfW + edge;
    const maxX = halfW - edge;
    const minY = -halfH + edge;
    const maxY = halfH - top;
    const clampL = (l: (typeof vis)[number]) => {
      l.x = clampRange(l.x, minX + l.hw, maxX - l.hw);
      l.y = clampRange(l.y, minY + l.hh, maxY - l.hh);
    };
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      // out of the controls: take the smallest escape that stays on screen
      for (const l of vis) {
        for (const r of this.blockers) {
          const ox = Math.min(l.x + l.hw, r.x1 + gap) - Math.max(l.x - l.hw, r.x0 - gap);
          const oy = Math.min(l.y + l.hh, r.y1 + gap) - Math.max(l.y - l.hh, r.y0 - gap);
          if (ox <= 0 || oy <= 0) continue;
          const opts = [
            { x: l.x, y: r.y1 + gap + l.hh }, // above
            { x: l.x, y: r.y0 - gap - l.hh }, // below
            { x: r.x0 - gap - l.hw, y: l.y }, // left
            { x: r.x1 + gap + l.hw, y: l.y }, // right
          ].filter((o) => o.x - l.hw >= minX - 1e-3 && o.x + l.hw <= maxX + 1e-3 && o.y - l.hh >= minY - 1e-3 && o.y + l.hh <= maxY + 1e-3);
          if (opts.length === 0) continue;
          opts.sort((p, q) => Math.hypot(p.x - l.x, p.y - l.y) - Math.hypot(q.x - l.x, q.y - l.y));
          l.x = opts[0].x;
          l.y = opts[0].y;
          moved = true;
        }
      }
      // apart from each other (vertically)
      for (let i = 0; i < vis.length; i++) {
        for (let j = i + 1; j < vis.length; j++) {
          const p = vis[i];
          const q = vis[j];
          const ox = Math.min(p.x + p.hw, q.x + q.hw) - Math.max(p.x - p.hw, q.x - q.hw);
          const oy = Math.min(p.y + p.hh, q.y + q.hh) + gap - Math.max(p.y - p.hh, q.y - q.hh);
          if (ox <= 0 || oy <= 0) continue;
          const [hi, lo] = p.y >= q.y ? [p, q] : [q, p];
          hi.y += oy / 2;
          lo.y -= oy / 2;
          // at a screen edge, the other one takes the whole move
          if (hi.y + hi.hh > maxY) {
            lo.y -= hi.y + hi.hh - maxY;
            hi.y = maxY - hi.hh;
          }
          if (lo.y - lo.hh < minY) {
            hi.y += minY - (lo.y - lo.hh);
            lo.y = minY + lo.hh;
          }
          moved = true;
        }
      }
      for (const l of vis) clampL(l);
      if (!moved) break;
    }
    for (const l of vis) l.a.label!.position.set(l.x, l.y, 5);
  }

  /** Does any rock (or its wrapped copy) overlap this world rect? */
  rockUnder(r: Rect): boolean {
    const imgs: THREE.Vector2[] = [];
    for (const a of this.list) {
      if (!a.group.visible || a.value === null) continue;
      const n = a.images(imgs);
      for (let i = 0; i < n; i++) {
        const cx = clampRange(imgs[i].x, r.x0, r.x1);
        const cy = clampRange(imgs[i].y, r.y0, r.y1);
        if (Math.hypot(imgs[i].x - cx, imgs[i].y - cy) < a.radius * 0.85) return true;
      }
    }
    return false;
  }

  /** Any rock still flying in (or waiting to)? */
  get entering(): boolean {
    return this.list.some((a) => a.entering);
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
