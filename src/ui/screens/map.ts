import type { Operation, StageDef } from '../../types';
import { h } from '../dom';
import type { Screen } from '../router';

const OP_LABEL: Record<Operation | 'mixed', string> = {
  add: 'Addition',
  sub: 'Subtraction',
  mul: 'Multiplication',
  div: 'Division',
  mixed: 'Mixed review',
};

/** "Addition Review: Asteroid Belt" -> "Asteroid Belt". */
function planetName(stage: StageDef): string {
  const i = stage.name.indexOf(': ');
  return i >= 0 ? stage.name.slice(i + 2) : stage.name;
}

/**
 * Badges & journey (Base -> Badges): the badge shelf, then every mission stage
 * as a planet on a path, grouped by operation (the list form of the galaxy Base).
 * Done planets are lit with a ✓, the current one pulses with its mastery %,
 * later ones are dim and locked. Review stages carry a boss marker.
 * Never color alone: each state also has an icon and words.
 */
export function mapScreen(opts: {
  stages: readonly StageDef[];
  stageIndex: number;
  /** 0..1 progress toward leaving the current stage. */
  progress: number;
  /** Content above the stage list (the badge shelf). */
  extra?: HTMLElement | null;
  onBack(): void;
}): Screen {
  const pct = Math.round(Math.min(1, Math.max(0, opts.progress)) * 100);
  const rows: HTMLElement[] = [];
  let lastOp: string | null = null;
  opts.stages.forEach((stage, i) => {
    if (stage.op !== lastOp) {
      rows.push(h('li', { class: `map-group map-op-${stage.op}` }, OP_LABEL[stage.op]));
      lastOp = stage.op;
    }
    const state = i < opts.stageIndex ? 'done' : i === opts.stageIndex ? 'current' : 'locked';
    const boss = stage.id.endsWith('review');
    const status =
      state === 'done' ? 'Done' : state === 'current' ? (pct >= 100 ? 'Ready to move on!' : `You are here · ${pct}%`) : 'Locked';
    rows.push(
      h(
        'li',
        {
          class: `map-stop map-${state} map-op-${stage.op}`,
          'aria-current': state === 'current' ? 'step' : undefined,
          'aria-label': `${stage.name}. ${status}${boss ? '. Boss stage' : ''}`,
        },
        h(
          'span',
          { class: 'map-planet', 'aria-hidden': 'true' },
          state === 'done' ? '✓' : state === 'locked' ? '🔒' : h('span', { class: 'map-ship' }, '🚀'),
        ),
        h(
          'span',
          { class: 'map-text', 'aria-hidden': 'true' },
          h('span', { class: 'map-name' }, planetName(stage), boss ? h('span', { class: 'map-boss' }, ' 👾') : null),
          h('span', { class: 'map-status' }, status),
          state === 'current'
            ? h('span', { class: 'map-progress' }, h('span', { class: 'map-progress-fill', style: { width: `${pct}%` } }))
            : null,
        ),
      ),
    );
  });

  const el = h(
    'div',
    { class: 'page map-page' },
    h(
      'header',
      { class: 'page-head' },
      h('button', { class: 'btn btn-icon btn-ghost', onclick: opts.onBack, 'aria-label': 'Back' }, '‹'),
      h('h2', { class: 'page-title' }, 'Badges & journey'),
      h('span', { class: 'head-spacer' }),
    ),
    opts.extra ?? null,
    h('h2', { class: 'journey-title' }, '🪐 Journey'),
    h('div', { class: 'panel map-panel' }, h('ol', { class: 'map-path', 'aria-label': 'Mission stages' }, rows)),
  );
  return { name: 'map', el };
}
