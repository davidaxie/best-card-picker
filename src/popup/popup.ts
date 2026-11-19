// Toolbar popup: best card, reason, runner-up, category dropdown, warnings and cap toggles.
import type { Category } from '../engine';
import { h } from '../shared/dom';
import { CATEGORY_OPTIONS, categoryLabel, fmtUsd, rateText, type PopupData } from '../shared/view';

const app = document.getElementById('app')!;
/** True once the user has let the extension look at pages they click it on (optional scripting). */
let scriptingGranted = false;

async function currentTabId(): Promise<number | null> {
  const fromQuery = new URLSearchParams(location.search).get('tab');
  if (fromQuery) return Number(fromQuery);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function send(msg: unknown): Promise<PopupData> {
  return (await chrome.runtime.sendMessage(msg)) as PopupData;
}

const SOURCE_TAG: Record<string, string> = {
  saved: 'your choice for this site',
  merchant: 'from the merchant list',
  hints: 'guessed from the page',
  unknown: 'unknown store',
};

function categorySelect(selected: Category, onChange: (c: Category) => void, id: string): HTMLSelectElement {
  const sel = h('select', { id, onchange: () => onChange(sel.value as Category) });
  for (const c of CATEGORY_OPTIONS) sel.append(h('option', { value: c.id, selected: c.id === selected }, c.label));
  return sel;
}

function render(data: PopupData): void {
  app.replaceChildren();
  if (!data.supported || !data.decision || data.tabId === undefined) {
    app.append(
      h('h1', {}, 'Best Card Picker'),
      h('p', { class: 'muted' }, 'Open a shopping site, then click the toolbar icon to check which card to use.'),
      footer(),
    );
    return;
  }
  const tabId = data.tabId;
  const d = data.decision;
  const r = d.recommendation;
  const cards = data.cardsFile.cards;
  const card = cards.find((c) => c.id === r.cardId);
  const runner = cards.find((c) => c.id === r.runnerUp?.cardId);
  const last4 = data.last4 ?? {};
  const digits = (id: string | undefined) => (id && last4[id] ? ` ••${last4[id]}` : '');

  app.append(h('div', { class: 'site' }, d.domain || d.host));
  if (card && r.rate !== null) {
    app.append(
      h('h1', { id: 'best' }, h('span', { class: 'swatch', style: `background:${card.color ?? '#444'}` }), `${card.name}${digits(card.id)} · ${rateText(card, r.rate)}`),
      h('p', { class: 'reason', id: 'reason' }, r.reason),
    );
    if (runner && r.runnerUp) {
      app.append(h('p', { class: 'muted', id: 'runner-up' }, `Runner-up: ${runner.name}${digits(runner.id)}, about ${Math.round(r.runnerUp.centsPerDollar * 100) / 100} cents per dollar`));
    }
  } else {
    app.append(h('h1', { id: 'best' }, 'No card accepted here'));
  }

  const savedLine = savedText(data, card?.name, runner?.name, digits);
  if (savedLine) app.append(h('p', { class: 'saved', id: 'saved' }, savedLine));
  // Before the first "yes", one button asks Chrome. After that, every click on the icon reads the
  // page by itself and this button only re-runs it (a checkout that changed after opening).
  const pointLabel = !scriptingGranted
    ? data.canPoint
      ? 'Point to my card on this page'
      : 'Check this page'
    : data.canPoint
      ? 'Look for my card again'
      : null;
  if (pointLabel && !data.settings?.paused) app.append(h('button', { class: 'link', id: 'point', onclick: () => void pointHere(tabId) }, pointLabel));

  for (const w of r.warnings) app.append(h('p', { class: 'warn', 'data-code': w.code }, w.message));
  if (data.settings?.paused) app.append(h('p', { class: 'warn' }, 'Paused: the pill and badge are off on all sites.'));

  const setCategory = (c: Category | null) =>
    void send({ type: 'setCategory', tabId, domain: d.domain, category: c }).then(render);

  if (d.needsAsk) {
    const guess = d.categorySource === 'hints' ? ` It looks like ${categoryLabel(d.category).toLowerCase()}.` : '';
    const sel = categorySelect(d.category, () => undefined, 'ask-category');
    app.append(
      h(
        'div',
        { class: 'ask', id: 'ask' },
        h('strong', {}, 'What kind of store is this?'),
        guess ? h('span', { class: 'muted' }, guess.trim()) : null,
        h('label', {}, sel, h('button', { class: 'link', id: 'ask-save', onclick: () => setCategory(sel.value as Category) }, 'Save')),
      ),
    );
  }

  const catSection = h(
    'section',
    {},
    h('label', { for: 'category' }, 'Category', categorySelect(d.category, (c) => setCategory(c), 'category')),
    h('div', { class: 'tag', id: 'category-source' }, SOURCE_TAG[d.categorySource] ?? ''),
    data.savedCategory ? h('button', { class: 'link', onclick: () => setCategory(null) }, 'Forget my choice for this site') : null,
  );
  app.append(catSection);

  const foreignBox = h('input', {
    type: 'checkbox',
    id: 'foreign',
    checked: d.foreign,
    onchange: () => void send({ type: 'setForeign', tabId, domain: d.domain, value: foreignBox.checked }).then(render),
  });
  app.append(
    h(
      'section',
      {},
      h('label', {}, foreignBox, 'Charged in another currency or outside the US'),
      d.foreignReasons.length ? h('div', { class: 'tag' }, `Detected: ${d.foreignReasons.join(', ')}`) : null,
      d.foreignOverride !== null
        ? h('button', { class: 'link', onclick: () => void send({ type: 'setForeign', tabId, domain: d.domain, value: null }).then(render) }, 'Use automatic detection')
        : null,
    ),
  );

  if (data.capToggles?.length) {
    const caps = h('section', { id: 'caps' }, h('div', { class: 'tag' }, 'Yearly caps in play'));
    for (const t of data.capToggles) {
      const box = h('input', {
        type: 'checkbox',
        checked: t.reached,
        'data-card': t.cardId,
        onchange: () => void send({ type: 'setCap', tabId, cardId: t.cardId, category: t.category, reached: box.checked }).then(render),
      });
      caps.append(h('label', {}, box, `${t.cardName} ${categoryLabel(t.category)}: ${fmtUsd(t.capUsd)} cap reached`));
    }
    app.append(caps);
  }

  app.append(footer());
}

function savedText(data: PopupData, bestName: string | undefined, runnerName: string | undefined, digits: (id: string | undefined) => string): string | null {
  const s = data.saved;
  const r = data.decision?.recommendation;
  if (!s || !r) return null;
  if (s.status === 'best') return `Outlined on the page: your saved ${bestName}${digits(r.cardId ?? undefined)}. You make the final click.`;
  if (s.status === 'runnerUp') {
    if (!digits(r.cardId ?? undefined)) return `${runnerName}${digits(r.runnerUp?.cardId)} is saved on this site and outlined. Add ${bestName}'s last four in settings to look for it too.`;
    return `Your best card isn't saved on this site; ${runnerName}${digits(r.runnerUp?.cardId)} is, and it's outlined.`;
  }
  if (s.status === 'none') return `None of the ${s.found} saved cards on this page match ${bestName}${digits(r.cardId ?? undefined)}.`;
  return 'No saved-card list found on this page yet. Open the payment step, then try again.';
}

async function pointHere(tabId: number): Promise<void> {
  // scripting has no install warning, so Chrome grants it without a prompt. activeTab (from clicking
  // the toolbar icon) gives access to this tab only, until it navigates.
  let granted = false;
  try {
    granted = await chrome.permissions.request({ permissions: ['scripting'] });
  } catch {
    granted = false;
  }
  if (!granted) {
    document.getElementById('point')?.replaceWith(h('p', { class: 'warn' }, 'Chrome did not allow the extension to look at this page.'));
    return;
  }
  scriptingGranted = true;
  render(await send({ type: 'point', tabId }));
}

function footer(): HTMLElement {
  return h(
    'div',
    { class: 'foot' },
    h('button', { class: 'link', onclick: () => void chrome.runtime.openOptionsPage() }, 'Cards and settings'),
    h('span', { class: 'tag' }, 'Runs only when you click the icon'),
  );
}

void (async () => {
  const tabId = await currentTabId();
  if (tabId === null) return render({ supported: false } as PopupData);
  try {
    scriptingGranted = await chrome.permissions.contains({ permissions: ['scripting'] });
  } catch {
    scriptingGranted = false;
  }
  const data = await send({ type: 'popup', tabId });
  render(data);
  // This popup opening is the user's click. If they already allowed it once, read the page and
  // outline the card now.
  if (data.supported && scriptingGranted && !data.settings?.paused) {
    document.getElementById('point')?.replaceWith(h('p', { class: 'saved', id: 'looking' }, 'Looking for your saved card on this page…'));
    render(await send({ type: 'point', tabId }));
  }
})();
