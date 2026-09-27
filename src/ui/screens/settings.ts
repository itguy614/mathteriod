import type { ControlMode, Profile, Settings, TouchMode } from '../../types';
import { h } from '../dom';
import type { Router, Screen } from '../router';

export function settingsScreen(opts: {
  profile: Profile;
  router: Router;
  speechAvailable: boolean;
  /** Apply live (audio) and persist. */
  onChange(settings: Settings): void;
  onTestSpeech(): void;
  onTestSfx(): void;
  onReset(): Promise<void>;
  onDelete(): Promise<void>;
  onBack(): void;
}): Screen {
  const settings: Settings = { ...opts.profile.settings };

  function slider(label: string, icon: string, key: 'musicVolume' | 'sfxVolume', onRelease?: () => void): HTMLElement {
    const value = h('span', { class: 'slider-value' }, `${Math.round(settings[key] * 100)}`);
    const input = h('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '5',
      value: String(Math.round(settings[key] * 100)),
      class: 'slider',
      'aria-label': label,
    });
    const paint = () => input.style.setProperty('--fill', `${input.value}%`);
    paint();
    input.addEventListener('input', () => {
      settings[key] = Number(input.value) / 100;
      value.textContent = input.value;
      paint();
      opts.onChange({ ...settings });
    });
    if (onRelease) input.addEventListener('change', onRelease);
    return h(
      'div',
      { class: 'setting-row' },
      h('span', { class: 'setting-icon', 'aria-hidden': 'true' }, icon),
      h('span', { class: 'setting-label' }, label),
      input,
      value,
    );
  }

  const toggle = h(
    'button',
    { class: `toggle${settings.readAloud ? ' on' : ''}`, role: 'switch', 'aria-checked': String(settings.readAloud), 'aria-label': 'Read aloud' },
    h('span', { class: 'toggle-knob' }),
  );
  toggle.addEventListener('click', () => {
    settings.readAloud = !settings.readAloud;
    toggle.classList.toggle('on', settings.readAloud);
    toggle.setAttribute('aria-checked', String(settings.readAloud));
    opts.onChange({ ...settings });
    if (settings.readAloud) opts.onTestSpeech();
  });

  // Steering: 'direct' (arrows move the ship) vs classic Asteroids 'rotate'.
  const modes: Array<{ mode: ControlMode; label: string; tip: string }> = [
    { mode: 'direct', label: '🕹️ Easy', tip: 'Arrows move the ship' },
    { mode: 'rotate', label: '🔄 Classic', tip: 'Turn and thrust' },
  ];
  const steerTip = h('p', { class: 'hint' });
  const segButtons = modes.map((m) =>
    h('button', {
      class: 'seg-btn',
      role: 'radio',
      onclick: () => {
        setMode(m.mode);
        opts.onChange({ ...settings });
      },
    }, m.label),
  );
  function setMode(mode: ControlMode): void {
    settings.controlMode = mode;
    segButtons.forEach((b, i) => {
      const on = modes[i].mode === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    steerTip.textContent = modes.find((m) => m.mode === mode)!.tip;
  }
  setMode(settings.controlMode);

  // Touch controls: only shown on touch-capable devices.
  const touchCapable =
    (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
  const touchModes: Array<{ mode: TouchMode; label: string; tip: string }> = [
    { mode: 'tapdrag', label: '👆 Tap & drag', tip: 'Tap a rock to shoot, drag to fly' },
    { mode: 'joystick', label: '🕹️ Joystick', tip: 'Joystick + FIRE button' },
  ];
  const touchTip = h('p', { class: 'hint' });
  const touchButtons = touchModes.map((m) =>
    h('button', {
      class: 'seg-btn',
      role: 'radio',
      onclick: () => {
        setTouchMode(m.mode);
        opts.onChange({ ...settings });
      },
    }, m.label),
  );
  function setTouchMode(mode: TouchMode): void {
    settings.touchMode = mode;
    touchButtons.forEach((b, i) => {
      const on = touchModes[i].mode === mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    touchTip.textContent = touchModes.find((m) => m.mode === mode)!.tip;
  }
  setTouchMode(settings.touchMode === 'joystick' ? 'joystick' : 'tapdrag');

  const el = h(
    'div',
    { class: 'page settings' },
    h(
      'header',
      { class: 'page-head' },
      h('button', { class: 'btn btn-icon btn-ghost', onclick: opts.onBack, 'aria-label': 'Back' }, '‹'),
      h('h2', { class: 'page-title' }, 'Settings'),
      h('span', { class: 'head-spacer' }),
    ),
    h(
      'div',
      { class: 'panel form-panel' },
      slider('Music', '🎵', 'musicVolume'),
      slider('Sounds', '🔊', 'sfxVolume', opts.onTestSfx),
      h(
        'div',
        { class: 'setting-row' },
        h('span', { class: 'setting-icon', 'aria-hidden': 'true' }, '🗣️'),
        h('span', { class: 'setting-label' }, 'Read aloud'),
        toggle,
        h(
          'button',
          { class: 'btn btn-ghost btn-small', onclick: opts.onTestSpeech, disabled: !opts.speechAvailable, 'aria-label': 'Test read aloud' },
          '▶ Test',
        ),
      ),
      !opts.speechAvailable ? h('p', { class: 'hint' }, 'Read aloud is not available in this browser.') : null,
      h(
        'div',
        { class: 'setting-row' },
        h('span', { class: 'setting-icon', 'aria-hidden': 'true' }, '🚀'),
        h('span', { class: 'setting-label' }, 'Steering'),
        h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Steering' }, ...segButtons),
      ),
      steerTip,
      touchCapable
        ? h(
            'div',
            { class: 'setting-row' },
            h('span', { class: 'setting-icon', 'aria-hidden': 'true' }, '📱'),
            h('span', { class: 'setting-label' }, 'Touch controls'),
            h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Touch controls' }, ...touchButtons),
          )
        : null,
      touchCapable ? touchTip : null,
      h('hr', { class: 'divider' }),
      h(
        'div',
        { class: 'danger-zone' },
        h(
          'button',
          {
            class: 'btn btn-ghost',
            onclick: async () => {
              const ok = await opts.router.confirm({
                icon: '♻️',
                title: `Start ${opts.profile.name} over?`,
                body: 'Progress, stardust and ship parts go back to the start.',
                yes: 'Start over',
                no: 'Keep',
                danger: true,
              });
              if (ok) await opts.onReset();
            },
          },
          '♻️ Reset pilot',
        ),
        h(
          'button',
          {
            class: 'btn btn-ghost',
            onclick: async () => {
              const ok = await opts.router.confirm({
                icon: '🗑️',
                title: `Delete ${opts.profile.name}?`,
                body: 'This pilot will be gone for good.',
                yes: 'Delete',
                no: 'Keep',
                danger: true,
              });
              if (ok) await opts.onDelete();
            },
          },
          '🗑️ Delete pilot',
        ),
      ),
    ),
  );
  return { name: 'settings', el };
}
