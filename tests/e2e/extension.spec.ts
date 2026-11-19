// End-to-end: loads dist-e2e/ (the built extension, with Auto mode permissions pre-granted because a
// headless run cannot click Chrome's permission prompt) in headless Chromium. Every page comes from
// tests/fixtures via request interception; any other request is aborted.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const DIST_E2E = join(ROOT, 'dist-e2e');
const DIST = join(ROOT, 'dist');
const FIX = join(ROOT, 'tests/fixtures');

const PAGES: Record<string, string> = {
  amazon: 'https://www.amazon.com/checkout/p/p-106-0000000/pay',
  amazonProduct: 'https://www.amazon.com/dp/B000TEST01',
  doordash: 'https://www.doordash.com/consumer/checkout/',
  united: 'https://www.united.com/en/us/checkout/payment',
  unitedCorner: 'https://www.united.com/en/us/checkout/review',
  instacart: 'https://www.instacart.com/store/checkout_v4',
  airbnb: 'https://www.airbnb.com/book/stays/12345678?numberOfAdults=2',
  gbp: 'https://www.example-shop.co.uk/checkout',
  unknown: 'https://www.tiny-candle-shop.com/products/lavender',
  pizzeria: 'https://www.marios-pizzeria-test.com/order/checkout',
  amazonSaved: 'https://www.amazon.com/checkout/p/p-106-0000001/pay',
  targetSaved: 'https://www.target.com/checkout',
  doordashSaved: 'https://www.doordash.com/consumer/checkout/payment/',
};
const FILES: Record<string, string> = {
  amazon: 'amazon-checkout.html',
  amazonProduct: 'amazon-product.html',
  doordash: 'doordash-checkout.html',
  united: 'united-checkout.html',
  unitedCorner: 'united-checkout-corner.html',
  instacart: 'instacart-checkout.html',
  airbnb: 'airbnb-checkout.html',
  gbp: 'gbp-shop-checkout.html',
  unknown: 'unknown-shop.html',
  pizzeria: 'pizzeria-checkout.html',
  amazonSaved: 'amazon-saved-cards.html',
  targetSaved: 'target-saved-cards.html',
  doordashSaved: 'doordash-saved-cards.html',
};
const strip = (u: string) => {
  const x = new URL(u);
  return x.origin + x.pathname;
};
const ROUTES = new Map(Object.entries(PAGES).map(([k, u]) => [strip(u), join(FIX, FILES[k]!)]));
const PAYMENT_FRAME = /^https:\/\/(js\.stripe\.com|assets\.braintreegateway\.com)\//;

interface Ext {
  ctx: BrowserContext;
  sw: Worker;
  id: string;
  /** Requests made by the service worker, popup or options page to anything outside the extension. */
  extensionNetwork: string[];
  /** Requests to hosts that are not fixtures (all aborted). */
  unexpected: string[];
}

async function launch(profile: string): Promise<Ext> {
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${DIST_E2E}`, `--load-extension=${DIST_E2E}`],
  });
  const extensionNetwork: string[] = [];
  const unexpected: string[] = [];
  ctx.on('request', (req) => {
    const url = req.url();
    if (url.startsWith('chrome-extension://')) return;
    let fromExtension = !!req.serviceWorker();
    try {
      fromExtension ||= req.frame().url().startsWith('chrome-extension://');
    } catch {
      /* service worker requests have no frame */
    }
    if (fromExtension) extensionNetwork.push(url);
  });
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('chrome-extension://')) return route.continue(); // the extension's own files
    const file = ROUTES.get(strip(url));
    if (file) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(file) });
    if (PAYMENT_FRAME.test(url)) return route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(FIX, 'payment-frame.html')) });
    unexpected.push(url);
    return route.abort();
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const id = new URL(sw.url()).host;
  return { ctx, sw, id, extensionNetwork, unexpected };
}

function newProfile(): string {
  return mkdtempSync(join(tmpdir(), 'bcp-e2e-'));
}

async function tabIdFor(ext: Ext, url: string): Promise<number> {
  return expect
    .poll(async () => ext.sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id ?? null, url))
    .not.toBeNull()
    .then(() => ext.sw.evaluate(async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)!.id!, url));
}

interface PillState {
  shown: boolean;
  count: number;
  corner: string | null;
  pill: { cardName: string; rateText: string; runnerUpName: string | null; detail: string; warnings: string[]; last4: string | null; savedNote?: string | null } | null;
  mode?: 'auto' | 'click';
  saved?: string | null;
  highlight?: { shown: boolean; label: string | null; count: number };
}

async function pillState(ext: Ext, tabId: number): Promise<PillState | null> {
  try {
    return await ext.sw.evaluate(
      (t) => (globalThis as unknown as { bcpTest: { pillState: (id: number) => Promise<unknown> } }).bcpTest.pillState(t),
      tabId,
    ) as PillState;
  } catch {
    return null; // content script not ready yet
  }
}

async function waitForPill(ext: Ext, tabId: number): Promise<PillState> {
  await expect.poll(async () => (await pillState(ext, tabId))?.shown ?? false, { timeout: 10_000 }).toBe(true);
  return (await pillState(ext, tabId))!;
}

async function enableAutoMode(ext: Ext): Promise<void> {
  const options = await ext.ctx.newPage();
  await options.goto(`chrome-extension://${ext.id}/options/index.html`);
  await options.locator('#autoMode').check();
  await expect(options.locator('#status')).toContainText('Auto mode on');
  await options.close();
}

async function openPopup(ext: Ext, tabId: number): Promise<Page> {
  const popup = await ext.ctx.newPage();
  await popup.goto(`chrome-extension://${ext.id}/popup/index.html?tab=${tabId}`);
  await expect(popup.locator('#best, .site').first()).toBeVisible();
  return popup;
}

async function storage(ext: Ext, key: string): Promise<unknown> {
  return ext.sw.evaluate(async (k) => (await chrome.storage.local.get(k))[k], key);
}

function assertNoExtensionNetwork(ext: Ext): void {
  expect(ext.extensionNetwork, 'requests from the service worker, popup or options page').toEqual([]);
  expect(ext.unexpected, 'requests to non-fixture hosts').toEqual([]);
}

// ---------------------------------------------------------------------------

test('built extension: permissions, CSP and no network APIs in dist/', () => {
  const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(['storage', 'activeTab']);
  expect(manifest.optional_host_permissions).toEqual(['<all_urls>']);
  expect(manifest.optional_permissions).toEqual(['scripting']);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'; connect-src 'none'");
  const files: string[] = [];
  const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
  walk(DIST);
  for (const f of files.filter((x) => /\.(js|html)$/.test(x))) {
    const src = readFileSync(f, 'utf8');
    expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|storage\.sync|importScripts/);
  }
});

test('click-to-check: unknown site asks for a category and the answer survives a browser restart', async () => {
  const profile = newProfile();
  let ext = await launch(profile);
  const page = await ext.ctx.newPage();
  await page.goto(PAGES.unknown!);
  let tabId = await tabIdFor(ext, PAGES.unknown!);
  let popup = await openPopup(ext, tabId);
  await expect(popup.locator('#ask')).toContainText('What kind of store is this?');
  await expect(popup.locator('#best')).toContainText('Chase Freedom Unlimited'); // general until answered
  await popup.locator('#ask-category').selectOption('restaurant');
  await popup.locator('#ask-save').click();
  await expect(popup.locator('#ask')).toHaveCount(0);
  await expect(popup.locator('#best')).toContainText('Amex Gold');
  await expect(popup.locator('#category-source')).toContainText('your choice');
  expect(await storage(ext, 'siteCategories')).toEqual({ 'tiny-candle-shop.com': 'restaurant' });
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();

  ext = await launch(profile); // restart with the same profile
  const again = await ext.ctx.newPage();
  await again.goto(PAGES.unknown!);
  tabId = await tabIdFor(ext, PAGES.unknown!);
  popup = await openPopup(ext, tabId);
  await expect(popup.locator('#best')).toContainText('Amex Gold');
  await expect(popup.locator('#ask')).toHaveCount(0);
  await expect(popup.locator('#category-source')).toContainText('your choice');
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

test('click-to-check: popup shows best card, runner-up, badge and no pill without Auto mode', async () => {
  const ext = await launch(newProfile());
  const page = await ext.ctx.newPage();
  await page.goto(PAGES.doordash!);
  const tabId = await tabIdFor(ext, PAGES.doordash!);
  const popup = await openPopup(ext, tabId);
  await expect(popup.locator('#best')).toContainText('Amex Gold · 4x');
  await expect(popup.locator('#reason')).toHaveText('4x at restaurants, about 8 cents per dollar');
  await expect(popup.locator('#runner-up')).toContainText('Chase Sapphire Preferred');
  await expect(popup.locator('#category')).toHaveValue('restaurant');
  expect(await ext.sw.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), tabId)).toBe('GOLD');
  expect(await pillState(ext, tabId)).toBeNull(); // no content script registered
  expect(await page.locator('bcp-pill-host').count()).toBe(0);
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

test('auto mode: the pill shows the expected card on the five PRD checkout pages', async () => {
  const ext = await launch(newProfile());
  await enableAutoMode(ext);
  const expected: [string, string, string][] = [
    ['amazon', 'Amex Blue Cash Everyday', 'Use Amex Blue Cash Everyday · 3% · runner-up Chase Freedom Unlimited'],
    ['doordash', 'Amex Gold', 'Use Amex Gold · 4x · runner-up Chase Sapphire Preferred'],
    ['united', 'United Explorer', 'Use United Explorer · 3x · runner-up Amex Gold'],
    ['instacart', 'Chase Sapphire Preferred', 'Use Chase Sapphire Preferred · 3x · runner-up Chase Freedom Unlimited'],
    ['airbnb', 'Chase Sapphire Preferred', 'Use Chase Sapphire Preferred · 3x · runner-up Chase Freedom Unlimited'],
  ];
  for (const [key, cardName, line] of expected) {
    const page = await ext.ctx.newPage();
    await page.goto(PAGES[key]!);
    const tabId = await tabIdFor(ext, PAGES[key]!);
    const s = await waitForPill(ext, tabId);
    expect(s.pill?.cardName, key).toBe(cardName);
    expect(`Use ${s.pill!.cardName} · ${s.pill!.rateText} · runner-up ${s.pill!.runnerUpName}`).toBe(line);
    expect(s.count, `${key}: at most one pill`).toBe(1);
    expect(await page.locator('bcp-pill-host').count()).toBe(1);
    await page.close();
  }
  // Not a checkout page: badge but no pill.
  const product = await ext.ctx.newPage();
  await product.goto(PAGES.amazonProduct!);
  const productTab = await tabIdFor(ext, PAGES.amazonProduct!);
  await expect.poll(async () => ext.sw.evaluate((t) => chrome.action.getBadgeText({ tabId: t }), productTab)).toBe('BCE');
  expect((await pillState(ext, productTab))?.shown).toBe(false);
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

test('auto mode: a GBP site warns about foreign fees and never recommends FU or BCE', async () => {
  const ext = await launch(newProfile());
  await enableAutoMode(ext);
  const page = await ext.ctx.newPage();
  await page.goto(PAGES.gbp!);
  const tabId = await tabIdFor(ext, PAGES.gbp!);
  const s = await waitForPill(ext, tabId);
  expect(['Chase Freedom Unlimited', 'Amex Blue Cash Everyday']).not.toContain(s.pill!.cardName);
  expect(s.pill!.warnings.join(' ')).toMatch(/Foreign purchase: avoid Chase Freedom Unlimited \(3% fee\), Amex Blue Cash Everyday \(2\.7% fee\)/);
  const popup = await openPopup(ext, tabId);
  await expect(popup.locator('[data-code="foreign_fees"]')).toBeVisible();
  await expect(popup.locator('#foreign')).toBeChecked();
  await expect(popup.locator('.tag', { hasText: 'Detected:' })).toContainText('prices in GBP');
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

test('privacy: typed text in a fake card field never reaches the extension', async () => {
  const ext = await launch(newProfile());
  await enableAutoMode(ext);
  const page = await ext.ctx.newPage();
  await page.goto(PAGES.united!);
  const tabId = await tabIdFor(ext, PAGES.united!);
  await waitForPill(ext, tabId);
  const typed = 'TYPED-SECRET-not-a-card';
  for (const sel of ['#ccname', '#ccnumber', '#ccexp', '#cccsc']) await page.locator(sel).fill(typed);
  // Make the content script scan again with the fields filled, then inspect what it sent.
  await ext.sw.evaluate((t) => chrome.tabs.sendMessage(t, { type: 'rescan' }), tabId);
  const sent = await ext.sw.evaluate(async (t) => {
    const messages: unknown[] = [];
    // Everything the service worker knows about this tab, plus everything in storage.
    messages.push(await chrome.storage.local.get(null));
    messages.push(await (globalThis as unknown as { bcpTest: { pillState: (id: number) => Promise<unknown> } }).bcpTest.pillState(t));
    return JSON.stringify(messages);
  }, tabId);
  expect(sent).not.toContain('TYPED-SECRET');
  const lastPage = await ext.sw.evaluate(() => JSON.stringify((globalThis as unknown as { bcpTest: { lastPages: () => unknown } }).bcpTest.lastPages()));
  expect(lastPage).toContain('united.com');
  expect(lastPage).not.toContain('TYPED-SECRET');
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

test('pill: stays off payment fields, "Not now" hides it, "Never on this site" sticks, pause turns it off', async () => {
  const ext = await launch(newProfile());
  await enableAutoMode(ext);
  const page = await ext.ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(PAGES.unitedCorner!);
  const tabId = await tabIdFor(ext, PAGES.unitedCorner!);
  const s = await waitForPill(ext, tabId);
  expect(s.corner).not.toBe('br'); // the card form sits in the bottom-right corner
  const pillBox = (await page.locator('bcp-pill-host').boundingBox())!;
  const formBox = (await page.locator('form').boundingBox())!;
  const overlaps =
    pillBox.x < formBox.x + formBox.width && formBox.x < pillBox.x + pillBox.width &&
    pillBox.y < formBox.y + formBox.height && formBox.y < pillBox.y + pillBox.height;
  expect(overlaps).toBe(false);

  // "Not now": first button in the pill's bottom row.
  await page.mouse.click(pillBox.x + 40, pillBox.y + pillBox.height - 22);
  await expect(page.locator('bcp-pill-host')).toHaveCount(0);

  // "Not now" holds for this page in this tab, even across a reload.
  await page.reload();
  await page.waitForTimeout(1500);
  expect((await pillState(ext, tabId))?.shown).toBe(false);
  expect(await storage(ext, 'neverSites')).toBeUndefined();

  // Another checkout page on the same site shows it again; "Never on this site" is the second button.
  await page.goto(PAGES.united!);
  await waitForPill(ext, tabId);
  const box2 = (await page.locator('bcp-pill-host').boundingBox())!;
  await page.mouse.click(box2.x + 150, box2.y + box2.height - 22);
  await expect(page.locator('bcp-pill-host')).toHaveCount(0);
  await expect.poll(() => storage(ext, 'neverSites')).toEqual(['united.com']);
  await page.goto(PAGES.unitedCorner!);
  await page.waitForTimeout(1500);
  expect((await pillState(ext, tabId))?.shown).toBe(false);

  // Pause: no pill anywhere.
  const options = await ext.ctx.newPage();
  await options.goto(`chrome-extension://${ext.id}/options/index.html`);
  await options.locator('#paused').check();
  await expect(options.locator('#status')).toContainText('Paused');
  const dd = await ext.ctx.newPage();
  await dd.goto(PAGES.doordash!);
  await page.waitForTimeout(1500);
  expect(await dd.locator('bcp-pill-host').count()).toBe(0);
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

test('options: editing a rate changes the next recommendation without a reload; caps toggle', async () => {
  const ext = await launch(newProfile());
  const page = await ext.ctx.newPage();
  await page.goto(PAGES.doordash!);
  const tabId = await tabIdFor(ext, PAGES.doordash!);
  let popup = await openPopup(ext, tabId);
  await expect(popup.locator('#best')).toContainText('Amex Gold');
  await popup.close();

  const options = await ext.ctx.newPage();
  await options.goto(`chrome-extension://${ext.id}/options/index.html`);
  await options.locator('[data-testid="rate-amex-gold-restaurant"]').fill('1');
  await options.locator('#save').click();
  await expect(options.locator('#status')).toContainText('Saved');

  popup = await openPopup(ext, tabId); // same tab, page not reloaded
  await expect(popup.locator('#best')).toContainText('Chase Sapphire Preferred');
  await popup.close();

  // Cap toggle from the popup on Amazon: BCE -> FU.
  const amazon = await ext.ctx.newPage();
  await amazon.goto(PAGES.amazon!);
  const amazonTab = await tabIdFor(ext, PAGES.amazon!);
  popup = await openPopup(ext, amazonTab);
  await expect(popup.locator('#best')).toContainText('Amex Blue Cash Everyday');
  await popup.locator('#caps input[data-card="amex-blue-cash-everyday"]').check();
  await expect(popup.locator('#best')).toContainText('Chase Freedom Unlimited');
  expect(await storage(ext, 'capState')).toEqual({ 'amex-blue-cash-everyday': { us_online_retail: { reached: true } } });

  // Bad edits are refused with a readable error.
  await options.reload();
  await options.locator('[data-testid="base-amex-gold"]').fill('-5');
  await options.locator('#save').click();
  await expect(options.locator('#errors li').first()).toContainText('baseRate');
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

test('options: exporting and re-importing cards.json changes nothing; reset restores defaults', async () => {
  const ext = await launch(newProfile());
  const options = await ext.ctx.newPage();
  await options.goto(`chrome-extension://${ext.id}/options/index.html`);
  // Make a non-default edit first so the round trip is meaningful.
  await options.locator('[data-testid="pv-united_miles"]').fill('1.35');
  await options.locator('#save').click();
  await expect(options.locator('#status')).toContainText('Saved');
  const before = await storage(ext, 'cardsFile');

  const [download] = await Promise.all([options.waitForEvent('download'), options.locator('#export').click()]);
  expect(download.suggestedFilename()).toBe('cards.json');
  const path = await download.path();
  const exported = readFileSync(path, 'utf8');
  expect(JSON.parse(exported)).toEqual(before);

  await options.locator('#import').setInputFiles(path);
  await expect(options.locator('#status')).toContainText('Imported 6 cards');
  expect(await storage(ext, 'cardsFile')).toEqual(before);

  // A file that fails validation changes nothing.
  await options.locator('#import').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"version":1,"cards":[]}') });
  await expect(options.locator('#status')).toContainText('Import failed');
  expect(await storage(ext, 'cardsFile')).toEqual(before);

  options.on('dialog', (d) => void d.accept());
  await options.locator('#reset').click();
  await expect(options.locator('#status')).toContainText('reset');
  const reset = (await storage(ext, 'cardsFile')) as { pointValuesCents: Record<string, number> };
  expect(reset.pointValuesCents.united_miles).toBe(1.2);
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

test('page hints: a restaurant found only through schema.org gets Amex Gold and a confirm prompt', async () => {
  const ext = await launch(newProfile());
  await enableAutoMode(ext);
  const page = await ext.ctx.newPage();
  await page.goto(PAGES.pizzeria!);
  const tabId = await tabIdFor(ext, PAGES.pizzeria!);
  const s = await waitForPill(ext, tabId);
  expect(s.pill!.cardName).toBe('Amex Gold');
  expect(s.pill!.detail).toContain('Unknown store');
  const popup = await openPopup(ext, tabId);
  await expect(popup.locator('#ask')).toContainText('looks like restaurants');
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

// ---------------------------------------------------------------------------
// Saved-card highlight. Fake digits only: Gold 0001, CSP 0002, FU 0003, UA 0004, AA 0005, BCE 0006.

const FAKE_LAST4 = {
  'amex-gold': '0001',
  'chase-sapphire-preferred': '0002',
  'chase-freedom-unlimited': '0003',
  'united-explorer': '0004',
  'citi-aa-platinum': '0005',
  'amex-blue-cash-everyday': '0006',
};

async function setLast4(ext: Ext, map: Record<string, string>): Promise<void> {
  await ext.sw.evaluate(async (m) => chrome.storage.local.set({ last4: m }), map);
}

/** Inputs, radio state, aria state, focus and every input/change/click event the page saw. */
async function formSnapshot(page: Page): Promise<unknown> {
  return page.evaluate(() => ({
    checked: Array.from(document.querySelectorAll('input')).map((i) => `${i.id}:${i.checked}:${i.value}`),
    aria: Array.from(document.querySelectorAll('[aria-checked],[aria-selected]')).map(
      (e) => `${e.id}:${e.getAttribute('aria-checked')}:${e.getAttribute('aria-selected')}`,
    ),
    active: document.activeElement?.tagName ?? null,
    events: (window as unknown as { __events: string[] }).__events,
  }));
}

async function waitForHighlight(ext: Ext, tabId: number): Promise<PillState> {
  await expect.poll(async () => (await pillState(ext, tabId))?.highlight?.shown ?? false, { timeout: 10_000 }).toBe(true);
  return (await pillState(ext, tabId))!;
}

/** The overlay sits on the row: its box contains the row's box (plus a few pixels of padding). */
async function expectOutlined(page: Page, rowSelector: string): Promise<void> {
  const r = await page.evaluate((sel) => {
    const host = document.querySelector('bcp-highlight-host')!.getBoundingClientRect();
    const row = document.querySelector(sel)!.getBoundingClientRect();
    return { host: { l: host.left, t: host.top, r: host.right, b: host.bottom }, row: { l: row.left, t: row.top, r: row.right, b: row.bottom } };
  }, rowSelector);
  expect(r.host.l).toBeLessThanOrEqual(r.row.l);
  expect(r.host.t).toBeLessThanOrEqual(r.row.t);
  expect(r.host.r).toBeGreaterThanOrEqual(r.row.r);
  expect(r.host.b).toBeGreaterThanOrEqual(r.row.b);
  expect(r.host.r - r.host.l - (r.row.r - r.row.l)).toBeLessThan(12);
}

test('saved cards: Auto mode outlines the best saved card and never touches the form', async () => {
  const ext = await launch(newProfile());
  await enableAutoMode(ext);
  await setLast4(ext, FAKE_LAST4);

  const cases = [
    { key: 'amazonSaved', card: 'Amex Blue Cash Everyday', last4: '0006', label: 'Best card', row: '#row-amex', saved: 'best', note: 'Outlined on the page' },
    { key: 'doordashSaved', card: 'Amex Gold', last4: '0001', label: 'Best card', row: '#row-amex', saved: 'best', note: 'Outlined on the page' },
    {
      key: 'targetSaved',
      card: 'Amex Blue Cash Everyday',
      last4: '0006',
      label: 'Runner-up',
      row: '#row-visa',
      saved: 'runnerUp',
      note: "Your best card isn't saved here; Chase Freedom Unlimited ••0003 is",
    },
  ];
  for (const c of cases) {
    const page = await ext.ctx.newPage();
    await page.goto(PAGES[c.key]!);
    await page.waitForLoadState('load');
    const before = await formSnapshot(page);
    const tabId = await tabIdFor(ext, PAGES[c.key]!);
    const st = await waitForHighlight(ext, tabId);
    expect(st.highlight, c.key).toMatchObject({ shown: true, label: c.label, count: 1 });
    expect(st.saved, c.key).toBe(c.saved);
    await expect.poll(async () => (await pillState(ext, tabId))?.pill?.savedNote ?? '', { timeout: 5000 }).toContain(c.note);
    const pill = (await pillState(ext, tabId))!.pill!;
    expect(pill.cardName, c.key).toBe(c.card);
    expect(pill.last4, c.key).toBe(c.last4);
    await expectOutlined(page, c.row);
    const shots = process.env.BCP_SHOTS; // optional: save screenshots of the outline for a human to look at
    if (shots) await page.waitForTimeout(500).then(() => page.screenshot({ path: join(shots, `${c.key}.png`) }));
    // Scrolling moves the outline with the row.
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(150);
    await expectOutlined(page, c.row);

    const after = await formSnapshot(page);
    expect(after, `${c.key}: form state`).toEqual(before);
    expect((after as { events: string[] }).events, `${c.key}: events`).toEqual([]);

    const popup = await openPopup(ext, tabId);
    await expect(popup.locator('#best')).toContainText(`${c.card} ••${c.last4}`);
    await expect(popup.locator('#saved')).toBeVisible();
    if (c.saved === 'runnerUp') await expect(popup.locator('#saved')).toContainText("isn't saved on this site; Chase Freedom Unlimited ••0003");
    else await expect(popup.locator('#saved')).toContainText(`Outlined on the page: your saved ${c.card} ••${c.last4}`);
    await popup.close();
    expect(await formSnapshot(page), `${c.key}: form state after popup`).toEqual(before);
    await page.close();
  }

  // Without saved digits there is no outline and the pill has no last four.
  await setLast4(ext, {});
  const page = await ext.ctx.newPage();
  await page.goto(PAGES.amazonSaved!);
  const tabId = await tabIdFor(ext, PAGES.amazonSaved!);
  const st = await waitForPill(ext, tabId);
  expect(st.pill?.last4).toBeNull();
  expect(st.highlight?.shown).toBe(false);
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

test('saved cards: click mode outlines the card from the popup button, with no pill', async () => {
  const ext = await launch(newProfile());
  await setLast4(ext, FAKE_LAST4);
  const page = await ext.ctx.newPage();
  await page.goto(PAGES.doordashSaved!);
  await page.waitForLoadState('load');
  const before = await formSnapshot(page);
  const tabId = await tabIdFor(ext, PAGES.doordashSaved!);
  expect(await pillState(ext, tabId)).toBeNull(); // no content script yet

  const popup = await openPopup(ext, tabId);
  await expect(popup.locator('#best')).toContainText('Amex Gold ••0001');
  await popup.locator('#point').click();
  await expect(popup.locator('#saved')).toContainText('Outlined on the page: your saved Amex Gold ••0001');
  const st = await waitForHighlight(ext, tabId);
  expect(st).toMatchObject({ shown: false, mode: 'click', saved: 'best', highlight: { shown: true, label: 'Best card' } });
  await expectOutlined(page, '#row-amex');
  expect(await formSnapshot(page)).toEqual(before);

  // Pressing it again reuses the injected script: still one outline.
  await popup.locator('#point').click();
  await expect(popup.locator('#saved')).toContainText('Outlined');
  expect((await pillState(ext, tabId))?.highlight?.count).toBe(1);
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});

test('saved cards: last four live outside cardsFile and leave exports unless opted in', async () => {
  const ext = await launch(newProfile());
  const options = await ext.ctx.newPage();
  options.on('dialog', (d) => void d.accept());
  await options.goto(`chrome-extension://${ext.id}/options/index.html`);

  await options.locator('[data-testid="last4-amex-gold"]').fill('12');
  await options.locator('#save').click();
  await expect(options.locator('#errors')).toContainText('exactly 4 digits');
  expect(await storage(ext, 'last4')).toBeUndefined();

  await options.locator('[data-testid="last4-amex-gold"]').fill('0001');
  await options.locator('#save').click();
  await expect(options.locator('#status')).toContainText('Saved');
  expect(await storage(ext, 'last4')).toEqual({ 'amex-gold': '0001' });
  expect(JSON.stringify(await storage(ext, 'cardsFile'))).not.toContain('last4');

  const exportText = async () => {
    const [download] = await Promise.all([options.waitForEvent('download'), options.locator('#export').click()]);
    return { text: readFileSync(await download.path(), 'utf8'), path: await download.path() };
  };
  const plain = await exportText();
  expect(plain.text).not.toContain('last4');
  expect(plain.text).not.toContain('0001');
  await expect(options.locator('#status')).toContainText('no last four digits');

  await options.locator('#exportLast4').check();
  const withDigits = await exportText();
  expect(JSON.parse(withDigits.text).cards.find((c: { id: string }) => c.id === 'amex-gold').last4).toBe('0001');

  // Importing that file puts the digits back in their own key, not in cardsFile.
  await setLast4(ext, {});
  await options.locator('#import').setInputFiles(withDigits.path);
  await expect(options.locator('#status')).toContainText('Imported 6 cards');
  expect(await storage(ext, 'last4')).toEqual({ 'amex-gold': '0001' });
  expect(JSON.stringify(await storage(ext, 'cardsFile'))).not.toContain('last4');
  await expect(options.locator('[data-testid="last4-amex-gold"]')).toHaveValue('0001');

  // Clear all data wipes them.
  await options.locator('#clear').click();
  await expect(options.locator('#status')).toContainText('last four digits cleared');
  expect(await storage(ext, 'last4')).toBeUndefined();
  assertNoExtensionNetwork(ext);
  await ext.ctx.close();
});
