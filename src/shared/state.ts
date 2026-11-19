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
  };
}

export const STATE_KEYS = ['cardsFile', 'siteCategories', 'siteForeign', 'capState', 'settings', 'neverSites'] as const;

export async function loadState(): Promise<StoredState> {
  const raw = (await chrome.storage.local.get([...STATE_KEYS])) as Partial<StoredState>;
  const d = defaultState();
  return {
    cardsFile: raw.cardsFile ?? d.cardsFile,
    siteCategories: raw.siteCategories ?? {},
    siteForeign: raw.siteForeign ?? {},
    capState: raw.capState ?? {},
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
    neverSites: raw.neverSites ?? [],
  };
}

export async function saveState(patch: Partial<StoredState>): Promise<void> {
  await chrome.storage.local.set(patch);
}

/** "Clear all data": per-site choices, cap toggles, never-sites and settings. Card rules are kept unless asked. */
export async function clearAllData(includeCards: boolean): Promise<void> {
  if (includeCards) await chrome.storage.local.clear();
  else await chrome.storage.local.remove(['siteCategories', 'siteForeign', 'capState', 'settings', 'neverSites']);
}
