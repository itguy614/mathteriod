import type { Profile } from '../../types';
import { h } from '../dom';
import type { Screen } from '../router';

export const AVATARS = ['🚀', '🦊', '🐱', '🐶', '🦄', '🐸', '🐼', '🦖', '🐙', '👾', '🐯', '🐧', '🦉', '🐲', '🤖', '🐵'];

export function profilePickerScreen(opts: {
  profiles: Profile[];
  lastPilotId: string | null;
  onPick(profile: Profile): void;
  onNew(): void;
  onBack(): void;
}): Screen {
  const tiles = opts.profiles.map((p) =>
    h(
      'button',
      {
        class: `avatar-tile${p.id === opts.lastPilotId ? ' is-last' : ''}`,
        onclick: () => opts.onPick(p),
        'aria-label': `Play as ${p.name}`,
      },
      h('span', { class: 'avatar-emoji', 'aria-hidden': 'true' }, p.avatar),
      h('span', { class: 'avatar-name' }, p.name),
    ),
  );
  const newTile = h(
    'button',
    { class: 'avatar-tile avatar-new', onclick: opts.onNew },
    h('span', { class: 'avatar-emoji', 'aria-hidden': 'true' }, '＋'),
    h('span', { class: 'avatar-name' }, 'New pilot'),
  );
  const el = h(
    'div',
    { class: 'page' },
    h(
      'header',
      { class: 'page-head' },
      h('button', { class: 'btn btn-icon btn-ghost', onclick: opts.onBack, 'aria-label': 'Back' }, '‹'),
      h('h2', { class: 'page-title' }, "Who's playing?"),
      h('span', { class: 'head-spacer' }),
    ),
    h('div', { class: 'avatar-grid' }, tiles, newTile),
  );
  return {
    name: 'profiles',
    el,
    onEnter() {
      const last = el.querySelector<HTMLButtonElement>('.is-last') ?? el.querySelector<HTMLButtonElement>('.avatar-tile');
      last?.focus({ preventScroll: true });
    },
  };
}
