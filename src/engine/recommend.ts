import categoriesData from '../../data/categories.json';
import { resolveMerchant } from './merchant';
import type {
  Card,
  CardScore,
  CardsFile,
  Category,
  EngineOptions,
  EngineWarning,
  Merchant,
  MerchantsFile,
  Network,
  PurchaseContext,
  Recommendation,
  Rule,
} from './types';

const CATEGORY_INFO = new Map(categoriesData.categories.map((c) => [c.id, c]));

export function categoryLabel(c: Category): string {
  return CATEGORY_INFO.get(c)?.label ?? c;
}
function categoryPhrase(c: Category): string {
  return CATEGORY_INFO.get(c)?.phrase ?? `on ${c}`;
}

/** Round half away from zero to 4 decimals. The Swift port uses .toNearestOrAwayFromZero. */
export function round4(x: number): number {
  const r = (Math.sign(x) * Math.round(Math.abs(x) * 10000)) / 10000;
  return r === 0 ? 0 : r; // no -0
}

export function isForeign(ctx: PurchaseContext): boolean {
  if (ctx.foreign === true) return true;
  if (ctx.currency && ctx.currency.toUpperCase() !== 'USD') return true;
  if (ctx.country && ctx.country.toUpperCase() !== 'US') return true;
  return false;
}

function capReached(cardId: string, rule: Rule, opts: EngineOptions): boolean {
  const entry = opts.capState?.[cardId]?.[rule.category];
  if (!entry) return false;
  if (entry.reached === true) return true;
  return rule.capUsdPerYear != null && entry.usedUsd != null && entry.usedUsd >= rule.capUsdPerYear;
}

function capNear(cardId: string, rule: Rule | null, opts: EngineOptions): boolean {
  if (!rule || rule.capUsdPerYear == null) return false;
  const used = opts.capState?.[cardId]?.[rule.category]?.usedUsd;
  return used != null && used >= 0.9 * rule.capUsdPerYear && used < rule.capUsdPerYear;
}

/** Pick the rule that sets this card's rate, or null for the base rate. */
export function selectRule(card: Card, category: Category, foreign: boolean, opts: EngineOptions): Rule | null {
  const eligible = card.rules.filter((r) => !(r.usOnly && foreign) && !capReached(card.id, r, opts));
  const pick = (cat: Category): Rule | null => {
    let best: Rule | null = null;
    for (const r of eligible) if (r.category === cat && (!best || r.rate > best.rate)) best = r;
    return best;
  };
  const specific = pick(category);
  if (specific) return specific;
  if (category === 'airline_united' || category === 'airline_aa') return pick('airline_direct');
  return null;
}

const NETWORK_RANK: Record<Network, number> = { visa: 0, mastercard: 0, discover: 1, amex: 2 };

function fmtCents(x: number): string {
  return String(Math.round(x * 100) / 100);
}
function fmtRate(card: Card, rate: number): string {
  return card.currency === 'cash' ? `${rate}% cash back` : `${rate}x`;
}

function reasonFor(card: Card, s: CardScore, category: Category, foreign: boolean): string {
  const value = `about ${fmtCents(s.centsPerDollar)} cents per dollar`;
  const fee = foreign && card.foreignFeePct > 0 ? ` after the ${card.foreignFeePct}% foreign fee` : '';
  if (s.basis === 'perk') {
    return `Perk pick: ${s.perkReason} (${fmtRate(card, s.rate)}, ${value}${fee})`;
  }
  if (s.basis === 'bonus') return `${fmtRate(card, s.rate)} ${categoryPhrase(category)}, ${value}${fee}`;
  return `${fmtRate(card, s.rate)} on everything else, ${value}${fee}`;
}

export function recommend(
  cardsFile: CardsFile,
  merchantsFile: MerchantsFile | null,
  ctx: PurchaseContext,
  opts: EngineOptions = {},
): Recommendation {
  const merchant: Merchant | null = resolveMerchant(ctx.merchant, [
    cardsFile.merchants ?? [],
    merchantsFile?.merchants ?? [],
  ]);
  const category: Category = ctx.category ?? merchant?.category ?? 'general';
  const foreign = isForeign(ctx);
  const preferCash = opts.preferCashOnTie ?? true;
  const pointValues = { ...cardsFile.pointValuesCents, ...(opts.pointValuesCents ?? {}) };
  const disabled = new Set(opts.disabledCards ?? []);
  const accepted: Network[] | undefined =
    ctx.acceptedNetworks ?? (ctx.channel === 'in_store' ? merchant?.inStoreNetworks : merchant?.onlineNetworks);

  const candidates = cardsFile.cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => card.enabled !== false && !disabled.has(card.id))
    .filter(({ card }) => !accepted || accepted.includes(card.network));

  const scored = candidates.map(({ card, index }) => {
    const rule = selectRule(card, category, foreign, opts);
    const rate = rule ? Math.max(rule.rate, card.baseRate) : card.baseRate;
    const cents = round4(rate * (pointValues[card.currency] ?? 0) - (foreign ? card.foreignFeePct : 0));
    const perk = card.preferredFor?.find((p) => p.category === category) ?? null;
    const score: CardScore = {
      cardId: card.id,
      rate,
      centsPerDollar: cents,
      basis: perk ? 'perk' : rule && rule.rate > card.baseRate ? 'bonus' : 'base',
      appliedRule: rule,
      perkReason: perk?.reason ?? null,
    };
    return { card, index, score };
  });

  scored.sort((a, b) => {
    const pa = a.score.basis === 'perk' ? 0 : 1;
    const pb = b.score.basis === 'perk' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (a.score.centsPerDollar !== b.score.centsPerDollar) return b.score.centsPerDollar - a.score.centsPerDollar;
    const ca = a.card.currency === 'cash' ? 0 : 1;
    const cb = b.card.currency === 'cash' ? 0 : 1;
    if (ca !== cb) return preferCash ? ca - cb : cb - ca;
    const na = NETWORK_RANK[a.card.network];
    const nb = NETWORK_RANK[b.card.network];
    if (na !== nb) return na - nb;
    return a.index - b.index;
  });

  const warnings: EngineWarning[] = [];
  const add = (code: EngineWarning['code'], message: string) => warnings.push({ code, message });

  if (foreign) {
    const feeCards = candidates.map((c) => c.card).filter((c) => c.foreignFeePct > 0);
    if (feeCards.length) {
      add(
        'foreign_fees',
        `Foreign purchase: avoid ${feeCards.map((c) => `${c.name} (${c.foreignFeePct}% fee)`).join(', ')}.`,
      );
    }
  }

  const best = scored[0];
  if (!best) {
    add('no_accepted_card', 'None of your cards are accepted here.');
    return {
      cardId: null,
      rate: null,
      centsPerDollar: null,
      basis: null,
      category,
      foreign,
      reason: 'None of your cards are accepted here.',
      runnerUp: null,
      warnings,
      merchant,
      ranked: [],
    };
  }

  const { card, score } = best;
  if ((ctx.mayNotTakeAmex || merchant?.mayNotTakeAmex) && card.network === 'amex') {
    const alt = scored.find((s) => s.card.network !== 'amex');
    add('may_not_take_amex', `This site may not take Amex.${alt ? ` Backup: ${alt.card.name}.` : ''}`);
  }
  if (capNear(card.id, score.appliedRule, opts)) {
    add('cap_near_limit', `${card.name} is near its $${score.appliedRule!.capUsdPerYear} yearly cap ${categoryPhrase(category)}.`);
  }
  if (score.appliedRule?.verify) {
    add('verify_rule', `${card.name} ${fmtRate(card, score.appliedRule.rate)} ${categoryPhrase(score.appliedRule.category)} is marked verify. Check the issuer's terms.`);
  }
  if (card.verify?.includes('foreignFeePct') && foreign) {
    add('verify_card', `${card.name}'s ${card.foreignFeePct}% foreign fee is marked verify.`);
  }
  if (merchant?.verify) {
    add('verify_merchant', `${merchant.name ?? merchant.match}: ${merchant.note ?? 'category or card acceptance is marked verify.'}`);
  }

  const second = scored[1];
  return {
    cardId: card.id,
    rate: score.rate,
    centsPerDollar: score.centsPerDollar,
    basis: score.basis,
    category,
    foreign,
    reason: reasonFor(card, score, category, foreign),
    runnerUp: second ? { cardId: second.card.id, centsPerDollar: second.score.centsPerDollar } : null,
    warnings,
    merchant,
    ranked: scored.map((s) => s.score),
  };
}
