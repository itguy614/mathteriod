import type { AudioBus, LevelConfig } from '../../types';
import { h } from '../dom';
import type { Screen } from '../router';

/** "Level N · Stage" card, then a 3-2-1 countdown, then onDone(). */
export function levelIntroScreen(opts: { config: LevelConfig; audio: AudioBus; onDone(): void }): Screen {
  const { config } = opts;
  const count = h('div', { class: 'countdown', 'aria-live': 'assertive' });
  const el = h(
    'div',
    { class: 'center-stack intro' },
    h(
      'div',
      { class: 'intro-card' },
      h('div', { class: 'intro-level' }, `Level ${config.levelNumber}`),
      h('div', { class: 'intro-stage' }, config.stageName),
      config.eased ? h('div', { class: 'intro-eased' }, h('span', { 'aria-hidden': 'true' }, '🌱'), ' Warm-up round') : null,
    ),
    count,
  );

  const timers: ReturnType<typeof setTimeout>[] = [];
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    opts.onDone();
  };
  const show = (text: string, cls = '') => {
    count.textContent = text;
    count.className = `countdown tick ${cls}`;
  };

  return {
    name: 'intro',
    el,
    passThrough: true,
    onEnter() {
      opts.audio.speak(`Level ${config.levelNumber}`);
      const steps = ['3', '2', '1'];
      steps.forEach((s, i) => {
        timers.push(
          setTimeout(() => {
            show(s);
            opts.audio.play('click');
          }, 1100 + i * 800),
        );
      });
      timers.push(setTimeout(() => show('GO!', 'go'), 1100 + steps.length * 800));
      timers.push(setTimeout(finish, 1100 + steps.length * 800 + 450));
    },
    onLeave() {
      timers.forEach(clearTimeout);
    },
  };
}
