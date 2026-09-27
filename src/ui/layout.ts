/**
 * Where to frame the hangar ship preview so the menu panel doesn't cover it.
 * Mirrors styles.css: landscape docks the panel on the right, portrait at the bottom.
 */
export function hangarCenter(): { x: number; y: number } {
  return window.innerWidth >= window.innerHeight ? { x: 0.3, y: 0.5 } : { x: 0.5, y: 0.26 };
}
