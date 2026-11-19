import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import merchantsData from '../data/merchants.json';
import type { MerchantsFile } from '../src/engine';
import { decide } from '../src/shared/decide';
import { countryFromHost, currencyFromText, isForeignLang } from '../src/shared/foreign';
import { categoryFromHints } from '../src/shared/hints';
import { exportCardsJson, importCardsJson } from '../src/shared/io';
import { parsePsl, publicSuffix, registrableDomain } from '../src/shared/psl';
import { defaultState } from '../src/shared/state';
import { capTogglesFor } from '../src/shared/view';

const psl = parsePsl(readFileSync(resolve(__dirname, '../data/public_suffix.dat'), 'utf8'));
const merchants = merchantsData as MerchantsFile;

describe('public suffix list', () => {
  it('finds registrable domains', () => {
    expect(registrableDomain('shop.example.co.uk', psl)).toBe('example.co.uk');
    expect(registrableDomain('www.amazon.com', psl)).toBe('amazon.com');
    expect(registrableDomain('a.b.c.example.com.au', psl)).toBe('example.com.au');
    expect(registrableDomain('travelsecure.chase.com', psl)).toBe('chase.com');
    expect(registrableDomain('someone.github.io', psl)).toBe('someone.github.io');
    expect(registrableDomain('localhost', psl)).toBe('localhost');
    expect(publicSuffix('shop.example.co.uk', psl)).toBe('co.uk');
  });
  it('handles wildcard and exception rules', () => {
    expect(registrableDomain('foo.bar.ck', psl)).toBe('foo.bar.ck'); // *.ck
    expect(registrableDomain('www.ck', psl)).toBe('www.ck'); // !www.ck
  });
});

describe('foreign check', () => {
  it('country TLDs, but not generic ones', () => {
    expect(countryFromHost('example.co.uk')).toBe('GB');
    expect(countryFromHost('shop.de')).toBe('DE');
    expect(countryFromHost('amazon.co.jp')).toBe('JP');
    expect(countryFromHost('startup.io')).toBeNull();
    expect(countryFromHost('fubo.tv')).toBeNull();
    expect(countryFromHost('amazon.com')).toBeNull();
  });
  it('html lang', () => {
    expect(isForeignLang('en-GB')).toBe(true);
    expect(isForeignLang('de')).toBe(true);
    expect(isForeignLang('en')).toBe(false);
    expect(isForeignLang('en-US')).toBe(false);
    expect(isForeignLang('es-US')).toBe(false);
    expect(isForeignLang(null)).toBe(false);
  });
  it('currency from prices', () => {
    expect(currencyFromText('Total £68.99 Delivery £4.99')).toBe('GBP');
    expect(currencyFromText('Total $42.99')).toBe('USD');
    expect(currencyFromText('Gesamt 12,99 € inkl. MwSt')).toBe('EUR');
    expect(currencyFromText('CA$ 20.00 and CA$5')).toBe('CAD');
    expect(currencyFromText('Price 1,200 JPY')).toBe('JPY');
    expect(currencyFromText('no prices here')).toBeNull();
  });
});

describe('page hints', () => {
  it('schema types win, then title words', () => {
    expect(categoryFromHints({ schemaTypes: ['Restaurant'], siteName: null, title: null })).toBe('restaurant');
    expect(categoryFromHints({ schemaTypes: ['WebPage'], siteName: null, title: 'Grand Hotel Downtown' })).toBe('hotel_direct');
    expect(categoryFromHints({ schemaTypes: [], siteName: null, title: 'Lavender Candle' })).toBeNull();
  });
});

describe('decide', () => {
  const state = defaultState();
  it('merchant map', () => {
    const d = decide(state, merchants, psl, { url: 'https://www.amazon.com/checkout' });
    expect(d).toMatchObject({ domain: 'amazon.com', category: 'us_online_retail', categorySource: 'merchant', needsAsk: false, foreign: false });
    expect(d.recommendation.cardId).toBe('amex-blue-cash-everyday');
  });
  it('saved choice beats the merchant map', () => {
    const s = { ...defaultState(), siteCategories: { 'amazon.com': 'restaurant' as const } };
    const d = decide(s, merchants, psl, { url: 'https://smile.amazon.com/x' });
    expect(d.categorySource).toBe('saved');
    expect(d.recommendation.cardId).toBe('amex-gold');
  });
  it('page hints, then ask', () => {
    const hinted = decide(state, merchants, psl, {
      url: 'https://www.marios-pizzeria-test.com/order',
      hints: { schemaTypes: ['Restaurant'], siteName: null, title: null },
    });
    expect(hinted).toMatchObject({ category: 'restaurant', categorySource: 'hints', needsAsk: true });
    const unknown = decide(state, merchants, psl, { url: 'https://www.tiny-candle-shop.com/' });
    expect(unknown).toMatchObject({ category: 'general', categorySource: 'unknown', needsAsk: true });
  });
  it('GBP site is foreign and never picks FU or BCE', () => {
    const d = decide(state, merchants, psl, { url: 'https://www.example-shop.co.uk/checkout', lang: 'en-GB', priceText: 'Total £68.99' });
    expect(d.foreign).toBe(true);
    expect(d.foreignReasons.length).toBe(3);
    expect(['chase-freedom-unlimited', 'amex-blue-cash-everyday']).not.toContain(d.recommendation.cardId);
    expect(d.recommendation.warnings.map((w) => w.code)).toContain('foreign_fees');
  });
  it('per-site foreign override wins', () => {
    const s = { ...defaultState(), siteForeign: { 'example-shop.co.uk': false } };
    expect(decide(s, merchants, psl, { url: 'https://www.example-shop.co.uk/checkout', lang: 'en-GB' }).foreign).toBe(false);
  });
  it('uses cap state and tie setting', () => {
    const s = { ...defaultState(), capState: { 'amex-blue-cash-everyday': { us_online_retail: { reached: true } } } };
    expect(decide(s, merchants, psl, { url: 'https://www.amazon.com/' }).recommendation.cardId).toBe('chase-freedom-unlimited');
    const t = defaultState();
    t.settings.preferCashOnTie = false;
    expect(decide(t, merchants, psl, { url: 'https://www.amazon.com/' }).recommendation.cardId).toBe('chase-freedom-unlimited');
  });
  it('cap toggles for the rules in play', () => {
    const toggles = capTogglesFor(defaultState(), 'us_online_retail');
    expect(toggles).toEqual([
      { cardId: 'amex-blue-cash-everyday', cardName: 'Amex Blue Cash Everyday', category: 'us_online_retail', capUsd: 6000, reached: false, usedUsd: null },
    ]);
    expect(capTogglesFor(defaultState(), 'airline_united')).toEqual([]);
  });
});

describe('import and export', () => {
  it('export then import changes nothing', () => {
    const original = defaultState().cardsFile;
    const text = exportCardsJson(original);
    const back = importCardsJson(text);
    expect(back.ok).toBe(true);
    expect(back.value).toEqual(original);
    expect(exportCardsJson(back.value!)).toBe(text);
  });
  it('rejects broken files with readable errors', () => {
    expect(importCardsJson('{ nope').errors[0]).toMatch(/Not valid JSON/);
    expect(importCardsJson('{"version":1}').ok).toBe(false);
  });
});
