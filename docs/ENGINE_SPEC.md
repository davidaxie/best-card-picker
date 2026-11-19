# Engine spec (TypeScript and Swift must match exactly)

Reference implementation: `src/engine/recommend.ts` and `src/engine/merchant.ts`.
Golden cases: `data/golden_tests.json`. If this spec and the TypeScript code disagree, the code plus the golden tests win; file a note in `SCHEMA_CHANGES.md`.

## Inputs

```
recommend(cardsFile, merchantsFile, context, options) -> Recommendation
```

`context` (PurchaseContext)

| field | type | meaning |
|---|---|---|
| category | Category? | Category to score. When absent: the resolved merchant's category, else `general`. |
| merchant | string? | A domain/host (`amazon.com`, `smile.amazon.com`, a full URL is fine) or a place name (`Trader Joe's`). |
| channel | `online` \| `in_store` | Picks which merchant acceptance list applies. Required. |
| foreign | bool? | Foreign purchase flag set by the app. |
| currency | string? | ISO 4217. Anything other than `USD` (case-insensitive) means foreign. |
| country | string? | ISO 3166 alpha-2. Anything other than `US` means foreign. |
| acceptedNetworks | [Network]? | Hard acceptance list. Overrides the merchant's list. |
| mayNotTakeAmex | bool? | Soft flag; ORed with the merchant's flag. Only adds a warning. |

`options` (EngineOptions)

| field | default | meaning |
|---|---|---|
| preferCashOnTie | true | On equal cents, a `cash` currency card beats a points card. `false` flips it (points win). |
| pointValuesCents | {} | Merged over `cardsFile.pointValuesCents` key by key. |
| disabledCards | [] | Card ids to skip (same as `enabled: false` on the card). |
| capState | {} | `capState[cardId][category] = { reached?: bool, usedUsd?: number }` |

## Merchant resolution

Lists are searched in this order: `cardsFile.merchants` (may be absent), then `merchantsFile.merchants`.

1. **Host extraction.** Trim, lowercase. If it contains `://`, keep what follows. Cut at the first `/`, `?` or `#`. Drop a trailing `:port` and a trailing `.`. If the result contains a `.` and no whitespace, it is a host; otherwise it is a place name.
2. **Host lookup.** Split on `.`. For i = 0 up to (labelCount - 2): suffix = labels[i...] joined by `.`. For each list in order, for each entry in order: an entry hits if its `match` contains a `.` and `match.lowercased() == suffix`. Return the first hit. No hit after the 2-label suffix: no merchant. (So `smile.amazon.com` -> `amazon.com`; `travelsecure.chase.com` hits its own entry before `chase.com`.)
3. **Name lookup.** `normalize(s)` = lowercase; delete `'` and U+2019; replace each maximal run of characters outside `[a-z0-9]` with one space; trim. Only entries whose `match` has no `.` are brands. A brand hits when `name == brand` or `name` starts with `brand + " "` (both normalized). The longest normalized brand wins; on equal length, the earlier list then the earlier entry wins. Empty normalized name: no merchant.

## Scoring

Let `category` = context.category ?? merchant?.category ?? `general`.
Let `foreign` = context.foreign == true OR (currency present and uppercased != `USD`) OR (country present and uppercased != `US`).
Let `accepted` = context.acceptedNetworks ?? (channel == in_store ? merchant?.inStoreNetworks : merchant?.onlineNetworks). Absent means every network.

**Candidates**: cards in file order where `enabled != false`, id not in `disabledCards`, and (`accepted` absent or contains `card.network`). Remember each card's file index.

**Rule selection** for each candidate:
1. `eligible` = card.rules minus rules where (`usOnly` and foreign) minus rules whose cap is reached. A cap is reached when `capState[card.id][rule.category].reached == true`, or when `usedUsd` and `capUsdPerYear` are both present and `usedUsd >= capUsdPerYear`.
2. Among eligible rules with `rule.category == category`, take the one with the highest rate (first one on equal rate).
3. If none and category is `airline_united` or `airline_aa`: the highest-rate eligible rule with category `airline_direct`.
4. Otherwise no rule (base rate).

Note: ineligible rules are dropped before the fallback, so a reached cap on a specific airline rule would let a card's `airline_direct` rule apply. No seed card has both.

**Value**
- `rate` = rule ? max(rule.rate, card.baseRate) : card.baseRate
- `cents` = round4(rate * pointValues[card.currency] - (foreign ? card.foreignFeePct : 0)), with a missing point value treated as 0.
- `round4(x)` = sign(x) * roundHalfAwayFromZero(abs(x) * 10000) / 10000, and -0 becomes 0. In Swift: `(abs(x) * 10000).rounded(.toNearestOrAwayFromZero) / 10000` times the sign. JS uses `Math.round` on a non-negative number, which is the same thing.
- `basis` = `perk` if card.preferredFor has an entry for `category`; else `bonus` if a rule was selected and rule.rate > baseRate; else `base`.

**Ranking** (sort candidates; first is the pick, second is the runner-up):
1. `basis == perk` first.
2. Higher `cents` first (compare the rounded values exactly).
3. preferCashOnTie true: currency `cash` first. False: non-cash first.
4. Network rank: visa = mastercard = 0, discover = 1, amex = 2. Lower first.
5. Lower file index first.

## Output

```
{ cardId, rate, centsPerDollar, basis, category, foreign, reason, runnerUp: { cardId, centsPerDollar } | null, warnings: [{ code, message }], merchant, ranked }
```

With no candidates: cardId, rate, centsPerDollar, basis and runnerUp are null and the only warning is `no_accepted_card` (`foreign_fees` needs at least one candidate, so it cannot fire here).

Known consequence of PRD step 3 (fees are subtracted, fee cards are not excluded): on a foreign drugstore purchase Freedom Unlimited nets 3x UR (6.0) minus its 3% fee = 3.0 cents and still beats the no-fee cards at 2.0. Every other category picks a no-fee card abroad. This is an open question for David; changing it is an engine rule change plus new golden cases.

**Warnings** (codes are compared in golden tests as a set; messages are free text):

| code | when |
|---|---|
| foreign_fees | foreign, and at least one candidate has foreignFeePct > 0 |
| may_not_take_amex | (context.mayNotTakeAmex or merchant.mayNotTakeAmex) and the pick's network is amex |
| cap_near_limit | the pick's selected rule has capUsdPerYear, and usedUsd for it is >= 0.9 * cap and < cap |
| verify_rule | the pick's selected rule has `verify: true` |
| verify_card | foreign and the pick's card `verify` list contains `foreignFeePct` |
| verify_merchant | a merchant entry was resolved and it has `verify: true` |
| no_accepted_card | no candidates |

**Reason text** (not compared; suggested format):
- bonus: `4x at restaurants, about 8 cents per dollar`
- cash bonus: `3% cash back on US online retail, about 3 cents per dollar`
- base: `1.5x on everything else, about 3 cents per dollar`
- perk: `Perk pick: free first checked bag and priority boarding on United (3x, about 3.6 cents per dollar)`
- foreign with a fee: append ` after the 3% foreign fee` to the value part.
Phrases come from `data/categories.json`.

## Golden test file

```
{ version, updated, description, cases: [ { id, description, input: PurchaseContext, options?: EngineOptions, expected: { cardId, rate, centsPerDollar, basis, category, runnerUp, warnings: [code] } } ] }
```

Run every case against the bundled `data/cards.json` and `data/merchants.json`. Compare `cardId`, `rate`, `basis`, `category` exactly, `centsPerDollar` and `runnerUp.centsPerDollar` within 1e-9, and warnings as a set of codes.
