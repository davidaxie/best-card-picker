import { describe, expect, it } from 'vitest';
import cards from '../data/cards.json';
import merchants from '../data/merchants.json';
import golden from '../data/golden_tests.json';
import { recommend } from '../src/engine';
import type { CardsFile, EngineOptions, MerchantsFile, PurchaseContext } from '../src/engine';

describe('golden tests (data/golden_tests.json)', () => {
  it('has about 30 or more cases', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(30);
  });
  for (const c of golden.cases) {
    it(c.id, () => {
      const r = recommend(
        cards as CardsFile,
        merchants as MerchantsFile,
        c.input as PurchaseContext,
        ((c as { options?: EngineOptions }).options ?? {}) as EngineOptions,
      );
      const e = c.expected;
      expect(r.cardId).toBe(e.cardId);
      expect(r.rate).toBe(e.rate);
      if (e.centsPerDollar === null) expect(r.centsPerDollar).toBeNull();
      else expect(Math.abs((r.centsPerDollar ?? NaN) - e.centsPerDollar)).toBeLessThan(1e-9);
      expect(r.basis).toBe(e.basis);
      expect(r.category).toBe(e.category);
      if (e.runnerUp === null) expect(r.runnerUp).toBeNull();
      else {
        expect(r.runnerUp?.cardId).toBe(e.runnerUp.cardId);
        expect(Math.abs((r.runnerUp?.centsPerDollar ?? NaN) - e.runnerUp.centsPerDollar)).toBeLessThan(1e-9);
      }
      expect(r.warnings.map((w) => w.code).sort()).toEqual([...e.warnings].sort());
      expect(r.reason.length).toBeGreaterThan(0);
    });
  }
});
