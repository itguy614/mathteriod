import type { TouchMode } from '../types';
import { TOUCH } from './constants';
import type { Controls } from './ship';

const KEY_LEFT = new Set(['ArrowLeft', 'KeyA']);
const KEY_RIGHT = new Set(['ArrowRight', 'KeyD']);
const KEY_UP = new Set(['ArrowUp', 'KeyW']);
const KEY_DOWN = new Set(['ArrowDown', 'KeyS']);
const KEY_FIRE = new Set(['Space']);
const KEY_PAUSE = new Set(['KeyP', 'Escape']);
const GAME_KEYS = new Set([...KEY_LEFT, ...KEY_RIGHT, ...KEY_UP, ...KEY_DOWN, ...KEY_FIRE]);

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export interface InputHooks {
  onPauseKey(): void;
  /** Tap-to-target at a client position (mouse click, or a quick touch on a rock). */
  onTap(clientX: number, clientY: number): void;
  /** Is there a live, targetable numbered rock under this client position (generous padding)? */
  pickRock(clientX: number, clientY: number, padPx: number): boolean;
  /** Client position → world coordinates. */
  toWorld(clientX: number, clientY: number): { x: number; y: number };
}

/**
 * Per-pointer gesture state. Every touch is classified on its own, so one finger
 * can fly while another taps FIRE or a rock.
 *  pending – started on a rock; becomes a tap if it ends quickly without moving,
 *            otherwise converts (tapdrag → fly, joystick → stick when inside the stick).
 *  fly     – tapdrag: the ship steers toward this finger.
 *  stick   – joystick: drives the fixed stick (only once "armed" by moving or holding).
 *  ignore  – nothing (e.g. empty space outside the stick in joystick mode).
 */
interface Ptr {
  id: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  t0: number;
  kind: 'pending' | 'fly' | 'stick' | 'ignore';
  inStick: boolean;
  armed: boolean;
  el: Element;
}

/**
 * Keyboard + mouse + touch input.
 *
 * Touch ('tapdrag', the default): quick tap on a rock = tap-to-target; touch on
 * empty space, a hold, or a drag = fly toward the finger (a ring shows the target).
 * Touch ('joystick'): a small fixed stick bottom-left (its capture area is a modest
 * circle around it) + tap rocks anywhere. Both modes have a FIRE button (exclusive
 * hit area; hold = auto-fire).
 */
export class Input {
  /** Only when enabled (a level is running) are keys and touches captured. */
  private enabled = false;
  private keys = new Set<string>();
  private firePresses = 0;
  private fireTouch = false;
  private fireId = -1;
  private touchCapable: boolean;
  private touchMode: TouchMode = 'tapdrag';
  private ptrs = new Map<number, Ptr>();
  private flyId = -1;
  private stickId = -1;
  private stickVec = { x: 0, y: 0 };
  private stickCenter = { x: 0, y: 0, r: 60 };
  private used = { fly: false, stick: false };

  private root: HTMLDivElement;
  private zone: HTMLDivElement;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private fireBtn: HTMLButtonElement;
  private ring: HTMLDivElement;
  private cleanup: Array<() => void> = [];

  constructor(
    private container: HTMLElement,
    private hooks: InputHooks,
  ) {
    this.touchCapable =
      (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0;

    this.root = document.createElement('div');
    this.root.className = 'mt-touch mt-touch--tapdrag';
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
    this.ring = document.createElement('div');
    this.ring.className = 'mt-fly-ring';
    this.root.append(this.ring, this.zone, this.fireBtn);
    container.appendChild(this.root);

    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => this.releaseAll());

    // FIRE: exclusive hit area (its own pointer, never reaches the field handlers)
    this.listen(this.fireBtn, 'pointerdown', (e) => {
      const pe = e as PointerEvent;
      pe.preventDefault();
      pe.stopPropagation();
      if (!this.enabled || this.paused) return;
      this.fireTouch = true;
      this.fireId = pe.pointerId;
      this.firePresses++;
      this.fireBtn.classList.add('mt-fire--down');
      try {
        this.fireBtn.setPointerCapture(pe.pointerId);
      } catch {
        /* ignore */
      }
    });
    const fireUp = (e: Event) => {
      const pe = e as PointerEvent;
      e.stopPropagation();
      if (pe.pointerId !== this.fireId) return;
      this.fireTouch = false;
      this.fireId = -1;
      this.fireBtn.classList.remove('mt-fire--down');
    };
    this.listen(this.fireBtn, 'pointerup', fireUp);
    this.listen(this.fireBtn, 'pointercancel', fireUp);
    this.listen(this.fireBtn, 'contextmenu', (e) => e.preventDefault());

    // the play field (canvas) and the joystick circle
    this.listen(container, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.listen(container, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.listen(container, 'pointerup', (e) => this.onUp(e as PointerEvent, false));
    this.listen(container, 'pointercancel', (e) => this.onUp(e as PointerEvent, true));
    // no long-press menus, scrolling, pinch zoom or double-tap zoom over the game
    this.listen(container, 'contextmenu', (e) => {
      if (this.enabled || this.touchCapable) e.preventDefault();
    });
    this.listen(container, 'touchstart', (e) => {
      if (!this.touchCapable) {
        this.touchCapable = true;
        this.refreshTouch();
      }
      if (this.enabled && e.cancelable && !(e.target as HTMLElement | null)?.closest?.('button')) e.preventDefault();
    }, { passive: false });
    this.listen(container, 'touchmove', (e) => {
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    this.listen(document, 'gesturestart', (e) => {
      if (this.enabled) e.preventDefault();
    });
    this.listen(container, 'dblclick', (e) => e.preventDefault());

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

  setTouchMode(mode: TouchMode): void {
    this.touchMode = mode === 'joystick' ? 'joystick' : 'tapdrag';
    this.releaseAll();
    this.root.classList.toggle('mt-touch--joystick', this.touchMode === 'joystick');
    this.root.classList.toggle('mt-touch--tapdrag', this.touchMode === 'tapdrag');
  }

  get mode(): TouchMode {
    return this.touchMode;
  }

  /** Visible on-screen controls (FIRE, and the stick in joystick mode) in client px. */
  controlRects(): { fire: DOMRect | null; stick: DOMRect | null } {
    if (!this.root.classList.contains('mt-touch--on')) return { fire: null, stick: null };
    return {
      fire: this.fireBtn.getBoundingClientRect(),
      stick: this.touchMode === 'joystick' ? this.base.getBoundingClientRect() : null,
    };
  }

  /** Make FIRE see-through while a rock sits under it. */
  setFireDim(on: boolean): void {
    this.fireBtn.classList.toggle('mt-fire--dim', on);
  }

  get isTouch(): boolean {
    return this.touchCapable;
  }

  /** Has the player flown by dragging / used the stick since the last call? (for the hint) */
  consumeUsed(): { fly: boolean; stick: boolean } {
    const u = { ...this.used };
    this.used.fly = false;
    this.used.stick = false;
    return u;
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
        this.hooks.onPauseKey();
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

  // -------------------------------------------------------------------------
  // Pointers

  private onDown(e: PointerEvent): void {
    if (!this.enabled || this.paused) return;
    const t = e.target as HTMLElement | null;
    if (!t) return;
    const onCanvas = t.classList.contains('mt-canvas');
    const onZone = this.touchMode === 'joystick' && (t === this.zone || this.zone.contains(t));
    // HUD widgets, buttons, FIRE etc. never start gameplay gestures
    if (!onCanvas && !onZone) return;

    if (e.pointerType === 'mouse') {
      // desktop: click-to-target, as before
      if (e.button === 0 && onCanvas) this.hooks.onTap(e.clientX, e.clientY);
      return;
    }
    e.preventDefault();
    if (!this.touchCapable) {
      this.touchCapable = true;
      this.refreshTouch();
    }
    const onRock = this.hooks.pickRock(e.clientX, e.clientY, TOUCH.rockPadPx);
    const p: Ptr = {
      id: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      x: e.clientX,
      y: e.clientY,
      // event timestamps, not handler time: a slow frame must not turn a tap into a hold
      t0: e.timeStamp,
      kind: 'ignore',
      inStick: false,
      armed: false,
      el: t,
    };
    if (this.touchMode === 'joystick') {
      this.measureStick();
      const c = this.stickCenter;
      p.inStick = Math.hypot(e.clientX - c.x, e.clientY - c.y) <= c.r * TOUCH.stickZoneMult;
      if (onRock) p.kind = 'pending';
      else if (p.inStick && this.stickId < 0) this.startStick(p);
    } else {
      if (onRock) p.kind = 'pending';
      else if (this.flyId < 0) this.startFly(p);
    }
    this.ptrs.set(p.id, p);
    try {
      t.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    this.advance(p, e.timeStamp);
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    this.ptrs.delete(p.id);
    if (p.kind === 'pending' && !cancelled && this.isTap(p, e.timeStamp)) {
      this.hooks.onTap(p.sx, p.sy);
    }
    if (p.id === this.flyId) this.endFly();
    if (p.id === this.stickId) this.endStick();
  }

  private isTap(p: Ptr, now: number): boolean {
    return now - p.t0 < TOUCH.tapMs && Math.hypot(p.x - p.sx, p.y - p.sy) < TOUCH.tapSlopPx;
  }

  /** Re-classify a pointer after it moved or time passed. */
  private advance(p: Ptr, now: number): void {
    if (p.kind === 'pending' && !this.isTap(p, now)) {
      // a rock touch that turned into a drag / hold: cancel the tap
      if (this.touchMode === 'tapdrag') {
        if (this.flyId < 0) this.startFly(p);
        else p.kind = 'ignore';
      } else if (p.inStick && this.stickId < 0) {
        this.startStick(p);
      } else {
        p.kind = 'ignore';
      }
    }
    if (p.kind === 'fly') this.placeRing(p);
    if (p.kind === 'stick') this.updateStick(p, now);
  }

  private startFly(p: Ptr): void {
    p.kind = 'fly';
    this.flyId = p.id;
    this.used.fly = true;
    this.ring.classList.add('mt-fly-ring--on');
    this.placeRing(p);
  }

  private endFly(): void {
    this.flyId = -1;
    this.ring.classList.remove('mt-fly-ring--on');
  }

  private placeRing(p: Ptr): void {
    const r = this.container.getBoundingClientRect();
    this.ring.style.transform = `translate(${p.x - r.left}px, ${p.y - r.top}px) translate(-50%, -50%)`;
  }

  private measureStick(): void {
    const r = this.base.getBoundingClientRect();
    if (r.width > 0) this.stickCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
  }

  private startStick(p: Ptr): void {
    p.kind = 'stick';
    this.stickId = p.id;
    this.base.classList.add('mt-stick-base--on');
    this.updateStick(p, p.t0);
  }

  private updateStick(p: Ptr, now: number): void {
    // a quick, still touch inside the stick never nudges the ship
    if (!p.armed && (Math.hypot(p.x - p.sx, p.y - p.sy) >= TOUCH.stickArmPx || now - p.t0 >= TOUCH.tapMs)) p.armed = true;
    const c = this.stickCenter;
    let dx = p.x - c.x;
    let dy = p.y - c.y;
    const len = Math.hypot(dx, dy);
    const max = c.r;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    if (p.armed) {
      this.stickVec.x = dx / max;
      this.stickVec.y = -dy / max;
      this.used.stick = true;
    }
  }

  private endStick(): void {
    this.stickId = -1;
    this.stickVec.x = 0;
    this.stickVec.y = 0;
    this.base.classList.remove('mt-stick-base--on');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private releaseAll(): void {
    this.keys.clear();
    this.fireTouch = false;
    this.fireId = -1;
    this.firePresses = 0;
    this.ptrs.clear();
    this.endFly();
    this.endStick();
    this.fireBtn.classList.remove('mt-fire--down', 'mt-fire--dim');
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
    const now = performance.now();
    for (const p of this.ptrs.values()) this.advance(p, now); // holds turn into fly/stick
    const has = (set: Set<string>) => {
      for (const k of set) if (this.keys.has(k)) return true;
      return false;
    };
    const left = has(KEY_LEFT);
    const right = has(KEY_RIGHT);
    const up = has(KEY_UP);
    const down = has(KEY_DOWN);
    // 'rotate' mode reads turn/thrust/brake; 'direct' mode reads moveX/moveY
    out.turn = (left ? 1 : 0) - (right ? 1 : 0);
    out.thrust = up ? 1 : 0;
    out.brake = down ? 1 : 0;
    out.moveX = (right ? 1 : 0) - (left ? 1 : 0);
    out.moveY = (up ? 1 : 0) - (down ? 1 : 0);
    out.fire = has(KEY_FIRE) || this.fireTouch;
    const stick = this.stickId >= 0 ? this.ptrs.get(this.stickId) : undefined;
    out.stickActive = !!stick && stick.armed;
    out.stickX = out.stickActive ? this.stickVec.x : 0;
    out.stickY = out.stickActive ? this.stickVec.y : 0;
    const fly = this.flyId >= 0 ? this.ptrs.get(this.flyId) : undefined;
    out.flyActive = !!fly;
    if (fly) {
      const w = this.hooks.toWorld(fly.x, fly.y);
      out.flyX = w.x;
      out.flyY = w.y;
    }
    return out;
  }

  dispose(): void {
    for (const c of this.cleanup) c();
    this.cleanup.length = 0;
    this.root.remove();
  }
}
