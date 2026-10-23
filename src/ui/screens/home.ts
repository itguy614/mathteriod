import type { Profile } from '../../types';
import { bodyIcon } from '../../catalog';
import { h, stardustBadge } from '../dom';
import type { Screen } from '../router';

export function homeScreen(opts: {
  profile: Profile;
  stageName: string;
  stageProgress: number;
  onLaunch(): void;
  onPractice(): void;
  onHangar(): void;
  onSettings(): void;
  onSwitchPilot(): void;
}): Screen {
  const p = opts.profile;
  const pct = Math.round(Math.min(1, Math.max(0, opts.stageProgress)) * 100);
  const level = p.learning.levelsCleared + 1;
  const launch = h(
    'button',
    { class: 'btn btn-primary btn-huge launch-btn', onclick: opts.onLaunch },
    h('span', { 'aria-hidden': 'true' }, '🚀'),
    ' Launch',
  );
  const practice = h(
    'button',
    { class: 'btn btn-practice practice-btn', onclick: opts.onPractice, 'aria-label': 'Practice' },
    h('span', { class: 'practice-btn-icon', 'aria-hidden': 'true' }, '🎯'),
    h('span', { class: 'practice-btn-word' }, 'Practice'),
  );

  const el = h(
    'div',
    { class: 'page home' },
    h(
      'header',
      { class: 'home-top' },
      h(
        'button',
        { class: 'pilot-chip', onclick: opts.onSwitchPilot, 'aria-label': `${p.name}. Switch pilot` },
        h('span', { class: 'pilot-avatar', 'aria-hidden': 'true' }, bodyIcon(p.loadout.body)),
        h('span', { class: 'pilot-text' }, h('span', { class: 'pilot-name' }, p.name), h('span', { class: 'pilot-switch' }, '⇄ switch')),
      ),
      h('span', { class: 'top-right' }, stardustBadge(p.stardust, 'big'), h('button', { class: 'btn btn-icon btn-ghost', onclick: opts.onSettings, 'aria-label': 'Settings' }, '⚙️')),
    ),
    h('div', { class: 'preview-space', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'panel dock-panel home-dock' },
      h(
        'div',
        { class: 'stage-card' },
        h('div', { class: 'stage-level' }, `Level ${level}`),
        h('div', { class: 'stage-name' }, opts.stageName),
        h(
          'div',
          { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'Stage mastery' },
          h('div', { class: 'progress-fill', style: { width: `${pct}%` } }),
          h('span', { class: 'progress-label' }, pct >= 100 ? '⭐ Ready!' : `${pct}%`),
        ),
        p.bestScore > 0 ? h('div', { class: 'best' }, h('span', { 'aria-hidden': 'true' }, '🏆'), ` Best ${p.bestScore.toLocaleString()}`) : null,
      ),
      h('div', { class: 'launch-row' }, launch, practice),
      h('button', { class: 'btn btn-secondary btn-big', onclick: opts.onHangar }, h('span', { 'aria-hidden': 'true' }, '🛠️'), ' Hangar'),
    ),
  );
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && document.activeElement === document.body) opts.onLaunch();
  };
  return {
    name: 'home',
    el,
    onEnter() {
      launch.focus({ preventScroll: true });
      document.addEventListener('keydown', onKey);
    },
    onLeave() {
      document.removeEventListener('keydown', onKey);
    },
  };
}
