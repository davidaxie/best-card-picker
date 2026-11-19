// The in-page pill. Drawn in a closed Shadow DOM so site styles cannot reach it. At most one per page.
// It moves to whichever corner does not cover card fields or payment iframes.
import { paymentElements } from './detect';

export interface PillData {
  cardName: string;
  color: string;
  rateText: string;
  runnerUpName: string | null;
  detail: string;
  warnings: string[];
  domain: string;
}

const HOST_TAG = 'bcp-pill-host';
let current: { host: HTMLElement; root: ShadowRoot; cleanup: () => void } | null = null;

export function pillShown(): boolean {
  return current !== null && document.documentElement.contains(current.host);
}

export function removePill(): void {
  if (!current) return;
  current.cleanup();
  current.host.remove();
  current = null;
}

type Corner = 'br' | 'tr' | 'bl' | 'tl';
const CORNERS: Corner[] = ['br', 'tr', 'bl', 'tl'];
const MARGIN = 16;

function cornerRect(c: Corner, w: number, h: number): DOMRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = c === 'br' || c === 'tr' ? vw - w - MARGIN : MARGIN;
  const y = c === 'br' || c === 'bl' ? vh - h - MARGIN : MARGIN;
  return new DOMRect(x, y, w, h);
}

function overlap(a: DOMRect, b: DOMRect): number {
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return x * y;
}

/** Pick the first corner that covers no payment element, else the one covering least. */
export function chooseCorner(w: number, h: number, avoid: DOMRect[]): Corner {
  let best: Corner = 'br';
  let bestArea = Infinity;
  for (const c of CORNERS) {
    const r = cornerRect(c, w, h);
    const area = avoid.reduce((s, a) => s + overlap(r, a), 0);
    if (area === 0) return c;
    if (area < bestArea) {
      best = c;
      bestArea = area;
    }
  }
  return best;
}

function place(host: HTMLElement): void {
  const box = host.getBoundingClientRect();
  const w = box.width || 340;
  const h = box.height || 90;
  const avoid = paymentElements(document)
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  const c = chooseCorner(w, h, avoid);
  host.style.top = c === 'tr' || c === 'tl' ? `${MARGIN}px` : 'auto';
  host.style.bottom = c === 'br' || c === 'bl' ? `${MARGIN}px` : 'auto';
  host.style.right = c === 'br' || c === 'tr' ? `${MARGIN}px` : 'auto';
  host.style.left = c === 'bl' || c === 'tl' ? `${MARGIN}px` : 'auto';
  host.dataset.corner = c;
}

const CSS = `
:host { all: initial; }
.pill { box-sizing: border-box; width: 340px; max-width: calc(100vw - 32px); font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #111; background: #fff; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18); border-left: 6px solid var(--card); padding: 10px 12px; }
.main { font-weight: 600; font-size: 14px; }
.detail { color: #444; margin-top: 2px; }
.warn { color: #8a4b00; margin-top: 4px; }
.row { display: flex; gap: 8px; margin-top: 8px; }
button { all: unset; cursor: pointer; font-size: 12px; line-height: 1; padding: 6px 10px; border-radius: 999px; background: #f1f1f1; color: #111; }
button:hover { background: #e4e4e4; }
button:focus-visible { outline: 2px solid #1a4c8b; }
@media (prefers-color-scheme: dark) {
  .pill { background: #1f1f1f; color: #f2f2f2; } .detail { color: #c8c8c8; } .warn { color: #f0b35a; }
  button { background: #333; color: #f2f2f2; } button:hover { background: #444; }
}`;

export function showPill(data: PillData, actions: { notNow: () => void; never: () => void }): void {
  removePill();
  for (const stale of Array.from(document.querySelectorAll(HOST_TAG))) stale.remove();
  const host = document.createElement(HOST_TAG);
  host.style.cssText = 'position:fixed;z-index:2147483647;bottom:16px;right:16px;display:block;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.setAttribute('role', 'status');
  pill.setAttribute('aria-live', 'polite');
  pill.style.setProperty('--card', data.color);

  const main = document.createElement('div');
  main.className = 'main';
  main.textContent = `Use ${data.cardName} · ${data.rateText}${data.runnerUpName ? ` · runner-up ${data.runnerUpName}` : ''}`;
  const detail = document.createElement('div');
  detail.className = 'detail';
  detail.textContent = data.detail;
  pill.append(main, detail);
  for (const w of data.warnings) {
    const el = document.createElement('div');
    el.className = 'warn';
    el.textContent = w;
    pill.append(el);
  }
  const row = document.createElement('div');
  row.className = 'row';
  const notNow = document.createElement('button');
  notNow.textContent = 'Not now';
  notNow.addEventListener('click', () => {
    removePill();
    actions.notNow();
  });
  const never = document.createElement('button');
  never.textContent = 'Never on this site';
  never.addEventListener('click', () => {
    removePill();
    actions.never();
  });
  row.append(notNow, never);
  pill.append(row);
  root.append(style, pill);
  document.documentElement.append(host);

  let pending = 0;
  const reposition = () => {
    if (pending) return;
    pending = window.setTimeout(() => {
      pending = 0;
      place(host);
    }, 150);
  };
  place(host);
  window.addEventListener('resize', reposition, { passive: true });
  window.addEventListener('scroll', reposition, { passive: true, capture: true });
  current = {
    host,
    root,
    cleanup: () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, { capture: true });
      if (pending) clearTimeout(pending);
    },
  };
}
