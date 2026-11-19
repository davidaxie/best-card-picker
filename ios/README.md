# Best Card Picker: iPhone app

SwiftUI, iOS 17 or later, Swift 6, no third-party packages. It uses the same
`data/cards.json` schema and scoring rules as the Chrome extension, ported to
Swift, so both always give the same answer. See `../PRD.md` and
`../docs/ENGINE_SPEC.md`.

## Layout

| Path | What |
|---|---|
| `Packages/BestCardEngine` | Local Swift package. `BestCardEngine` is the scoring engine, a port of `src/engine`. `CardPickerCore` holds storage, saved places, the MapKit category mapping and the answer text shared by every screen. |
| `App/` | The app: category grid, nearby list, saved places, card editor, settings, App Intents, CLMonitor alerts. |
| `Widget/` | Lock screen widget, plus a Control Center control on iOS 18 and later. |
| `Shared/` | Code built into both the app and the widget: App Group names and the Control Center intent. |
| `AppTests/`, `UITests/` | XCTest unit tests and UI tests for the app. |
| `scripts/sync-shared-data.sh` | Copies `../data/{cards,merchants,categories,golden_tests}.json` into the package. It also runs as an Xcode build phase. It never edits `data/`. |
| `scripts/build-brands.py` | Builds the bundled store list `CardPickerCore/Resources/brands.json` (about 3,900 US chains) from the name-suggestion-index. Rerun it to refresh the list; see the header of the script. |
| `scripts/ts-parity.sh` | Runs the TypeScript engine on every golden case and writes `ts_parity.json`. The Swift tests then check the two engines agree word for word. |
| `project.yml` | XcodeGen spec. The generated `BestCardPicker.xcodeproj` is committed. |

## Tests

```bash
cd ios/Packages/BestCardEngine && swift test
```

This runs on macOS with no simulator. It covers all 47 golden cases, full
parity with the TypeScript output (reason text, warning messages, ranking), the
MapKit mapping, storage round trips and the card number guard.

```bash
cd ios && xcodebuild test -project BestCardPicker.xcodeproj -scheme BestCardPicker -destination 'platform=iOS Simulator,name=iPhone 17'
```

This runs the package tests plus the app unit tests and UI tests. It needs the
iOS platform installed (Xcode > Settings > Components, or
`xcodebuild -downloadPlatform iOS`).

After the extension side changes `data/` or `src/engine`, run
`ios/scripts/ts-parity.sh`.

## Install on your iPhone (free Apple ID)

1. Open `ios/BestCardPicker.xcodeproj` in Xcode.
2. Run `cp ios/Local.xcconfig.example ios/Local.xcconfig` and put your
   Personal Team ID in it. `Local.xcconfig` is gitignored, so the ID never
   reaches the public repo. Don't pick the team in Xcode's Signing tab: that
   writes it into the committed project. Keep the App Group
   `group.com.davidxie.bestcardpicker`. If Xcode says the bundle ID is taken,
   change `com.davidxie.bestcardpicker` (app), `.widget` (widget) and the App
   Group in `project.yml` and both `.entitlements` files to something unique,
   then run `xcodegen generate`.
3. Pick your iPhone and Run. With a free Apple ID the app stops launching after
   7 days; Run again to reinstall it.
4. On the phone, go to Settings > General > VPN & Device Management and trust
   your developer certificate. Also turn on Background App Refresh for Card
   Picker, which region alerts need.

## How it works

- **Category grid** (Pick tab): one tap, and the answer is computed on the spot.
  The engine takes microseconds; a test checks that all 12 tiles answer in
  under 200 ms.
- **Store search** (Pick tab): type a store name ("Trader", "Circle K",
  "Chipotle") and each match shows its best card, with no location needed. It
  searches the hand-reviewed brands in `cards.json` and `merchants.json` first,
  then about 3,900 US chains bundled in `brands.json`.
- **Nearby**: an `MKLocalPointsOfInterestRequest` within 200 m lists the 5
  nearest places. Each place's category is resolved in this order: your saved
  choice for that place, a brand in `merchants.json`, a chain in the bundled
  `brands.json` (whole name only, so "Kings BBQ" is not the Kings
  supermarket), the MapKit category
  (PRD table), then general (the app asks once and remembers). The reason line
  says "Likely" because MapKit is guessing.
- **Saved places** (max 20, iOS's limit): each place is a 100 m
  `CLMonitor.CircularGeographicCondition`. On entry the app posts a
  notification such as "Trader Joe's: use Amex Gold (4x)". The app asks for
  "Always" location only when you turn on the Saved place alerts switch.
- **"Which card here?"**: checks for a saved place within 100 m, then the
  nearest MapKit place within 100 m (skipped in Offline mode). Siri, Shortcuts
  and the Action button all use the same answer. In Siri, say "Which card here
  in Card Picker" (Apple requires the app name in the phrase). There's also
  "Best card for gas in Card Picker".
- **Back Tap or Action button**: in Settings > Accessibility > Touch > Back
  Tap > Triple Tap, pick **Open Which Card Here** (listed under Card Picker;
  if it isn't, make a one-action shortcut with it in the Shortcuts app first).
  It opens the app straight on the "Which card here?" answer.
- **Widget**: shows the last place-based answer (from an arrival alert, a
  Nearby tap or Siri) for 2 hours, then "Which card here?". Tapping it opens
  the app's Here sheet.
- **Offline mode**: no MapKit requests at all. Grid, saved places, alerts and
  the widget keep working.

## Storage and privacy

- The source of truth is `Documents/best-card-picker.json`, written with
  `.completeFileProtection` (unreadable while the phone is locked).
- A copy lives in the App Group as `snapshot.json`, with "complete until first
  unlock" protection. It's needed because a geofence fires with the phone
  locked in your pocket, and the widget and Siri also run while locked. It
  holds card names, public earn rates, cap toggles, saved place names and
  coordinates, and the last answer. **It never holds card numbers**: only a
  nickname and optional last four digits exist anywhere, and imports
  containing anything like a card number (12 or more digits) are rejected.
- The only network use is MapKit. There's no URLSession, iCloud, CloudKit,
  analytics or crash reporting. "Clear all data" in Settings wipes both files.

## Store list source and license

`brands.json` is generated from the
[name-suggestion-index](https://github.com/osmlab/name-suggestion-index)
8.0.20261101 (BSD-3-Clause, copyright the OpenStreetMap name-suggestion-index
contributors; full text in `brands-LICENSE.md`). `scripts/build-brands.py` keeps
US brands, maps each OpenStreetMap tag group to a card category, applies
reviewed fixes (Walmart and Target are never grocery, convenience chains like
Circle K count as gas, dollar stores are general), and drops single dictionary
words such as "Express" unless reviewed. Brands that run several kinds of store
are flagged `verify` and the app says so. The curated `data/` files always win.
