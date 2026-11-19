// Turns what the extension knows about a tab into an engine call. Pure, so it is unit tested.
import { recommend, toHost, CATEGORIES } from '../engine';
import type { Category, MerchantsFile, Recommendation } from '../engine';
import { registrableDomain, type Psl } from './psl';
import { countryFromHost, currencyFromText, isForeignLang } from './foreign';
import { categoryFromHints, type PageHints } from './hints';
import type { StoredState } from './state';

/** What the content script (or the popup, from the tab URL alone) reports about a page. */
export interface PageInfo {
  url: string;
  title?: string | null;
  hints?: PageHints;
  lang?: string | null;
  /** Currency from structured data (priceCurrency, og:price:currency). */
  metaCurrency?: string | null;
  /** Up to ~20k characters of visible text around prices, for the currency check. */
  priceText?: string | null;
}

export type CategorySource = 'saved' | 'merchant' | 'hints' | 'unknown';

export interface Decision {
  host: string;
  domain: string;
  category: Category;
  categorySource: CategorySource;
  /** True when the extension should ask "What kind of store is this?". */
  needsAsk: boolean;
  foreign: boolean;
  foreignReasons: string[];
  foreignOverride: boolean | null;
  currency: string | null;
  recommendation: Recommendation;
}

export function isCategory(x: unknown): x is Category {
  return typeof x === 'string' && (CATEGORIES as readonly string[]).includes(x);
}

export function decide(state: StoredState, merchants: MerchantsFile, psl: Psl, page: PageInfo): Decision {
  const host = toHost(page.url) ?? '';
  const domain = host ? registrableDomain(host, psl) : '';
  const cardsFile = state.cardsFile;

  // Category: saved choice, then merchant map (cards.json merchants first), then page hints, then ask.
  const saved = domain ? state.siteCategories[domain] : undefined;
  const base = recommend(cardsFile, merchants, { merchant: host || undefined, channel: 'online' });
  let category: Category;
  let source: CategorySource;
  if (saved && isCategory(saved)) {
    category = saved;
    source = 'saved';
  } else if (base.merchant) {
    category = base.merchant.category;
    source = 'merchant';
  } else {
    const guess = page.hints ? categoryFromHints({ ...page.hints, title: page.hints.title ?? page.title ?? null }) : null;
    category = guess ?? 'general';
    source = guess ? 'hints' : 'unknown';
  }

  // Foreign: per-site override, else any of TLD country, price currency, html lang.
  const reasons: string[] = [];
  const country = host ? countryFromHost(host) : null;
  if (country) reasons.push(`.${host.split('.').pop()} domain`);
  const detectedCurrency =
    page.metaCurrency?.trim().toUpperCase() || (page.priceText ? currencyFromText(page.priceText) : null) || null;
  if (detectedCurrency && detectedCurrency !== 'USD') reasons.push(`prices in ${detectedCurrency}`);
  if (isForeignLang(page.lang)) reasons.push(`page language ${page.lang}`);
  const override = domain && domain in state.siteForeign ? state.siteForeign[domain]! : null;
  const foreign = override ?? reasons.length > 0;

  const recommendation = recommend(
    cardsFile,
    merchants,
    { merchant: host || undefined, category, channel: 'online', foreign },
    { preferCashOnTie: state.settings.preferCashOnTie, capState: state.capState },
  );

  return {
    host,
    domain,
    category,
    categorySource: source,
    needsAsk: source === 'hints' || source === 'unknown',
    foreign,
    foreignReasons: reasons,
    foreignOverride: override,
    currency: detectedCurrency,
    recommendation,
  };
}
