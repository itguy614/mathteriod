/**
 * Where to frame the hangar ship preview so the menu panel doesn't cover it.
 * Mirrors styles.css: landscape docks the panel on the right, portrait at the bottom.
 */
/** Where Base frames the ship on the galaxy route: left of the dock, so the next planet shows. */
export function galaxyCenter(): { x: number; y: number } {
  return window.innerWidth >= window.innerHeight ? { x: 0.2, y: 0.45 } : { x: 0.28, y: 0.28 };
}

export function hangarCenter(): { x: number; y: number } {
  return window.innerWidth >= window.innerHeight ? { x: 0.3, y: 0.5 } : { x: 0.5, y: 0.26 };
}
