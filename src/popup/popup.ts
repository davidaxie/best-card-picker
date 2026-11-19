// Toolbar popup: best card, reason, runner-up, category dropdown, warnings and cap toggles.
import type { Category } from '../engine';
import { h } from '../shared/dom';
import { CATEGORY_OPTIONS, categoryLabel, fmtUsd, rateText, type PopupData } from '../shared/view';

const app = document.getElementById('app')!;

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
      footer(data),
    );
    return;
  }
  const tabId = data.tabId;
  const d = data.decision;
  const r = d.recommendation;
  const cards = data.cardsFile.cards;
  const card = cards.find((c) => c.id === r.cardId);
  const runner = cards.find((c) => c.id === r.runnerUp?.cardId);

  app.append(h('div', { class: 'site' }, d.domain || d.host));
  if (card && r.rate !== null) {
    app.append(
      h('h1', { id: 'best' }, h('span', { class: 'swatch', style: `background:${card.color ?? '#444'}` }), `${card.name} · ${rateText(card, r.rate)}`),
      h('p', { class: 'reason', id: 'reason' }, r.reason),
    );
    if (runner && r.runnerUp) {
      app.append(h('p', { class: 'muted', id: 'runner-up' }, `Runner-up: ${runner.name}, about ${Math.round(r.runnerUp.centsPerDollar * 100) / 100} cents per dollar`));
    }
  } else {
    app.append(h('h1', { id: 'best' }, 'No card accepted here'));
  }

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

  const neverBox = h('input', {
    type: 'checkbox',
    id: 'never',
    checked: data.never === true,
    onchange: () => void send({ type: 'setNever', tabId, domain: d.domain, never: neverBox.checked }).then(render),
  });
  app.append(h('section', {}, h('label', {}, neverBox, 'Never show the pill on this site')), footer(data));
}

function footer(data: PopupData): HTMLElement {
  return h(
    'div',
    { class: 'foot' },
    h('button', { class: 'link', onclick: () => void chrome.runtime.openOptionsPage() }, 'Cards and settings'),
    h('span', { class: 'tag' }, data.settings?.autoMode ? 'Auto mode on' : 'Click-to-check mode'),
  );
}

void (async () => {
  const tabId = await currentTabId();
  if (tabId === null) return render({ supported: false } as PopupData);
  render(await send({ type: 'popup', tabId }));
})();
