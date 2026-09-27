import type { AudioBus, GameEngine, ItemKind, Profile, ShipLoadout } from '../../types';
import { hangarCenter } from '../layout';
import { CATALOG, type CatalogItem } from '../../catalog';
import { equip, isEquipped, isOwned, purchase } from '../../store/economy';
import { h, setChildren, stardustBadge } from '../dom';
import type { Router, Screen } from '../router';

const TABS: { kind: ItemKind; label: string; icon: string }[] = [
  { kind: 'body', label: 'Body', icon: '🚀' },
  { kind: 'color', label: 'Color', icon: '🎨' },
  { kind: 'laser', label: 'Laser', icon: '⚡' },
  { kind: 'trail', label: 'Trail', icon: '💨' },
  { kind: 'perk', label: 'Perks', icon: '🛡️' },
];

const ITEM_ICONS: Record<string, string> = {
  arrow: '🔺',
  saucer: '🛸',
  stingray: '🪁',
  falcon: '🦅',
  titan: '🛡',
  phoenix: '🔥',
  pulse: '•',
  twin: '‖',
  plasma: '🔮',
  lightning: '⚡',
  ion: '💨',
  flame: '🔥',
  sparkle: '✨',
  comet: '☄️',
  shield: '🫧',
  agile: '🌀',
};

function swatch(item: CatalogItem): HTMLElement {
  const bg =
    item.hex === 'rainbow'
      ? 'conic-gradient(#ff3b3b, #ffd23b, #8dff3b, #22e4ff, #9b5bff, #ff3bd4, #ff3b3b)'
      : (item.hex ?? '#fff');
  return h('span', { class: 'swatch', style: { background: bg, boxShadow: item.hex === 'rainbow' ? '' : `0 0 18px ${item.hex}` } });
}

function itemVisual(item: CatalogItem): HTMLElement {
  if (item.kind === 'color') return swatch(item);
  return h('span', { class: 'item-icon', 'aria-hidden': 'true' }, ITEM_ICONS[item.id] ?? '★');
}

/** Loadout with `item` applied for preview only (not saved). */
function previewLoadout(base: ShipLoadout, item: CatalogItem | null): ShipLoadout {
  const l: ShipLoadout = { ...base, perks: [...base.perks] };
  if (!item) return l;
  switch (item.kind) {
    case 'body':
      l.body = item.id;
      break;
    case 'color':
      l.color = item.id;
      break;
    case 'laser':
      l.laser = item.id;
      break;
    case 'trail':
      l.trail = item.id;
      break;
    case 'perk':
      if (!l.perks.includes(item.id)) l.perks.push(item.id);
      break;
  }
  return l;
}

export function hangarScreen(opts: {
  profile: Profile;
  game: GameEngine;
  audio: AudioBus;
  router: Router;
  /** Persist the updated profile. */
  onSave(profile: Profile): Promise<void>;
  onBack(): void;
}): Screen {
  let profile = opts.profile;
  let tab: ItemKind = 'body';
  let selected: CatalogItem | null = CATALOG.find((i) => i.id === profile.loadout.body) ?? null;

  const balance = h('span', { class: 'hangar-balance' });
  const tabBar = h('nav', { class: 'tabs', role: 'tablist' });
  const grid = h('div', { class: 'item-grid' });
  const detail = h('div', { class: 'item-detail' });

  function refreshPreview(): void {
    opts.game.showHangar(previewLoadout(profile.loadout, selected && !isEquipped(profile, selected.id) ? selected : null), hangarCenter());
  }

  async function commit(next: Profile): Promise<void> {
    profile = next;
    render();
    refreshPreview();
    await opts.onSave(profile);
  }

  async function buy(item: CatalogItem): Promise<void> {
    const ok = await opts.router.confirm({
      icon: item.kind === 'color' ? '🎨' : (ITEM_ICONS[item.id] ?? '✦'),
      title: `Buy ${item.name}?`,
      body: `${item.price.toLocaleString()} ✦ stardust`,
      yes: 'Buy it!',
      no: 'Not now',
    });
    if (!ok) return;
    const r = purchase(profile, item.id);
    if (!r.ok) return;
    opts.audio.play('purchase');
    // Equip right away: that's what kids expect after buying.
    const equipped = equip(r.profile, item.id, 'hull') ?? r.profile;
    await commit(equipped);
    detail.classList.remove('pop');
    void detail.offsetWidth;
    detail.classList.add('pop');
  }

  function renderTabs(): void {
    setChildren(
      tabBar,
      TABS.map((t) =>
        h(
          'button',
          {
            class: `tab${t.kind === tab ? ' active' : ''}`,
            role: 'tab',
            'aria-selected': String(t.kind === tab),
            onclick: () => {
              tab = t.kind;
              const inTab = CATALOG.filter((i) => i.kind === tab);
              selected = inTab.find((i) => isEquipped(profile, i.id)) ?? inTab[0] ?? null;
              render();
              refreshPreview();
            },
          },
          h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, t.icon),
          h('span', { class: 'tab-label' }, t.label),
        ),
      ),
    );
  }

  function renderGrid(): void {
    const items = CATALOG.filter((i) => i.kind === tab);
    setChildren(
      grid,
      items.map((item) => {
        const owned = isOwned(profile, item.id);
        let badge: HTMLElement;
        if (item.kind === 'color' && owned) {
          const hull = profile.loadout.color === item.id;
          const laser = profile.loadout.laserColor === item.id;
          badge = h('span', { class: 'item-state' }, hull ? '🚀✓' : '', laser ? ' ⚡✓' : '', !hull && !laser ? 'Owned' : '');
        } else if (owned) {
          badge = h('span', { class: `item-state${isEquipped(profile, item.id) ? ' on' : ''}` }, isEquipped(profile, item.id) ? '✓ On' : 'Owned');
        } else {
          badge = stardustBadge(item.price, profile.stardust >= item.price ? '' : 'too-poor');
        }
        return h(
          'button',
          {
            class: `item-card${selected?.id === item.id ? ' selected' : ''}${owned ? ' owned' : ' locked'}${isEquipped(profile, item.id) ? ' equipped' : ''}`,
            onclick: () => {
              selected = item;
              render();
              refreshPreview();
            },
          },
          itemVisual(item),
          h('span', { class: 'item-name' }, item.name),
          badge,
        );
      }),
    );
  }

  function renderDetail(): void {
    const item = selected;
    if (!item) {
      setChildren(detail);
      return;
    }
    const owned = isOwned(profile, item.id);
    const actions: HTMLElement[] = [];
    if (!owned) {
      const need = item.price - profile.stardust;
      actions.push(
        need > 0
          ? h('button', { class: 'btn btn-primary', disabled: true }, `Need ${need.toLocaleString()} more ✦`)
          : h('button', { class: 'btn btn-primary', onclick: () => void buy(item) }, 'Buy ', stardustBadge(item.price)),
      );
    } else if (item.kind === 'color') {
      const hullOn = profile.loadout.color === item.id;
      const laserOn = profile.loadout.laserColor === item.id;
      actions.push(
        h(
          'button',
          { class: `btn ${hullOn ? 'btn-ghost' : 'btn-secondary'}`, disabled: hullOn, onclick: () => void commit(equip(profile, item.id, 'hull') ?? profile) },
          hullOn ? '✓ Hull' : '🚀 Use for hull',
        ),
        h(
          'button',
          { class: `btn ${laserOn ? 'btn-ghost' : 'btn-secondary'}`, disabled: laserOn, onclick: () => void commit(equip(profile, item.id, 'laser') ?? profile) },
          laserOn ? '✓ Lasers' : '⚡ Use for lasers',
        ),
      );
    } else if (item.kind === 'perk') {
      const on = isEquipped(profile, item.id);
      actions.push(
        h('button', { class: `btn ${on ? 'btn-ghost' : 'btn-secondary'}`, onclick: () => void commit(equip(profile, item.id) ?? profile) }, on ? 'Turn off' : 'Turn on'),
      );
    } else {
      const on = isEquipped(profile, item.id);
      actions.push(
        h('button', { class: `btn ${on ? 'btn-ghost' : 'btn-secondary'}`, disabled: on, onclick: () => void commit(equip(profile, item.id) ?? profile) }, on ? '✓ Equipped' : 'Equip'),
      );
    }
    setChildren(
      detail,
      h('div', { class: 'detail-text' }, h('div', { class: 'detail-name' }, item.name, !owned ? h('span', { class: 'preview-tag' }, ' 👀 preview') : null), h('div', { class: 'detail-desc' }, item.description)),
      h('div', { class: 'detail-actions' }, actions),
    );
  }

  function render(): void {
    setChildren(balance, stardustBadge(profile.stardust, 'big'));
    renderTabs();
    renderGrid();
    renderDetail();
  }

  const el = h(
    'div',
    { class: 'page hangar' },
    h(
      'header',
      { class: 'page-head' },
      h('button', { class: 'btn btn-icon btn-ghost', onclick: opts.onBack, 'aria-label': 'Back' }, '‹'),
      h('h2', { class: 'page-title' }, 'Hangar'),
      balance,
    ),
    h('div', { class: 'preview-space', 'aria-hidden': 'true' }),
    h('div', { class: 'panel dock-panel hangar-dock' }, tabBar, grid, detail),
  );

  render();
  return {
    name: 'hangar',
    el,
    onEnter: refreshPreview,
    onLeave() {
      // Never leave an unbought preview on the ship.
      opts.game.showHangar(profile.loadout, hangarCenter());
    },
  };
}
