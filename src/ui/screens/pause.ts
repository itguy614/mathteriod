import { h } from '../dom';
import type { Screen } from '../router';

export function pauseScreen(opts: { onResume(): void; onQuit(): void; quitLabel?: string; quitIcon?: string }): Screen {
  const resume = h('button', { class: 'btn btn-primary btn-big', onclick: opts.onResume }, h('span', { 'aria-hidden': 'true' }, '▶'), ' Resume');
  const el = h(
    'div',
    { class: 'center-stack pause dim' },
    h(
      'div',
      { class: 'panel menu-panel' },
      h('h2', { class: 'menu-title' }, h('span', { 'aria-hidden': 'true' }, '⏸'), ' Paused'),
      resume,
      h('button', { class: 'btn btn-ghost btn-big', onclick: opts.onQuit }, h('span', { 'aria-hidden': 'true' }, opts.quitIcon ?? '🏠'), ` ${opts.quitLabel ?? 'Quit to base'}`),
    ),
  );
  return {
    name: 'pause',
    el,
    onEnter: () => resume.focus({ preventScroll: true }),
  };
}
