// Outline plus a small "Best card" tag over the matching saved card. It is an overlay: a fixed,
// pointer-events:none element in a closed Shadow DOM, appended to <html>, never inside the site's
// form. It never focuses, clicks, selects or changes anything; the user makes the final click.

const HOST_TAG = 'bcp-highlight-host';
const PAD = 4;

let current: { host: HTMLElement; target: Element; label: string; cleanup: () => void } | null = null;

export function highlightShown(): boolean {
  return current !== null && document.documentElement.contains(current.host);
}

export function highlightState(): { shown: boolean; label: string | null; count: number } {
  return { shown: highlightShown(), label: current?.label ?? null, count: document.querySelectorAll(HOST_TAG).length };
}

export function highlightTarget(): Element | null {
  return current?.target ?? null;
}

export function removeHighlight(): void {
  if (!current) return;
  current.cleanup();
  current.host.remove();
  current = null;
}

const CSS = `
:host { all: initial; }
.box { position: absolute; inset: 0; box-sizing: border-box; border: 3px solid var(--card); border-radius: 8px;
  box-shadow: 0 0 0 3px rgba(255,255,255,.85), 0 0 12px 2px var(--glow); }
.tag { position: absolute; top: -11px; right: 8px; padding: 2px 8px; border-radius: 999px; background: var(--card); color: #fff;
  font: 600 11px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; white-space: nowrap;
  box-shadow: 0 1px 4px rgba(0,0,0,.25); }
@media (prefers-reduced-motion: no-preference) { .box { animation: pop .25s ease-out; } }
@keyframes pop { from { transform: scale(1.03); opacity: 0; } to { transform: none; opacity: 1; } }`;

function place(host: HTMLElement, target: Element): void {
  const r = target.getBoundingClientRect();
  const visible = r.width > 0 && r.height > 0 && target.isConnected;
  host.style.display = visible ? 'block' : 'none';
  if (!visible) return;
  host.style.left = `${r.left - PAD}px`;
  host.style.top = `${r.top - PAD}px`;
  host.style.width = `${r.width + PAD * 2}px`;
  host.style.height = `${r.height + PAD * 2}px`;
}

export function showHighlight(target: Element, opts: { label: string; color: string }): void {
  if (current && current.target === target && current.label === opts.label && highlightShown()) {
    place(current.host, target);
    return;
  }
  removeHighlight();
  for (const stale of Array.from(document.querySelectorAll(HOST_TAG))) stale.remove();
  const host = document.createElement(HOST_TAG);
  host.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;display:block;margin:0;padding:0;';
  host.setAttribute('aria-hidden', 'true');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  const box = document.createElement('div');
  box.className = 'box';
  box.style.setProperty('--card', opts.color);
  box.style.setProperty('--glow', `${opts.color}66`);
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.textContent = opts.label;
  box.append(tag);
  root.append(style, box);
  document.documentElement.append(host);

  let frame = 0;
  const follow = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      place(host, target);
    });
  };
  place(host, target);
  window.addEventListener('resize', follow, { passive: true });
  window.addEventListener('scroll', follow, { passive: true, capture: true });
  // Layout shifts (an accordion opening, a banner loading) move the row without a scroll event.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(follow) : null;
  ro?.observe(target);
  ro?.observe(document.body);
  current = {
    host,
    target,
    label: opts.label,
    cleanup: () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, { capture: true });
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
