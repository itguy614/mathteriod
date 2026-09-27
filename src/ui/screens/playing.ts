import { h } from '../dom';
import type { Screen } from '../router';

/**
 * Transparent overlay while a level runs. The game draws its own HUD (including
 * the pause button) and handles input; this screen only lets pointer events through.
 */
export function playingScreen(): Screen {
  const el = h('div', { class: 'playing' });
  return { name: 'playing', el, passThrough: true };
}
