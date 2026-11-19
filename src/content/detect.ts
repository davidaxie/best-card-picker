// Checkout detection and page hints. Privacy rule: this file only checks that elements exist and
// reads attributes, page text and structured data. It never reads what is typed into inputs
// (no .value, no FormData, no input events) and never looks inside payment iframes.
import type { PageInfo } from '../shared/decide';
import type { PageHints } from '../shared/hints';

export interface CheckoutSignals {
  path: boolean;
  ccFields: number;
  paymentIframes: number;
  payButtons: number;
}

export interface CheckoutScan {
  score: number;
  isCheckout: boolean;
  signals: CheckoutSignals;
}

export const CHECKOUT_THRESHOLD = 4;

const PATH_RE = /(^|[/_.\-=?&#])(checkout|cart|basket|payment|payments|pay|billing|order|place-order|placeorder|purchase|buy|spc)([/_.\-=?&#]|$)/i;

const CC_SELECTOR = [
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
  'cc-name',
  'cc-type',
]
  .map((t) => `[autocomplete~="${t}"]`)
  .join(',');

const PAYMENT_FRAME_HOSTS = /(^|\.)(stripe\.com|stripe\.network|braintreegateway\.com|braintree-api\.com|adyen\.com|adyenpayments\.com|paypal\.com|paypalobjects\.com)$/i;

const PAY_BUTTON_RE =
  /^(place (your )?order|place order and pay|pay now|pay( securely)?( now)?( \S+)?|complete (your )?(purchase|order|booking|payment)|submit (order|payment)|confirm (and|&) pay|confirm (booking|purchase|order|payment)|request to book|continue to payment|buy and pay)$/i;

function frameHost(src: string): string | null {
  try {
    return new URL(src, 'https://invalid.example/').hostname;
  } catch {
    return null;
  }
}

/** Payment iframes and card fields, used by the pill to stay clear of them. */
export function paymentElements(doc: Document): Element[] {
  const out: Element[] = Array.from(doc.querySelectorAll(CC_SELECTOR));
  for (const f of Array.from(doc.querySelectorAll('iframe'))) {
    const src = f.getAttribute('src') ?? '';
    const host = src ? frameHost(src) : null;
    const name = f.getAttribute('name') ?? '';
    if ((host && PAYMENT_FRAME_HOSTS.test(host)) || /^__privateStripeFrame|braintree|adyen/i.test(name)) out.push(f);
  }
  return out;
}

function buttonLabel(el: Element): string {
  // Button text and aria-label only. <input type=submit> is skipped on purpose: its label lives in .value.
  const aria = el.getAttribute('aria-label');
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return (text || aria || '').slice(0, 80);
}

export function scanCheckout(doc: Document, url: string): CheckoutScan {
  let pathPart = '';
  try {
    const u = new URL(url);
    pathPart = u.pathname + u.search + u.hash;
  } catch {
    pathPart = '';
  }
  const ccFields = doc.querySelectorAll(CC_SELECTOR).length;
  const paymentIframes = paymentElements(doc).filter((e) => e.tagName === 'IFRAME').length;
  let payButtons = 0;
  for (const b of Array.from(doc.querySelectorAll('button, [role="button"], a.button, a[class*="btn"]'))) {
    if (PAY_BUTTON_RE.test(buttonLabel(b))) payButtons++;
  }
  const signals: CheckoutSignals = { path: PATH_RE.test(pathPart), ccFields, paymentIframes, payButtons };
  const score = (signals.path ? 2 : 0) + (ccFields > 0 ? 3 : 0) + (paymentIframes > 0 ? 3 : 0) + (payButtons > 0 ? 2 : 0);
  return { score, isCheckout: score >= CHECKOUT_THRESHOLD, signals };
}

function schemaTypes(doc: Document): { types: string[]; currency: string | null } {
  const types = new Set<string>();
  let currency: string | null = null;
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    const o = node as Record<string, unknown>;
    const t = o['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x));
    if (!currency && typeof o.priceCurrency === 'string') currency = o.priceCurrency;
    for (const v of Object.values(o)) if (typeof v === 'object') visit(v, depth + 1);
  };
  for (const s of Array.from(doc.querySelectorAll('script[type="application/ld+json"]')).slice(0, 20)) {
    try {
      visit(JSON.parse(s.textContent ?? ''), 0);
    } catch {
      /* ignore bad JSON-LD */
    }
  }
  for (const el of Array.from(doc.querySelectorAll('[itemtype]')).slice(0, 50)) {
    const t = (el.getAttribute('itemtype') ?? '').split('/').pop();
    if (t) types.add(t);
  }
  return { types: [...types], currency };
}

const SKIP_TEXT_PARENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'SELECT', 'OPTION']);

/** Visible text that contains price-like tokens, capped at maxChars. */
export function priceText(doc: Document, maxChars = 20000): string {
  if (!doc.body) return '';
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  const parts: string[] = [];
  let total = 0;
  for (let n = walker.nextNode(); n && total < maxChars; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || SKIP_TEXT_PARENTS.has(parent.tagName)) continue;
    const t = (n.nodeValue ?? '').trim();
    if (!t || !/\d/.test(t) || !/[$£€¥₹]|[A-Z]{3}/.test(t)) continue;
    parts.push(t.slice(0, 200));
    total += t.length;
  }
  return parts.join(' \n ').slice(0, maxChars);
}

function meta(doc: Document, selector: string): string | null {
  return doc.querySelector(selector)?.getAttribute('content')?.trim() || null;
}

export function collectPage(doc: Document, url: string): PageInfo {
  const st = schemaTypes(doc);
  const hints: PageHints = {
    schemaTypes: st.types,
    siteName: meta(doc, 'meta[property="og:site_name"]'),
    title: doc.title || null,
  };
  const metaCurrency =
    meta(doc, 'meta[itemprop="priceCurrency"]') ??
    meta(doc, 'meta[property="og:price:currency"]') ??
    meta(doc, 'meta[property="product:price:currency"]') ??
    st.currency;
  return {
    url,
    title: doc.title || null,
    hints,
    lang: doc.documentElement.getAttribute('lang'),
    metaCurrency,
    priceText: priceText(doc),
  };
}
