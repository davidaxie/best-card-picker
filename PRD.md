# PRD: Best Card Picker (Chrome Extension + iPhone App)

Nov 18, 2026 · David

## Overview

Build two private, local-only tools that tell David which of his six credit cards earns the most on a purchase: a Chrome extension for online checkout and an iPhone app for in-store purchases. Both read the same card rules file and run the same scoring logic, so they always give the same answer.

**Build order change (Nov 18, 2026):** David asked for both tools to be built at the same time in parallel sessions. The extension session owns the shared data files and the TypeScript engine; the iPhone session owns `ios/` and ports the engine to Swift. See "Parallel build plan" at the bottom.

**Problem.** David holds six rewards cards with overlapping bonus categories, so picking the best one means remembering about 20 rules. Existing apps (Kudos, CardPointers, MaxRewards) solve this, but they require sending browsing data, location, or bank logins to a company.

## Goals

- Recommend the best card within 1 second at online checkout, and on arrival at a saved store.
- Show the reason ("4x at restaurants, about 8 cents per dollar") and a runner-up card.
- Keep all data on David's devices. No accounts, no servers, no analytics.
- Make the rules easy to edit when card terms change. The AA card's fee and earning rates change on January 24, 2027.

## Non-goals for v1

- Storing or autofilling card numbers, CVVs, or expiration dates.
- Connecting to banks or reading transactions.
- Activating Amex or Chase Offers.
- Switching the Apple Pay default card. iOS has no public API for it.
- Publishing to the Chrome Web Store or the App Store. Both tools are installed for personal use only.

**User.** One person: David. These are personal tools, not a product.

## Shared card rules engine

Both apps are thin shells around one engine: give it a purchase context (category, merchant, country, in store or online) and it returns the best card, its value in cents per dollar, a one-line reason, and a runner-up. Build and test the engine first, before either app.

Each app only gathers context and shows the answer; every decision comes from the shared engine and cards.json.

### Rules file: cards.json

All card knowledge lives in one human-editable JSON file. No rate is hard-coded in app code. The extension bundles a default copy, and the user can edit, import, and export it. The iPhone app reads the same schema.

```json
{
  "version": 1,
  "updated": "2026-11-18",
  "pointValuesCents": { "amex_mr": 2.0, "chase_ur": 2.0, "united_miles": 1.2, "aa_miles": 1.45, "cash": 1.0 },
  "cards": [
    {
      "id": "amex-gold",
      "name": "Amex Gold",
      "network": "amex",
      "currency": "amex_mr",
      "foreignFeePct": 0,
      "baseRate": 1,
      "rules": [
        { "category": "restaurant", "rate": 4, "capUsdPerYear": 50000 },
        { "category": "us_supermarket", "rate": 4, "capUsdPerYear": 25000 },
        { "category": "airline_direct", "rate": 3 },
        { "category": "amex_travel_prepaid_hotel", "rate": 5 }
      ]
    }
  ],
  "merchants": [
    { "match": "costco", "category": "wholesale_club", "inStoreNetworks": ["visa"] },
    { "match": "united.com", "category": "airline_united" }
  ]
}
```

**Categories (canonical list).** restaurant, us_supermarket, online_grocery, gas_ev, streaming, drugstore, us_online_retail, airline_united, airline_aa, airline_direct, hotel_direct, chase_travel, amex_travel_prepaid_hotel, vacation_rental, rideshare_transit, rental_car, wholesale_club, general. A card rule for airline_direct also covers airline_united and airline_aa unless a more specific rule exists.

### Seed data: David's six cards

Rates come from issuer and review pages checked on November 18, 2026. Verify each against the issuer's terms before relying on it, and flag any rule marked "verify".

| Card | Network | Currency | Foreign fee | Bonus rules | Everything else |
|---|---|---|---|---|---|
| Amex Gold | Amex | amex_mr | 0% | 4x restaurant (cap $50k/yr), 4x us_supermarket (cap $25k/yr), 3x airline_direct (verify), 5x amex_travel_prepaid_hotel | 1x |
| Chase Sapphire Preferred | Visa | chase_ur | 0% | 5x chase_travel, 3x restaurant, online_grocery, gas_ev, streaming, vacation_rental, 2x other travel (hotel_direct, airline_direct, rideshare_transit, rental_car) | 1x |
| Chase Freedom Unlimited | Visa | chase_ur | 3% | 5x chase_travel, 3x restaurant, 3x drugstore | 1.5x |
| United Explorer | Visa | united_miles | 0% | 3x airline_united, 2x restaurant, 2x hotel_direct | 1x |
| Citi AAdvantage Platinum Select | Mastercard | aa_miles | 0% (verify) | 2x airline_aa, 2x restaurant, 2x gas_ev | 1x |
| Amex Blue Cash Everyday | Amex | cash | 2.7% | 3% us_supermarket, 3% us_online_retail, 3% gas_ev (US only), each capped at $6k/yr | 1% |

Point values are defaults the user can change in settings. Chase Freedom Unlimited points are valued as chase_ur because David pools them into his Sapphire account. United and AA mile values are placeholders.

### Scoring logic

For each card, compute value in cents per dollar, then apply filters and pick the highest.

1. **Rate.** Use the card's most specific rule that matches the category. No match means the base rate. A rule whose yearly cap is marked as reached also falls back to the base rate.
2. **Value.** Rate times the point value of the card's currency, in cents. Example: Amex Gold at a restaurant is 4 x 2.0 = 8.0 cents per dollar.
3. **Foreign purchase.** If the merchant is outside the US or charges in another currency, subtract the card's foreign fee (2.7% means minus 2.7 cents) and drop US-only rules such as Blue Cash Everyday's 3%.
4. **Acceptance.** Remove cards whose network the merchant does not take. Costco in-store takes Visa only. Sites can be marked as not taking Amex.
5. **Perk preference.** On airline_united, rank United Explorer first, and on airline_aa rank the AA card first, even if another card earns more points. The reason line says why (free checked bag, base miles boost).
6. **Ties.** Prefer the card with the guaranteed value (cash back) unless the user flips this in settings. If still tied, prefer Visa or Mastercard over Amex, since they are accepted in more places.

The engine returns: `{ cardId, rate, centsPerDollar, reason, runnerUp: { cardId, centsPerDollar }, warnings[] }`. Warnings cover foreign fees, "site may not take Amex", and caps near their limit.

### Golden tests

A file of about 30 purchase cases with expected answers (golden_tests.json) runs against both the TypeScript and Swift engines in CI, so both apps stay in sync. Examples:

| Context | Expected card | Why |
|---|---|---|
| restaurant, US, in store | Amex Gold | 4x MR = 8.0 cents |
| us_supermarket, US | Amex Gold | 4x MR beats 3% cash |
| gas_ev, US | Sapphire Preferred | 3x UR = 6.0 cents |
| us_online_retail (Amazon) | Blue Cash Everyday | 3% cash, tie with Freedom Unlimited 1.5x UR broken toward cash |
| drugstore | Freedom Unlimited | 3x UR |
| airline_united | United Explorer | perk preference |
| wholesale_club, in store | Freedom Unlimited | Visa only, 1.5x |
| restaurant, foreign (GBP) | Amex Gold | no foreign fee, 4x |
| general, foreign | Sapphire Preferred | ties Amex Gold at 2.0 cents, Visa wins the tie; Freedom Unlimited loses 3% |

## Chrome extension

A Manifest V3 extension that spots checkout pages, classifies the store from a local list, and shows the best card in a small in-page pill and the toolbar badge. It makes zero network requests.

### User stories

1. On a checkout page, I see a small pill: "Use Blue Cash Everyday · 3% · runner-up Freedom Unlimited". I can dismiss it.
2. Clicking the toolbar icon on any site shows the best card, the detected category, and a dropdown to change the category. My choice is remembered for that site.
3. On a site that charges in another currency, I am warned off cards with foreign fees.
4. In an options page, I can edit cards, rates, point values and caps, and import or export cards.json.
5. I can mark a cap as reached ("Blue Cash online retail: $6k used") so the engine stops counting that bonus.
6. On a site it does not know, it asks me once: "What kind of store is this?"

### How it decides

1. **Merchant.** Take the registrable domain of the tab (shop.example.co.uk becomes example.co.uk) using a bundled public suffix list.
2. **Category**, checked in this order: the user's saved choice for that domain, then the bundled merchants.json (about 200 common sites), then page hints (schema.org Store or Restaurant types, og:site_name, title words), then ask the user.
3. **Checkout detection** in the content script. Add up signals: a URL path with checkout, cart, payment, billing or order; inputs with autocomplete set to cc-number or cc-exp; payment iframes from Stripe, Braintree, Adyen or PayPal; buttons such as "Place order" or "Pay now". Show the pill once the score passes a threshold. The script only checks that these elements exist and never reads what is typed into them.
4. **Foreign check.** A non-US country domain (.co.uk, .de, .jp), prices in another currency, or a non-US html lang sets the foreign flag for the engine.
5. **Engine.** Runs in the service worker and caches one result per tab.

### Starter merchant map

| Site | Category | Expected card |
|---|---|---|
| amazon.com, walmart.com, target.com | us_online_retail | Blue Cash Everyday (Freedom Unlimited once the $6k cap is used) |
| doordash.com, ubereats.com, grubhub.com | restaurant | Amex Gold |
| instacart.com | online_grocery | Sapphire Preferred |
| safeway.com (verify how online orders code) | us_supermarket | Amex Gold |
| united.com | airline_united | United Explorer |
| aa.com | airline_aa | AA card |
| delta.com, alaskaair.com, jetblue.com | airline_direct | Amex Gold |
| marriott.com, hilton.com, hyatt.com | hotel_direct | Sapphire Preferred |
| airbnb.com, vrbo.com | vacation_rental | Sapphire Preferred |
| Chase Travel portal | chase_travel | Sapphire Preferred (uses the $100 hotel credit) |
| amextravel.com (prepaid hotels only) | amex_travel_prepaid_hotel | Amex Gold |
| netflix.com, spotify.com, hulu.com | streaming | Sapphire Preferred |
| cvs.com, walgreens.com (verify) | drugstore | Freedom Unlimited |
| uber.com (rides), lyft.com | rideshare_transit | Sapphire Preferred |
| hertz.com, enterprise.com | rental_car | Sapphire Preferred |

### Interface

- Toolbar badge: a short code (GOLD, CSP, FU, BCE, UA, AA) in a color per card.
- In-page pill: bottom right, drawn inside a Shadow DOM so the site's styles cannot break it. At most one per page. Buttons: "Not now" and "Never on this site". It never covers payment fields.
- Popup: best card, reason, runner-up, category dropdown, warnings, and cap toggles for the rules in play.
- Options page: card editor, point values, per-site overrides, import and export, reset to defaults, and a pause switch for all sites.

### Build and permissions

- Manifest V3, TypeScript, built with Vite. No runtime libraries other than the shared engine; plain DOM or Preact for the popup and options.
- Layout: src/engine (pure functions, shared), src/background/service-worker.ts, src/content/detect.ts and pill.ts, src/popup, src/options, data/cards.json, data/merchants.json, data/public_suffix.dat, tests/.
- Permissions: storage and activeTab. The automatic pill needs content scripts on every site, so declare `<all_urls>` under optional_host_permissions and ask for it from an "Auto mode" switch in settings. Without it, the extension still works when the toolbar icon is clicked.
- Storage: chrome.storage.local only. Never chrome.storage.sync, which copies data through the Google account.
- Content security policy for extension pages: `script-src 'self'; object-src 'self'; connect-src 'none'`. No remote code and no fetch calls.
- Install: chrome://extensions, turn on Developer mode, Load unpacked, pick the dist/ folder.

### Acceptance criteria

- [ ] Golden tests pass.
- [ ] The pill shows the expected card from the map above on checkout pages of amazon.com, doordash.com, united.com, instacart.com and airbnb.com.
- [ ] On an unknown site, the popup asks for a category, and the answer survives a browser restart.
- [ ] A site priced in GBP shows the foreign fee warning and never recommends Freedom Unlimited or Blue Cash Everyday.
- [ ] DevTools shows zero network requests from the service worker, popup and options page during a full checkout test.
- [ ] The content script never reads input values, confirmed by code review and a test with a fake card field.
- [ ] Editing a rate in options changes the next recommendation without a reload.
- [ ] Exporting and re-importing cards.json changes nothing.

## iPhone app

A SwiftUI app that tells David which card to tap in a store, three ways: a one-tap category grid, a nearby places list, and an alert on arriving at one of up to 20 saved stores. It cannot choose the Apple Pay card for him, so he still swipes to the named card in Wallet.

### User stories

1. At a register, I open the app and tap "Gas". It shows "Sapphire Preferred · 3x · 6 cents per dollar".
2. I open the app and it lists the five nearest places with the best card for each. I tap mine.
3. When I walk into my saved Trader Joe's, I get a notification: "Trader Joe's: use Amex Gold (4x)".
4. A lock screen widget or the Action button answers "Which card here?" without opening the app.
5. I can ask Siri "Which card here?".
6. I edit cards the same way as in the extension, or import the cards.json exported from it.

### How it decides

1. **Engine.** A Swift port of the TypeScript engine, reading the same cards.json schema and passing the same golden tests.
2. **Location.** Core Location with precise location. "While Using" permission for nearby lookups; "Always" only if the user turns on saved place alerts.
3. **Place category.** An MKLocalPointsOfInterestRequest within about 100 m, mapped to engine categories (table below). Brand names in merchants.json win over the MapKit category, for example Costco, Walmart, Target, Trader Joe's and Whole Foods.
4. **Saved places.** The user saves a place from the nearby list (name, coordinates, category). Each becomes a CLMonitor circular condition of about 100 m. On entry, the app posts a local notification with the best card.
5. **Widget and intents.** A WidgetKit lock screen widget, plus an App Intent "Which card here?" that works from Siri, Shortcuts, the Action button and Control Center.

| MapKit category | Engine category |
|---|---|
| restaurant, cafe, bakery, brewery, winery, nightlife | restaurant (bakery and winery: verify how they code) |
| foodMarket | us_supermarket |
| gasStation, evCharger | gas_ev |
| pharmacy | drugstore |
| hotel | hotel_direct |
| parking, publicTransport | rideshare_transit |
| carRental | rental_car |
| store, or anything else | general: ask once, then remember for that place |

### iOS limits to design around

- No public API changes or preselects the Apple Pay card. The app only names the card.
- An app can monitor at most 20 geographic regions at once, so saved places max out at 20.
- A geofence cannot start a Live Activity from the background without a push server, so v1 uses notifications instead.
- Region alerts need Background App Refresh turned on for the app.
- MapKit lookups send the phone's location to Apple. An "Offline mode" setting turns lookups off and uses only the category grid and saved places.
- The MapKit category is a guess. The bank's merchant code can differ, so the reason line says "likely" for MapKit-based answers.

### Build and install

- SwiftUI, iOS 17 or later (needed for CLMonitor), Swift 6, no third-party packages.
- Targets: the app, a widget extension, and App Intents in the app target.
- Storage: one JSON file in the app's Documents folder with complete file protection. No iCloud or CloudKit in v1.
- Install from Xcode on the Mac. With a free Apple ID the app stops working after 7 days and must be reinstalled; the $99 a year Apple Developer Program extends that to a year.
- Moving rules between devices: export cards.json from the extension, AirDrop it to the iPhone, and open it in the app through the share sheet or a file importer.

### Acceptance criteria

- [ ] Golden tests pass in Swift and match the TypeScript results exactly.
- [ ] A category grid answer takes one tap and shows in under 200 ms.
- [ ] At a real supermarket, the nearby list shows it near the top and recommends Amex Gold.
- [ ] Arriving at a saved place triggers a notification with the app closed.
- [ ] Costco recommends Freedom Unlimited, since the warehouse takes Visa only.
- [ ] Offline mode makes zero network requests.
- [ ] The widget and the Siri intent give the same answer as the app.
- [ ] Importing the extension's cards.json produces identical recommendations.

## Privacy and security requirements

The whole point is that no company sees David's data, so these rules beat convenience every time. Each one is checked before a milestone counts as done.

1. **No card numbers, ever.** Cards are stored as a nickname and, optionally, the last four digits. No full number, CVV, expiry, or billing address in code, storage, logs or test fixtures.
2. **No network calls.** The extension makes none. The iPhone app's only network use is the MapKit place lookup, and Offline mode turns that off.
3. **No accounts, no servers, no cloud sync in v1.** Data moves between devices only by a file David exports and imports himself.
4. **No analytics, crash reporting or ad SDKs, and no third-party runtime packages.** Build tools (Vite, TypeScript, test runners) are fine because they do not ship in the app.
5. **Read pages, never forms.** The content script looks at the URL, page structure and prices. It never reads what is typed into inputs and never touches payment iframes.
6. **Smallest permissions.** The extension starts with storage and activeTab; site-wide access is an opt-in switch. The iPhone app asks for "Always" location only when saved place alerts are turned on.
7. **Local history only.** Per-site category choices and cap toggles stay in local storage. A "Clear all data" button wipes them.
8. **Code is public, data stays private.** On Nov 18, 2026 David chose to publish the code as a public GitHub repo (github.com/davidaxie/best-card-picker). Commit no personal data: the default cards.json holds card names and public earn rates only. Never commit exported cards.json files, per-site history, saved places, last-four digits, signing team IDs or provisioning profiles.

## Milestones and testing (original order)

1. M0 Engine. cards.json schema and validator, the TypeScript engine, golden_tests.json, and unit tests in Vitest. Done when every golden test passes.
2. M1 Extension core. Popup, options page, toolbar badge and merchants.json, working in click-to-check mode without site-wide permission. Installed with Load unpacked.
3. M2 Extension auto mode. Checkout detection, the in-page pill, the foreign check, per-site memory and cap toggles. Done when every extension acceptance check passes.
4. M3 One week of real use. David uses the extension for daily shopping and notes every wrong or missing answer; fix the merchant map and rules from that list.
5. M4 iPhone core. Swift engine port, category grid, nearby list, card editor and cards.json import.
6. M5 iPhone alerts. Saved places with geofence notifications, the lock screen widget, the Siri intent and Offline mode. Done when every iPhone acceptance check passes.
7. Later. Convert the extension into a Safari Web Extension with Xcode's converter so it also works in Safari on the iPhone and Mac; an Apple Watch view; monthly reminders to use the Amex Gold credits.

### Testing

- Engine: golden tests run in both languages with one command each (npm test and xcodebuild test).
- Checkout detection: saved, scrubbed HTML copies of real checkout pages as fixtures, plus Playwright loading the built extension in Chromium to confirm the pill appears with the right card.
- Privacy: the network checks in each acceptance list, plus a search of the codebase for fetch, XMLHttpRequest, URLSession and chrome.storage.sync before each milestone closes.
- Real world: for the iPhone, visits to a supermarket, a gas station, a restaurant and Costco.

## Open questions for David

Agents start with the defaults below; each answer only changes a setting.

- [ ] Point values. Keep Amex MR and Chase UR at 2.0 cents each? United miles at 1.2 and AA miles at 1.45 are placeholders.
- [ ] Online shopping tie. Blue Cash Everyday 3% cash and Freedom Unlimited 1.5x UR both come to 3.0 cents. Default is cash; flip it?
- [ ] Caps. Manual "cap reached" toggles (default), or a local running total of the spend the tools see?
- [ ] Sync. Manual file export through AirDrop (default), or allow iCloud Drive later?
- [ ] MapKit lookups. Fine to send location to Apple for nearby places, or start in Offline mode?
- [ ] Apple developer account. Free Apple ID with a reinstall every 7 days, or $99 a year?
- [ ] AA card. On January 24, 2027, its fee rises to $150 and its earning rates change. Update cards.json then, or drop the card?

## Parallel build plan (Nov 18, 2026)

Two Claude Code sessions work in this one folder at the same time, on disjoint files, both committing to `main`.

| Session | Owns (may write) | Reads only |
|---|---|---|
| Chrome extension | everything except `ios/`: `data/`, `src/`, `tests/`, `package.json`, Vite config, root `README.md` | `ios/` |
| iPhone app | `ios/` only | `data/cards.json`, `data/merchants.json`, `data/golden_tests.json` |

- The extension session writes `data/cards.json`, `data/merchants.json` and `data/golden_tests.json` FIRST (M0) and commits them before anything else, so the iPhone session can test against them.
- The schema in this PRD is the contract. If either session needs a schema change, it records the request in `SCHEMA_CHANGES.md` (append only, dated) instead of editing the other side's files.
- Commit only your own paths (`git add <paths>`, never `git add -A`). Never rewrite history, never switch branches.
- The repo is public at github.com/davidaxie/best-card-picker. Both sessions share this one checkout, so no pull is needed: after each commit, run `git push origin main`. Never force-push.
- The iPhone app bundles a copy of the shared data files via an Xcode build step or a copy script under `ios/`, never by moving them out of `data/`.

Sources: earn rates and product facts were checked on November 18, 2026, mostly from review sites (Upgraded Points, The Points Party, The Points Guy, One Mile at a Time, Frequent Miler, PointsCrowd, Apple Support, Apple Developer). Confirm against each issuer's terms page before treating a rate as final.
