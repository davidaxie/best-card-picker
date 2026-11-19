# Schema changes

Append only. Newest at the bottom. Each entry says who asked, what changed, and whether golden tests changed.
The PRD schema is the contract; everything here is an addition to it. Both engines must follow `docs/ENGINE_SPEC.md`.

## 2026-11-18 (extension session): additions made while writing M0

All additions are optional fields. A file written to the PRD's original example schema still loads.

**cards.json, card object**
- `shortCode` (string): toolbar badge text (GOLD, CSP, FU, BCE, UA, AA).
- `color` (string, `#RRGGBB`): badge and pill color.
- `preferredFor` (array of `{ category, reason }`): the PRD's perk preference, expressed as data instead of code. United Explorer on `airline_united`, AA card on `airline_aa`, and Sapphire Preferred on `chase_travel` (PRD says CSP wins there for the $100 hotel credit; CSP and FU both earn 5x, so the perk entry makes that explicit instead of relying on file order).
- `enabled` (boolean, default true): card editor can switch a card off without deleting it.
- `last4` (string of exactly 4 digits): optional, per PRD privacy rule 1. Nothing else about the card number is allowed.
- `verify` (array of field names, e.g. `["foreignFeePct"]`): card-level "verify" flags from the PRD seed table.
- `note` (string).

**cards.json, rule object**
- `usOnly` (boolean): rule is dropped on foreign purchases (PRD scoring step 3). Set on all three Blue Cash Everyday rules and on Amex Gold `us_supermarket` (the issuer bonus is for US supermarkets).
- `verify` (boolean): the PRD's "verify" marks. Set on Amex Gold `airline_direct` (from the PRD) and Amex Gold `amex_travel_prepaid_hotel` (added: some issuer pages show a lower rate).
- `note` (string).

**cards.json and merchants.json, merchant object**
- `name` (string): display name.
- `onlineNetworks` (array of networks): hard acceptance list for online purchases, alongside the PRD's `inStoreNetworks`.
- `mayNotTakeAmex` (boolean): soft flag, only adds a warning.
- `verify` (boolean), `note` (string).
- `match` semantics: a value containing a dot is a domain, anything else is a brand matched against place names. See `docs/ENGINE_SPEC.md`.

**New files**
- `data/merchants.json`: `{ version, updated, merchants: [merchant] }`, same merchant object as cards.json. Entries in cards.json `merchants` win over merchants.json.
- `data/categories.json`: `{ version, categories: [{ id, label, phrase }] }`, display labels for the 18 canonical categories, so both apps show the same words.
- `data/golden_tests.json`: format documented in `docs/ENGINE_SPEC.md`.
- `data/cards.schema.json`, `data/merchants.schema.json`: JSON Schema (draft 2020-12) for the two data files.

**Engine output additions** (beyond the PRD's `{ cardId, rate, centsPerDollar, reason, runnerUp, warnings }`)
- `basis`: `bonus`, `base` or `perk`.
- `category`: the category actually used.
- `warnings` are `{ code, message }`. Golden tests compare the codes only.

Golden tests: written against these additions from the start (47 cases).

## 2026-11-19: last four digits move out of cardsFile (extension storage only)

- The schema is unchanged: `card.last4` is still allowed in a cards file, so an exported file with digits still validates and the iPhone app can still read it.
- The Chrome extension no longer stores digits inside `cardsFile`. They live in a separate `chrome.storage.local` key, `last4: { [cardId]: "1234" }`. On load, any `card.last4` found in stored `cardsFile` is moved there once.
- Export omits `last4` unless the user ticks "Include last four digits". Import moves any `last4` into the separate key.
- `data/cards.json` never carries `last4`; a unit test checks this.

## 2026-11-19: `last4` accepts 4 or 5 digits

- `card.last4` pattern loosened from `^[0-9]{4}$` to `^[0-9]{4,5}$` in `data/cards.schema.json` and `src/engine/validate.ts`. Amex shows a 5-digit ending on its own site. The field keeps its name for compatibility.
- Matching on a checkout page: stored and shown digits match when the shorter is the end of the longer. A stored `12345` matches a page showing `2345`; a page showing all 5 must agree on all 5.
- iPhone: `ios/Packages/BestCardEngine/Sources/BestCardEngine/Validator.swift` still requires exactly 4, so an exported cards file with a 5-digit value fails there until it is loosened the same way.

## 2026-11-19: Auto mode removed from the extension (click-only)

- Extension storage: `settings.autoMode` and `neverSites` are gone. They are deleted on install, update and browser start, along with the old registered all-sites content script and any `<all_urls>` grant.
- No change to `data/*.json` or the engine.
