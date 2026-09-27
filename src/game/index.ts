import './game.css';
import type { AudioBus, GameEngine } from '../types';
import { Engine } from './engine';

export { WORLD_SPAN } from './constants';

/**
 * Create the Mathteroid arcade engine inside `container` (e.g. #game-root).
 * It immediately shows attract mode (starfield + drifting rocks).
 */
export function createGame(container: HTMLElement, audio: AudioBus): GameEngine {
  const engine = new Engine(container, audio);
  // Automated playtests drive the game through this; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __mathteroid: Engine }).__mathteroid = engine;
  return engine;
}
