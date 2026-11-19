# Best Card Picker

Private, local-only tools that tell you which of your credit cards earns the most on a purchase.
One shared rules file (`data/cards.json`) and one scoring engine, used by a Chrome extension (this
folder) and a SwiftUI iPhone app (`ios/`, see `ios/README.md`). No accounts, no servers, no analytics,
no network requests from the extension.

See `PRD.md` for the product spec, `docs/ENGINE_SPEC.md` for the exact scoring rules both engines
follow, and `SCHEMA_CHANGES.md` for fields added beyond the PRD.

## Layout

| Path | What |
|---|---|
| `data/cards.json` | Your six cards, earn rates, caps, point values. The only place rates live. |
| `data/merchants.json` | Starter map of ~270 shopping sites and ~40 store brands to categories. |
| `data/golden_tests.json` | 47 purchase cases with expected answers. Both engines must pass them. |
| `data/categories.json` | Labels for the 18 categories. |
| `data/*.schema.json` | JSON Schema for the two data files. |
| `data/public_suffix.dat` | Bundled Public Suffix List (MPL 2.0), used to turn `shop.example.co.uk` into `example.co.uk`. |
| `src/engine/` | Pure TypeScript engine and validator, no dependencies. |
| `src/background/service-worker.ts` | Runs the engine, caches one result per tab, sets the toolbar badge. |
| `src/content/` | Auto mode only: checkout detection (`detect.ts`) and the Shadow DOM pill (`pill.ts`). |
| `src/popup/`, `src/options/` | Toolbar popup and options page (plain DOM). |
| `tests/` | Vitest unit tests, fixtures, and the Playwright suite in `tests/e2e/`. |

## Commands

```bash
npm install
```

```bash
npm test
```

Runs every golden case plus validator, merchant matching, detection, privacy and decision tests (Vitest).

```bash
npm run build
```

Typechecks and builds the extension into `dist/`.

```bash
npm run test:e2e
```

Builds `dist/` and `dist-e2e/`, then loads the extension in headless Chromium and checks it against
the fixture checkout pages. The first run may need `npx playwright install chromium`.
`dist-e2e/` pre-grants the Auto mode permissions because a headless test cannot click Chrome's
permission prompt. Never load `dist-e2e/` for real browsing.

## Install in Chrome

1. `npm run build`
2. Open `chrome://extensions` and turn on Developer mode.
3. Click Load unpacked and pick the `dist/` folder.
4. Pin the extension. Click it on any shopping site to see the best card (click-to-check mode).
5. Optional: open the options page and turn on Auto mode to get the in-page pill on checkout pages.
   Chrome will ask for access to all sites; that is the only time it does.

## How it decides (extension)

1. Merchant: the tab's host, reduced to its registrable domain with the bundled suffix list.
2. Category: your saved choice for that site, then the merchant map, then page hints (schema.org
   types, `og:site_name`, title words), then it asks you once in the popup.
3. Checkout (Auto mode): URL words (checkout, cart, payment, billing, order), card fields by
   `autocomplete`, payment iframes (Stripe, Braintree, Adyen, PayPal), and buttons such as
   "Place order". It only checks that these exist; it never reads what you type.
4. Foreign: a country domain (.co.uk, .de, .jp), prices in another currency, or a non-US page
   language. You can override it per site in the popup.
5. Engine: see `docs/ENGINE_SPEC.md`. Defaults: Amex MR and Chase UR at 2.0 cents, cash wins ties,
   manual "cap reached" toggles.

## Permissions and privacy

- Installed permissions: `storage` and `activeTab` only. `scripting` and `<all_urls>` are optional and
  requested by the Auto mode switch; turning Auto mode off removes them.
- Extension pages run under `script-src 'self'; object-src 'self'; connect-src 'none'`. The code has
  no `fetch`, `XMLHttpRequest`, WebSocket or beacon calls; `npm run test:e2e` checks this in `dist/`
  and records any request from the service worker, popup or options page.
- Storage is `chrome.storage.local` only, never `chrome.storage.sync`.
- Cards are a nickname and, optionally, the last four digits. The validator rejects anything that
  looks like a card number, CVV, expiry or address field.
- "Clear all data" in options wipes per-site choices, cap toggles, never-show sites and settings.
- Do not commit exported `cards.json` files or anything with your own history in it.
