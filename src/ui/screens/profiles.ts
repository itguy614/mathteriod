import type { Profile } from '../../types';
import { bodyIcon, getItem } from '../../catalog';
import { h } from '../dom';
import type { Screen } from '../router';

/**
 * The start screen: logo plus "who's playing?" pilot tiles (ship, name, level)
 * and a New pilot tile. With no pilots yet, just one big New pilot button.
 */
export function profilePickerScreen(opts: {
  profiles: Profile[];
  lastPilotId: string | null;
  onPick(profile: Profile): void;
  onNew(): void;
}): Screen {
  const tiles = opts.profiles.map((p) => {
    const level = p.learning.levelsCleared + 1;
    const ship = getItem(p.loadout.body)?.name ?? 'Ship';
    return h(
      'button',
      {
        class: `pilot-tile${p.id === opts.lastPilotId ? ' is-last' : ''}`,
        onclick: () => opts.onPick(p),
        'aria-label': `Play as ${p.name}, level ${level}, ${ship}`,
      },
      h('span', { class: 'pilot-tile-ship', 'aria-hidden': 'true' }, bodyIcon(p.loadout.body)),
      h('span', { class: 'pilot-tile-name' }, p.name),
      h('span', { class: 'pilot-tile-meta' }, `Level ${level} · ${ship}`),
    );
  });
  const newTile = h(
    'button',
    { class: 'pilot-tile pilot-new', onclick: opts.onNew },
    h('span', { class: 'pilot-tile-ship', 'aria-hidden': 'true' }, '＋'),
    h('span', { class: 'pilot-tile-name' }, 'New pilot'),
  );
  const first = opts.profiles.length === 0;
  const el = h(
    'div',
    { class: 'page start-screen' },
    h(
      'h1',
      { class: 'logo', 'aria-label': 'Mathteroid' },
      h('span', { class: 'logo-math' }, 'MATH'),
      h('span', { class: 'logo-teroid' }, 'TEROID'),
    ),
    h('p', { class: 'tagline' }, 'Blast the right answer!'),
    first
      ? h(
          'button',
          { class: 'btn btn-primary btn-huge start-new', onclick: opts.onNew },
          h('span', { 'aria-hidden': 'true' }, '＋'),
          ' New pilot',
        )
      : [h('h2', { class: 'start-prompt' }, "Who's playing?"), h('div', { class: 'pilot-grid' }, tiles, newTile)],
  );
  return {
    name: 'profiles',
    el,
    onEnter() {
      const focus = el.querySelector<HTMLButtonElement>('.is-last') ?? el.querySelector<HTMLButtonElement>('.pilot-tile, .start-new');
      focus?.focus({ preventScroll: true });
    },
  };
}
