import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import cards from '../data/cards.json';
import merchants from '../data/merchants.json';
import categories from '../data/categories.json';
import cardsSchema from '../data/cards.schema.json';
import merchantsSchema from '../data/merchants.schema.json';
import { CATEGORIES, validateCardsFile, validateMerchantsFile } from '../src/engine';
import type { CardsFile } from '../src/engine';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('bundled data', () => {
  it('cards.json passes the runtime validator', () => {
    const r = validateCardsFile(cards);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it('merchants.json passes the runtime validator', () => {
    const r = validateMerchantsFile(merchants);
    expect(r.errors).toEqual([]);
  });
  it('both files pass the JSON Schema', () => {
    const ajv = new Ajv2020({ allErrors: true });
    ajv.addSchema(cardsSchema);
    const vc = ajv.compile(cardsSchema);
    const vm = ajv.compile(merchantsSchema);
    expect(vc(cards), JSON.stringify(vc.errors)).toBe(true);
    expect(vm(merchants), JSON.stringify(vm.errors)).toBe(true);
  });
  it('has the six seed cards', () => {
    expect(cards.cards.map((c) => c.id)).toEqual([
      'amex-gold', 'chase-sapphire-preferred', 'chase-freedom-unlimited', 'united-explorer', 'citi-aa-platinum', 'amex-blue-cash-everyday',
    ]);
  });
  it('keeps the PRD verify flags', () => {
    const gold = (cards as CardsFile).cards.find((c) => c.id === 'amex-gold')!;
    expect(gold.rules.find((r) => r.category === 'airline_direct')?.verify).toBe(true);
    expect((cards as CardsFile).cards.find((c) => c.id === 'citi-aa-platinum')?.verify).toContain('foreignFeePct');
    const m = merchants.merchants;
    for (const match of ['safeway.com', 'cvs.com', 'walgreens.com']) expect(m.find((x) => x.match === match)?.verify).toBe(true);
  });
  it('merchant map is about 200 sites and covers the PRD starter map', () => {
    const domains = merchants.merchants.filter((m) => m.match.includes('.'));
    expect(domains.length).toBeGreaterThanOrEqual(200);
    const want: Record<string, string> = {
      'amazon.com': 'us_online_retail', 'walmart.com': 'us_online_retail', 'target.com': 'us_online_retail',
      'doordash.com': 'restaurant', 'ubereats.com': 'restaurant', 'grubhub.com': 'restaurant', 'instacart.com': 'online_grocery',
      'safeway.com': 'us_supermarket', 'aa.com': 'airline_aa', 'delta.com': 'airline_direct', 'alaskaair.com': 'airline_direct',
      'jetblue.com': 'airline_direct', 'marriott.com': 'hotel_direct', 'hilton.com': 'hotel_direct', 'hyatt.com': 'hotel_direct',
      'airbnb.com': 'vacation_rental', 'vrbo.com': 'vacation_rental', 'amextravel.com': 'amex_travel_prepaid_hotel',
      'netflix.com': 'streaming', 'spotify.com': 'streaming', 'hulu.com': 'streaming', 'cvs.com': 'drugstore',
      'walgreens.com': 'drugstore', 'uber.com': 'rideshare_transit', 'lyft.com': 'rideshare_transit', 'hertz.com': 'rental_car',
      'enterprise.com': 'rental_car',
    };
    for (const [d, cat] of Object.entries(want)) expect(merchants.merchants.find((m) => m.match === d)?.category, d).toBe(cat);
    expect(cards.merchants.find((m) => m.match === 'united.com')?.category).toBe('airline_united');
  });
  it('categories.json lists exactly the canonical categories', () => {
    expect(categories.categories.map((c) => c.id)).toEqual([...CATEGORIES]);
  });
});

describe('validator rejects bad input', () => {
  it('unknown category', () => {
    const c = clone(cards);
    (c.cards[0]!.rules[0] as { category: string }).category = 'groceries';
    expect(validateCardsFile(c).ok).toBe(false);
  });
  it('duplicate ids and missing point values', () => {
    const c = clone(cards);
    c.cards[1]!.id = 'amex-gold';
    c.cards[2]!.currency = 'mystery_points';
    const r = validateCardsFile(c);
    expect(r.errors.some((e) => e.includes('duplicate'))).toBe(true);
    expect(r.errors.some((e) => e.includes('mystery_points'))).toBe(true);
  });
  it('anything that looks like a card number', () => {
    const c = clone(cards) as unknown as { cards: Record<string, unknown>[] };
    c.cards[0]!.note = 'my card 4111 1111 1111 1111';
    expect(validateCardsFile(c).ok).toBe(false);
  });
  it('card number, CVV or expiry fields', () => {
    for (const key of ['number', 'cvv', 'expiry', 'billingAddress']) {
      const c = clone(cards) as unknown as { cards: Record<string, unknown>[] };
      c.cards[0]![key] = 'x';
      expect(validateCardsFile(c).ok, key).toBe(false);
    }
  });
  it('last4 must be exactly four digits', () => {
    const c = clone(cards) as unknown as { cards: Record<string, unknown>[] };
    c.cards[0]!.last4 = '1234';
    expect(validateCardsFile(c).ok).toBe(true);
    c.cards[0]!.last4 = '123456';
    expect(validateCardsFile(c).ok).toBe(false);
  });
  it('non-object input', () => {
    expect(validateCardsFile('nope').ok).toBe(false);
    expect(validateCardsFile(null).ok).toBe(false);
    expect(validateMerchantsFile([]).ok).toBe(false);
  });
});
