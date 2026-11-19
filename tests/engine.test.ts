import { describe, expect, it } from 'vitest';
import cards from '../data/cards.json';
import merchants from '../data/merchants.json';
import { recommend, resolveMerchant, round4, toHost, normalizeName } from '../src/engine';
import type { CardsFile, Merchant, MerchantsFile } from '../src/engine';

const C = cards as CardsFile;
const M = merchants as MerchantsFile;
const lists: Merchant[][] = [C.merchants ?? [], M.merchants];

describe('round4', () => {
  it('rounds half away from zero and never returns -0', () => {
    expect(round4(3 * 1.2)).toBe(3.6);
    expect(round4(1.00005)).toBe(1.0001);
    expect(round4(-1.00005)).toBe(-1.0001);
    expect(Object.is(round4(-0.00001), 0)).toBe(true);
  });
});

describe('merchant resolution', () => {
  it('extracts hosts from URLs', () => {
    expect(toHost('https://www.Amazon.com:443/gp/cart?x=1')).toBe('www.amazon.com');
    expect(toHost("Trader Joe's")).toBeNull();
  });
  it('normalizes names', () => {
    expect(normalizeName("Trader Joe’s #123")).toBe('trader joes 123');
    expect(normalizeName('Stop & Shop')).toBe('stop shop');
  });
  it('walks subdomains down to the registrable domain', () => {
    expect(resolveMerchant('www.doordash.com', lists)?.category).toBe('restaurant');
    expect(resolveMerchant('https://checkout.netflix.com/pay', lists)?.category).toBe('streaming');
    expect(resolveMerchant('travelsecure.chase.com', lists)?.category).toBe('chase_travel');
    expect(resolveMerchant('chase.com', lists)).toBeNull();
  });
  it('matches brands by prefix and prefers the longest brand', () => {
    expect(resolveMerchant('Costco Wholesale #481', lists)?.category).toBe('wholesale_club');
    expect(resolveMerchant('Costco Gasoline', lists)?.category).toBe('gas_ev');
    expect(resolveMerchant('The Shell Seafood Shack', lists)).toBeNull();
    expect(resolveMerchant('Shell', lists)?.category).toBe('gas_ev');
  });
  it('cards.json merchants win over merchants.json', () => {
    const override: Merchant[] = [{ match: 'amazon.com', category: 'general' }];
    expect(resolveMerchant('amazon.com', [override, M.merchants])?.category).toBe('general');
  });
});

describe('recommend', () => {
  it('produces the PRD reason line', () => {
    const r = recommend(C, M, { category: 'restaurant', channel: 'in_store' });
    expect(r.reason).toBe('4x at restaurants, about 8 cents per dollar');
  });
  it('explains perks and foreign fees in the reason', () => {
    expect(recommend(C, M, { merchant: 'united.com', channel: 'online' }).reason).toMatch(/^Perk pick: free first checked bag/);
    const fu = recommend(C, M, { category: 'drugstore', channel: 'in_store', currency: 'EUR' });
    expect(fu.ranked.find((s) => s.cardId === 'chase-freedom-unlimited')?.centsPerDollar).toBe(3);
  });
  it('ranks every accepted card', () => {
    const r = recommend(C, M, { category: 'general', channel: 'online' });
    expect(r.ranked).toHaveLength(6);
    const costco = recommend(C, M, { merchant: 'Costco', channel: 'in_store' });
    expect(costco.ranked.map((s) => s.cardId).sort()).toEqual(['chase-freedom-unlimited', 'chase-sapphire-preferred', 'united-explorer']);
  });
  it('respects enabled:false on a card', () => {
    const c = JSON.parse(JSON.stringify(C)) as CardsFile;
    c.cards[0]!.enabled = false;
    expect(recommend(c, M, { category: 'restaurant', channel: 'online' }).cardId).toBe('chase-sapphire-preferred');
  });
  it('never recommends a foreign-fee card on a GBP site when a no-fee card earns as much', () => {
    for (const category of ['general', 'us_online_retail', 'restaurant', 'gas_ev', 'us_supermarket', 'streaming', 'online_grocery', 'hotel_direct', 'chase_travel'] as const) {
      const r = recommend(C, M, { category, channel: 'online', currency: 'GBP' });
      expect(['chase-freedom-unlimited', 'amex-blue-cash-everyday'], category).not.toContain(r.cardId);
      expect(r.warnings.map((w) => w.code)).toContain('foreign_fees');
    }
  });
  it('known edge: a foreign drugstore still nets FU 3.0 cents after its 3% fee (PRD scoring math)', () => {
    // PRD scoring step 3 subtracts the fee rather than excluding the card, so 3x UR (6.0) - 3 = 3.0 beats 2.0.
    // Flagged to David as an open question; flip by changing the engine rule, then update golden tests.
    const r = recommend(C, M, { category: 'drugstore', channel: 'online', currency: 'GBP' });
    expect(r.cardId).toBe('chase-freedom-unlimited');
    expect(r.centsPerDollar).toBe(3);
    expect(r.reason).toContain('after the 3% foreign fee');
  });
  it('is pure: does not mutate its inputs', () => {
    const before = JSON.stringify(C);
    recommend(C, M, { merchant: 'amazon.com', channel: 'online' }, { capState: { 'amex-blue-cash-everyday': { us_online_retail: { reached: true } } } });
    expect(JSON.stringify(C)).toBe(before);
  });
});
