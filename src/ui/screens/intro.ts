import type { AudioBus, LevelConfig } from '../../types';
import { h } from '../dom';
import type { Screen } from '../router';

/**
 * "Level N · Stage" card, then a 3-2-1 countdown, then onDone().
 * Practice passes `kicker` ("Practice · ×6 ×7") and `title` ("Round 2") instead.
 */
export function levelIntroScreen(opts: { config: LevelConfig; audio: AudioBus; kicker?: string; title?: string; onDone(): void }): Screen {
  const { config } = opts;
  const kicker = opts.kicker ?? `Level ${config.levelNumber}`;
  const reverse = config.waves.includes('reverse');
  const waves = config.waves.length;
  const count = h('div', { class: 'countdown', 'aria-live': 'assertive' });
  const el = h(
    'div',
    { class: 'center-stack intro' },
    h(
      'div',
      { class: 'intro-card' },
      h('div', { class: 'intro-level' }, kicker),
      h('div', { class: 'intro-stage' }, opts.title ?? config.stageName),
      config.eased ? h('div', { class: 'intro-eased' }, h('span', { 'aria-hidden': 'true' }, '🌱'), ' Warm-up round') : null,
      waves > 1 ? h('div', { class: 'intro-waves' }, `${waves} waves`) : null,
      reverse
        ? h(
            'div',
            { class: 'intro-mode' },
            h('strong', null, h('span', { 'aria-hidden': 'true' }, '🔄'), ` Wave ${config.waves.indexOf('reverse') + 1} is Reverse!`),
            h('span', null, 'Shoot every equation that makes the number.'),
          )
        : null,
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
      const intro = opts.kicker ? (opts.title ?? 'Practice') : kicker;
      opts.audio.speak(intro);
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
