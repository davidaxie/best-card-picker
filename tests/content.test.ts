// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPage, scanCheckout } from '../src/content/detect';

const fixture = (name: string) => readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

function load(name: string): Document {
  return new DOMParser().parseFromString(fixture(name), 'text/html');
}

const URLS: Record<string, string> = {
  'amazon-checkout.html': 'https://www.amazon.com/checkout/p/p-106-0000000/pay',
  'amazon-product.html': 'https://www.amazon.com/dp/B000TEST01',
  'doordash-checkout.html': 'https://www.doordash.com/consumer/checkout/',
  'united-checkout.html': 'https://www.united.com/en/us/checkout/payment',
  'instacart-checkout.html': 'https://www.instacart.com/store/checkout_v4',
  'airbnb-checkout.html': 'https://www.airbnb.com/book/stays/12345678?numberOfAdults=2',
  'gbp-shop-checkout.html': 'https://www.example-shop.co.uk/checkout',
  'unknown-shop.html': 'https://www.tiny-candle-shop.com/products/lavender',
  'pizzeria-checkout.html': 'https://www.marios-pizzeria-test.com/order/checkout',
};

describe('checkout detection on fixtures', () => {
  for (const [name, url] of Object.entries(URLS)) {
    const expectCheckout = !['amazon-product.html', 'unknown-shop.html'].includes(name);
    it(`${name} is ${expectCheckout ? '' : 'not '}a checkout`, () => {
      const scan = scanCheckout(load(name), url);
      expect(scan.isCheckout, JSON.stringify(scan)).toBe(expectCheckout);
    });
  }
  it('counts the expected signals', () => {
    const dd = scanCheckout(load('doordash-checkout.html'), URLS['doordash-checkout.html']!);
    expect(dd.signals).toMatchObject({ path: true, paymentIframes: 1, payButtons: 1 });
    const ua = scanCheckout(load('united-checkout.html'), URLS['united-checkout.html']!);
    expect(ua.signals.ccFields).toBe(4);
    const bnb = scanCheckout(load('airbnb-checkout.html'), URLS['airbnb-checkout.html']!);
    expect(bnb.signals.path).toBe(false);
    expect(bnb.score).toBeGreaterThanOrEqual(4);
  });
});

describe('page hints', () => {
  it('reads schema.org types, site name, lang and prices', () => {
    const p = collectPage(load('pizzeria-checkout.html'), URLS['pizzeria-checkout.html']!);
    expect(p.hints?.schemaTypes).toContain('Restaurant');
    const gbp = collectPage(load('gbp-shop-checkout.html'), URLS['gbp-shop-checkout.html']!);
    expect(gbp.lang).toBe('en-GB');
    expect(gbp.priceText).toContain('£68.99');
    expect(collectPage(load('doordash-checkout.html'), URLS['doordash-checkout.html']!).hints?.siteName).toBe('DoorDash');
  });
});

describe('privacy: the content script never reads input values', () => {
  const restore: (() => void)[] = [];
  afterEach(() => restore.splice(0).forEach((f) => f()));

  function spyValue(proto: object, name: string, reads: string[]): void {
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')!;
    Object.defineProperty(proto, 'value', {
      configurable: true,
      get() {
        reads.push(name);
        return desc.get!.call(this);
      },
      set(v) {
        desc.set!.call(this, v);
      },
    });
    restore.push(() => Object.defineProperty(proto, 'value', desc));
  }

  it('scanCheckout and collectPage do not touch .value on a filled fake card field', () => {
    const typed = `TYPED-${'0'.repeat(12)}-SECRET`; // not a card number
    document.documentElement.innerHTML = fixture('united-checkout.html');
    for (const id of ['ccname', 'ccnumber', 'ccexp', 'cccsc']) (document.getElementById(id) as HTMLInputElement).value = typed;
    const ta = document.createElement('textarea');
    ta.value = typed;
    document.body.append(ta);

    const reads: string[] = [];
    spyValue(HTMLInputElement.prototype, 'input', reads);
    spyValue(HTMLTextAreaElement.prototype, 'textarea', reads);
    spyValue(HTMLSelectElement.prototype, 'select', reads);

    const scan = scanCheckout(document, URLS['united-checkout.html']!);
    const page = collectPage(document, URLS['united-checkout.html']!);
    expect(scan.isCheckout).toBe(true);
    expect(reads).toEqual([]);
    expect(JSON.stringify({ scan, page })).not.toContain('SECRET');
  });

  it('the content script source has no value, FormData or input-event reads', () => {
    for (const f of ['detect.ts', 'main.ts', 'highlight.ts', 'saved-cards.ts']) {
      const src = readFileSync(resolve(__dirname, '../src/content', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/\.value\b|FormData|addEventListener\(['"](input|change|keydown|keyup|keypress)['"]|selectionStart|contentDocument|contentWindow/);
    }
  });
});

describe('real-world checkout URLs', () => {
  it('path signal covers common checkout paths but not product pages alone', async () => {
    const { scanCheckout: scan } = await import('../src/content/detect');
    const empty = new DOMParser().parseFromString('<html><body><button>Place your order</button></body></html>', 'text/html');
    expect(scan(empty, 'https://www.amazon.com/gp/buy/spc/handlers/display.html?hasWorkingJavascript=1').isCheckout).toBe(true);
    expect(scan(empty, 'https://www.example.com/checkout/').isCheckout).toBe(true);
    const product = new DOMParser().parseFromString('<html><body><button>Add to bag</button></body></html>', 'text/html');
    expect(scan(product, 'https://www.apple.com/shop/buy-iphone/iphone-17').isCheckout).toBe(false);
  });
});
