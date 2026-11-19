// @vitest-environment jsdom
// Saved-card finder, matcher and highlight. Fixtures use fake digits only (0001 to 0006).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { highlightState, removeHighlight, showHighlight } from '../src/content/highlight';
import { findSavedCards, last4sIn, matchSaved, networkIn, sameEnding, type CardTarget, type SavedTargets } from '../src/content/saved-cards';
import { exportCardsJson, importCardsJson } from '../src/shared/io';
import { cleanLast4, defaultCardsFile, splitLast4 } from '../src/shared/state';

const fixture = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');
function mount(name: string): void {
  document.documentElement.innerHTML = fixture(name).replace(/<script>[\s\S]*?<\/script>/g, '');
}

const T = (cardId: string, name: string, last4: string, network: CardTarget['network']): CardTarget => ({ cardId, name, last4, network, color: '#123456' });
const GOLD = T('amex-gold', 'Amex Gold', '0001', 'amex');
const CSP = T('chase-sapphire-preferred', 'Chase Sapphire Preferred', '0002', 'visa');
const FU = T('chase-freedom-unlimited', 'Chase Freedom Unlimited', '0003', 'visa');
const BCE = T('amex-blue-cash-everyday', 'Amex Blue Cash Everyday', '0006', 'amex');

afterEach(() => removeHighlight());

describe('last four patterns', () => {
  it('finds the common ways sites print a saved card', () => {
    expect(last4sIn('Visa ending in 0003')).toEqual(['0003']);
    expect(last4sIn('Amex ends with 0006')).toEqual(['0006']);
    expect(last4sIn('Mastercard •••• 0005')).toEqual(['0005']);
    expect(last4sIn('**** 0002')).toEqual(['0002']);
    expect(last4sIn('xxxx0004')).toEqual(['0004']);
    expect(last4sIn('Amex ...0001')).toEqual(['0001']);
    expect(last4sIn('Visa …0002')).toEqual(['0002']);
    expect(last4sIn('x0001')).toEqual(['0001']);
    expect(last4sIn('Card (x-0003)')).toEqual(['0003']);
    expect(last4sIn('Amex ending in 10006')).toEqual(['10006']);
    expect(last4sIn('American Express •••• 10006')).toEqual(['10006']);
  });
  it('ignores prices, years, order numbers and longer digit runs', () => {
    for (const s of ['Total $1,234.00', 'Order 1234', 'Expires 2028', '©2026 Example', 'ending in 123456', 'Room 4x1234', 'Call 555-0100']) {
      expect(last4sIn(s), s).toEqual([]);
    }
  });
  it('names a network only when exactly one is named', () => {
    expect(networkIn('American Express ending in 0006')).toBe('amex');
    expect(networkIn('Visa •••• 0003')).toBe('visa');
    expect(networkIn('Pay with Visa, Mastercard or Discover')).toBeNull();
    expect(networkIn('•••• 0003')).toBeNull();
  });
});

describe('4 or 5 digit endings', () => {
  it('a stored 5-digit ending matches a page showing its last 4, or all 5', () => {
    expect(sameEnding('10006', '0006')).toBe(true);
    expect(sameEnding('10006', '10006')).toBe(true);
    expect(sameEnding('10006', '20006')).toBe(false);
    expect(sameEnding('0006', '10006')).toBe(true); // stored 4, page shows 5
    expect(sameEnding('0006', '0007')).toBe(false);
  });

  it('outlines an Amex stored as 5 digits on pages that print 4 or 5', () => {
    const bce5 = { ...BCE, last4: '10006' };
    document.body.innerHTML = '<ul><li id="a">Visa ending in 0003</li><li id="b">Amex ending in 0006</li></ul>';
    expect(matchSaved(findSavedCards(document), { best: bce5, runnerUp: null }).element?.id).toBe('b');
    document.body.innerHTML = '<ul><li id="a">Amex ending in 20006</li><li id="b">Amex ending in 10006</li></ul>';
    expect(matchSaved(findSavedCards(document), { best: bce5, runnerUp: null }).element?.id).toBe('b');
    // A different 5-digit Amex ending is not a match, even though the last 4 agree.
    document.body.innerHTML = '<ul><li id="a">Amex ending in 20006</li></ul>';
    expect(matchSaved(findSavedCards(document), { best: bce5, runnerUp: null }).status).toBe('none');
  });

  it('storage and export keep 4 or 5 digits and drop anything else', () => {
    expect(cleanLast4({ a: '0001', b: '10006', c: '123456', d: '123' })).toEqual({ a: '0001', b: '10006' });
    const f = defaultCardsFile();
    const out = JSON.parse(exportCardsJson(f, { [f.cards[0]!.id]: '10001', [f.cards[1]!.id]: '123456' }));
    expect(out.cards[0].last4).toBe('10001');
    expect(out.cards[1].last4).toBeUndefined();
    expect(importCardsJson(JSON.stringify(out)).ok).toBe(true);
  });
});

describe('saved card lists on fixtures', () => {
  it('Amazon-style radios: outlines the Amex row for Blue Cash Everyday', () => {
    mount('amazon-saved-cards.html');
    const found = findSavedCards(document);
    expect(found.map((f) => [f.last4, f.network, f.element.id])).toEqual([
      ['0003', 'visa', 'row-visa'],
      ['0006', 'amex', 'row-amex'],
    ]);
    const m = matchSaved(found, { best: BCE, runnerUp: FU });
    expect(m.status).toBe('best');
    expect(m.element?.id).toBe('row-amex');
  });

  it('Target-style split spans: best card missing, runner-up outlined, wrong network skipped', () => {
    mount('target-saved-cards.html');
    const found = findSavedCards(document);
    expect(found.map((f) => [f.last4, f.network, f.element.id])).toEqual([
      ['0005', 'mastercard', 'row-mc'],
      ['0003', 'visa', 'row-visa'],
      ['0006', 'discover', 'row-discover'],
    ]);
    // Discover •••• 0006 shares BCE's digits but names another network: not a match.
    const m = matchSaved(found, { best: BCE, runnerUp: FU });
    expect(m.status).toBe('runnerUp');
    expect(m.element?.id).toBe('row-visa');
    expect(matchSaved(found, { best: BCE, runnerUp: null }).status).toBe('none');
  });

  it('DoorDash-style listbox: outlines Gold, not the selected Visa', () => {
    mount('doordash-saved-cards.html');
    const found = findSavedCards(document);
    expect(found.map((f) => [f.last4, f.network, f.element.id])).toEqual([
      ['0002', 'visa', 'row-visa'],
      ['0001', 'amex', 'row-amex'],
    ]);
    const m = matchSaved(found, { best: GOLD, runnerUp: CSP });
    expect(m.status).toBe('best');
    expect(m.element?.id).toBe('row-amex');
  });

  it('a page without a saved list reports noList; old fixtures have no saved cards', () => {
    for (const f of ['amazon-checkout.html', 'doordash-checkout.html', 'united-checkout.html', 'instacart-checkout.html']) {
      mount(f);
      expect(findSavedCards(document), f).toEqual([]);
      expect(matchSaved(findSavedCards(document), { best: GOLD, runnerUp: null }).status).toBe('noList');
    }
  });

  it('a row that names no network still matches on digits alone', () => {
    document.body.innerHTML = '<ul><li id="a">Card •••• 0001</li><li id="b">Card •••• 0009</li></ul>';
    const m = matchSaved(findSavedCards(document), { best: GOLD, runnerUp: null });
    expect(m.status).toBe('best');
    expect(m.element?.id).toBe('a');
  });
});

describe('privacy and form state', () => {
  const restore: (() => void)[] = [];
  beforeEach(() => {
    // jsdom has no layout: give every element a visible box so the overlay draws.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 300, 40));
  });
  afterEach(() => {
    restore.splice(0).forEach((f) => f());
    vi.restoreAllMocks();
  });

  function trap(proto: object, prop: string, log: string[]): void {
    const desc = Object.getOwnPropertyDescriptor(proto, prop)!;
    Object.defineProperty(proto, prop, {
      configurable: true,
      get() {
        log.push(`get ${prop}`);
        return desc.get!.call(this);
      },
      set(v) {
        log.push(`set ${prop}`);
        desc.set!.call(this, v);
      },
    });
    restore.push(() => Object.defineProperty(proto, prop, desc));
  }

  function formState(): string {
    const inputs = Array.from(document.querySelectorAll('input')).map((i) => `${i.id}:${i.getAttribute('value')}:${i.checked}`);
    const aria = Array.from(document.querySelectorAll('[aria-checked],[aria-selected]')).map(
      (e) => `${e.id}:${e.getAttribute('aria-checked')}:${e.getAttribute('aria-selected')}`,
    );
    return JSON.stringify({ inputs, aria, active: document.activeElement?.tagName, body: document.body.innerHTML });
  }

  for (const [file, targets] of [
    ['amazon-saved-cards.html', { best: BCE, runnerUp: FU }],
    ['target-saved-cards.html', { best: BCE, runnerUp: FU }],
    ['doordash-saved-cards.html', { best: GOLD, runnerUp: CSP }],
  ] as [string, SavedTargets][]) {
    it(`${file}: no input value is read and no form state changes`, () => {
      mount(file);
      const gift = document.getElementById('giftcode') as HTMLInputElement | null;
      if (gift) gift.value = 'TYPED-SECRET';
      const log: string[] = [];
      trap(HTMLInputElement.prototype, 'value', log);
      trap(HTMLInputElement.prototype, 'checked', log);
      trap(HTMLTextAreaElement.prototype, 'value', log);
      trap(HTMLSelectElement.prototype, 'value', log);
      const events: string[] = [];
      const types = ['input', 'change', 'click', 'focus', 'focusin', 'select', 'submit', 'keydown'];
      const rec = (e: Event) => events.push(e.type);
      types.forEach((t) => document.addEventListener(t, rec, true));
      const before = formState();
      log.length = 0;

      const m = matchSaved(findSavedCards(document), targets);
      expect(m.element).not.toBeNull();
      showHighlight(m.element!, { label: 'Best card', color: '#123456' });
      expect(highlightState()).toMatchObject({ shown: true, label: 'Best card', count: 1 });

      expect(log).toEqual([]);
      expect(events).toEqual([]);
      types.forEach((t) => document.removeEventListener(t, rec, true));
      expect(formState()).toBe(before);
      // The overlay lives outside <body> and outside every form.
      const host = document.querySelector('bcp-highlight-host') as HTMLElement;
      expect(host.parentElement).toBe(document.documentElement);
      expect(host.closest('form')).toBeNull();
      expect(host.style.pointerEvents).toBe('none');
      expect(host.style.left).toBe('6px');
      expect(host.style.width).toBe('308px');
    });
  }

  it('the new content files have no value, checked, click, focus or dispatch calls', () => {
    for (const f of ['saved-cards.ts', 'highlight.ts', 'main.ts', 'detect.ts', 'pill.ts']) {
      const src = readFileSync(resolve(__dirname, '../src/content', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(
        /\.value\b|\.checked\b|\.selected\b|\.click\(|\.focus\(|\.blur\(|dispatchEvent|\.submit\(|requestSubmit|setAttribute\(['"]aria-(checked|selected)|contentDocument|contentWindow|FormData/,
      );
    }
  });
});

describe('last four storage and export', () => {
  it('splitLast4 moves digits out of a cards file', () => {
    const f = defaultCardsFile();
    f.cards[0]!.last4 = '0001';
    f.cards[1]!.last4 = '12'; // malformed: dropped
    const { cardsFile, last4 } = splitLast4(f);
    expect(last4).toEqual({ [f.cards[0]!.id]: '0001' });
    expect(cardsFile.cards.some((c) => 'last4' in c)).toBe(false);
    expect(f.cards[0]!.last4).toBe('0001'); // input not mutated
  });

  it('cleanLast4 keeps 4 or 5 digit strings only', () => {
    expect(cleanLast4({ a: '0001', b: '123', c: 1234, d: '123456', e: '00a1', f: '10002' })).toEqual({ a: '0001', f: '10002' });
    expect(cleanLast4(null)).toEqual({});
  });

  it('export leaves digits out unless they are passed in, and the file still validates', () => {
    const f = defaultCardsFile();
    f.cards[0]!.last4 = '0001'; // even a stray one inside cardsFile is dropped
    const plain = exportCardsJson(f);
    expect(plain).not.toContain('last4');
    expect(plain).not.toContain('0001');
    const withDigits = exportCardsJson(f, { [f.cards[1]!.id]: '0002' });
    expect(JSON.parse(withDigits).cards[1].last4).toBe('0002');
    expect(withDigits).not.toContain('0001');
    expect(importCardsJson(withDigits).ok).toBe(true);
  });

  it('the bundled cards.json carries no last four digits', () => {
    expect(readFileSync(resolve(__dirname, '../data/cards.json'), 'utf8')).not.toContain('last4');
  });
});
