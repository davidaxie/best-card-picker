import type { Merchant } from './types';

/** Lowercase, drop apostrophes, turn every other non [a-z0-9] char into a space, collapse spaces. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Turn "https://www.Amazon.com:443/path" into "www.amazon.com". Returns null when the input is not a host. */
export function toHost(input: string): string | null {
  let s = input.trim().toLowerCase();
  const scheme = s.indexOf('://');
  if (scheme >= 0) s = s.slice(scheme + 3);
  s = s.split(/[/?#]/)[0] ?? '';
  s = s.replace(/:\d+$/, '').replace(/\.$/, '');
  if (!s.includes('.') || /\s/.test(s)) return null;
  return s;
}

/**
 * Find the merchant entry for a domain or a place name.
 *
 * Domain input (contains a dot, no spaces): try the full host, then drop the leftmost label,
 * down to two labels. At each step, the first entry whose match equals that suffix wins,
 * searching the lists in the order given (cards.json merchants first, then merchants.json).
 *
 * Name input: entries whose match has no dot are brands. A brand hits when the normalized
 * name equals the normalized brand or starts with it followed by a space. The longest brand
 * wins; on equal length the earlier list and earlier entry wins.
 */
export function resolveMerchant(input: string | undefined, lists: Merchant[][]): Merchant | null {
  if (!input) return null;
  const host = toHost(input);
  if (host) {
    const labels = host.split('.');
    for (let i = 0; i <= labels.length - 2; i++) {
      const suffix = labels.slice(i).join('.');
      for (const list of lists) {
        for (const m of list) {
          if (m.match.includes('.') && m.match.toLowerCase() === suffix) return m;
        }
      }
    }
    return null;
  }
  const name = normalizeName(input);
  if (!name) return null;
  let best: Merchant | null = null;
  let bestLen = -1;
  for (const list of lists) {
    for (const m of list) {
      if (m.match.includes('.')) continue;
      const brand = normalizeName(m.match);
      if (!brand) continue;
      if ((name === brand || name.startsWith(brand + ' ')) && brand.length > bestLen) {
        best = m;
        bestLen = brand.length;
      }
    }
  }
  return best;
}
