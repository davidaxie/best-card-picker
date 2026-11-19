// Content script. Two ways in:
// - Auto mode: registered by the service worker after the user grants <all_urls>. Shows the pill on
//   checkout pages and outlines the best saved card.
// - Click mode: injected once into the active tab when the user presses "Point to my card" in the
//   popup (activeTab + scripting). Outlines the saved card only, no pill.
// It never reads input values, never changes form state and never clicks anything.
import { collectPage, scanCheckout } from './detect';
import { highlightState, removeHighlight, showHighlight } from './highlight';
import { pillShown, removePill, showPill, type PillData } from './pill';
import { findSavedCards, matchSaved, type SavedMatch, type SavedStatus, type SavedTargets } from './saved-cards';

type Mode = 'auto' | 'click';

interface PageResponse {
  showPill: boolean;
  pill: PillData | null;
  targets: SavedTargets | null;
}

declare global {
  interface Window {
    __bcpLoaded?: boolean;
    __bcpMode?: Mode;
  }
}

function noteFor(m: SavedMatch, targets: SavedTargets): string | null {
  const best = targets.best;
  if (m.status === 'runnerUp' && m.target) {
    return best
      ? `Your best card isn't saved here; ${m.target.name} ••${m.target.last4} is (outlined).`
      : `${m.target.name} ••${m.target.last4} is saved here (outlined).`;
  }
  if (m.status === 'best' && m.target) return `Outlined on the page: your saved ${m.target.name} ••${m.target.last4}.`;
  if (m.status === 'none' && best) return `${best.name} ••${best.last4} isn't among the cards saved on this site.`;
  return null;
}

function start(): void {
  if (window.__bcpLoaded || window.top !== window) return;
  window.__bcpLoaded = true;
  let mode: Mode = window.__bcpMode === 'click' ? 'click' : 'auto';

  let lastKey = '';
  let lastPill: PillData | null = null;
  let lastTargets: SavedTargets | null = null;
  let lastStatus: SavedStatus | null = null;
  let lastReportKey = '';
  let dismissedUrl: string | null = null;

  const pillActions = {
    notNow: () => {
      dismissedUrl = location.href;
      removeHighlight();
      void chrome.runtime.sendMessage({ type: 'dismiss' }).catch(() => undefined);
    },
    never: () => {
      removeHighlight();
      void chrome.runtime.sendMessage({ type: 'never' }).catch(() => undefined);
    },
  };

  /** Find the site's saved cards, outline the match, and refresh the pill line. Local only. */
  const applySaved = (): void => {
    const targets = lastTargets;
    if (!targets || dismissedUrl === location.href) {
      removeHighlight();
      lastStatus = null;
      return;
    }
    const m = matchSaved(findSavedCards(document), targets);
    if (m.element && m.target) {
      showHighlight(m.element, { label: m.status === 'best' ? 'Best card' : 'Runner-up', color: m.target.color });
    } else {
      removeHighlight();
    }
    const note = noteFor(m, targets);
    if (lastPill && mode === 'auto' && (lastPill.savedNote ?? null) !== note) {
      lastPill = { ...lastPill, savedNote: note };
      if (pillShown()) showPill(lastPill, pillActions);
    }
    lastStatus = m.status;
    const reportKey = `${location.href}|${m.status}|${m.target?.cardId ?? ''}`;
    if (reportKey !== lastReportKey) {
      lastReportKey = reportKey;
      void chrome.runtime
        .sendMessage({ type: 'saved', url: location.href, status: m.status, cardId: m.target?.cardId ?? null, found: m.found })
        .catch(() => undefined);
    }
  };

  const check = async (force = false): Promise<void> => {
    const url = location.href;
    const scan = scanCheckout(document, url);
    const key = `${url}|${scan.isCheckout}|${mode}`;
    if (!force && key === lastKey) {
      // Same page, but a saved-card list may have rendered since: re-match locally.
      if (lastTargets) applySaved();
      return;
    }
    lastKey = key;
    if (dismissedUrl && dismissedUrl !== url) dismissedUrl = null;
    let resp: PageResponse | undefined;
    try {
      resp = (await chrome.runtime.sendMessage({ type: 'page', page: collectPage(document, url), checkout: scan, mode })) as PageResponse;
    } catch {
      return; // extension reloaded or service worker unavailable
    }
    lastTargets = resp?.targets ?? null;
    if (mode === 'auto' && resp?.showPill && resp.pill && dismissedUrl !== url) {
      lastPill = { ...resp.pill, savedNote: lastPill?.savedNote ?? null };
      if (!pillShown()) showPill(lastPill, pillActions);
    } else if (mode === 'auto' && !resp?.showPill) {
      removePill();
      lastPill = null;
    }
    applySaved();
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
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true, characterData: true });
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
    if (msg?.type === 'point') {
      // Popup button: outline the saved card on this page even when it does not look like checkout.
      mode = 'click';
      dismissedUrl = null;
      lastReportKey = '';
      void check(true).then(() => sendResponse({ ok: true, status: lastStatus }));
      return true;
    }
    if (msg?.type === 'pillState') {
      const host = document.querySelector('bcp-pill-host') as HTMLElement | null;
      sendResponse({
        shown: pillShown(),
        count: document.querySelectorAll('bcp-pill-host').length,
        corner: host?.dataset.corner ?? null,
        pill: pillShown() ? lastPill : null,
        mode,
        saved: lastStatus,
        highlight: highlightState(),
      });
      return false;
    }
    return false;
  });
}

start();
