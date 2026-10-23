import type { BadgeDef } from '../../store/badges';
import { h } from '../dom';

const GROUPS: Array<{ group: BadgeDef['group']; title: string }> = [
  { group: 'play', title: 'Pilot badges' },
  { group: 'journey', title: 'Journey' },
  { group: 'tables', title: 'Times tables' },
];

/**
 * Badge shelf (shown under the galaxy map): every badge, earned ones lit,
 * the rest dimmed with how to earn them. Earned state is also in words.
 */
export function badgeShelf(badges: BadgeDef[], earned: Record<string, number>): HTMLElement {
  const count = badges.filter((b) => b.id in earned).length;
  return h(
    'section',
    { class: 'panel badge-shelf', 'aria-label': `Badges: ${count} of ${badges.length} earned` },
    h('h2', { class: 'badge-shelf-title' }, '🏅 Badges ', h('span', { class: 'badge-count' }, `${count} / ${badges.length}`)),
    GROUPS.flatMap(({ group, title }) => {
      const list = badges.filter((b) => b.group === group);
      return [
        h('h3', { class: 'badge-group' }, title),
        h(
          'ul',
          { class: `badge-grid${group === 'tables' ? ' badge-grid-tables' : ''}` },
          list.map((b) => {
            const has = b.id in earned;
            return h(
              'li',
              { class: `badge${has ? ' badge-earned' : ''}`, title: b.description },
              h('span', { class: 'badge-icon', 'aria-hidden': 'true' }, b.icon),
              h('span', { class: 'badge-name' }, b.name),
              h('span', { class: 'badge-desc' }, has ? '✓ Earned' : b.description),
            );
          }),
        ),
      ];
    }),
  );
}
