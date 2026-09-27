const SHIP_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L20 21 L12 17 L4 21 Z" fill="currentColor" stroke="#07051a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const SHIELD_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L20 5 V11 C20 16.5 16.5 20.5 12 22 C7.5 20.5 4 16.5 4 11 V5 Z" fill="currentColor" stroke="#07051a" stroke-width="1.6" stroke-linejoin="round"/></svg>';

export type ShieldState = 'none' | 'up' | 'used';

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
    this.pauseBtn.addEventListener('click', () => onPause());
    q<HTMLButtonElement>('.mt-hud-resume').addEventListener('click', () => onResume());
  }

  show(on: boolean): void {
    this.root.classList.toggle('mt-hud--on', on);
    if (!on) {
      this.setPaused(false);
      this.setMessage(null);
    }
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
