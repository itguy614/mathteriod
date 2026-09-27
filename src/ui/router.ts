import { h } from './dom';

/**
 * A screen is just a root element plus optional lifecycle hooks.
 * `passThrough` screens let pointer events fall through to the WebGL canvas
 * (used while a level is playing; only elements marked `.interactive` catch clicks).
 */
export interface Screen {
  el: HTMLElement;
  /** Called after the element is in the DOM. */
  onEnter?(): void;
  /** Called before the element is removed. Clean up timers/listeners here. */
  onLeave?(): void;
  passThrough?: boolean;
  /** Short name, handy for debugging and CSS (data-screen). */
  name: string;
}

/**
 * Minimal router: one active screen in #ui-root, plus a modal layer on top.
 * Screens are built by functions in ./screens and swapped with a quick fade.
 */
export class Router {
  private current: Screen | null = null;
  private screenLayer: HTMLElement;
  private modalLayer: HTMLElement;

  constructor(private root: HTMLElement) {
    this.screenLayer = h('div', { class: 'screen-layer' });
    this.modalLayer = h('div', { class: 'modal-layer' });
    root.replaceChildren(this.screenLayer, this.modalLayer);
  }

  get currentName(): string | null {
    return this.current?.name ?? null;
  }

  show(screen: Screen): void {
    this.closeModals();
    const prev = this.current;
    if (prev) {
      try {
        prev.onLeave?.();
      } catch (err) {
        console.error('[ui] onLeave failed', err);
      }
      const old = prev.el;
      old.classList.add('screen-leave');
      old.style.pointerEvents = 'none';
      setTimeout(() => old.remove(), 220);
    }
    this.current = screen;
    screen.el.classList.add('screen', 'screen-enter');
    screen.el.dataset.screen = screen.name;
    this.root.classList.toggle('pass-through', !!screen.passThrough);
    this.screenLayer.append(screen.el);
    requestAnimationFrame(() => screen.el.classList.remove('screen-enter'));
    screen.onEnter?.();
  }

  /** Show an element as a modal on top of the current screen. Returns a close function. */
  modal(content: HTMLElement, onDismiss?: () => void): () => void {
    const backdrop = h('div', { class: 'modal-backdrop' }, content);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      backdrop.classList.add('modal-leave');
      setTimeout(() => backdrop.remove(), 180);
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        onDismiss?.();
      }
    };
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        close();
        onDismiss?.();
      }
    });
    document.addEventListener('keydown', onKey, true);
    this.modalLayer.append(backdrop);
    return close;
  }

  closeModals(): void {
    this.modalLayer.replaceChildren();
  }

  /** Yes/no confirmation dialog. Resolves true on confirm. */
  confirm(opts: { icon?: string; title: string; body?: string; yes: string; no?: string; danger?: boolean }): Promise<boolean> {
    return new Promise((resolve) => {
      let close: () => void = () => {};
      const answer = (v: boolean) => {
        close();
        resolve(v);
      };
      const yesBtn = h(
        'button',
        { class: `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => answer(true) },
        opts.yes,
      );
      const panel = h(
        'div',
        { class: 'panel modal', role: 'dialog', 'aria-modal': 'true' },
        opts.icon ? h('div', { class: 'modal-icon' }, opts.icon) : null,
        h('h2', { class: 'modal-title' }, opts.title),
        opts.body ? h('p', { class: 'modal-body' }, opts.body) : null,
        h(
          'div',
          { class: 'btn-row' },
          h('button', { class: 'btn btn-ghost', onclick: () => answer(false) }, opts.no ?? 'Back'),
          yesBtn,
        ),
      );
      close = this.modal(panel, () => resolve(false));
      requestAnimationFrame(() => yesBtn.focus());
    });
  }
}
