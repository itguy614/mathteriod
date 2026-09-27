import * as THREE from 'three';
import { getItem } from '../catalog';

const FALLBACK = '#22e4ff';

/**
 * A catalog color that may animate (rainbow). `color` is updated in place by
 * `update(time)` so materials can copy from it every frame.
 */
export class DynamicColor {
  readonly color = new THREE.Color();
  readonly rainbow: boolean;
  private readonly offset: number;

  constructor(id: string, offset = 0) {
    const hex = getItem(id)?.hex ?? FALLBACK;
    this.rainbow = hex === 'rainbow';
    this.offset = offset;
    if (!this.rainbow) this.color.set(hex);
    else this.update(0);
  }

  update(time: number): THREE.Color {
    if (this.rainbow) this.color.setHSL((time * 0.12 + this.offset) % 1, 1, 0.55);
    return this.color;
  }
}

/** Hue-cycling helper for effects that want a rainbow regardless of loadout. */
export function rainbowAt(t: number, out: THREE.Color): THREE.Color {
  return out.setHSL(((t % 1) + 1) % 1, 1, 0.58);
}
