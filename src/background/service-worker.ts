// Service worker: runs the engine, caches one result per tab, sets the toolbar badge, answers the
// popup and the content script. Makes no network requests.
import merchantsData from '../../data/merchants.json';
import pslText from '../../data/public_suffix.dat?raw';
import type { Card, Category, MerchantsFile } from '../engine';
import { decide, isCategory, type Decision, type PageInfo } from '../shared/decide';
import { parsePsl } from '../shared/psl';
import { loadState, saveState, type Settings, type StoredState } from '../shared/state';
import type { CheckoutScan } from '../content/detect';
import type { PillData } from '../content/pill';
import type { CardTarget, SavedStatus, SavedTargets } from '../content/saved-cards';
import { capTogglesFor, rateText, type PopupData } from '../shared/view';

const merchants = merchantsData as MerchantsFile;
const psl = parsePsl(pslText);
const SCRIPT_ID = 'bcp-detect';

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
  dismissedUrl?: string;
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

function pillData(state: StoredState, d: Decision): PillData | null {
  const r = d.recommendation;
  const card = cardById(state, r.cardId);
  if (!card || r.rate === null) return null;
  const runner = cardById(state, r.runnerUp?.cardId ?? null);
  const warnings = r.warnings
    .filter((w) => ['foreign_fees', 'may_not_take_amex', 'cap_near_limit', 'no_accepted_card'].includes(w.code))
    .map((w) => w.message);
  const ask = d.needsAsk ? ' Unknown store: pick a category from the toolbar icon.' : '';
  return {
    cardName: card.name,
    color: card.color ?? '#444444',
    rateText: rateText(card, r.rate),
    runnerUpName: runner?.name ?? null,
    last4: state.last4[card.id] ?? null,
    detail: `${r.reason}.${ask}`,
    warnings,
    domain: d.domain,
  };
}

function target(state: StoredState, id: string | null | undefined): CardTarget | null {
  const card = cardById(state, id ?? null);
  const last4 = card ? state.last4[card.id] : undefined;
  if (!card || !last4) return null;
  return { cardId: card.id, name: card.name, last4, network: card.network, color: card.color ?? '#444444' };
}

/** Best and runner-up with their saved last four digits; null when neither has digits saved. */
function savedTargets(state: StoredState, d: Decision): SavedTargets | null {
  const best = target(state, d.recommendation.cardId);
  const runnerUp = target(state, d.recommendation.runnerUp?.cardId);
  return best || runnerUp ? { best, runnerUp } : null;
}

async function rescan(tabId: number): Promise<void> {
  try {
    await Promise.race([
      chrome.tabs.sendMessage(tabId, { type: 'rescan' }),
      new Promise((resolve) => setTimeout(resolve, 400)),
    ]);
  } catch {
    /* no content script in this tab (click-to-check mode) */
  }
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
  if (!e.page || e.page.url !== url) {
    await rescan(tabId);
  }
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
    never: state.neverSites.includes(d.domain),
    isCheckout: e.checkout?.isCheckout ?? null,
    last4: state.last4,
    saved,
    canPoint: Boolean(savedTargets(state, d)),
  };
}

async function onPage(
  tabId: number,
  page: PageInfo,
  checkout: CheckoutScan,
  mode: 'auto' | 'click',
): Promise<{ showPill: boolean; pill: PillData | null; targets: SavedTargets | null }> {
  const state = await loadState();
  const e = entry(tabId);
  if (e.page?.url !== page.url) e.decision = undefined;
  e.checkout = checkout;
  const d = decisionFor(state, tabId, page);
  await setBadge(tabId, state, d);
  const show =
    checkout.isCheckout &&
    !state.settings.paused &&
    !state.neverSites.includes(d.domain) &&
    e.dismissedUrl !== page.url;
  // Digits go to the page's content script only when it will use them: on a checkout page that
  // shows the pill, or when the user pressed "Point to my card" in the popup.
  const wantTargets = mode === 'click' || show;
  return { showPill: mode === 'auto' && show, pill: mode === 'auto' && show ? pillData(state, d) : null, targets: wantTargets ? savedTargets(state, d) : null };
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

/** Popup button: outline the saved card on this tab. Uses activeTab + the optional scripting permission. */
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
      await chrome.scripting.executeScript({ target: { tabId }, func: () => void ((window as unknown as { __bcpMode: string }).__bcpMode = 'click') });
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch {
      return popupData(tabId);
    }
  }
  await waiting;
  return popupData(tabId);
}

async function syncContentScripts(): Promise<boolean> {
  const state = await loadState();
  const granted = await chrome.permissions.contains({ permissions: ['scripting'], origins: ['<all_urls>'] });
  if (!chrome.scripting) return false;
  const want = state.settings.autoMode && granted && !state.settings.paused;
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (want && registered.length === 0) {
    await chrome.scripting.registerContentScripts([
      { id: SCRIPT_ID, matches: ['<all_urls>'], js: ['content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true },
    ]);
  } else if (!want && registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  }
  return want;
}

async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const state = await loadState();
  const settings = { ...state.settings, ...patch };
  await saveState({ settings });
  return settings;
}

type Msg =
  | { type: 'page'; page: PageInfo; checkout: CheckoutScan; mode?: 'auto' | 'click' }
  | { type: 'saved'; url: string; status: SavedStatus; cardId: string | null; found: number }
  | { type: 'point'; tabId: number }
  | { type: 'popup'; tabId: number }
  | { type: 'setCategory'; tabId: number; domain: string; category: Category | null }
  | { type: 'setForeign'; tabId: number; domain: string; value: boolean | null }
  | { type: 'setCap'; tabId: number; cardId: string; category: Category; reached: boolean }
  | { type: 'setNever'; tabId: number; domain: string; never: boolean }
  | { type: 'setSettings'; patch: Partial<Settings> }
  | { type: 'autoMode'; enabled: boolean }
  | { type: 'dismiss' }
  | { type: 'never' };

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const fromTab = sender.tab?.id;
  switch (msg.type) {
    case 'page':
      return fromTab === undefined ? null : onPage(fromTab, msg.page, msg.checkout, msg.mode === 'click' ? 'click' : 'auto');
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
    case 'setNever': {
      const state = await loadState();
      const set = new Set(state.neverSites);
      if (msg.never) set.add(msg.domain);
      else set.delete(msg.domain);
      await saveState({ neverSites: [...set].sort() });
      return popupData(msg.tabId);
    }
    case 'setSettings': {
      const settings = await updateSettings(msg.patch);
      await syncContentScripts();
      return settings;
    }
    case 'autoMode': {
      await updateSettings({ autoMode: msg.enabled });
      return { active: await syncContentScripts() };
    }
    case 'dismiss':
      if (fromTab !== undefined) entry(fromTab).dismissedUrl = sender.tab?.url ?? entry(fromTab).page?.url;
      return { ok: true };
    case 'never': {
      if (fromTab === undefined) return null;
      const d = entry(fromTab).decision;
      if (!d?.domain) return null;
      const state = await loadState();
      await saveState({ neverSites: [...new Set([...state.neverSites, d.domain])].sort() });
      return { ok: true };
    }
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

chrome.permissions.onAdded.addListener(() => void syncContentScripts());
chrome.permissions.onRemoved.addListener(() => {
  void (async () => {
    const granted = await chrome.permissions.contains({ permissions: ['scripting'], origins: ['<all_urls>'] });
    if (!granted) await updateSettings({ autoMode: false });
    await syncContentScripts().catch(() => false);
  })();
});
chrome.runtime.onInstalled.addListener(() => void syncContentScripts().catch(() => false));
chrome.runtime.onStartup.addListener(() => void syncContentScripts().catch(() => false));

// Test hook (no network, no data): lets the Playwright suite read pill state through the extension.
(globalThis as unknown as { bcpTest: unknown }).bcpTest = {
  pillState: (tabId: number) => chrome.tabs.sendMessage(tabId, { type: 'pillState' }),
  lastPages: () => [...tabs.values()].map((e) => e.page ?? null),
  syncContentScripts,
};
