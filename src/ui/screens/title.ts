import { h } from '../dom';
import type { Screen } from '../router';

export function titleScreen(opts: { onPlay(): void }): Screen {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    opts.onPlay();
  };
  const play = h('button', { class: 'btn btn-primary btn-huge', onclick: go }, h('span', { 'aria-hidden': 'true' }, '▶'), ' Play');
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      go();
    }
  };
  const el = h(
    'div',
    { class: 'center-stack title-screen' },
    h(
      'h1',
      { class: 'logo', 'aria-label': 'Mathteroid' },
      h('span', { class: 'logo-math' }, 'MATH'),
      h('span', { class: 'logo-teroid' }, 'TEROID'),
    ),
    h('p', { class: 'tagline' }, 'Blast the right answer!'),
    play,
  );
  return {
    name: 'title',
    el,
    onEnter() {
      document.addEventListener('keydown', onKey);
      play.focus({ preventScroll: true });
    },
    onLeave() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
