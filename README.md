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
| `src/content/` | Injected only after you click the toolbar icon: page hints and checkout signals (`detect.ts`), the saved-card finder (`saved-cards.ts`) and the outline overlay (`highlight.ts`). |
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
`dist-e2e/` adds host access because a headless test cannot click the toolbar icon to get
`activeTab`. Never load `dist-e2e/` for real browsing.

## Install in Chrome

1. `npm run build`
2. Open `chrome://extensions` and turn on Developer mode.
3. Click Load unpacked and pick the `dist/` folder.
4. Pin the extension. Click it on any shopping site to see the best card.

The extension only runs when you click its icon. Nothing is registered on any site and nothing pops
up on its own. The first time, the popup shows "Check this page" (or "Point to my card on this page"
if you saved card digits): press it once to let the extension read the page you clicked it on. After
that, each click on the icon reads that one page and outlines your card right away.

## How it decides (extension)

1. Merchant: the tab's host, reduced to its registrable domain with the bundled suffix list.
2. Category: your saved choice for that site, then the merchant map, then page hints (schema.org
   types, `og:site_name`, title words), then it asks you once in the popup.
3. Page reading (only after your click): page hints, prices and language from the page, plus
   checkout signals (URL words, card fields by `autocomplete`, payment iframes, "Place order"
   buttons). It only checks that fields exist; it never reads what you type.
4. Foreign: a country domain (.co.uk, .de, .jp), prices in another currency, or a non-US page
   language. You can override it per site in the popup.
5. Engine: see `docs/ENGINE_SPEC.md`. Defaults: Amex MR and Chase UR at 2.0 cents, cash wins ties,
   manual "cap reached" toggles.

## Pointing at your saved card

If you add a card's last 4 or 5 digits in options (Amex shows 5 on its own site), the extension looks for the site's saved-card list
("Visa ending in 1234", "•••• 1234", "x1234", "Amex ...1234") and draws an outline with a small
"Best card" tag around the matching row. If the best card is not saved on that site but the runner-up
is, it outlines the runner-up and says so. A stored 5-digit ending also matches a page that shows
only the last 4. It happens when you click the toolbar icon on the checkout page. The outline keeps
up with the page for a minute (checkouts often re-render) and then stops watching. If you open the
payment step later, click the icon again or press "Look for my card again".

The outline is an overlay in a closed Shadow DOM with `pointer-events: none`, outside the site's form.
It reads page text and `aria-label` only, never input values, and never clicks, selects, focuses or
changes anything: you make the final click. A row that names a different network (Discover •••• 1234
when your Amex ends in 1234) is not a match.

## Permissions and privacy

- Installed permissions: `storage` and `activeTab` only. `scripting` is optional and requested by the
  popup's first "Check this page" press (Chrome grants it without a prompt because it has no
  warning). There is no all-sites access and no registered content script; `activeTab` limits each
  run to the one tab you clicked on. Updating from a build with the old Auto mode removes its
  registered script, its all-sites permission and its stored settings.
- Extension pages run under `script-src 'self'; object-src 'self'; connect-src 'none'`. The code has
  no `fetch`, `XMLHttpRequest`, WebSocket or beacon calls; `npm run test:e2e` checks this in `dist/`
  and records any request from the service worker, popup or options page.
- Storage is `chrome.storage.local` only, never `chrome.storage.sync`.
- Cards are a nickname and, optionally, the last 4 or 5 digits. The validator rejects anything that
  looks like a card number, CVV, expiry or address field.
- Last four digits live in their own `chrome.storage.local` key (`last4`), never in `cardsFile` and
  never in the bundled `data/cards.json`. Export leaves them out unless you tick "Include last four
  digits". Importing a file that has them moves them into that key.
- "Clear all data" in options wipes per-site choices, cap toggles, settings and the
  saved last four digits.
- Do not commit exported `cards.json` files or anything with your own history in it.
