// Small helpers shared by the service worker, popup and options page.
import categoriesData from '../../data/categories.json';
import type { Card, CardsFile, Category } from '../engine';
import type { Decision } from './decide';
import type { Settings, StoredState } from './state';

export const CATEGORY_OPTIONS = categoriesData.categories as { id: Category; label: string; phrase: string }[];

export function categoryLabel(c: Category): string {
  return CATEGORY_OPTIONS.find((x) => x.id === c)?.label ?? c;
}

export function rateText(card: Card, rate: number): string {
  return card.currency === 'cash' ? `${rate}%` : `${rate}x`;
}

export interface CapToggle {
  cardId: string;
  cardName: string;
  category: Category;
  capUsd: number;
  reached: boolean;
  usedUsd: number | null;
}

/** Cap toggles for the capped rules that could apply to this category. */
export function capTogglesFor(state: Pick<StoredState, 'cardsFile' | 'capState'>, category: Category): CapToggle[] {
  const out: CapToggle[] = [];
  const cats: Category[] = category === 'airline_united' || category === 'airline_aa' ? [category, 'airline_direct'] : [category];
  for (const card of state.cardsFile.cards) {
    if (card.enabled === false) continue;
    for (const r of card.rules) {
      if (!cats.includes(r.category) || r.capUsdPerYear == null) continue;
      const entry = state.capState[card.id]?.[r.category];
      out.push({
        cardId: card.id,
        cardName: card.name,
        category: r.category,
        capUsd: r.capUsdPerYear,
        reached: entry?.reached === true || (entry?.usedUsd != null && entry.usedUsd >= r.capUsdPerYear),
        usedUsd: entry?.usedUsd ?? null,
      });
    }
  }
  return out;
}

export function fmtUsd(n: number): string {
  return n >= 1000 && n % 1000 === 0 ? `$${n / 1000}k` : `$${n.toLocaleString('en-US')}`;
}

export interface PopupData {
  supported: boolean;
  tabId?: number;
  decision?: Decision;
  settings: Settings;
  cardsFile: CardsFile;
  capToggles?: CapToggle[];
  savedCategory?: Category | null;
  isCheckout?: boolean | null;
  /** Saved last four digits by card id (extension pages only). */
  last4?: Record<string, string>;
  /** What the page's content script found in the site's saved-card list, if it ran. */
  saved?: { url: string; status: 'best' | 'runnerUp' | 'none' | 'noList'; cardId: string | null; found: number } | null;
  /** Best or runner-up has last four digits saved, so "Point to my card" can work. */
  canPoint?: boolean;
}
