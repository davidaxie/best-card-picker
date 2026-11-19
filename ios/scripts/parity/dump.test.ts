// Dumps the TypeScript engine's full output (including reason and warning
// messages) for every golden case, so the Swift tests can check that the two
// engines agree word for word. Run: ios/scripts/ts-parity.sh
import { writeFileSync } from 'node:fs';
import { test } from 'vitest';
import cards from '../../../data/cards.json';
import merchants from '../../../data/merchants.json';
import golden from '../../../data/golden_tests.json';
import { recommend } from '../../../src/engine';

test('dump TypeScript engine output for golden cases', () => {
  const out = (golden as any).cases.map((c: any) => {
    const r = recommend(cards as any, merchants as any, c.input, c.options ?? {});
    return {
      id: c.id,
      cardId: r.cardId,
      rate: r.rate,
      centsPerDollar: r.centsPerDollar,
      basis: r.basis,
      category: r.category,
      foreign: r.foreign,
      reason: r.reason,
      runnerUp: r.runnerUp,
      warnings: r.warnings,
      merchantMatch: r.merchant?.match ?? null,
      ranked: r.ranked.map((s: any) => ({ cardId: s.cardId, rate: s.rate, centsPerDollar: s.centsPerDollar, basis: s.basis })),
    };
  });
  writeFileSync(
    'ios/Packages/BestCardEngine/Tests/BestCardEngineTests/Resources/ts_parity.json',
    JSON.stringify({ generatedFrom: 'src/engine (TypeScript)', cases: out }, null, 2) + '\n',
  );
});
