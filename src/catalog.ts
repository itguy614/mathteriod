import type { ItemKind, ShipLoadout } from './types';

/**
 * Hangar catalog. ui/ uses it for the shop; game/ renders every id listed here.
 * Prices are in Stardust. price 0 = owned by everyone from the start.
 * Starter bodies: the one picked at profile creation is free; the others cost their price.
 */
export interface CatalogItem {
  id: string;
  kind: ItemKind;
  name: string;
  description: string;
  price: number;
  /** For kind 'color': primary hex; 'rainbow' animates through hues. */
  hex?: string;
  /** Bodies marked starter are the three choices at profile creation. */
  starter?: boolean;
}

export const CATALOG: CatalogItem[] = [
  // Bodies
  { id: 'arrow', kind: 'body', name: 'Arrow', description: 'Classic sleek triangle fighter.', price: 200, starter: true },
  { id: 'saucer', kind: 'body', name: 'Saucer', description: 'Round flying disc with a glowing dome.', price: 200, starter: true },
  { id: 'stingray', kind: 'body', name: 'Stingray', description: 'Wide swept wings, low and fast-looking.', price: 200, starter: true },
  { id: 'falcon', kind: 'body', name: 'Falcon', description: 'Twin-prong freighter with side pods.', price: 400 },
  { id: 'titan', kind: 'body', name: 'Titan', description: 'Heavy armored cruiser with twin engines.', price: 800 },
  { id: 'phoenix', kind: 'body', name: 'Phoenix', description: 'Feathered wings that flare when thrusting.', price: 1500 },

  // Colors (hull glow and laser colors)
  { id: 'cyan', kind: 'color', name: 'Cyan', description: 'Cool neon cyan.', price: 0, hex: '#22e4ff' },
  { id: 'magenta', kind: 'color', name: 'Magenta', description: 'Hot neon pink.', price: 100, hex: '#ff3bd4' },
  { id: 'lime', kind: 'color', name: 'Lime', description: 'Electric green.', price: 100, hex: '#8dff3b' },
  { id: 'orange', kind: 'color', name: 'Blaze', description: 'Burning orange.', price: 150, hex: '#ff8a1f' },
  { id: 'violet', kind: 'color', name: 'Violet', description: 'Deep ultraviolet.', price: 150, hex: '#9b5bff' },
  { id: 'gold', kind: 'color', name: 'Gold', description: 'Shiny champion gold.', price: 300, hex: '#ffd23b' },
  { id: 'white', kind: 'color', name: 'Starlight', description: 'Pure bright white.', price: 300, hex: '#f4f7ff' },
  { id: 'rainbow', kind: 'color', name: 'Rainbow', description: 'Cycles through every color.', price: 1000, hex: 'rainbow' },

  // Laser styles (cosmetic only: same hitbox and speed)
  { id: 'pulse', kind: 'laser', name: 'Pulse', description: 'Short glowing bolts.', price: 0 },
  { id: 'twin', kind: 'laser', name: 'Twin Beam', description: 'Two parallel streaks.', price: 250 },
  { id: 'plasma', kind: 'laser', name: 'Plasma Orb', description: 'Wobbling balls of plasma.', price: 500 },
  { id: 'lightning', kind: 'laser', name: 'Lightning', description: 'Crackling zig-zag bolts.', price: 900 },

  // Engine trails
  { id: 'ion', kind: 'trail', name: 'Ion', description: 'Soft glowing exhaust.', price: 0 },
  { id: 'flame', kind: 'trail', name: 'Flame', description: 'Roaring fire exhaust.', price: 200 },
  { id: 'sparkle', kind: 'trail', name: 'Sparkle', description: 'Twinkling star particles.', price: 400 },
  { id: 'comet', kind: 'trail', name: 'Comet', description: 'Long rainbow comet tail.', price: 800 },

  // Light perks (small help, never answers the math)
  { id: 'shield', kind: 'perk', name: 'Bubble Shield', description: 'Absorbs the first collision each level.', price: 600 },
  { id: 'agile', kind: 'perk', name: 'Agile Thrusters', description: 'Turn and accelerate a bit faster.', price: 450 },
];

export function getItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

export function defaultLoadout(body = 'arrow'): ShipLoadout {
  return { body, color: 'cyan', laser: 'pulse', laserColor: 'cyan', trail: 'ion', perks: [] };
}

/** Collisions allowed before a level fails (vision: three). */
export const HITS_ALLOWED = 3;
