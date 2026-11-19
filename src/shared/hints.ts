// Category guesses from page hints: schema.org types, og:site_name and title words.
import type { Category } from '../engine';

export interface PageHints {
  schemaTypes: string[];
  siteName: string | null;
  title: string | null;
}

const SCHEMA_MAP: [RegExp, Category][] = [
  [/^(Restaurant|FoodEstablishment|CafeOrCoffeeShop|FastFoodRestaurant|Bakery|BarOrPub|Brewery|Winery|IceCreamShop)$/i, 'restaurant'],
  [/^(GroceryStore)$/i, 'us_supermarket'],
  [/^(GasStation)$/i, 'gas_ev'],
  [/^(Pharmacy|Drugstore)$/i, 'drugstore'],
  [/^(Hotel|LodgingBusiness|Motel|Resort|Hostel|BedAndBreakfast)$/i, 'hotel_direct'],
  [/^(VacationRental)$/i, 'vacation_rental'],
  [/^(Airline)$/i, 'airline_direct'],
  [/^(AutoRental)$/i, 'rental_car'],
  [/^(TaxiService|BusStation|TrainStation|ParkingFacility)$/i, 'rideshare_transit'],
];

const WORDS: [RegExp, Category][] = [
  [/\b(restaurant|pizzeria|pizza|grill|bistro|sushi|taqueria|tacos?|burgers?|diner|cafe|café|bbq|kitchen|ramen|noodle|steakhouse|food delivery|order online)\b/i, 'restaurant'],
  [/\b(pharmacy|drugstore)\b/i, 'drugstore'],
  [/\b(hotel|resort|inn|suites)\b/i, 'hotel_direct'],
  [/\b(airlines?|airways)\b/i, 'airline_direct'],
  [/\b(car rental|rent a car)\b/i, 'rental_car'],
  [/\b(streaming|subscribe to watch)\b/i, 'streaming'],
  [/\b(grocery delivery)\b/i, 'online_grocery'],
];

/** A category guess, or null when the hints say nothing useful. */
export function categoryFromHints(h: PageHints): Category | null {
  for (const t of h.schemaTypes) {
    for (const [re, cat] of SCHEMA_MAP) if (re.test(t)) return cat;
  }
  const text = [h.siteName, h.title].filter(Boolean).join(' ');
  for (const [re, cat] of WORDS) if (re.test(text)) return cat;
  return null;
}
