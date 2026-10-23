import type { AudioBus, GameEngine } from '../../types';
import { hangarCenter } from '../layout';
import { CATALOG, bodyIcon, defaultLoadout } from '../../catalog';
import { h, setChildren } from '../dom';
import type { Screen } from '../router';

/**
 * Two quick steps: (1) name, (2) choose a base ship with a live
 * 3D preview via game.showHangar().
 */
export function newPilotScreen(opts: {
  game: GameEngine;
  audio: AudioBus;
  onCreate(name: string, body: string): void;
  onBack(): void;
}): Screen {
  const starters = CATALOG.filter((i) => i.kind === 'body' && i.starter);
  let name = '';
  let body = starters[0]?.id ?? 'arrow';
  let busy = false;

  const root = h('div', { class: 'page new-pilot' });

  function stepOne(): void {
    opts.game.showAttract();
    root.classList.remove('with-preview');
    const input = h('input', {
      class: 'name-input',
      type: 'text',
      maxLength: 16,
      placeholder: 'Your name',
      value: name,
      autocomplete: 'off',
      autocapitalize: 'words',
      'aria-label': 'Pilot name',
    });
    input.spellcheck = false;
    const next = h('button', { class: 'btn btn-primary btn-big', disabled: !name.trim() }, 'Next ›');
    input.addEventListener('input', () => {
      name = input.value;
      next.disabled = !name.trim();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && name.trim()) stepTwo();
    });
    next.addEventListener('click', () => name.trim() && stepTwo());

    setChildren(
      root,
      header('New pilot', opts.onBack),
      h(
        'div',
        { class: 'panel form-panel' },
        h('label', { class: 'field-label' }, h('span', { 'aria-hidden': 'true' }, '✏️'), ' Name'),
        input,
        h('div', { class: 'btn-row' }, next),
      ),
    );
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }

  function stepTwo(): void {
    root.classList.add('with-preview');
    const preview = () => opts.game.showHangar(defaultLoadout(body), hangarCenter());
    preview();

    const cards = h(
      'div',
      { class: 'ship-choices', role: 'radiogroup', 'aria-label': 'Ship' },
      starters.map((s) => {
        const card = h(
          'button',
          { class: `ship-choice${s.id === body ? ' selected' : ''}`, role: 'radio', 'aria-checked': String(s.id === body) },
          h('span', { class: 'ship-icon', 'aria-hidden': 'true' }, bodyIcon(s.id)),
          h('span', { class: 'ship-name' }, s.name),
        );
        card.addEventListener('click', () => {
          body = s.id;
          cards.querySelectorAll('.ship-choice').forEach((x) => {
            x.classList.toggle('selected', x === card);
            x.setAttribute('aria-checked', String(x === card));
          });
          desc.textContent = s.description;
          preview();
        });
        return card;
      }),
    );
    const desc = h('p', { class: 'ship-desc' }, starters.find((s) => s.id === body)?.description ?? '');
    const go = h('button', { class: 'btn btn-primary btn-big' }, h('span', { 'aria-hidden': 'true' }, '🚀'), ' Ready!');
    go.addEventListener('click', () => {
      if (busy) return;
      busy = true;
      go.disabled = true;
      opts.onCreate(name.trim(), body);
    });

    setChildren(
      root,
      header('Pick your ship', stepOne),
      h('div', { class: 'preview-space', 'aria-hidden': 'true' }),
      h('div', { class: 'panel dock-panel' }, cards, desc, h('div', { class: 'btn-row' }, go)),
    );
  }

  stepOne();
  return { name: 'new-pilot', el: root };
}

function header(title: string, onBack: () => void): HTMLElement {
  return h(
    'header',
    { class: 'page-head' },
    h('button', { class: 'btn btn-icon btn-ghost', onclick: onBack, 'aria-label': 'Back' }, '‹'),
    h('h2', { class: 'page-title' }, title),
    h('span', { class: 'head-spacer' }),
  );
}
