import * as THREE from 'three';
import type { Particles } from './particles';
import { rainbowAt } from './colors';

interface TrailStyle {
  rate: number; // particles / second at full thrust per engine
  speed: number;
  spread: number; // radians
  life: number;
  size0: number;
  size1: number;
  shape: 0 | 1;
  twinkle: boolean;
  drag: number;
  colors(accent: THREE.Color, time: number, out0: THREE.Color, out1: THREE.Color): void;
}

const WHITE = new THREE.Color(1, 1, 1);

const STYLES: Record<string, TrailStyle> = {
  ion: {
    rate: 70,
    speed: 11,
    spread: 0.22,
    life: 0.38,
    size0: 1.0,
    size1: 0.15,
    shape: 0,
    twinkle: false,
    drag: 2,
    colors(accent, _t, a, b) {
      a.copy(accent).lerp(WHITE, 0.35).multiplyScalar(1.9);
      b.copy(accent).multiplyScalar(0.35);
    },
  },
  flame: {
    rate: 120,
    speed: 15,
    spread: 0.34,
    life: 0.32,
    size0: 1.45,
    size1: 0.25,
    shape: 0,
    twinkle: false,
    drag: 2.5,
    colors(_a, _t, a, b) {
      a.setRGB(1.0, 0.8, 0.35).multiplyScalar(2.3);
      b.setRGB(0.9, 0.12, 0.02).multiplyScalar(0.9);
    },
  },
  sparkle: {
    rate: 42,
    speed: 6,
    spread: 1.0,
    life: 0.8,
    size0: 1.1,
    size1: 0.0,
    shape: 1,
    twinkle: true,
    drag: 1.2,
    colors(accent, _t, a, b) {
      const r = Math.random();
      if (r < 0.34) a.setRGB(1, 1, 1);
      else if (r < 0.67) a.setRGB(1, 0.85, 0.35);
      else a.copy(accent);
      a.multiplyScalar(2.2);
      b.copy(a).multiplyScalar(0.6);
    },
  },
  comet: {
    rate: 110,
    speed: 4.5,
    spread: 0.15,
    life: 1.15,
    size0: 1.35,
    size1: 0.2,
    shape: 0,
    twinkle: false,
    drag: 0.8,
    colors(_a, t, a, b) {
      rainbowAt(t * 0.6, a).multiplyScalar(2.0);
      rainbowAt(t * 0.6 + 0.25, b).multiplyScalar(0.5);
    },
  },
};

const c0 = new THREE.Color();
const c1 = new THREE.Color();

/**
 * Emit exhaust particles for one engine. `acc` carries the fractional particle
 * count between frames (one entry per engine). Directions are world XY.
 */
export function emitTrail(
  particles: Particles,
  trailId: string,
  acc: { v: number },
  x: number,
  y: number,
  z: number,
  dirX: number,
  dirY: number,
  baseVx: number,
  baseVy: number,
  accent: THREE.Color,
  amount: number,
  dt: number,
  time: number,
  scale = 1,
  intensity = 1,
): void {
  const st = STYLES[trailId] ?? STYLES.ion;
  acc.v += st.rate * amount * dt;
  const baseA = Math.atan2(dirY, dirX);
  while (acc.v >= 1) {
    acc.v -= 1;
    const a = baseA + (Math.random() - 0.5) * st.spread * 2;
    const sp = st.speed * (0.6 + Math.random() * 0.6) * scale * (0.5 + amount * 0.5);
    st.colors(accent, time, c0, c1);
    if (intensity !== 1) {
      c0.multiplyScalar(intensity);
      c1.multiplyScalar(intensity);
    }
    const j = (Math.random() - 0.5) * 0.4 * scale;
    particles.spawn({
      x: x + j * -dirY,
      y: y + j * dirX,
      z,
      vx: Math.cos(a) * sp + baseVx,
      vy: Math.sin(a) * sp + baseVy,
      life: st.life * (0.7 + Math.random() * 0.6),
      size0: st.size0 * scale * (0.7 + Math.random() * 0.6),
      size1: st.size1 * scale,
      r: c0.r,
      g: c0.g,
      b: c0.b,
      r2: c1.r,
      g2: c1.g,
      b2: c1.b,
      drag: st.drag,
      shape: st.shape,
      twinkle: st.twinkle,
    });
  }
}
