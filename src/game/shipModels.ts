import * as THREE from 'three';
import { disposeObject } from './graphics';

/**
 * Procedural ship bodies. Conventions: nose points +Y, "up" (toward the
 * camera) is +Z, about 5 units long. Each model has a lit metallic hull plus
 * neon accents (MeshBasic/LineBasic, pushed above 1.0 so they bloom) that are
 * recolored every frame from the loadout color.
 */
export interface ShipModel {
  readonly root: THREE.Group;
  /** Local exhaust points (trail emitters). */
  readonly engines: THREE.Vector3[];
  /** Local laser spawn point. */
  readonly muzzle: THREE.Vector3;
  update(time: number, thrust: number, color: THREE.Color): void;
  dispose(): void;
}

type P = [number, number];

interface Mats {
  hull: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  accent: THREE.MeshBasicMaterial;
  line: THREE.LineBasicMaterial;
  engine: THREE.MeshBasicMaterial;
}

function makeMats(): Mats {
  return {
    hull: new THREE.MeshStandardMaterial({ color: 0xa3adc0, metalness: 0.85, roughness: 0.36 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x323a4c, metalness: 0.7, roughness: 0.45 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b1530, metalness: 0.2, roughness: 0.08, emissive: 0x000000 }),
    accent: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    line: new THREE.LineBasicMaterial({ color: 0xffffff }),
    engine: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  };
}

/** Mirror a right-hand half outline (nose on the axis → tail on the axis) into a full loop. */
function mirror(half: P[]): THREE.Vector2[] {
  const pts = half.map(([x, y]) => new THREE.Vector2(x, y));
  for (let i = half.length - 2; i >= 1; i--) pts.push(new THREE.Vector2(-half[i][0], half[i][1]));
  return pts;
}

function extrude(pts: THREE.Vector2[], depth: number, bevel: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

function loop(pts: THREE.Vector2[], z: number, mat: THREE.LineBasicMaterial, grow = 0): THREE.LineLoop {
  const g = new THREE.BufferGeometry().setFromPoints(
    pts.map((p) => {
      const l = p.length();
      const k = l > 0 ? (l + grow) / l : 1;
      return new THREE.Vector3(p.x * k, p.y * k, z);
    }),
  );
  return new THREE.LineLoop(g, mat);
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

class BaseModel implements ShipModel {
  readonly root = new THREE.Group();
  engines: THREE.Vector3[] = [];
  muzzle = new THREE.Vector3(0, 2.6, 0);
  readonly mats = makeMats();
  /** Extra per-frame animation hook. */
  animate: ((time: number, thrust: number, color: THREE.Color) => void) | null = null;
  private tmp = new THREE.Color();

  update(time: number, thrust: number, color: THREE.Color): void {
    const m = this.mats;
    m.accent.color.copy(color).multiplyScalar(2.1);
    m.line.color.copy(color).multiplyScalar(2.6);
    this.tmp.copy(color).lerp(new THREE.Color(1, 1, 1), 0.35);
    m.engine.color.copy(this.tmp).multiplyScalar(0.9 + thrust * 2.4 + Math.sin(time * 40) * 0.15 * thrust);
    m.glass.emissive.copy(color).multiplyScalar(0.28);
    this.animate?.(time, thrust, color);
  }

  dispose(): void {
    disposeObject(this.root, false);
    for (const mat of Object.values(this.mats)) (mat as THREE.Material).dispose();
  }
}

// ---------------------------------------------------------------------------

function buildArrow(): BaseModel {
  const s = new BaseModel();
  const m = s.mats;
  const outline = mirror([
    [0, 2.7],
    [0.55, 1.0],
    [2.0, -1.55],
    [1.25, -1.3],
    [0.6, -1.75],
    [0, -1.35],
  ]);
  s.root.add(mesh(extrude(outline, 0.45, 0.16), m.hull));
  // dark center spine
  const spine = mirror([
    [0, 2.1],
    [0.32, 0.6],
    [0.5, -1.2],
    [0, -1.0],
  ]);
  s.root.add(mesh(extrude(spine, 0.3, 0.08), m.dark, 0, 0, 0.3));
  // cockpit canopy
  const canopy = new THREE.SphereGeometry(0.42, 18, 12);
  canopy.scale(0.75, 1.6, 0.7);
  s.root.add(mesh(canopy, m.glass, 0, 0.55, 0.5));
  // neon outline + wing stripes
  s.root.add(loop(outline, 0.41, m.line, 0.02));
  for (const side of [-1, 1]) {
    const stripe = new THREE.BoxGeometry(0.14, 1.5, 0.06);
    const st = mesh(stripe, m.accent, side * 1.1, -0.65, 0.42);
    st.rotation.z = side * 0.95;
    s.root.add(st);
    s.root.add(mesh(new THREE.SphereGeometry(0.16, 10, 8), m.accent, side * 1.9, -1.5, 0.2));
  }
  // engine nozzle
  s.root.add(mesh(new THREE.BoxGeometry(0.7, 0.25, 0.35), m.engine, 0, -1.45, 0.1));
  s.engines = [new THREE.Vector3(0, -1.65, 0)];
  s.muzzle.set(0, 2.8, 0);
  return s;
}

function buildSaucer(): BaseModel {
  const s = new BaseModel();
  const m = s.mats;
  const profile = [
    [0.0, -0.4],
    [1.1, -0.45],
    [2.15, -0.18],
    [2.4, 0.0],
    [2.15, 0.16],
    [1.3, 0.36],
    [0.9, 0.42],
    [0.0, 0.42],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const disc = new THREE.LatheGeometry(profile, 40);
  disc.rotateX(Math.PI / 2);
  s.root.add(mesh(disc, m.hull));
  // dark inner ring panel
  const panel = new THREE.TorusGeometry(1.55, 0.14, 6, 40);
  s.root.add(mesh(panel, m.dark, 0, 0, 0.3));
  // glowing dome
  const dome = new THREE.SphereGeometry(0.95, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.rotateX(Math.PI / 2);
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x0a1030,
    metalness: 0.1,
    roughness: 0.05,
    emissive: 0xffffff,
    emissiveIntensity: 0.9,
    transparent: true,
    opacity: 0.92,
  });
  s.root.add(mesh(dome, domeMat, 0, 0, 0.36));
  // neon rim
  s.root.add(mesh(new THREE.TorusGeometry(2.38, 0.07, 6, 56), m.accent));
  // running lights (two alternating banks)
  const bankA = new THREE.MeshBasicMaterial();
  const bankB = new THREE.MeshBasicMaterial();
  const bulb = new THREE.SphereGeometry(0.13, 8, 6);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    s.root.add(mesh(bulb, i % 2 ? bankA : bankB, Math.cos(a) * 1.85, Math.sin(a) * 1.85, 0.27));
  }
  // nose cannon so the heading reads clearly
  const nose = new THREE.ConeGeometry(0.28, 1.0, 10);
  s.root.add(mesh(nose, m.hull, 0, 2.55, 0));
  s.root.add(mesh(new THREE.BoxGeometry(0.16, 0.7, 0.1), m.accent, 0, 2.1, 0.3));
  // rear engines
  for (const x of [-0.8, 0.8]) s.root.add(mesh(new THREE.SphereGeometry(0.28, 10, 8), m.engine, x, -2.15, 0));
  const tmp = new THREE.Color();
  s.animate = (time, thrust, color) => {
    domeMat.emissive.copy(color).multiplyScalar(0.6 + 0.25 * Math.sin(time * 3) + thrust * 0.3);
    const blink = Math.sin(time * 6) > 0;
    tmp.copy(color).lerp(new THREE.Color(1, 1, 1), 0.5);
    bankA.color.copy(tmp).multiplyScalar(blink ? 2.4 : 0.35);
    bankB.color.copy(tmp).multiplyScalar(blink ? 0.35 : 2.4);
  };
  const baseDispose = s.dispose.bind(s);
  s.dispose = () => {
    baseDispose();
    domeMat.dispose();
    bankA.dispose();
    bankB.dispose();
    bulb.dispose();
  };
  s.engines = [new THREE.Vector3(-0.8, -2.3, 0), new THREE.Vector3(0.8, -2.3, 0)];
  s.muzzle.set(0, 3.0, 0);
  return s;
}

function buildStingray(): BaseModel {
  const s = new BaseModel();
  const m = s.mats;
  const outline = mirror([
    [0, 2.2],
    [0.55, 1.35],
    [1.5, 0.15],
    [3.15, -0.9],
    [2.75, -1.28],
    [1.35, -0.98],
    [0.55, -1.55],
    [0, -1.3],
  ]);
  s.root.add(mesh(extrude(outline, 0.26, 0.12), m.hull));
  // raised center body
  const body = new THREE.SphereGeometry(1, 24, 14);
  body.scale(0.68, 2.0, 0.45);
  s.root.add(mesh(body, m.dark, 0, 0.15, 0.18));
  const canopy = new THREE.SphereGeometry(0.4, 16, 10);
  canopy.scale(0.8, 1.5, 0.7);
  s.root.add(mesh(canopy, m.glass, 0, 0.9, 0.45));
  // tail spikes
  const spike = new THREE.ConeGeometry(0.12, 1.5, 6);
  spike.rotateZ(Math.PI);
  for (const x of [-0.3, 0.3]) s.root.add(mesh(spike, m.hull, x, -2.0, 0));
  s.root.add(loop(outline, 0.26, m.line, 0.02));
  // wing light strips + eyes
  for (const side of [-1, 1]) {
    const strip = mesh(new THREE.BoxGeometry(2.1, 0.1, 0.06), m.accent, side * 1.75, -0.45, 0.26);
    strip.rotation.z = side * -0.56;
    s.root.add(strip);
    s.root.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), m.accent, side * 3.0, -1.02, 0.1));
  }
  for (const x of [-0.45, 0.45]) s.root.add(mesh(new THREE.BoxGeometry(0.4, 0.22, 0.25), m.engine, x, -1.35, 0.05));
  s.engines = [new THREE.Vector3(-0.45, -1.55, 0), new THREE.Vector3(0.45, -1.55, 0)];
  s.muzzle.set(0, 2.4, 0);
  return s;
}

function buildFalcon(): BaseModel {
  const s = new BaseModel();
  const m = s.mats;
  const disc = new THREE.CylinderGeometry(1.75, 1.8, 0.55, 32);
  disc.rotateX(Math.PI / 2);
  s.root.add(mesh(disc, m.hull));
  const cap = new THREE.CylinderGeometry(0.9, 1.3, 0.25, 24);
  cap.rotateX(Math.PI / 2);
  s.root.add(mesh(cap, m.dark, 0, -0.1, 0.38));
  // twin forward prongs
  for (const x of [-0.62, 0.62]) {
    s.root.add(mesh(new THREE.BoxGeometry(0.62, 2.1, 0.42), m.hull, x, 2.0, 0));
    s.root.add(mesh(new THREE.BoxGeometry(0.12, 1.6, 0.08), m.accent, x, 2.05, 0.25));
  }
  // side pods
  const pod = new THREE.CapsuleGeometry(0.36, 1.3, 4, 12);
  for (const x of [-1.95, 1.95]) {
    s.root.add(mesh(pod, m.dark, x, -0.35, 0));
    s.root.add(mesh(new THREE.SphereGeometry(0.15, 8, 6), m.accent, x, 0.62, 0.1));
  }
  // offset cockpit tube
  const tube = new THREE.CylinderGeometry(0.28, 0.28, 1.1, 12);
  const t = mesh(tube, m.hull, 1.55, 1.05, 0.05);
  t.rotation.z = -0.7;
  s.root.add(t);
  s.root.add(mesh(new THREE.SphereGeometry(0.32, 12, 10), m.glass, 1.9, 1.45, 0.1));
  // neon rim + rear engine arc
  s.root.add(mesh(new THREE.TorusGeometry(1.8, 0.06, 6, 48), m.accent, 0, 0, 0.1));
  const arc = new THREE.TorusGeometry(1.55, 0.12, 6, 24, Math.PI * 0.7);
  const arcMesh = mesh(arc, m.engine, 0, 0, 0.05);
  arcMesh.rotation.z = -Math.PI / 2 - Math.PI * 0.35;
  s.root.add(arcMesh);
  s.engines = [-0.9, 0, 0.9].map((x) => new THREE.Vector3(x, -1.75 + Math.abs(x) * 0.3, 0));
  s.muzzle.set(0, 2.7, 0);
  return s;
}

function buildTitan(): BaseModel {
  const s = new BaseModel();
  const m = s.mats;
  const outline = mirror([
    [0, 2.9],
    [0.55, 2.5],
    [0.85, 1.3],
    [1.35, 0.7],
    [1.35, -1.9],
    [0.95, -2.3],
    [0, -2.3],
  ]);
  s.root.add(mesh(extrude(outline, 0.7, 0.14), m.hull));
  // armor plates
  for (const side of [-1, 1]) {
    s.root.add(mesh(new THREE.BoxGeometry(0.55, 2.5, 0.7), m.dark, side * 1.6, -0.55, 0));
    s.root.add(mesh(new THREE.BoxGeometry(0.1, 2.1, 0.08), m.accent, side * 1.6, -0.55, 0.39));
    // turrets
    s.root.add(mesh(new THREE.BoxGeometry(0.3, 0.9, 0.25), m.dark, side * 0.45, 1.8, 0.45));
  }
  // bridge tower
  s.root.add(mesh(new THREE.BoxGeometry(0.95, 1.2, 0.55), m.dark, 0, -0.7, 0.6));
  s.root.add(mesh(new THREE.BoxGeometry(0.8, 0.14, 0.1), m.accent, 0, -0.2, 0.9));
  s.root.add(loop(outline, 0.5, m.line, 0.02));
  // twin engines
  const nac = new THREE.CylinderGeometry(0.46, 0.52, 1.3, 16);
  const ring = new THREE.TorusGeometry(0.47, 0.07, 6, 20);
  ring.rotateX(Math.PI / 2);
  for (const x of [-0.8, 0.8]) {
    s.root.add(mesh(nac, m.hull, x, -2.45, 0));
    s.root.add(mesh(ring, m.accent, x, -2.05, 0));
    const glow = new THREE.CircleGeometry(0.4, 16);
    glow.rotateX(Math.PI / 2);
    s.root.add(mesh(glow, m.engine, x, -3.11, 0));
    s.root.add(mesh(new THREE.SphereGeometry(0.34, 10, 8), m.engine, x, -3.05, 0));
  }
  s.engines = [new THREE.Vector3(-0.8, -3.2, 0), new THREE.Vector3(0.8, -3.2, 0)];
  s.muzzle.set(0, 3.0, 0);
  return s;
}

function buildPhoenix(): BaseModel {
  const s = new BaseModel();
  const m = s.mats;
  const body = mirror([
    [0, 2.9],
    [0.3, 2.0],
    [0.48, 0.4],
    [0.36, -1.5],
    [0, -2.1],
  ]);
  s.root.add(mesh(extrude(body, 0.5, 0.14), m.hull));
  s.root.add(loop(body, 0.43, m.line, 0.02));
  const canopy = new THREE.SphereGeometry(0.3, 14, 10);
  canopy.scale(0.9, 2.0, 0.8);
  s.root.add(mesh(canopy, m.glass, 0, 1.45, 0.42));
  // crest
  s.root.add(mesh(new THREE.BoxGeometry(0.1, 1.6, 0.08), m.accent, 0, 0.1, 0.46));

  // feathered wings: each feather pivots at the body
  const featherLens = [3.0, 2.75, 2.35, 1.85];
  const baseAngles = [0.28, 0.0, -0.3, -0.62];
  const feathers: Array<{ pivot: THREE.Group; base: number; side: number; idx: number }> = [];
  featherLens.forEach((L, idx) => {
    const leaf = [
      new THREE.Vector2(0, -0.14),
      new THREE.Vector2(L * 0.55, -0.24),
      new THREE.Vector2(L, 0),
      new THREE.Vector2(L * 0.6, 0.2),
      new THREE.Vector2(0, 0.14),
    ];
    const geo = extrude(leaf, 0.14, 0.05);
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.35, 0.55 - idx * 0.42, -0.05 + idx * 0.02);
      const f = mesh(geo, idx % 2 ? m.dark : m.hull);
      // the left pivot is flipped about Y (z negated), so its edge goes on the other face
      const edge = loop(leaf, side < 0 ? -0.13 : 0.13, m.line, 0.02);
      pivot.add(f, edge);
      if (side < 0) {
        // mirror about the ship axis without flipping face winding
        pivot.rotation.y = Math.PI;
      }
      s.root.add(pivot);
      feathers.push({ pivot, base: baseAngles[idx], side, idx });
    }
  });
  // tail flame feathers
  const tail = new THREE.ConeGeometry(0.16, 1.1, 6);
  tail.rotateZ(Math.PI);
  const tails: THREE.Mesh[] = [];
  for (const [x, r] of [
    [-0.28, 0.35],
    [0, 0],
    [0.28, -0.35],
  ] as P[]) {
    const t = mesh(tail, m.accent, x, -2.45, 0);
    t.rotation.z = r;
    s.root.add(t);
    tails.push(t);
  }
  s.root.add(mesh(new THREE.SphereGeometry(0.28, 10, 8), m.engine, 0, -2.0, 0));

  let flare = 0;
  s.animate = (time, thrust) => {
    flare += (thrust - flare) * 0.12;
    for (const f of feathers) {
      const spread = flare * (0.22 + f.idx * 0.08) + Math.sin(time * 2.2 + f.idx) * 0.03;
      // right side: positive z rotation lifts the feather forward; left is mirrored via rotation.y
      f.pivot.rotation.z = f.base + spread * (f.idx < 2 ? 1 : -1);
    }
    for (let i = 0; i < tails.length; i++) tails[i].scale.set(1, 1 + flare * (0.6 + 0.2 * Math.sin(time * 30 + i)), 1);
  };
  s.engines = [new THREE.Vector3(0, -2.3, 0)];
  s.muzzle.set(0, 3.0, 0);
  return s;
}

const BUILDERS: Record<string, () => BaseModel> = {
  arrow: buildArrow,
  saucer: buildSaucer,
  stingray: buildStingray,
  falcon: buildFalcon,
  titan: buildTitan,
  phoenix: buildPhoenix,
};

export function buildShipModel(body: string): ShipModel {
  return (BUILDERS[body] ?? buildArrow)();
}
