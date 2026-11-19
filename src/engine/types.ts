// Shared types for the Best Card Picker engine. The Swift port in ios/ mirrors these.

export const CATEGORIES = [
  'restaurant',
  'us_supermarket',
  'online_grocery',
  'gas_ev',
  'streaming',
  'drugstore',
  'us_online_retail',
  'airline_united',
  'airline_aa',
  'airline_direct',
  'hotel_direct',
  'chase_travel',
  'amex_travel_prepaid_hotel',
  'vacation_rental',
  'rideshare_transit',
  'rental_car',
  'wholesale_club',
  'general',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const NETWORKS = ['amex', 'visa', 'mastercard', 'discover'] as const;
export type Network = (typeof NETWORKS)[number];

export type Channel = 'online' | 'in_store';

export interface Rule {
  category: Category;
  rate: number;
  capUsdPerYear?: number;
  usOnly?: boolean;
  verify?: boolean;
  note?: string;
}

export interface PerkPreference {
  category: Category;
  reason: string;
}

export interface Card {
  id: string;
  name: string;
  shortCode?: string;
  color?: string;
  network: Network;
  currency: string;
  foreignFeePct: number;
  baseRate: number;
  rules: Rule[];
  preferredFor?: PerkPreference[];
  enabled?: boolean;
  last4?: string;
  verify?: string[];
  note?: string;
}

export interface Merchant {
  match: string;
  name?: string;
  category: Category;
  inStoreNetworks?: Network[];
  onlineNetworks?: Network[];
  mayNotTakeAmex?: boolean;
  verify?: boolean;
  note?: string;
}

export interface CardsFile {
  version: number;
  updated: string;
  pointValuesCents: Record<string, number>;
  cards: Card[];
  merchants?: Merchant[];
}

export interface MerchantsFile {
  version: number;
  updated: string;
  merchants: Merchant[];
}

export interface PurchaseContext {
  /** Engine category. When absent, the merchant's category is used, else general. */
  category?: Category;
  /** A domain or host (amazon.com, smile.amazon.com) or a place name (Trader Joe's). */
  merchant?: string;
  channel: Channel;
  foreign?: boolean;
  /** ISO 4217 code of the price shown. Anything other than USD makes the purchase foreign. */
  currency?: string;
  /** ISO 3166 alpha-2 country of the merchant. Anything other than US makes the purchase foreign. */
  country?: string;
  /** Hard acceptance list. Cards on other networks are removed. Overrides the merchant's list. */
  acceptedNetworks?: Network[];
  /** Soft flag: add a warning when the pick is an Amex card. */
  mayNotTakeAmex?: boolean;
}

export interface CapEntry {
  reached?: boolean;
  usedUsd?: number;
}

/** capState[cardId][category] */
export type CapState = Record<string, Record<string, CapEntry>>;

export interface EngineOptions {
  /** Default true: on a value tie, a cash-back card beats a points card. */
  preferCashOnTie?: boolean;
  /** Merged over cardsFile.pointValuesCents. */
  pointValuesCents?: Record<string, number>;
  disabledCards?: string[];
  capState?: CapState;
}

export type Basis = 'bonus' | 'base' | 'perk';

export type WarningCode =
  | 'foreign_fees'
  | 'may_not_take_amex'
  | 'cap_near_limit'
  | 'verify_rule'
  | 'verify_card'
  | 'verify_merchant'
  | 'no_accepted_card';

export interface EngineWarning {
  code: WarningCode;
  message: string;
}

export interface CardScore {
  cardId: string;
  rate: number;
  centsPerDollar: number;
  basis: Basis;
  appliedRule: Rule | null;
  perkReason: string | null;
}

export interface Recommendation {
  cardId: string | null;
  rate: number | null;
  centsPerDollar: number | null;
  basis: Basis | null;
  category: Category;
  foreign: boolean;
  reason: string;
  runnerUp: { cardId: string; centsPerDollar: number } | null;
  warnings: EngineWarning[];
  merchant: Merchant | null;
  /** All accepted cards, best first. */
  ranked: CardScore[];
}
