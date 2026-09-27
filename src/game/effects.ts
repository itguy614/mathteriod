import * as THREE from 'three';
import type { Graphics } from './graphics';
import { makeLabelSprite, type LabelFactory } from './labels';
import type { Particles } from './particles';
import { rainbowAt } from './colors';

interface Popup {
  aspect: number;
  rise: number;
  sprite: THREE.Sprite;
  age: number;
  life: number;
  size: number;
  x: number;
  y: number;
}

const WHITE = new THREE.Color(1, 1, 1);
const ROCK_DUST = new THREE.Color(0.55, 0.48, 0.42);
const ORANGE = new THREE.Color(1.0, 0.55, 0.15);
const RED = new THREE.Color(0.8, 0.12, 0.05);
const RIM = new THREE.Color(0x8f7bff);

/** Explosions, ✓/✗ icon pops, screen flash, celebration fireworks. */
export class Effects {
  private popups: Popup[] = [];
  private pool: THREE.Sprite[] = [];
  private flashEl: HTMLDivElement;
  private tmp = new THREE.Color();
  private tmp2 = new THREE.Color();

  constructor(
    private gfx: Graphics,
    private particles: Particles,
    private labels: LabelFactory,
    container: HTMLElement,
  ) {
    this.flashEl = document.createElement('div');
    this.flashEl.className = 'mt-flash';
    container.appendChild(this.flashEl);
  }

  /** Big, satisfying correct-answer explosion. */
  correctBurst(x: number, y: number, radius: number): void {
    const p = this.particles;
    const s = radius / 4;
    p.burst(x, y, 70, 30 * s, 0.9, 1.5 * s, this.tmp.setRGB(1, 0.95, 0.7), ORANGE, { intensity: 2.0, drag: 2.2 });
    p.burst(x, y, 40, 16 * s, 1.2, 1.3 * s, ROCK_DUST, undefined, { intensity: 1, drag: 1.5 });
    p.burst(x, y, 40, 22 * s, 1.1, 1.0, WHITE, undefined, { intensity: 2.2, drag: 1.2, shape: 1, twinkle: true });
    // expanding ring
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const sp = 26 * s;
      rainbowAt(i / 36, this.tmp2);
      p.spawn({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.55,
        size0: 1.4,
        size1: 0.3,
        r: this.tmp2.r * 2.2,
        g: this.tmp2.g * 2.2,
        b: this.tmp2.b * 2.2,
        drag: 3,
      });
    }
    this.gfx.pulseBloom(0.45);
  }

  /** Small puff when a rock splits or is nudged. */
  rockPuff(x: number, y: number, radius: number): void {
    const s = radius / 4;
    this.particles.burst(x, y, 26, 14 * s, 0.7, 1.1 * s, ROCK_DUST, undefined, { intensity: 1.1 });
    this.particles.burst(x, y, 12, 18 * s, 0.4, 0.8, RIM, undefined, { intensity: 2.2 });
  }

  /** Small sparks where a laser hits. */
  sparks(x: number, y: number, color: THREE.Color): void {
    this.particles.burst(x, y, 10, 14, 0.3, 0.7, color, undefined, { intensity: 2 });
  }

  shipExplosion(x: number, y: number, color: THREE.Color): void {
    const p = this.particles;
    p.burst(x, y, 90, 26, 1.1, 1.5, this.tmp.setRGB(1, 0.9, 0.6), RED, { intensity: 2.6, drag: 1.8 });
    p.burst(x, y, 50, 20, 1.4, 1.1, color, undefined, { intensity: 2.2, drag: 1.2 });
    p.burst(x, y, 30, 34, 0.8, 0.6, WHITE, undefined, { intensity: 2.5, drag: 0.8, shape: 1 });
    this.gfx.pulseBloom(0.5);
  }

  shieldPop(x: number, y: number, color: THREE.Color): void {
    this.particles.burst(x, y, 50, 24, 0.6, 1.0, this.tmp.copy(color).lerp(WHITE, 0.5), color, { intensity: 2.2, drag: 2.5, shape: 1 });
  }

  /** Celebration bursts spread across the field (level cleared). */
  fireworks(n: number): void {
    for (let i = 0; i < n; i++) {
      const x = (Math.random() * 2 - 1) * this.gfx.halfW * 0.75;
      const y = (Math.random() * 2 - 1) * this.gfx.halfH * 0.7;
      rainbowAt(Math.random(), this.tmp);
      this.particles.burst(x, y, 45, 22, 1.2, 1.0, this.tmp, WHITE, { intensity: 2.3, drag: 1.4, shape: i % 2 ? 1 : 0, twinkle: true });
    }
  }

  /** Pop a ✓ or ✗ badge at a world position. */
  popIcon(kind: 'check' | 'cross', x: number, y: number): void {
    const sprite = this.pool.pop() ?? makeLabelSprite(null);
    const mat = sprite.material as THREE.SpriteMaterial;
    mat.map = this.labels.iconTexture(kind);
    mat.needsUpdate = true;
    mat.opacity = 1;
    this.gfx.overlay.add(sprite);
    const size = this.gfx.labelSize(kind === 'check' ? 6.5 : 5, kind === 'check' ? 70 : 56);
    this.popups.push({ sprite, age: 0, life: kind === 'check' ? 0.9 : 0.8, size, x, y, aspect: 1, rise: 3 });
    sprite.position.set(x, y, 8);
  }

  /** Small floating "⚡ Speedy! +N" note (subtle speed feedback; no timers shown anywhere). */
  popSpeedy(bonus: number, x: number, y: number): void {
    const sprite = this.pool.pop() ?? makeLabelSprite(null);
    const mat = sprite.material as THREE.SpriteMaterial;
    const { tex, aspect } = this.labels.speedyTexture(bonus);
    mat.map = tex;
    mat.needsUpdate = true;
    mat.opacity = 1;
    this.gfx.overlay.add(sprite);
    const size = this.gfx.labelSize(2.6, 26);
    const off = this.gfx.labelSize(6.5, 70) * 0.55 + size;
    const hw = (size * aspect) / 2;
    const cx = THREE.MathUtils.clamp(x, -this.gfx.halfW + hw, this.gfx.halfW - hw);
    const cy = Math.min(y + off, this.gfx.halfH - size - 110 / this.gfx.pxPerUnit); // stay below the HUD banner
    this.popups.push({ sprite, age: 0, life: 1.3, size, x: cx, y: cy, aspect, rise: 2 });
    sprite.position.set(cx, cy, 8);
  }

  flash(): void {
    const el = this.flashEl;
    el.classList.remove('mt-flash--on');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('mt-flash--on');
  }

  update(dt: number): void {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.sprite.removeFromParent();
        this.pool.push(p.sprite);
        this.popups.splice(i, 1);
        continue;
      }
      // pop: overshoot then settle, then rise and fade
      const pop = t < 0.2 ? easeOutBack(t / 0.2) : 1;
      const s = p.size * pop;
      p.sprite.scale.set(s * p.aspect, s, 1);
      p.sprite.position.set(p.x, p.y + t * p.rise, 8);
      (p.sprite.material as THREE.SpriteMaterial).opacity = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
    }
  }

  clear(): void {
    for (const p of this.popups) {
      p.sprite.removeFromParent();
      this.pool.push(p.sprite);
    }
    this.popups.length = 0;
  }

  dispose(): void {
    this.clear();
    for (const s of this.pool) (s.material as THREE.SpriteMaterial).dispose();
    this.pool.length = 0;
    this.flashEl.remove();
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
