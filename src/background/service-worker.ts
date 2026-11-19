// Service worker: runs the engine, caches one result per tab, sets the toolbar badge and answers
// the popup. Click-only: nothing runs on a page until the user clicks the toolbar icon. Makes no
// network requests.
import merchantsData from '../../data/merchants.json';
import pslText from '../../data/public_suffix.dat?raw';
import type { Card, Category, MerchantsFile } from '../engine';
import { decide, isCategory, type Decision, type PageInfo } from '../shared/decide';
import { parsePsl } from '../shared/psl';
import { loadState, saveState, type Settings, type StoredState } from '../shared/state';
import type { CheckoutScan } from '../content/detect';
import type { CardTarget, SavedStatus, SavedTargets } from '../content/saved-cards';
import { capTogglesFor, type PopupData } from '../shared/view';

const merchants = merchantsData as MerchantsFile;
const psl = parsePsl(pslText);
/** Id of the all-sites content script that older builds registered for Auto mode. */
const OLD_AUTO_SCRIPT_ID = 'bcp-detect';

export interface SavedReport {
  url: string;
  status: SavedStatus;
  cardId: string | null;
  found: number;
}

interface TabEntry {
  page?: PageInfo;
  checkout?: CheckoutScan;
  decision?: Decision;
  saved?: SavedReport;
  savedWaiters?: ((r: SavedReport) => void)[];
}
const tabs = new Map<number, TabEntry>();

function entry(tabId: number): TabEntry {
  let e = tabs.get(tabId);
  if (!e) tabs.set(tabId, (e = {}));
  return e;
}

function cardById(state: StoredState, id: string | null): Card | undefined {
  return id ? state.cardsFile.cards.find((c) => c.id === id) : undefined;
}

async function setBadge(tabId: number, state: StoredState, d: Decision | undefined): Promise<void> {
  const card = d ? cardById(state, d.recommendation.cardId) : undefined;
  try {
    if (!card || state.settings.paused) {
      await chrome.action.setBadgeText({ tabId, text: '' });
      return;
    }
    await chrome.action.setBadgeText({ tabId, text: (card.shortCode ?? card.name.slice(0, 4)).slice(0, 4) });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: card.color ?? '#444444' });
    await chrome.action.setTitle({ tabId, title: `Best Card Picker: ${card.name}` });
  } catch {
    /* tab closed */
  }
}

function decisionFor(state: StoredState, tabId: number, page: PageInfo): Decision {
  const e = entry(tabId);
  if (e.decision && e.page?.url === page.url) return e.decision;
  e.page = page;
  e.decision = decide(state, merchants, psl, page);
  return e.decision;
}

function target(state: StoredState, id: string | null | undefined): CardTarget | null {
  const card = cardById(state, id ?? null);
  const last4 = card ? state.last4[card.id] : undefined;
  if (!card || !last4) return null;
  return { cardId: card.id, name: card.name, last4, network: card.network, color: card.color ?? '#444444' };
}

/** Best and runner-up with their saved last digits; null when neither has digits saved. */
function savedTargets(state: StoredState, d: Decision): SavedTargets | null {
  const best = target(state, d.recommendation.cardId);
  const runnerUp = target(state, d.recommendation.runnerUp?.cardId);
  return best || runnerUp ? { best, runnerUp } : null;
}

async function popupData(tabId: number): Promise<PopupData> {
  const state = await loadState();
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    tab = undefined;
  }
  const url = tab?.url ?? '';
  if (!/^https?:/i.test(url)) {
    return { supported: false, settings: state.settings, cardsFile: state.cardsFile } as PopupData;
  }
  const e = entry(tabId);
  const page: PageInfo = e.page && e.page.url === url ? e.page : { url, title: tab?.title ?? null };
  const saved = e.saved && e.saved.url === url ? e.saved : null;
  // The popup always recomputes: it is often answering a change the user just made, and
  // storage.onChanged (which clears the cache) may not have fired yet.
  e.decision = undefined;
  const d = decisionFor(state, tabId, page);
  await setBadge(tabId, state, d);
  return {
    supported: true,
    tabId,
    decision: d,
    settings: state.settings,
    cardsFile: state.cardsFile,
    capToggles: capTogglesFor(state, d.category),
    savedCategory: state.siteCategories[d.domain] ?? null,
    isCheckout: e.checkout?.isCheckout ?? null,
    last4: state.last4,
    saved,
    canPoint: Boolean(savedTargets(state, d)) && !state.settings.paused,
  };
}

/** The content script (injected by a click) reports the page; the answer carries the card digits. */
async function onPage(tabId: number, page: PageInfo, checkout: CheckoutScan): Promise<{ targets: SavedTargets | null }> {
  const state = await loadState();
  const e = entry(tabId);
  // The content script's report is richer than the url and title the popup may have cached.
  e.decision = undefined;
  e.checkout = checkout;
  const d = decisionFor(state, tabId, page);
  await setBadge(tabId, state, d);
  return { targets: state.settings.paused ? null : savedTargets(state, d) };
}

function waitForSaved(tabId: number, ms: number): Promise<SavedReport | null> {
  const e = entry(tabId);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    (e.savedWaiters ??= []).push((r) => {
      clearTimeout(t);
      resolve(r);
    });
  });
}

/**
 * Popup asked to outline the saved card on this tab. Runs only after a click on the toolbar icon:
 * activeTab gives access to this one tab, and scripting (optional, no install warning) injects.
 */
async function point(tabId: number): Promise<PopupData> {
  const e = entry(tabId);
  e.saved = undefined;
  const waiting = waitForSaved(tabId, 2500);
  let reached = false;
  try {
    const r = (await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'point' }),
      new Promise((resolve) => setTimeout(() => resolve(null), 400)),
    ])) as { ok?: boolean } | null;
    reached = r?.ok === true;
  } catch {
    reached = false;
  }
  if (!reached) {
    if (!chrome.scripting) return popupData(tabId);
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch {
      return popupData(tabId);
    }
  }
  await waiting;
  return popupData(tabId);
}

async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const state = await loadState();
  const settings = { ...state.settings, ...patch };
  await saveState({ settings });
  return settings;
}

/**
 * Older builds had an Auto mode that ran on every site. Remove what it left behind: the registered
 * all-sites script, the all-sites permission and its stored settings.
 */
async function removeOldAutoMode(): Promise<void> {
  try {
    if (chrome.scripting?.getRegisteredContentScripts) {
      const old = await chrome.scripting.getRegisteredContentScripts({ ids: [OLD_AUTO_SCRIPT_ID] });
      if (old.length) await chrome.scripting.unregisterContentScripts({ ids: [OLD_AUTO_SCRIPT_ID] });
    }
  } catch {
    /* nothing registered */
  }
  try {
    if (await chrome.permissions.contains({ origins: ['<all_urls>'] })) await chrome.permissions.remove({ origins: ['<all_urls>'] });
  } catch {
    /* not granted, or not removable in this build */
  }
  const raw = (await chrome.storage.local.get(['settings', 'neverSites'])) as { settings?: Record<string, unknown>; neverSites?: unknown };
  if (raw.settings && 'autoMode' in raw.settings) {
    const { autoMode: _drop, ...rest } = raw.settings;
    await chrome.storage.local.set({ settings: rest });
  }
  if (raw.neverSites !== undefined) await chrome.storage.local.remove('neverSites');
}

type Msg =
  | { type: 'page'; page: PageInfo; checkout: CheckoutScan }
  | { type: 'saved'; url: string; status: SavedStatus; cardId: string | null; found: number }
  | { type: 'point'; tabId: number }
  | { type: 'popup'; tabId: number }
  | { type: 'setCategory'; tabId: number; domain: string; category: Category | null }
  | { type: 'setForeign'; tabId: number; domain: string; value: boolean | null }
  | { type: 'setCap'; tabId: number; cardId: string; category: Category; reached: boolean }
  | { type: 'setSettings'; patch: Partial<Settings> };

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const fromTab = sender.tab?.id;
  switch (msg.type) {
    case 'page':
      return fromTab === undefined ? null : onPage(fromTab, msg.page, msg.checkout);
    case 'saved': {
      if (fromTab === undefined) return null;
      const e = entry(fromTab);
      e.saved = { url: msg.url, status: msg.status, cardId: msg.cardId, found: msg.found };
      const waiters = e.savedWaiters ?? [];
      e.savedWaiters = [];
      for (const w of waiters) w(e.saved);
      return { ok: true };
    }
    case 'point':
      return point(msg.tabId);
    case 'popup':
      return popupData(msg.tabId);
    case 'setCategory': {
      const state = await loadState();
      const siteCategories = { ...state.siteCategories };
      if (msg.category && isCategory(msg.category)) siteCategories[msg.domain] = msg.category;
      else delete siteCategories[msg.domain];
      await saveState({ siteCategories });
      return popupData(msg.tabId);
    }
    case 'setForeign': {
      const state = await loadState();
      const siteForeign = { ...state.siteForeign };
      if (msg.value === null) delete siteForeign[msg.domain];
      else siteForeign[msg.domain] = msg.value;
      await saveState({ siteForeign });
      return popupData(msg.tabId);
    }
    case 'setCap': {
      const state = await loadState();
      const capState = JSON.parse(JSON.stringify(state.capState)) as StoredState['capState'];
      const forCard = (capState[msg.cardId] ??= {});
      forCard[msg.category] = { ...(forCard[msg.category] ?? {}), reached: msg.reached };
      await saveState({ capState });
      return popupData(msg.tabId);
    }
    case 'setSettings':
      return updateSettings(msg.patch);
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  handle(msg, sender).then(sendResponse, (err: unknown) => sendResponse({ error: String(err) }));
  return true;
});

// Any change to rules, choices, caps or settings invalidates cached results so the next
// recommendation uses it without a reload.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local') return;
  void (async () => {
    const state = await loadState();
    for (const [tabId, e] of tabs) {
      e.decision = undefined;
      if (e.page) await setBadge(tabId, state, decisionFor(state, tabId, e.page));
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => tabs.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    const e = tabs.get(tabId);
    if (e) {
      e.page = undefined;
      e.decision = undefined;
      e.checkout = undefined;
      e.saved = undefined;
    }
  }
});

chrome.runtime.onInstalled.addListener(() => void removeOldAutoMode().catch(() => undefined));
chrome.runtime.onStartup.addListener(() => void removeOldAutoMode().catch(() => undefined));

// Test hook (no network, no data): lets the Playwright suite read the outline state through the extension.
(globalThis as unknown as { bcpTest: unknown }).bcpTest = {
  pageState: (tabId: number) => chrome.tabs.sendMessage(tabId, { type: 'pageState' }),
  lastPages: () => [...tabs.values()].map((e) => e.page ?? null),
  removeOldAutoMode,
};
