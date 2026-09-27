import type { AudioBus, LevelResult, LevelSummary } from '../../types';
import { starsForAccuracy } from '../../store/economy';
import { countUp, h } from '../dom';
import type { Screen } from '../router';

const CLEAR_CHEERS = ['Great flying!', 'Awesome!', 'Nice shooting!', 'You did it!', 'Super pilot!', 'Out of this world!'];
const FAIL_CHEERS = [
  'So close! Your ship needs a tune-up. Try again!',
  'Good try! Every blast makes you stronger.',
  "Nice effort! Let's fly again!",
  'Almost there! One more try?',
];

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

export function resultsScreen(opts: {
  result: LevelResult;
  summary: LevelSummary;
  earned: number;
  newBest: boolean;
  audio: AudioBus;
  onNext(): void;
  onRetry(): void;
  onHangar(): void;
  onBase(): void;
  /**
   * Practice variant: Play again / Change skills / Base, never a promotion or
   * "new best". `streak` = clears in a row this session (shown from 2).
   */
  practice?: { streak: number; onPlayAgain(): void; onChangeSkills(): void };
}): Screen {
  const { result, summary } = opts;
  const practice = opts.practice;
  const cleared = result.outcome === 'cleared';
  const correct = result.answers.filter((a) => a.correct).length;
  const stars = starsForAccuracy(summary.accuracy, cleared);
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelCount: (() => void) | null = null;

  const earnedEl = h('span', { class: 'stardust-amount' }, '0');
  const earnedRow = h(
    'div',
    { class: 'earned' },
    h('span', { class: 'stardust big' }, h('span', { class: 'stardust-icon', 'aria-hidden': 'true' }, '✦'), h('span', { class: 'plus' }, '+'), earnedEl),
  );

  const starRow = cleared
    ? h(
        'div',
        { class: 'stars', 'aria-label': `${stars} of 3 stars` },
        [1, 2, 3].map((i) => h('span', { class: `star${i <= stars ? ' earned' : ''}`, dataset: { i: String(i) } }, '★')),
      )
    : null;

  const stats = h(
    'div',
    { class: 'result-stats' },
    h('div', { class: 'stat' }, h('span', { class: 'stat-icon', 'aria-hidden': 'true' }, '✅'), h('span', { class: 'stat-value' }, String(correct)), h('span', { class: 'stat-label' }, 'right')),
    h(
      'div',
      { class: 'stat' },
      h('span', { class: 'stat-icon', 'aria-hidden': 'true' }, '🎯'),
      h('span', { class: 'stat-value' }, result.score.toLocaleString()),
      h('span', { class: 'stat-label' }, 'score'),
      opts.newBest && !practice ? h('span', { class: 'new-best' }, 'NEW BEST!') : null,
    ),
  );

  const promoted = summary.promoted && !practice;
  const streakChip =
    practice && cleared && practice.streak >= 2
      ? h('div', { class: 'streak-chip', 'aria-label': `${practice.streak} in a row` }, h('span', { 'aria-hidden': 'true' }, '🔥'), ` ${practice.streak} in a row`)
      : null;

  const promoBanner =
    promoted && summary.newStageName
      ? h(
          'div',
          { class: 'promo-banner' },
          h('div', { class: 'promo-kicker' }, '🔓 STAGE UNLOCKED'),
          h('div', { class: 'promo-name' }, summary.newStageName),
        )
      : null;

  const buttons = practice
    ? [
        h('button', { class: 'btn btn-primary btn-big', onclick: practice.onPlayAgain }, h('span', { 'aria-hidden': 'true' }, '🔁'), ' Play again'),
        h('button', { class: 'btn btn-secondary', onclick: practice.onChangeSkills }, h('span', { 'aria-hidden': 'true' }, '🎯'), ' Change skills'),
        h('button', { class: 'btn btn-ghost', onclick: opts.onBase }, h('span', { 'aria-hidden': 'true' }, '🏠'), ' Base'),
      ]
    : cleared
    ? [
        h('button', { class: 'btn btn-primary btn-big', onclick: opts.onNext }, h('span', { 'aria-hidden': 'true' }, '🚀'), ' Next'),
        h('button', { class: 'btn btn-secondary', onclick: opts.onHangar }, h('span', { 'aria-hidden': 'true' }, '🛠️'), ' Hangar'),
        h('button', { class: 'btn btn-ghost', onclick: opts.onBase }, h('span', { 'aria-hidden': 'true' }, '🏠'), ' Base'),
      ]
    : [
        h('button', { class: 'btn btn-primary btn-big', onclick: opts.onRetry }, h('span', { 'aria-hidden': 'true' }, '🔁'), ' Try again'),
        h('button', { class: 'btn btn-ghost', onclick: opts.onBase }, h('span', { 'aria-hidden': 'true' }, '🏠'), ' Base'),
      ];

  const el = h(
    'div',
    { class: `center-stack results ${cleared ? 'is-cleared' : 'is-failed'}${promoted ? ' is-promoted' : ''}${practice ? ' is-practice' : ''}` },
    h(
      'div',
      { class: 'panel results-panel' },
      promoBanner,
      h('h2', { class: 'results-title' }, cleared ? pick(CLEAR_CHEERS) : h('span', null, h('span', { 'aria-hidden': 'true' }, '🔧 '), 'Good try!')),
      !cleared ? h('p', { class: 'encourage' }, FAIL_CHEERS[0]!) : null,
      starRow,
      streakChip,
      stats,
      earnedRow,
      h('div', { class: 'btn-row results-actions' }, buttons),
    ),
    promoted ? h('div', { class: 'confetti', 'aria-hidden': 'true' }, Array.from({ length: 36 }, (_, i) => h('i', { style: `--i:${i}` }))) : null,
  );

  // The first fail message is the canonical one; vary later ones for repeat fails.
  if (!cleared && Math.random() < 0.5) {
    const p = el.querySelector('.encourage');
    if (p) p.textContent = pick(FAIL_CHEERS);
  }

  return {
    name: 'results',
    el,
    onEnter() {
      // The game already played levelClear/levelFail at the moment it happened.
      if (promoted) timers.push(setTimeout(() => opts.audio.play('promote'), 400));
      // Stars pop in one by one.
      el.querySelectorAll<HTMLElement>('.star').forEach((s, i) => {
        timers.push(setTimeout(() => s.classList.add('show'), 400 + i * 280));
      });
      timers.push(
        setTimeout(
          () => {
            let ticks = 0;
            cancelCount = countUp(earnedEl, 0, opts.earned, Math.min(1600, 400 + opts.earned * 6), () => {
              if (ticks++ % 4 === 0) opts.audio.play('click');
            });
          },
          cleared ? 1300 : 600,
        ),
      );
      if (cleared) opts.audio.speak(pick(['Great job!', 'Awesome!', 'Well done!']));
      else opts.audio.speak('Good try! Try again!');
      (buttons[0] as HTMLButtonElement).focus({ preventScroll: true });
    },
    onLeave() {
      timers.forEach(clearTimeout);
      cancelCount?.();
    },
  };
}
