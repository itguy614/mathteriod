/** Tiny DOM helpers: no framework, just readable element construction. */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & {
  class?: string;
  style?: string | Partial<CSSStyleDeclaration>;
  dataset?: Record<string, string>;
};

/**
 * h('button', { class: 'btn', onclick: fn }, 'Play')
 * Keys starting with "on" become event listeners; others become properties
 * when the element has them, otherwise attributes.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') el.className = String(value);
      else if (key === 'style') {
        if (typeof value === 'string') el.setAttribute('style', value);
        else Object.assign(el.style, value);
      } else if (key === 'dataset') Object.assign(el.dataset, value as Record<string, string>);
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (key in el && !key.includes('-')) {
        (el as unknown as Record<string, unknown>)[key] = value;
      } else {
        el.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  append(el, children);
  return el;
}

function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c);
    else if (c === null || c === undefined || c === false) continue;
    else el.append(c instanceof Node ? c : String(c));
  }
}

/** Replace all children of an element. */
export function setChildren(el: Element, ...children: (Child | Child[])[]): void {
  el.replaceChildren();
  append(el, children);
}

/** Stardust amount, formatted with the sparkle icon. */
export function stardustBadge(amount: number, extraClass = ''): HTMLElement {
  return h(
    'span',
    { class: `stardust ${extraClass}`.trim(), 'aria-label': `${amount} stardust` },
    h('span', { class: 'stardust-icon', 'aria-hidden': 'true' }, '✦'),
    h('span', { class: 'stardust-amount' }, amount.toLocaleString()),
  );
}

/** Animate a number from `from` to `to` inside `el`. Returns a cancel function. */
export function countUp(el: HTMLElement, from: number, to: number, ms = 1200, onTick?: () => void): () => void {
  let raf = 0;
  const start = performance.now();
  let lastShown = from;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - t, 3);
    const v = Math.round(from + (to - from) * eased);
    if (v !== lastShown) {
      lastShown = v;
      onTick?.();
    }
    el.textContent = v.toLocaleString();
    if (t < 1) raf = requestAnimationFrame(step);
  };
  el.textContent = from.toLocaleString();
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
