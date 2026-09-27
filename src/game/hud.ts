const SHIP_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L20 21 L12 17 L4 21 Z" fill="currentColor" stroke="#07051a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const SHIELD_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L20 5 V11 C20 16.5 16.5 20.5 12 22 C7.5 20.5 4 16.5 4 11 V5 Z" fill="currentColor" stroke="#07051a" stroke-width="1.6" stroke-linejoin="round"/></svg>';

export type ShieldState = 'none' | 'up' | 'used';

/** Controls the hint can teach; each chip fades once the player has used it. */
export type HintPart = 'fly' | 'turn' | 'brake' | 'move' | 'fire' | 'stick' | 'drag';
/** 'touch' = joystick touch mode, 'tapdrag' = tap/drag touch mode. */
export type HintKind = 'rotate' | 'direct' | 'touch' | 'tapdrag';

// Arrows are drawn as SVG so the keycaps look the same everywhere (no emoji fonts).
const arrow = (rot: number) =>
  `<svg class="mt-key-arrow" viewBox="0 0 24 24" aria-hidden="true" style="transform:rotate(${rot}deg)"><path d="M12 3 L21 13 H15.5 V21 H8.5 V13 H3 Z" fill="currentColor"/></svg>`;
const ARROW = { up: arrow(0), right: arrow(90), down: arrow(180), left: arrow(270) };
const key = (label: string, wide = false, name = label) =>
  `<kbd class="mt-key${wide ? ' mt-key--wide' : ''}" aria-label="${name}">${label}</kbd>`;
const part = (id: HintPart, inner: string) => `<span class="mt-hint-part" data-part="${id}">${inner}</span>`;

const HINT_HTML: Record<HintKind, string> = {
  rotate: `<div class="mt-hint-bar">${[
    part('fly', `${key(ARROW.up, false, 'Up')} Fly`),
    part('turn', `${key(ARROW.left, false, 'Left')}${key(ARROW.right, false, 'Right')} Turn`),
    part('brake', `${key(ARROW.down, false, 'Down')} Brake`),
    part('fire', `${key('Space', true)} Fire`),
  ].join('')}</div>`,
  direct: `<div class="mt-hint-bar">${[
    part('move', `${key(ARROW.up, false, 'Up')}${key(ARROW.down, false, 'Down')}${key(ARROW.left, false, 'Left')}${key(ARROW.right, false, 'Right')} Move`),
    part('fire', `${key('Space', true)} Fire`),
  ].join('')}</div>`,
  tapdrag: `<div class="mt-hint-bar mt-hint-bar--touch">${[
    part('drag', `<span class="mt-hint-finger" aria-hidden="true"></span>Drag to fly`),
    part('fire', `<span class="mt-hint-tapdot" aria-hidden="true"></span>Tap a rock to shoot`),
  ].join('')}</div>`,
  touch: `
    <div class="mt-hint-touch mt-hint-touch--stick mt-hint-part" data-part="stick">
      <span class="mt-hint-finger" aria-hidden="true"></span>Drag here to fly</div>
    <div class="mt-hint-touch mt-hint-touch--fire mt-hint-part" data-part="fire">
      Tap <b>FIRE</b> or tap a rock</div>`,
};

/**
 * In-level DOM overlay (inside the game container, not #ui-root): equation
 * banner, hull indicators, score, level/stage, pause button and pause overlay.
 */
export class Hud {
  readonly root: HTMLDivElement;
  private banner: HTMLDivElement;
  private eq: HTMLSpanElement;
  private hull: HTMLDivElement;
  private score: HTMLSpanElement;
  private level: HTMLDivElement;
  private pauseBtn: HTMLButtonElement;
  private pausedEl: HTMLDivElement;
  private msgEl: HTMLDivElement;
  private hintEl: HTMLDivElement;
  private hintParts = new Map<HintPart, HTMLElement>();

  constructor(container: HTMLElement, onPause: () => void, onResume: () => void) {
    const root = document.createElement('div');
    root.className = 'mt-hud';
    root.innerHTML = `
      <div class="mt-hud-hull" aria-label="Ship hull"></div>
      <div class="mt-hud-banner" role="status" aria-live="polite"><span class="mt-hud-eq"></span></div>
      <div class="mt-hud-right">
        <div class="mt-hud-score"><span class="mt-hud-score-label">Score</span> <span class="mt-hud-score-val">0</span></div>
        <button class="mt-hud-pause" type="button" aria-label="Pause"><span></span><span></span></button>
      </div>
      <div class="mt-hud-level"></div>
      <div class="mt-hud-msg"></div>
      <div class="mt-hint" aria-live="polite"></div>
      <div class="mt-hud-paused">
        <div class="mt-hud-paused-card">
          <div class="mt-hud-paused-title">Paused</div>
          <button class="mt-hud-resume" type="button">▶ Resume</button>
          <div class="mt-hud-paused-hint">Press P to keep flying</div>
        </div>
      </div>`;
    container.appendChild(root);
    this.root = root;
    const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    this.banner = q('.mt-hud-banner');
    this.eq = q('.mt-hud-eq');
    this.hull = q('.mt-hud-hull');
    this.score = q('.mt-hud-score-val');
    this.level = q('.mt-hud-level');
    this.pauseBtn = q('.mt-hud-pause');
    this.pausedEl = q('.mt-hud-paused');
    this.msgEl = q('.mt-hud-msg');
    this.hintEl = q('.mt-hint');
    this.pauseBtn.addEventListener('click', () => onPause());
    q<HTMLButtonElement>('.mt-hud-resume').addEventListener('click', () => onResume());
  }

  show(on: boolean): void {
    this.root.classList.toggle('mt-hud--on', on);
    if (!on) {
      this.setPaused(false);
      this.setMessage(null);
      this.hideHint();
    }
  }

  /** Show the controls hint (bottom-center for keys, next to the touch controls on touch). */
  showHint(kind: HintKind): void {
    this.hintEl.innerHTML = HINT_HTML[kind];
    this.hintEl.className = `mt-hint mt-hint--${kind === 'touch' || kind === 'tapdrag' ? 'touch' : 'keys'} mt-hint--on`;
    this.hintParts.clear();
    this.hintEl.querySelectorAll<HTMLElement>('[data-part]').forEach((el) => {
      this.hintParts.set(el.dataset.part as HintPart, el);
    });
  }

  /** The player used this control: fade its chip. Returns true once every chip is done. */
  hintUsed(p: HintPart): boolean {
    const el = this.hintParts.get(p);
    if (el) {
      el.classList.add('mt-hint-part--done');
      this.hintParts.delete(p);
    }
    if (this.hintParts.size === 0) this.hintEl.classList.remove('mt-hint--on');
    return this.hintParts.size === 0;
  }

  /** Does the hint still show `p`? */
  hintHas(p: HintPart): boolean {
    return this.hintParts.has(p);
  }

  /** Fade the whole hint out. */
  hideHint(): void {
    this.hintParts.clear();
    this.hintEl.classList.remove('mt-hint--on');
  }

  setLevel(levelNumber: number, stageName: string): void {
    this.level.textContent = `Level ${levelNumber} · ${stageName}`;
  }

  setQuestion(prompt: string | null): void {
    if (prompt === null) {
      this.banner.classList.remove('mt-hud-banner--on');
      return;
    }
    this.eq.textContent = `${prompt} = ?`;
    this.banner.classList.add('mt-hud-banner--on');
    this.bump('mt-hud-banner--new');
  }

  /** Brief banner reaction: a bounce on correct, a wiggle on wrong. */
  react(kind: 'correct' | 'wrong'): void {
    this.bump(kind === 'correct' ? 'mt-hud-banner--correct' : 'mt-hud-banner--wrong');
  }

  private bump(cls: string): void {
    const b = this.banner;
    b.classList.remove('mt-hud-banner--new', 'mt-hud-banner--correct', 'mt-hud-banner--wrong');
    void b.offsetWidth;
    b.classList.add(cls);
  }

  setHull(hitsTaken: number, allowed: number, shield: ShieldState): void {
    let html = '';
    for (let i = 0; i < allowed; i++) {
      const lost = i >= allowed - hitsTaken;
      html += `<span class="mt-hud-life${lost ? ' mt-hud-life--lost' : ''}">${SHIP_SVG}</span>`;
    }
    if (shield !== 'none') html += `<span class="mt-hud-shield${shield === 'used' ? ' mt-hud-shield--used' : ''}">${SHIELD_SVG}</span>`;
    this.hull.innerHTML = html;
    this.hull.setAttribute('aria-label', `Ship hull: ${allowed - hitsTaken} of ${allowed}${shield === 'up' ? ', shield ready' : ''}`);
  }

  setScore(score: number): void {
    this.score.textContent = String(score);
  }

  setMessage(text: string | null, kind: 'clear' | 'fail' = 'clear'): void {
    if (text === null) {
      this.msgEl.classList.remove('mt-hud-msg--on');
      return;
    }
    this.msgEl.textContent = text;
    this.msgEl.className = `mt-hud-msg mt-hud-msg--on mt-hud-msg--${kind}`;
  }

  setPaused(on: boolean): void {
    this.pausedEl.classList.toggle('mt-hud-paused--on', on);
  }

  dispose(): void {
    this.root.remove();
  }
}
