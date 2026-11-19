// Registrable domain lookup from the bundled Public Suffix List (data/public_suffix.dat).
// Standard algorithm: longest matching rule wins, "!" exceptions beat wildcards, default rule is "*".

export interface Psl {
  rules: Set<string>;
  wildcards: Set<string>;
  exceptions: Set<string>;
}

export function parsePsl(text: string): Psl {
  const psl: Psl = { rules: new Set(), wildcards: new Set(), exceptions: new Set() };
  for (const raw of text.split('\n')) {
    const line = raw.trim().toLowerCase();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('!')) psl.exceptions.add(line.slice(1));
    else if (line.startsWith('*.')) psl.wildcards.add(line.slice(2));
    else psl.rules.add(line);
  }
  return psl;
}

/** Number of labels in the public suffix of host. */
function suffixLength(labels: string[], psl: Psl): number {
  let best = 1; // default rule "*"
  for (let i = 0; i < labels.length; i++) {
    const candidate = labels.slice(i).join('.');
    const n = labels.length - i;
    if (psl.exceptions.has(candidate)) return n - 1;
    if (psl.rules.has(candidate) && n > best) best = n;
    const parent = labels.slice(i + 1).join('.');
    if (i + 1 < labels.length && psl.wildcards.has(parent) && n > best) best = n;
  }
  return best;
}

/** shop.example.co.uk -> example.co.uk. Returns the host itself for IPs, localhost and bare suffixes. */
export function registrableDomain(host: string, psl: Psl): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (!h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':')) return h;
  const labels = h.split('.');
  const n = suffixLength(labels, psl);
  if (n >= labels.length) return h;
  return labels.slice(labels.length - n - 1).join('.');
}

/** The public suffix itself, e.g. "co.uk" for shop.example.co.uk. */
export function publicSuffix(host: string, psl: Psl): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  return labels.slice(labels.length - Math.min(suffixLength(labels, psl), labels.length)).join('.');
}
