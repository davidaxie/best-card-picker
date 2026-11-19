// Foreign purchase signals: country TLD, prices in another currency, non-US html lang.

/** Two-letter TLDs that are commonly used as generic domains by US sites. */
const GENERIC_CCTLDS = new Set(['us', 'co', 'io', 'ai', 'tv', 'me', 'ly', 'fm', 'gg', 'to', 'sh', 'ws', 'cc', 'so', 'xyz', 'app', 'dev']);

/** The country implied by the domain, or null for generic and US domains. */
export function countryFromHost(host: string): string | null {
  const tld = host.toLowerCase().replace(/\.$/, '').split('.').pop() ?? '';
  if (tld.length !== 2 || GENERIC_CCTLDS.has(tld)) return null;
  return tld === 'uk' ? 'GB' : tld.toUpperCase();
}

/** True when an html lang value names a non-US region, or a language other than English or Spanish with no region. */
export function isForeignLang(lang: string | null | undefined): boolean {
  if (!lang) return false;
  const [language, region] = lang.trim().replace('_', '-').split('-');
  if (!language) return false;
  if (region && /^[a-z]{2}$/i.test(region)) return region.toUpperCase() !== 'US';
  return !['en', 'es'].includes(language.toLowerCase());
}

const SYMBOLS: [RegExp, string][] = [
  [/£\s?\d/g, 'GBP'],
  [/€\s?\d|\d\s?€/g, 'EUR'],
  [/¥\s?\d|\d\s?円/g, 'JPY'],
  [/₹\s?\d/g, 'INR'],
  [/\b(?:CA|C)\$\s?\d/g, 'CAD'],
  [/\b(?:AU|A)\$\s?\d/g, 'AUD'],
  [/\bMX\$\s?\d/g, 'MXN'],
  [/\b(GBP|EUR|JPY|CAD|AUD|CHF|INR|MXN|SEK|NOK|DKK|NZD|SGD|HKD)\s?\d|\d\s?(GBP|EUR|JPY|CAD|AUD|CHF|INR|MXN|SEK|NOK|DKK|NZD|SGD|HKD)\b/g, ''],
];
const USD = /(?:^|[^A-Z$])(?:US)?\$\s?\d|\bUSD\s?\d|\d\s?USD\b/g;

/**
 * Most common currency in a chunk of visible page text, or null when no prices are found.
 * Plain "$" counts as USD.
 */
export function currencyFromText(text: string): string | null {
  const counts = new Map<string, number>();
  const bump = (c: string, n: number) => n && counts.set(c, (counts.get(c) ?? 0) + n);
  for (const [re, code] of SYMBOLS) {
    for (const m of text.matchAll(re)) {
      const c = code || (m[1] ?? m[2] ?? '').toUpperCase();
      if (c) bump(c, 1);
    }
  }
  bump('USD', (text.match(USD) ?? []).length);
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN || (n === bestN && c === 'USD')) {
      best = c;
      bestN = n;
    }
  }
  return best;
}
