// Options page: card editor, point values, caps, per-site choices, import/export, reset, pause, Auto mode.
import { NETWORKS, validateCardsFile } from '../engine';
import type { Card, CardsFile, Category, Network, Rule } from '../engine';
import { h } from '../shared/dom';
import { exportCardsJson, importCardsJson } from '../shared/io';
import { clearAllData, defaultCardsFile, LAST4_RE, loadState, saveState, splitLast4, type StoredState } from '../shared/state';
import { CATEGORY_OPTIONS, categoryLabel, fmtUsd } from '../shared/view';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let state: StoredState;
let draft: CardsFile;
/** Last four digits being edited, keyed by the draft card object so an id rename keeps them. */
let draftLast4 = new Map<Card, string>();

function resetDraft(): void {
  draft = clone(state.cardsFile);
  draftLast4 = new Map(draft.cards.filter((c) => state.last4[c.id]).map((c) => [c, state.last4[c.id]!]));
}

function status(msg: string, isError = false): void {
  const el = $('status');
  el.textContent = msg;
  el.className = isError ? 'error' : '';
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function categorySelect(value: Category, onChange: (c: Category) => void, testId?: string): HTMLSelectElement {
  const sel = h('select', { 'data-testid': testId, onchange: () => onChange(sel.value as Category) });
  for (const c of CATEGORY_OPTIONS) sel.append(h('option', { value: c.id, selected: c.id === value }, c.label));
  return sel;
}

// ---------- General ----------
function renderGeneral(): void {
  const paused = $<HTMLInputElement>('paused');
  const auto = $<HTMLInputElement>('autoMode');
  const cash = $<HTMLInputElement>('preferCash');
  paused.checked = state.settings.paused;
  auto.checked = state.settings.autoMode;
  cash.checked = state.settings.preferCashOnTie;
  paused.onchange = async () => {
    await chrome.runtime.sendMessage({ type: 'setSettings', patch: { paused: paused.checked } });
    status(paused.checked ? 'Paused on all sites.' : 'Resumed.');
  };
  cash.onchange = async () => {
    await chrome.runtime.sendMessage({ type: 'setSettings', patch: { preferCashOnTie: cash.checked } });
    status('Tie preference saved.');
  };
  auto.onchange = async () => {
    const perms: chrome.permissions.Permissions = { permissions: ['scripting'], origins: ['<all_urls>'] };
    if (auto.checked) {
      let granted = false;
      try {
        granted = await chrome.permissions.request(perms);
      } catch {
        granted = false;
      }
      if (!granted) {
        auto.checked = false;
        return status('Auto mode needs access to all sites. Click-to-check still works without it.', true);
      }
      const r = (await chrome.runtime.sendMessage({ type: 'autoMode', enabled: true })) as { active: boolean };
      status(r.active ? 'Auto mode on: the pill appears on checkout pages.' : 'Auto mode saved, but it is paused.');
    } else {
      await chrome.runtime.sendMessage({ type: 'autoMode', enabled: false });
      await chrome.permissions.remove(perms).catch(() => false);
      status('Auto mode off. Click the toolbar icon to check a site.');
    }
  };
}

// ---------- Point values ----------
function renderPoints(): void {
  const box = $('pointValues');
  box.replaceChildren();
  for (const [currency, value] of Object.entries(draft.pointValuesCents)) {
    const input = h('input', {
      type: 'number',
      step: '0.05',
      min: '0',
      value: String(value),
      'data-testid': `pv-${currency}`,
      oninput: () => {
        draft.pointValuesCents[currency] = Number(input.value);
      },
    });
    box.append(h('label', {}, h('span', {}, currency), input));
  }
}

// ---------- Cards ----------
function ruleRow(card: Card, rule: Rule, i: number, rerender: () => void): HTMLTableRowElement {
  const rate = h('input', {
    type: 'number',
    step: '0.5',
    min: '0',
    value: String(rule.rate),
    'data-testid': `rate-${card.id}-${rule.category}`,
    oninput: () => {
      rule.rate = Number(rate.value);
    },
  });
  const cap = h('input', {
    type: 'number',
    step: '500',
    min: '0',
    value: rule.capUsdPerYear != null ? String(rule.capUsdPerYear) : '',
    placeholder: 'none',
    oninput: () => {
      const n = numOrUndef(cap.value);
      if (n === undefined) delete rule.capUsdPerYear;
      else rule.capUsdPerYear = n;
    },
  });
  const usOnly = h('input', { type: 'checkbox', checked: rule.usOnly === true, onchange: () => (usOnly.checked ? (rule.usOnly = true) : delete rule.usOnly) });
  const verify = h('input', { type: 'checkbox', checked: rule.verify === true, onchange: () => (verify.checked ? (rule.verify = true) : delete rule.verify) });
  return h(
    'tr',
    {},
    h('td', {}, categorySelect(rule.category, (c) => (rule.category = c))),
    h('td', {}, rate),
    h('td', {}, cap),
    h('td', {}, usOnly),
    h('td', {}, verify),
    h(
      'td',
      {},
      h('button', {
        type: 'button',
        class: 'small',
        onclick: () => {
          card.rules.splice(i, 1);
          rerender();
        },
      }, 'Remove'),
    ),
  );
}

function textField(label: string, value: string, set: (v: string) => void, attrs: Record<string, string> = {}): HTMLLabelElement {
  const input = h('input', { type: 'text', value, oninput: () => set(input.value), ...attrs });
  return h('label', {}, label, input);
}

function numberField(label: string, value: number, set: (v: number) => void, attrs: Record<string, string> = {}): HTMLLabelElement {
  const input = h('input', { type: 'number', value: String(value), oninput: () => set(Number(input.value)), ...attrs });
  return h('label', {}, label, input);
}

function renderCards(): void {
  const list = $('cardList');
  list.replaceChildren();
  draft.cards.forEach((card, ci) => {
    const rerender = () => renderCards();
    const network = h('select', { onchange: () => (card.network = network.value as Network) });
    for (const n of NETWORKS) network.append(h('option', { value: n, selected: n === card.network }, n));
    const currency = h('select', { onchange: () => (card.currency = currency.value) });
    for (const c of Object.keys(draft.pointValuesCents)) currency.append(h('option', { value: c, selected: c === card.currency }, c));
    const enabled = h('input', { type: 'checkbox', checked: card.enabled !== false, onchange: () => (enabled.checked ? delete card.enabled : (card.enabled = false)) });
    const color = h('input', { type: 'color', value: card.color ?? '#444444', oninput: () => (card.color = color.value.toUpperCase()) });

    const rules = h('tbody');
    card.rules.forEach((r, i) => rules.append(ruleRow(card, r, i, rerender)));
    const verifyNote = card.verify?.length ? h('p', { class: 'muted' }, `Marked verify: ${card.verify.join(', ')}`) : null;

    list.append(
      h(
        'fieldset',
        { class: 'card', 'data-card': card.id },
        h('legend', {}, card.name || card.id),
        h(
          'div',
          { class: 'fields' },
          textField('Name', card.name, (v) => (card.name = v)),
          textField('Id', card.id, (v) => (card.id = v), { pattern: '[a-z0-9-]+' }),
          h('label', {}, 'Network', network),
          h('label', {}, 'Currency', currency),
          numberField('Base rate', card.baseRate, (v) => (card.baseRate = v), { step: '0.5', min: '0', 'data-testid': `base-${card.id}` }),
          numberField('Foreign fee %', card.foreignFeePct, (v) => (card.foreignFeePct = v), { step: '0.1', min: '0' }),
          textField('Badge code', card.shortCode ?? '', (v) => (v ? (card.shortCode = v.toUpperCase()) : delete card.shortCode), { maxlength: '4' }),
          textField('Last 4 (optional, stays in this browser)', draftLast4.get(card) ?? '', (v) => (v.trim() ? draftLast4.set(card, v.trim()) : draftLast4.delete(card)), {
            maxlength: '4',
            inputmode: 'numeric',
            pattern: '[0-9]{4}',
            autocomplete: 'off',
            'data-testid': `last4-${card.id}`,
          }),
          h('label', {}, 'Color', color),
          h('label', {}, 'Enabled', enabled),
        ),
        verifyNote,
        card.note ? h('p', { class: 'muted' }, card.note) : null,
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Category'), h('th', {}, 'Rate'), h('th', {}, 'Cap $/yr'), h('th', {}, 'US only'), h('th', {}, 'Verify'), h('th', {}))),
          rules,
        ),
        h(
          'div',
          { class: 'row' },
          h('button', {
            type: 'button',
            class: 'small',
            onclick: () => {
              card.rules.push({ category: 'general', rate: card.baseRate });
              rerender();
            },
          }, 'Add rule'),
          h('button', {
            type: 'button',
            class: 'small danger',
            onclick: () => {
              if (confirm(`Remove ${card.name}?`)) {
                draft.cards.splice(ci, 1);
                rerender();
              }
            },
          }, 'Remove card'),
        ),
      ),
    );
  });
}

async function saveDraft(): Promise<void> {
  const errorsEl = $('errors');
  errorsEl.replaceChildren();
  const bad = draft.cards.some((c) => c.rules.some((r) => !Number.isFinite(r.rate) || (r.capUsdPerYear !== undefined && !Number.isFinite(r.capUsdPerYear))));
  const candidate: CardsFile = { ...clone(draft), updated: new Date().toISOString().slice(0, 10) };
  for (const c of candidate.cards) delete c.last4;
  const last4: Record<string, string> = {};
  const last4Errors: string[] = [];
  for (const [card, digits] of draftLast4) {
    if (!draft.cards.includes(card)) continue;
    if (!LAST4_RE.test(digits)) last4Errors.push(`${card.name || card.id}: last four must be exactly 4 digits, or empty.`);
    else last4[card.id] = digits;
  }
  const result = validateCardsFile(candidate);
  if (!result.ok || bad || last4Errors.length) {
    for (const e of result.errors) errorsEl.append(h('li', {}, e));
    for (const e of last4Errors) errorsEl.append(h('li', {}, e));
    if (bad) errorsEl.append(h('li', {}, 'Every rate and cap must be a number.'));
    return status('Not saved: fix the errors listed under Cards.', true);
  }
  await saveState({ cardsFile: candidate, last4 });
  state.cardsFile = candidate;
  state.last4 = last4;
  resetDraft();
  renderAll();
  status('Saved. The next recommendation uses these rules.');
}

// ---------- Caps ----------
function renderCaps(): void {
  const box = $('capList');
  box.replaceChildren();
  for (const card of state.cardsFile.cards) {
    for (const r of card.rules) {
      if (r.capUsdPerYear == null) continue;
      const entry = state.capState[card.id]?.[r.category] ?? {};
      const update = async (patch: { reached?: boolean; usedUsd?: number | undefined }) => {
        const capState = clone(state.capState);
        const forCard = (capState[card.id] ??= {});
        const next = { ...(forCard[r.category] ?? {}), ...patch };
        if (next.usedUsd === undefined) delete next.usedUsd;
        forCard[r.category] = next;
        state.capState = capState;
        await saveState({ capState });
        status('Cap saved.');
      };
      const reached = h('input', { type: 'checkbox', checked: entry.reached === true, onchange: () => void update({ reached: reached.checked }) });
      const used = h('input', {
        type: 'number',
        min: '0',
        step: '100',
        placeholder: 'spent so far',
        value: entry.usedUsd != null ? String(entry.usedUsd) : '',
        onchange: () => void update({ usedUsd: numOrUndef(used.value) }),
      });
      box.append(h('label', {}, reached, `${card.name} ${categoryLabel(r.category)} (${fmtUsd(r.capUsdPerYear)} cap) reached`, used));
    }
  }
}

// ---------- Sites ----------
function renderSites(): void {
  const box = $('siteList');
  box.replaceChildren();
  const cats = Object.entries(state.siteCategories).sort(([a], [b]) => a.localeCompare(b));
  const foreign = Object.entries(state.siteForeign).sort(([a], [b]) => a.localeCompare(b));
  if (!cats.length && !foreign.length && !state.neverSites.length) {
    box.append(h('p', { class: 'muted' }, 'No per-site choices yet. Pick a category in the toolbar popup to add one.'));
    return;
  }
  const table = h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Site'), h('th', {}, 'Choice'), h('th', {}))));
  const body = h('tbody');
  const remove = (fn: () => void) => h('button', { type: 'button', class: 'small', onclick: async () => {
    fn();
    await saveState({ siteCategories: state.siteCategories, siteForeign: state.siteForeign, neverSites: state.neverSites });
    renderSites();
    status('Removed.');
  } }, 'Remove');
  for (const [domain, cat] of cats) {
    const sel = categorySelect(cat, async (c) => {
      state.siteCategories = { ...state.siteCategories, [domain]: c };
      await saveState({ siteCategories: state.siteCategories });
      status(`${domain} saved as ${categoryLabel(c)}.`);
    });
    body.append(h('tr', { 'data-site': domain }, h('td', {}, domain), h('td', {}, sel), h('td', {}, remove(() => delete state.siteCategories[domain]))));
  }
  for (const [domain, value] of foreign) {
    body.append(h('tr', {}, h('td', {}, domain), h('td', {}, value ? 'Always foreign' : 'Never foreign'), h('td', {}, remove(() => delete state.siteForeign[domain]))));
  }
  for (const domain of state.neverSites) {
    body.append(h('tr', {}, h('td', {}, domain), h('td', {}, 'Pill never shown'), h('td', {}, remove(() => (state.neverSites = state.neverSites.filter((d) => d !== domain))))));
  }
  table.append(body);
  box.append(table);
}

// ---------- Import / export ----------
function wireData(): void {
  $('export').onclick = () => {
    const withDigits = $<HTMLInputElement>('exportLast4').checked;
    const blob = new Blob([exportCardsJson(state.cardsFile, withDigits ? state.last4 : undefined)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'cards.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(withDigits ? 'Exported cards.json, including last four digits. Keep that file private.' : 'Exported cards.json (no last four digits).');
  };
  const input = $<HTMLInputElement>('import');
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const result = importCardsJson(await file.text());
    input.value = '';
    if (!result.ok || !result.value) {
      const errorsEl = $('errors');
      errorsEl.replaceChildren(...result.errors.map((e) => h('li', {}, e)));
      return status('Import failed: the file did not pass validation. Nothing changed.', true);
    }
    // Digits in an imported file move to their own storage key, never into cardsFile.
    const split = splitLast4(result.value);
    const last4 = { ...state.last4, ...split.last4 };
    await saveState({ cardsFile: split.cardsFile, last4 });
    state.cardsFile = split.cardsFile;
    state.last4 = last4;
    resetDraft();
    renderAll();
    status(`Imported ${split.cardsFile.cards.length} cards.`);
  };
  $('reset').onclick = async () => {
    if (!confirm('Replace your cards and point values with the bundled defaults?')) return;
    const fresh = defaultCardsFile();
    await saveState({ cardsFile: fresh });
    state.cardsFile = fresh;
    resetDraft();
    renderAll();
    status('Cards reset to defaults.');
  };
  $('clear').onclick = async () => {
    if (!confirm('Clear per-site choices, cap toggles, never-show sites, settings and saved last four digits? Your card rules are kept.')) return;
    await chrome.runtime.sendMessage({ type: 'autoMode', enabled: false });
    await clearAllData(false);
    state = await loadState();
    resetDraft();
    renderAll();
    status('All per-site data, settings and last four digits cleared.');
  };
  $('addCard').onclick = () => {
    const n = draft.cards.length + 1;
    draft.cards.push({ id: `card-${n}`, name: `New card ${n}`, network: 'visa', currency: Object.keys(draft.pointValuesCents)[0] ?? 'cash', foreignFeePct: 0, baseRate: 1, rules: [] });
    renderCards();
  };
  $('save').onclick = () => void saveDraft();
  $('discard').onclick = () => {
    resetDraft();
    renderAll();
    status('Edits discarded.');
  };
}

function renderAll(): void {
  renderGeneral();
  renderPoints();
  renderCards();
  renderCaps();
  renderSites();
}

// Keep in sync with changes made from the popup.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  void loadState().then((s) => {
    const cardsChanged = 'cardsFile' in changes || 'last4' in changes;
    state = s;
    if (cardsChanged) resetDraft();
    renderGeneral();
    renderCaps();
    renderSites();
    if (cardsChanged) {
      renderPoints();
      renderCards();
    }
  });
});

void (async () => {
  state = await loadState();
  resetDraft();
  wireData();
  renderAll();
})();
