// Content script entry (Auto mode only). Registered by the service worker after the user grants
// <all_urls> from the options page. Sends page structure to the service worker, shows the pill.
import { collectPage, scanCheckout } from './detect';
import { pillShown, removePill, showPill, type PillData } from './pill';

interface PageResponse {
  showPill: boolean;
  pill: PillData | null;
}

declare global {
  interface Window {
    __bcpLoaded?: boolean;
  }
}

function start(): void {
  if (window.__bcpLoaded || window.top !== window) return;
  window.__bcpLoaded = true;

  let lastKey = '';
  let lastPill: PillData | null = null;
  let dismissedUrl: string | null = null;

  const check = async (force = false): Promise<void> => {
    const url = location.href;
    const scan = scanCheckout(document, url);
    const key = `${url}|${scan.isCheckout}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    if (dismissedUrl && dismissedUrl !== url) dismissedUrl = null;
    let resp: PageResponse | undefined;
    try {
      resp = (await chrome.runtime.sendMessage({ type: 'page', page: collectPage(document, url), checkout: scan })) as PageResponse;
    } catch {
      return; // extension reloaded or service worker unavailable
    }
    if (resp?.showPill && resp.pill && dismissedUrl !== url) {
      lastPill = resp.pill;
      if (!pillShown()) {
        showPill(resp.pill, {
          notNow: () => {
            dismissedUrl = location.href;
            void chrome.runtime.sendMessage({ type: 'dismiss' }).catch(() => undefined);
          },
          never: () => void chrome.runtime.sendMessage({ type: 'never' }).catch(() => undefined),
        });
      }
    } else if (!resp?.showPill) {
      removePill();
    }
  };

  void check(true);

  // Single-page checkouts: re-check when the DOM settles or the URL changes, for a while.
  let timer = 0;
  const observer = new MutationObserver(() => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = 0;
      void check();
    }, 800);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 120_000);
  let lastUrl = location.href;
  window.setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      void check();
    }
  }, 1000);

  chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
    if (msg?.type === 'rescan') {
      void check(true).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (msg?.type === 'pillState') {
      const host = document.querySelector('bcp-pill-host') as HTMLElement | null;
      sendResponse({
        shown: pillShown(),
        count: document.querySelectorAll('bcp-pill-host').length,
        corner: host?.dataset.corner ?? null,
        pill: pillShown() ? lastPill : null,
      });
      return false;
    }
    return false;
  });
}

start();
