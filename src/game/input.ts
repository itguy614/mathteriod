import type { Controls } from './ship';

const KEY_LEFT = new Set(['ArrowLeft', 'KeyA']);
const KEY_RIGHT = new Set(['ArrowRight', 'KeyD']);
const KEY_UP = new Set(['ArrowUp', 'KeyW']);
const KEY_FIRE = new Set(['Space']);
const KEY_PAUSE = new Set(['KeyP', 'Escape']);
const GAME_KEYS = new Set([...KEY_LEFT, ...KEY_RIGHT, ...KEY_UP, ...KEY_FIRE, 'ArrowDown', 'KeyS']);

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Keyboard + touch input. Touch controls (floating joystick on the left half,
 * big FIRE button on the right) appear automatically on touch devices while a
 * level is running.
 */
export class Input {
  /** Only when enabled (a level is running) are keys captured. */
  private enabled = false;
  private keys = new Set<string>();
  private firePresses = 0;
  private fireTouch = false;
  private stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private touchCapable: boolean;

  private root: HTMLDivElement;
  private zone: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private fireBtn: HTMLButtonElement;
  private cleanup: Array<() => void> = [];

  constructor(
    private container: HTMLElement,
    private onPauseKey: () => void,
    private onTap: (clientX: number, clientY: number) => void,
  ) {
    this.touchCapable =
      (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;

    this.root = document.createElement('div');
    this.root.className = 'mt-touch';
    this.zone = document.createElement('div');
    this.zone.className = 'mt-stick-zone';
    this.base = document.createElement('div');
    this.base.className = 'mt-stick-base';
    this.knob = document.createElement('div');
    this.knob.className = 'mt-stick-knob';
    this.base.appendChild(this.knob);
    this.zone.appendChild(this.base);
    this.fireBtn = document.createElement('button');
    this.fireBtn.className = 'mt-fire';
    this.fireBtn.type = 'button';
    this.fireBtn.textContent = 'FIRE';
    this.fireBtn.setAttribute('aria-label', 'Fire');
    this.root.append(this.zone, this.fireBtn);
    container.appendChild(this.root);

    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => this.releaseAll());

    // joystick
    this.listen(this.zone, 'pointerdown', (e) => this.stickDown(e as PointerEvent));
    this.listen(this.zone, 'pointermove', (e) => this.stickMove(e as PointerEvent));
    this.listen(this.zone, 'pointerup', (e) => this.stickUp(e as PointerEvent));
    this.listen(this.zone, 'pointercancel', (e) => this.stickUp(e as PointerEvent));
    // fire button
    this.listen(this.fireBtn, 'pointerdown', (e) => {
      e.preventDefault();
      this.fireTouch = true;
      this.firePresses++;
      this.fireBtn.classList.add('mt-fire--down');
      try {
        this.fireBtn.setPointerCapture((e as PointerEvent).pointerId);
      } catch {
        /* ignore */
      }
    });
    const fireUp = () => {
      this.fireTouch = false;
      this.fireBtn.classList.remove('mt-fire--down');
    };
    this.listen(this.fireBtn, 'pointerup', fireUp);
    this.listen(this.fireBtn, 'pointercancel', fireUp);
    this.listen(this.fireBtn, 'contextmenu', (e) => e.preventDefault());

    // tap / click on the play field (outside joystick + fire zones) → tap-to-target
    this.listen(container, 'pointerdown', (e) => {
      const pe = e as PointerEvent;
      if (!this.enabled || this.paused) return;
      const t = pe.target as HTMLElement | null;
      if (!t || !t.classList.contains('mt-canvas')) return;
      if (pe.pointerType === 'mouse' && pe.button !== 0) return;
      this.onTap(pe.clientX, pe.clientY);
    });

    // no page scroll / pinch zoom / double-tap zoom over the game
    this.listen(container, 'touchstart', (e) => {
      if (!this.touchCapable) {
        this.touchCapable = true;
        this.refreshTouch();
      }
      if (this.enabled && e.cancelable && (e.target === this.zone || this.root.contains(e.target as Node))) e.preventDefault();
    }, { passive: false });
    this.listen(container, 'touchmove', (e) => {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    this.listen(document, 'gesturestart', (e) => {
      if (this.enabled) e.preventDefault();
    });

    this.refreshTouch();
  }

  private listen(
    target: EventTarget,
    type: string,
    fn: (e: Event) => void,
    opts?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, fn, opts);
    this.cleanup.push(() => target.removeEventListener(type, fn, opts));
  }

  /** While paused, input is ignored (including P/Escape). */
  private paused = false;
  setPaused(on: boolean): void {
    this.paused = on;
    if (on) this.releaseAll();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.releaseAll();
    this.refreshTouch();
  }

  get isTouch(): boolean {
    return this.touchCapable;
  }

  private refreshTouch(): void {
    this.root.classList.toggle('mt-touch--on', this.enabled && this.touchCapable);
    this.container.classList.toggle('mt-is-touch', this.touchCapable);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.enabled || isEditable(e.target)) return;
    if (KEY_PAUSE.has(e.code)) {
      // pause only; while paused the keys belong to main's pause menu
      if (down && !e.repeat && !this.paused) {
        e.preventDefault();
        this.onPauseKey();
      }
      return;
    }
    if (this.paused) return;
    if (!GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    if (down) {
      if (KEY_FIRE.has(e.code) && !e.repeat) this.firePresses++;
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
  }

  private stickDown(e: PointerEvent): void {
    if (this.stick.active) return;
    e.preventDefault();
    const r = this.zone.getBoundingClientRect();
    this.stick.active = true;
    this.stick.id = e.pointerId;
    this.stick.ox = e.clientX - r.left;
    this.stick.oy = e.clientY - r.top;
    this.stick.x = 0;
    this.stick.y = 0;
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this.base.style.left = `${this.stick.ox}px`;
    this.base.style.top = `${this.stick.oy}px`;
    this.base.classList.add('mt-stick-base--on');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private stickMove(e: PointerEvent): void {
    if (!this.stick.active || e.pointerId !== this.stick.id) return;
    const r = this.zone.getBoundingClientRect();
    const radius = Math.max(40, this.base.offsetWidth / 2);
    let dx = e.clientX - r.left - this.stick.ox;
    let dy = e.clientY - r.top - this.stick.oy;
    const len = Math.hypot(dx, dy);
    if (len > radius) {
      dx = (dx / len) * radius;
      dy = (dy / len) * radius;
    }
    this.stick.x = dx / radius;
    this.stick.y = -dy / radius;
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private stickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stick.id) return;
    this.stick.active = false;
    this.stick.id = -1;
    this.stick.x = 0;
    this.stick.y = 0;
    this.base.classList.remove('mt-stick-base--on');
  }

  private releaseAll(): void {
    this.keys.clear();
    this.fireTouch = false;
    this.firePresses = 0;
    this.stick.active = false;
    this.stick.id = -1;
    this.stick.x = 0;
    this.stick.y = 0;
    this.base.classList.remove('mt-stick-base--on');
    this.fireBtn.classList.remove('mt-fire--down');
  }

  /** Returns true once per new fire press (tap). */
  consumeFirePress(): boolean {
    if (this.firePresses > 0) {
      this.firePresses = 0;
      return true;
    }
    return false;
  }

  read(out: Controls): Controls {
    const has = (set: Set<string>) => {
      for (const k of set) if (this.keys.has(k)) return true;
      return false;
    };
    out.turn = (has(KEY_LEFT) ? 1 : 0) - (has(KEY_RIGHT) ? 1 : 0);
    out.thrust = has(KEY_UP) ? 1 : 0;
    out.fire = has(KEY_FIRE) || this.fireTouch;
    out.stickActive = this.stick.active;
    out.stickX = this.stick.x;
    out.stickY = this.stick.y;
    return out;
  }

  dispose(): void {
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
    this.root.remove();
  }
}
