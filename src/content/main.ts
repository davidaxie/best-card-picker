// Content script. Never registered on any site: the service worker injects it into the active tab
// only after the user clicks the toolbar icon (activeTab + scripting). It reports the page,
// outlines the matching saved card, and keeps that outline in place for a short while as the
// checkout re-renders. It never reads input values, never changes form state and never clicks.
import { collectPage, scanCheckout } from './detect';
import { highlightState, removeHighlight, showHighlight } from './highlight';
import { findSavedCards, matchSaved, type SavedStatus, type SavedTargets } from './saved-cards';

declare global {
  interface Window {
    __bcpLoaded?: boolean;
  }
}

/** How long after a click the outline keeps re-checking a page that re-renders. */
const FOLLOW_MS = 60_000;

function start(): void {
  if (window.__bcpLoaded || window.top !== window) return;
  window.__bcpLoaded = true;

  let targets: SavedTargets | null = null;
  let lastStatus: SavedStatus | null = null;
  let lastReportKey = '';
  let observer: MutationObserver | null = null;
  let stopTimer = 0;

  /** Find the site's saved cards and outline the match. Local only. */
  const applySaved = (): void => {
    if (!targets) {
      removeHighlight();
      lastStatus = null;
      return;
    }
    const m = matchSaved(findSavedCards(document), targets);
    if (m.element && m.target) showHighlight(m.element, { label: m.status === 'best' ? 'Best card' : 'Runner-up', color: m.target.color });
    else removeHighlight();
    lastStatus = m.status;
    const reportKey = `${location.href}|${m.status}|${m.target?.cardId ?? ''}`;
    if (reportKey !== lastReportKey) {
      lastReportKey = reportKey;
      void chrome.runtime
        .sendMessage({ type: 'saved', url: location.href, status: m.status, cardId: m.target?.cardId ?? null, found: m.found })
        .catch(() => undefined);
    }
  };

  const follow = (): void => {
    observer?.disconnect();
    if (stopTimer) clearTimeout(stopTimer);
    let timer = 0;
    const startUrl = location.href;
    const stop = () => {
      observer?.disconnect();
      observer = null;
      if (location.href !== startUrl) removeHighlight();
    };
    observer = new MutationObserver(() => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        if (location.href !== startUrl) return stop(); // navigated inside the app: wait for the next click
        applySaved();
      }, 600);
    });
    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true, characterData: true });
    stopTimer = window.setTimeout(stop, FOLLOW_MS);
  };

  /** One click: tell the service worker about the page, then outline the card. */
  const run = async (): Promise<void> => {
    lastReportKey = '';
    let resp: { targets: SavedTargets | null } | undefined;
    try {
      resp = (await chrome.runtime.sendMessage({
        type: 'page',
        page: collectPage(document, location.href),
        checkout: scanCheckout(document, location.href),
      })) as { targets: SavedTargets | null };
    } catch {
      return; // extension reloaded or service worker unavailable
    }
    targets = resp?.targets ?? null;
    applySaved();
    follow();
  };

  void run();

  chrome.runtime.onMessage.addListener((msg: { type?: string }, _sender, sendResponse) => {
    if (msg?.type === 'point') {
      void run().then(() => sendResponse({ ok: true, status: lastStatus }));
      return true;
    }
    if (msg?.type === 'pageState') {
      sendResponse({ saved: lastStatus, highlight: highlightState(), following: observer !== null });
      return false;
    }
    return false;
  });
}

start();
