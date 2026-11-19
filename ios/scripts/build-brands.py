#!/usr/bin/env python3
"""Build the iPhone app's bundled brand list (brands.json) from the
name-suggestion-index (NSI), the open brand database OpenStreetMap editors use.

    curl -sSfL -o /tmp/nsi/nsi.json \
      https://cdn.jsdelivr.net/npm/name-suggestion-index@8.0.20261101/dist/json/nsi.json
    python3 -I ios/scripts/build-brands.py /tmp/nsi/nsi.json

What it does:
- Keeps brands whose NSI locationSet covers the US (us, us-<state>, or a world
  or Americas region that doesn't exclude the US).
- Maps the OSM tag group to a card category (CATEGORY_BY_GROUP), skipping
  places nobody pays at with a card (banks, ATMs, offices, schools...).
- Applies reviewed fixes for card-network quirks (OVERRIDES).
- Drops names that are one ordinary English word ("Express", "Market")
  unless reviewed in KEEP_WORDS. The app only matches a bundled brand to a
  whole place name, but a plain word is still too likely to be some other
  local business.
- Drops anything data/merchants.json or data/cards.json already covers, so the
  curated lists always win (the app searches them first anyway).

Output: ios/Packages/BestCardEngine/Sources/CardPickerCore/Resources/brands.json
It never writes to data/.
"""
import json
import os
import re
import sys

NSI_VERSION = "8.0.20261101"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "..", "Packages", "BestCardEngine", "Sources", "CardPickerCore", "Resources", "brands.json")

# Higher number wins when a name shows up in several groups.
PRIORITY = {
    # Supermarkets beat drugstores: chains like Giant or Times run pharmacies
    # under the same name, and the pharmacy counter codes as grocery anyway.
    "us_supermarket": 9, "drugstore": 8, "restaurant": 7, "gas_ev": 6,
    "wholesale_club": 5, "hotel_direct": 4, "rental_car": 3,
    "rideshare_transit": 2, "general": 1,
}

CATEGORY_BY_GROUP = {
    "amenity/fast_food": "restaurant", "amenity/restaurant": "restaurant",
    "amenity/cafe": "restaurant", "amenity/ice_cream": "restaurant",
    "amenity/food_court": "restaurant", "amenity/bar": "restaurant",
    "amenity/pub": "restaurant", "shop/bakery": "restaurant",
    "shop/coffee": "restaurant", "shop/pastry": "restaurant",
    "shop/supermarket": "us_supermarket",
    "amenity/fuel": "gas_ev", "amenity/charging_station": "gas_ev",
    "man_made/charge_point": "gas_ev",
    "amenity/pharmacy": "drugstore", "shop/chemist": "drugstore",
    "shop/wholesale": "wholesale_club",
    "tourism/hotel": "hotel_direct", "tourism/motel": "hotel_direct",
    "tourism/hostel": "hotel_direct",
    "amenity/car_rental": "rental_car",
    "amenity/parking": "rideshare_transit",
    # Paid places that earn the base rate. Listing them still helps: it stops
    # a MapKit guess (say "food market" for a dollar store) from being used.
    "amenity/cinema": "general", "amenity/car_wash": "general",
    "amenity/post_office": "general", "amenity/theatre": "general",
    "leisure/fitness_centre": "general", "leisure/sports_centre": "general",
    "leisure/bowling_alley": "general", "leisure/amusement_arcade": "general",
    "tourism/theme_park": "general",
}
# Every other shop/* group is "general", except these.
SKIP_SHOP = {"shop/car", "shop/money_lender", "shop/truck", "shop/motorcycle", "shop/boat"}

# Reviewed fixes, keyed by normalized name.
OVERRIDES = {
    # Discount and variety stores: not supermarkets for any card's bonus.
    "dollar general": "general", "family dollar": "general", "dollar tree": "general",
    "five below": "general", "big lots": "general", "kmart": "general",
    "ollies bargain outlet": "general",
    # Convenience chains that are mostly gas stations in the US.
    "7 eleven": "gas_ev", "circle k": "gas_ev", "quiktrip": "gas_ev",
    "racetrac": "gas_ev", "caseys": "gas_ev", "kum go": "gas_ev",
    "loves": "gas_ev", "pilot": "gas_ev", "flying j": "gas_ev",
    "maverik": "gas_ev", "kwik trip": "gas_ev", "buc ees": "gas_ev",
    "stewarts shops": "gas_ev", "cumberland farms": "gas_ev",
    "holiday stationstores": "gas_ev", "thorntons": "gas_ev",
    "murphy usa": "gas_ev", "murphy express": "gas_ev",
    # Warehouse clubs.
    "costco": "wholesale_club",
    # Walmart and Target never count as supermarkets, under any store name.
    "super target": "general", "dollar general market": "general",
    # Stores with an in-store cafe that NSI also lists as a restaurant.
    "ikea": "general",
    # Supermarket chains whose pharmacy item shares the name.
    "times supermarkets": "us_supermarket",
}
# Any name containing these is "general" (MCC 5310/5311, not grocery).
ALWAYS_GENERAL_WORDS = ("walmart", "target")
# Single dictionary words that are safe enough (distinct chains).
KEEP_WORDS = {
    "giant", "safeway", "target", "shell", "arco", "mobil", "chevron",
    "marathon", "sunoco", "speedway", "albertsons", "hannaford", "meijer",
    "wendys", "arbys", "hardees", "applebees", "chilis", "dennys",
    "sheetz", "wawa", "starbucks", "subway", "popeyes", "culvers",
    "hyatt", "hilton", "marriott", "sheraton", "westin", "hertz",
    "avis", "budget", "enterprise", "alamo", "walgreens",
}
# Never include these as brands (too generic or not a place you pay).
DROP = {"express", "market", "pizza", "food", "fuel", "gas", "hotel", "inn",
        "motel", "cafe", "coffee", "grill", "kitchen", "deli", "bar", "pub",
        "pharmacy", "drug", "store", "shop", "outlet", "mart", "station",
        # Car makers listed as charging networks: a dealership named
        # "Mercedes-Benz of ..." must not count as gas.
        "mercedes benz", "tesla", "porsche", "metro", "astro"}

FUEL_WORDS = {"gas", "fuel", "petrol", "gasoline", "station", "charging"}
US_REGIONS = {"us", "001", "019", "021"}


def normalize(s: str) -> str:
    """Exactly Engine.normalize (ENGINE_SPEC.md): lowercase, drop ' and U+2019,
    collapse runs of non [a-z0-9] into one space, trim. No accent folding, so
    'Café Rio' becomes 'caf rio' here and in the engine alike."""
    s = s.lower().replace("'", "").replace("’", "")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def clean_display(name: str) -> str:
    """'Target (USA)' -> 'Target', 'Food City (Arizona)' stays (it tells two
    chains apart)."""
    return re.sub(r"\s*\((USA|US|United States)\)$", "", name).strip()


def covers_us(location_set: dict) -> bool:
    inc = [str(x).lower() for x in location_set.get("include", [])]
    exc = [str(x).lower() for x in location_set.get("exclude", [])]
    if "us" in exc:
        return False
    return any(x in US_REGIONS or x.startswith("us-") for x in inc)


def group_category(group: str):
    if group in CATEGORY_BY_GROUP:
        return CATEGORY_BY_GROUP[group]
    if group.startswith("shop/") and group not in SKIP_SHOP:
        return "general"
    return None


def load_words():
    try:
        with open("/usr/share/dict/words") as f:
            return {w.strip().lower() for w in f if w.strip()}
    except OSError:
        sys.exit("needs /usr/share/dict/words (present on macOS)")


def curated_brands():
    names = []
    for path, key in (("data/merchants.json", "merchants"), ("data/cards.json", "merchants")):
        with open(os.path.join(ROOT, path)) as f:
            for m in json.load(f).get(key) or []:
                if "." not in m["match"]:
                    names.append(normalize(m["match"]))
    return names


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    nsi = json.load(open(sys.argv[1]))["nsi"]
    words = load_words()
    curated = curated_brands()

    best = {}  # normalized name -> (category, display name, set of categories seen)
    # NSI matchNames, resolved after every brand's own name is known: an alias
    # takes its brand's main category, so "Tops Friendly Markets" (listed only
    # under the Tops gas station) stays a supermarket. Aliases that name fuel
    # ("Kroger Gas") stay gas.
    aliases = []
    for key, value in nsi.items():
        if not key.startswith("brands/"):
            continue
        group = key[len("brands/"):]
        base = group_category(group)
        if base is None:
            continue
        for item in value.get("items", []):
            if not covers_us(item.get("locationSet", {})):
                continue
            tags = item.get("tags", {})
            display = item.get("displayName") or tags.get("brand") or tags.get("name")
            if not display:
                continue
            names = {display, tags.get("brand", ""), tags.get("name", "")}
            owner = normalize(tags.get("brand") or display)
            if owner in DROP:  # every name variant of a dropped brand
                continue
            for alias in item.get("matchNames", []):
                aliases.append((normalize(alias), owner, base, display))
            for raw in names:
                n = normalize(raw or "")
                if len(n) < 3 or n.isdigit() or n in DROP:
                    continue
                cat = OVERRIDES.get(n, base)
                prev = best.get(n)
                if prev is None:
                    best[n] = (cat, display, {cat})
                else:
                    seen = prev[2] | {cat}
                    keep_cat = cat if PRIORITY[cat] > PRIORITY[prev[0]] else prev[0]
                    # Show the item's own name when it is this key ("Dollar
                    # General", not the alias owner "DGX").
                    own = normalize(display) == n and normalize(prev[1]) != n
                    keep_name = display if own or (keep_cat == cat and normalize(prev[1]) != n) else prev[1]
                    best[n] = (keep_cat, keep_name, seen)

    for n, owner, base, display in aliases:
        if len(n) < 3 or n.isdigit() or n in DROP or n in best:
            continue
        if any(w in FUEL_WORDS for w in n.split()):
            cat = "gas_ev"
            if owner in best and best[owner][0] != "gas_ev":
                display = clean_display(best[owner][1]) + " gas"  # "Kroger gas"
        elif owner in best:
            cat = best[owner][0]
            display = best[owner][1]
        else:
            cat = base
        cat = OVERRIDES.get(n, cat)
        best[n] = (cat, display, {cat})

    out, dropped_word, dropped_curated = [], 0, 0
    for n, (cat, display, seen) in sorted(best.items()):
        cat = OVERRIDES.get(n, cat)
        if any(w in n.split() for w in ALWAYS_GENERAL_WORDS):
            cat = "general"
        if " " not in n and n in words and n not in KEEP_WORDS:
            dropped_word += 1
            continue
        if any(n == c or n.startswith(c + " ") for c in curated) and cat != "gas_ev":
            dropped_curated += 1
            continue
        if n in curated:
            dropped_curated += 1
            continue
        entry = {"match": n, "name": clean_display(display), "category": cat}
        if len(seen - {"general"}) > 1:
            entry["verify"] = True
            entry["note"] = "This brand runs several kinds of store; the category shown is the most common one."
        out.append(entry)

    counts = {}
    for e in out:
        counts[e["category"]] = counts.get(e["category"], 0) + 1
    doc = {
        "version": 1,
        "updated": "2026-11-19",
        "source": f"name-suggestion-index {NSI_VERSION} (BSD-3-Clause, see brands-LICENSE.md); US brands mapped to card categories by ios/scripts/build-brands.py",
        "merchants": out,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print(f"{len(out)} brands -> {os.path.relpath(OUT, ROOT)}")
    print("by category:", dict(sorted(counts.items(), key=lambda kv: -kv[1])))
    print(f"dropped: {dropped_word} single dictionary words, {dropped_curated} already curated")


if __name__ == "__main__":
    main()
