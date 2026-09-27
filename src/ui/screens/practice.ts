import type { LearningState, Operation } from '../../types';
import { SKILL_SYMBOL, skillMastery, skillsFor, weakestFacts, type SkillLevel } from '../../learning/index';
import { h } from '../dom';
import type { Screen } from '../router';

const OP_TABS: Array<{ op: Operation; word: string }> = [
  { op: 'add', word: 'Plus' },
  { op: 'sub', word: 'Minus' },
  { op: 'mul', word: 'Times' },
  { op: 'div', word: 'Divide' },
];

/**
 * Meter icon + words: never color alone. 'new' and 'learning' icons are drawn
 * in CSS (empty ring / half-filled ring); 'fast' is a lightning bolt.
 */
const LEVEL_META: Record<SkillLevel, { icon: string; word: string }> = {
  new: { icon: '', word: 'not started' },
  learning: { icon: '', word: 'learning' },
  fast: { icon: '⚡', word: 'fast' },
};

/**
 * Practice picker: fact-family tiles (×7, ÷7, +8, −8 …) grouped by operation tabs,
 * multi-select, each with a mastery meter; plus a "Needs practice" tile.
 */
export function practiceScreen(opts: {
  learning: LearningState;
  /** Previously picked skill ids (restored). */
  selected: string[];
  /** Tab to open when nothing is selected. */
  defaultOp: Operation;
  onStart(skillIds: string[]): void;
  onNeedsPractice(): void;
  onBack(): void;
}): Screen {
  const selected = new Set(opts.selected);
  const firstSelected = opts.selected[0]?.split(':')[0] as Operation | undefined;
  let op: Operation = firstSelected && OP_TABS.some((t) => t.op === firstSelected) ? firstSelected : opts.defaultOp;

  // --- Needs practice ------------------------------------------------------
  const weak = weakestFacts(opts.learning);
  const needsBtn = h(
    'button',
    {
      class: 'needs-tile',
      disabled: weak.length === 0,
      onclick: opts.onNeedsPractice,
      'aria-label': weak.length ? `Needs practice: ${weak.length} tricky facts` : 'Needs practice. Play a few missions first',
    },
    h('span', { class: 'needs-icon', 'aria-hidden': 'true' }, '💪'),
    h(
      'span',
      { class: 'needs-text' },
      h('span', { class: 'needs-title' }, 'Needs practice'),
      h('span', { class: 'needs-sub' }, weak.length ? `Your ${weak.length} trickiest facts` : 'Play a few missions first'),
    ),
    h('span', { class: 'needs-go', 'aria-hidden': 'true' }, weak.length ? '▶' : '🔒'),
  );

  // --- Tabs ------------------------------------------------------------------
  const tabBadges = new Map<Operation, HTMLElement>();
  const tabs = OP_TABS.map((t) => {
    const badge = h('span', { class: 'op-tab-badge' });
    tabBadges.set(t.op, badge);
    return h(
      'button',
      { class: 'op-tab', role: 'tab', dataset: { op: t.op }, onclick: () => setOp(t.op), 'aria-label': t.word },
      h('span', { class: 'op-tab-symbol', 'aria-hidden': 'true' }, SKILL_SYMBOL[t.op]),
      h('span', { class: 'op-tab-word' }, t.word),
      badge,
    );
  });

  // --- Tiles -------------------------------------------------------------------
  const grid = h('div', { class: 'skill-grid', role: 'group' });

  function tile(id: string, label: string): HTMLButtonElement {
    const m = skillMastery(id, opts.learning);
    const meta = LEVEL_META[m.level];
    // Learning always shows a sliver so it reads differently from "not started".
    const fill = m.level === 'new' ? 0 : Math.max(0.12, m.fraction);
    const btn = h(
      'button',
      {
        class: `skill-tile lvl-${m.level}`,
        dataset: { skill: id },
        'aria-pressed': String(selected.has(id)),
        'aria-label': `${label}, ${meta.word}`,
        onclick: () => {
          if (selected.has(id)) selected.delete(id);
          else selected.add(id);
          btn.setAttribute('aria-pressed', String(selected.has(id)));
          btn.classList.toggle('on', selected.has(id));
          refresh();
        },
      },
      h('span', { class: 'skill-check', 'aria-hidden': 'true' }, '✓'),
      h('span', { class: 'skill-label' }, label),
      h(
        'span',
        { class: 'skill-meter', 'aria-hidden': 'true' },
        h('span', { class: 'skill-meter-icon' }, meta.icon || null),
        h('span', { class: 'skill-meter-bar' }, h('span', { class: 'skill-meter-fill', style: { width: `${Math.round(fill * 100)}%` } })),
      ),
    );
    btn.classList.toggle('on', selected.has(id));
    return btn;
  }

  function renderGrid(): void {
    grid.replaceChildren(...skillsFor(op).map((s) => tile(s.id, s.label)));
    grid.setAttribute('aria-label', OP_TABS.find((t) => t.op === op)!.word);
  }

  function setOp(next: Operation): void {
    op = next;
    tabs.forEach((t) => {
      const on = t.dataset.op === op;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    renderGrid();
  }

  // --- Start bar -----------------------------------------------------------------
  const countEl = h('span', { class: 'start-count' });
  const startBtn = h(
    'button',
    { class: 'btn btn-primary btn-big practice-start', onclick: () => selected.size && opts.onStart(ordered()) },
    h('span', { 'aria-hidden': 'true' }, '▶'),
    ' Start',
    countEl,
  );
  const clearBtn = h(
    'button',
    {
      class: 'btn btn-ghost btn-icon practice-clear',
      'aria-label': 'Clear picks',
      onclick: () => {
        selected.clear();
        renderGrid();
        refresh();
      },
    },
    '✕',
  );

  /** Selected ids in catalog order (+, −, ×, ÷; N ascending). */
  function ordered(): string[] {
    return OP_TABS.flatMap((t) => skillsFor(t.op).map((s) => s.id)).filter((id) => selected.has(id));
  }

  function refresh(): void {
    const n = selected.size;
    startBtn.disabled = n === 0;
    countEl.textContent = n ? String(n) : '';
    countEl.hidden = n === 0;
    startBtn.setAttribute('aria-label', n ? `Start with ${n} picked` : 'Pick a skill to start');
    clearBtn.hidden = n === 0;
    for (const t of OP_TABS) {
      const k = [...selected].filter((id) => id.startsWith(`${t.op}:`)).length;
      const b = tabBadges.get(t.op)!;
      b.textContent = k ? String(k) : '';
      b.hidden = k === 0;
    }
  }

  const el = h(
    'div',
    { class: 'page practice' },
    h(
      'header',
      { class: 'page-head' },
      h('button', { class: 'btn btn-icon btn-ghost', onclick: opts.onBack, 'aria-label': 'Back' }, '‹'),
      h('h2', { class: 'page-title' }, h('span', { 'aria-hidden': 'true' }, '🎯 '), 'Practice'),
      h('span', { class: 'head-spacer' }),
    ),
    h(
      'div',
      { class: 'panel practice-panel' },
      needsBtn,
      h('div', { class: 'op-tabs', role: 'tablist' }, tabs),
      grid,
      h(
        'div',
        { class: 'practice-legend', 'aria-hidden': 'true' },
        (Object.keys(LEVEL_META) as SkillLevel[]).map((l) =>
          h('span', { class: `legend-item lvl-${l}` }, h('span', { class: 'skill-meter-icon' }, LEVEL_META[l].icon || null), LEVEL_META[l].word),
        ),
      ),
      h('div', { class: 'practice-bar' }, clearBtn, startBtn),
    ),
  );

  setOp(op);
  refresh();

  return {
    name: 'practice',
    el,
    onEnter() {
      (selected.size ? startBtn : tabs.find((t) => t.dataset.op === op)!).focus({ preventScroll: true });
    },
  };
}
