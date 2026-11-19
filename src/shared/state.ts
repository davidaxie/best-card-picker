// Everything the extension stores. chrome.storage.local only (never sync).
import defaultCards from '../../data/cards.json';
import type { CapState, CardsFile, Category } from '../engine';

export interface Settings {
  /** Pause switch for all sites: no pill, no badge. */
  paused: boolean;
  /** User turned on Auto mode and granted <all_urls> + scripting. */
  autoMode: boolean;
  /** PRD default: cash wins value ties. */
  preferCashOnTie: boolean;
}

export interface StoredState {
  cardsFile: CardsFile;
  /** Per-site category choice, keyed by registrable domain. */
  siteCategories: Record<string, Category>;
  /** Per-site foreign override, keyed by registrable domain. */
  siteForeign: Record<string, boolean>;
  capState: CapState;
  settings: Settings;
  /** Registrable domains where the pill is never shown. */
  neverSites: string[];
  /**
   * Optional last four digits per card id. Kept apart from cardsFile so the digits never ride along
   * in an export (unless the user ticks the box) or in anything that copies the rules file.
   */
  last4: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = { paused: false, autoMode: false, preferCashOnTie: true };

export function defaultCardsFile(): CardsFile {
  return JSON.parse(JSON.stringify(defaultCards)) as CardsFile;
}

export function defaultState(): StoredState {
  return {
    cardsFile: defaultCardsFile(),
    siteCategories: {},
    siteForeign: {},
    capState: {},
    settings: { ...DEFAULT_SETTINGS },
    neverSites: [],
    last4: {},
  };
}

export const STATE_KEYS = ['cardsFile', 'siteCategories', 'siteForeign', 'capState', 'settings', 'neverSites', 'last4'] as const;

/** 4 digits, or 5 (Amex shows a 5-digit ending on its own site). The key stays named last4. */
export const LAST4_RE = /^\d{4,5}$/;

/** Only well-formed entries survive: 4 or 5 digits, keyed by card id. */
export function cleanLast4(map: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!map || typeof map !== 'object') return out;
  for (const [id, v] of Object.entries(map as Record<string, unknown>)) if (typeof v === 'string' && LAST4_RE.test(v)) out[id] = v;
  return out;
}

/** Moves any card.last4 out of a cards file. Returns the stripped copy and the digits found. */
export function splitLast4(file: CardsFile): { cardsFile: CardsFile; last4: Record<string, string> } {
  const copy = JSON.parse(JSON.stringify(file)) as CardsFile;
  const last4: Record<string, string> = {};
  for (const c of copy.cards) {
    if (c.last4 !== undefined) {
      if (LAST4_RE.test(c.last4)) last4[c.id] = c.last4;
      delete c.last4;
    }
  }
  return { cardsFile: copy, last4 };
}

export async function loadState(): Promise<StoredState> {
  const raw = (await chrome.storage.local.get([...STATE_KEYS])) as Partial<StoredState>;
  const d = defaultState();
  let cardsFile = raw.cardsFile ?? d.cardsFile;
  let last4 = cleanLast4(raw.last4);
  if (cardsFile.cards.some((c) => c.last4 !== undefined)) {
    // Older builds kept the digits inside cardsFile. Move them out once.
    const split = splitLast4(cardsFile);
    cardsFile = split.cardsFile;
    last4 = { ...split.last4, ...last4 };
    await chrome.storage.local.set({ cardsFile, last4 });
  }
  return {
    cardsFile,
    siteCategories: raw.siteCategories ?? {},
    siteForeign: raw.siteForeign ?? {},
    capState: raw.capState ?? {},
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    neverSites: raw.neverSites ?? [],
    last4,
  };
}

export async function saveState(patch: Partial<StoredState>): Promise<void> {
  await chrome.storage.local.set(patch);
}

/** "Clear all data": per-site choices, cap toggles, never-sites, settings and last four digits. Card rules are kept unless asked. */
export async function clearAllData(includeCards: boolean): Promise<void> {
  if (includeCards) await chrome.storage.local.clear();
  else await chrome.storage.local.remove(['siteCategories', 'siteForeign', 'capState', 'settings', 'neverSites', 'last4']);
}
