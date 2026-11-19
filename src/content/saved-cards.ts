// Finds the site's saved-card list ("Visa ending in 1234", "•••• 1234", "x1234", "Amex ...1234").
// Privacy rule, same as detect.ts: this reads text nodes and aria-label attributes only. It never
// reads input .value, never reads form state, never dispatches events and never looks inside iframes
// (the tree walker stays in the top document, so payment iframes are out of reach).
import type { Network } from '../engine';

export interface SavedCard {
  last4: string;
  /** Network named next to the digits, if exactly one is named. */
  network: Network | null;
  /** Element to outline: the row, label or list item holding the digits. */
  element: Element;
}

export interface CardTarget {
  cardId: string;
  name: string;
  last4: string;
  network: Network;
  color: string;
}

export interface SavedTargets {
  best: CardTarget | null;
  runnerUp: CardTarget | null;
}

export type SavedStatus = 'best' | 'runnerUp' | 'none' | 'noList';

export interface SavedMatch {
  status: SavedStatus;
  target: CardTarget | null;
  element: Element | null;
  /** How many saved cards were found on the page. */
  found: number;
}

// "ending in 1234", "ends with 1234", "•••• 1234", "**** 1234", "xxxx1234", "...1234", "…1234", "x1234", "x-1234".
const LAST4_RE = /(?:\b(?:ending|ends)\s+(?:in|with)\s*:?\s*|(?:[•·∙●◦*]{2,}|[xX]{2,}|\.{2,}|…)\s{0,3}|(?:^|[\s(])[xX]-?)(\d{4})(?!\d)/g;

const NETWORK_WORDS: [Network, RegExp][] = [
  ['amex', /\b(amex|american express)\b/i],
  ['visa', /\bvisa\b/i],
  ['mastercard', /\b(mastercard|master card)\b/i],
  ['discover', /\bdiscover\b/i],
];

const ROW_SELECTOR = 'label, li, tr, [role="radio"], [role="option"], [role="listitem"], [role="row"], [role="menuitemradio"]';
const SKIP_PARENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION']);
const OWN_HOSTS = 'bcp-pill-host, bcp-highlight-host';
const MAX_TEXT_NODES = 20000;

export function last4sIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LAST4_RE)) out.push(m[1]!);
  return out;
}

export function networkIn(text: string): Network | null {
  const named = NETWORK_WORDS.filter(([, re]) => re.test(text)).map(([n]) => n);
  return named.length === 1 ? named[0]! : null;
}

/** Text of an element with a space between text nodes, so <span>Amex</span><span>x0001</span> reads "Amex x0001". */
function spacedText(el: Element, max = 600): string {
  const parts: string[] = [];
  let len = 0;
  const walker = el.ownerDocument.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n && len < max; n = walker.nextNode()) {
    const p = n.parentElement;
    if (p && SKIP_PARENTS.has(p.tagName)) continue;
    const t = n.nodeValue ?? '';
    parts.push(t);
    len += t.length;
  }
  return parts.join(' ');
}

function text(el: Element): string {
  return spacedText(el) + ' ' + (el.getAttribute('aria-label') ?? '');
}

/** The tightest row-like ancestor that holds only this one saved card. */
function rowFor(start: Element, last4: string): Element {
  const row = start.closest(ROW_SELECTOR);
  if (row && row !== document.body) {
    const digits = new Set(last4sIn(text(row)));
    if (digits.size === 1 && digits.has(last4)) return row;
  }
  return start;
}

export function findSavedCards(doc: Document): SavedCard[] {
  if (!doc.body) return [];
  const out: SavedCard[] = [];
  const seen = new Set<Element>();
  const add = (from: Element, source: string) => {
    for (const last4 of new Set(last4sIn(source))) {
      const element = rowFor(from, last4);
      if (seen.has(element) || element.closest(OWN_HOSTS)) continue;
      seen.add(element);
      out.push({ last4, network: networkIn(text(element)), element });
    }
  };

  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  let n = 0;
  for (let node = walker.nextNode(); node && n < MAX_TEXT_NODES; node = walker.nextNode(), n++) {
    const parent = node.parentElement;
    if (!parent || SKIP_PARENTS.has(parent.tagName)) continue;
    const t = node.nodeValue ?? '';
    if (!/\d{4}/.test(t)) continue;
    if (last4sIn(t).length) add(parent, t);
    else if (parent.parentElement) {
      // A mask and the digits are often split across sibling spans: try the enclosing element's text.
      const up = parent.parentElement;
      if ((up.textContent ?? '').length < 300) add(up, spacedText(up));
    }
  }
  for (const el of Array.from(doc.body.querySelectorAll('[aria-label]')).slice(0, 2000)) {
    const label = el.getAttribute('aria-label') ?? '';
    if (/\d{4}/.test(label)) add(el, label);
  }
  return out;
}

function matches(saved: SavedCard, t: CardTarget): boolean {
  return saved.last4 === t.last4 && (saved.network === null || saved.network === t.network);
}

/** Best card first, then the runner-up. A row naming a different network is never a match. */
export function matchSaved(found: SavedCard[], targets: SavedTargets): SavedMatch {
  if (!found.length) return { status: 'noList', target: null, element: null, found: 0 };
  for (const [status, t] of [['best', targets.best], ['runnerUp', targets.runnerUp]] as const) {
    if (!t) continue;
    const hit = found.find((s) => matches(s, t));
    if (hit) return { status, target: t, element: hit.element, found: found.length };
  }
  return { status: 'none', target: null, element: null, found: found.length };
}
