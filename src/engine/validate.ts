// Runtime validator for cards.json and merchants.json. Mirrors data/cards.schema.json and adds
// cross-field checks the schema cannot express. No dependencies, so it ships in the extension.
import { CATEGORIES, NETWORKS } from './types';
import type { CardsFile, MerchantsFile } from './types';

export interface ValidationResult<T> {
  ok: boolean;
  errors: string[];
  value?: T;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const CATS = new Set<string>(CATEGORIES);
const NETS = new Set<string>(NETWORKS);

/** Any run of 13 to 19 digits (spaces or dashes allowed between) looks like a card number. */
const CARD_NUMBER_RE = /(?:\d[ -]?){12,18}\d/;
const FORBIDDEN_KEYS = /^(number|cardnumber|card_number|pan|cvv|cvc|csc|cvv2|exp|expiry|expiration|expirationdate|billingaddress|billing_address|address|zip|postalcode)$/i;

function privacyScan(v: unknown, path: string, errors: string[]): void {
  if (typeof v === 'string') {
    if (CARD_NUMBER_RE.test(v)) errors.push(`${path}: looks like a card number; card numbers are never stored`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => privacyScan(x, `${path}[${i}]`, errors));
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.test(k)) errors.push(`${path}.${k}: field not allowed (no card numbers, CVV, expiry or address)`);
      privacyScan(x, `${path}.${k}`, errors);
    }
  }
}

function allowedKeys(o: Obj, keys: string[], path: string, errors: string[]): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) errors.push(`${path}: unknown field "${k}"`);
}

function checkNetworks(v: unknown, path: string, errors: string[]): void {
  if (v === undefined) return;
  if (!Array.isArray(v) || !v.every((n) => typeof n === 'string' && NETS.has(n))) {
    errors.push(`${path}: must be a list of ${NETWORKS.join(', ')}`);
  }
}

function checkOptional(o: Obj, key: string, type: 'boolean' | 'string', path: string, errors: string[]): void {
  if (o[key] !== undefined && typeof o[key] !== type) errors.push(`${path}.${key}: must be a ${type}`);
}

function checkMerchant(m: unknown, path: string, errors: string[]): void {
  if (!isObj(m)) return void errors.push(`${path}: must be an object`);
  allowedKeys(m, ['match', 'name', 'category', 'inStoreNetworks', 'onlineNetworks', 'mayNotTakeAmex', 'verify', 'note'], path, errors);
  if (typeof m.match !== 'string' || !m.match.trim()) errors.push(`${path}.match: required text`);
  if (typeof m.category !== 'string' || !CATS.has(m.category)) errors.push(`${path}.category: unknown category "${String(m.category)}"`);
  checkNetworks(m.inStoreNetworks, `${path}.inStoreNetworks`, errors);
  checkNetworks(m.onlineNetworks, `${path}.onlineNetworks`, errors);
  checkOptional(m, 'name', 'string', path, errors);
  checkOptional(m, 'mayNotTakeAmex', 'boolean', path, errors);
  checkOptional(m, 'verify', 'boolean', path, errors);
  checkOptional(m, 'note', 'string', path, errors);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCardsFile(input: unknown): ValidationResult<CardsFile> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['cards.json must be a JSON object'] };
  allowedKeys(input, ['version', 'updated', 'pointValuesCents', 'cards', 'merchants'], 'cards.json', errors);
  if (input.version !== 1) errors.push('version: must be 1');
  if (typeof input.updated !== 'string' || !DATE_RE.test(input.updated)) errors.push('updated: must be a YYYY-MM-DD date');

  const pv = input.pointValuesCents;
  if (!isObj(pv) || Object.keys(pv).length === 0) errors.push('pointValuesCents: must be an object with at least one currency');
  else {
    for (const [k, v] of Object.entries(pv)) {
      if (!/^[a-z0-9_]+$/.test(k)) errors.push(`pointValuesCents.${k}: currency names use a-z, 0-9 and _`);
      if (!isNum(v) || v < 0 || v > 100) errors.push(`pointValuesCents.${k}: must be a number from 0 to 100`);
    }
  }

  if (!Array.isArray(input.cards) || input.cards.length === 0) errors.push('cards: must be a non-empty list');
  else {
    const ids = new Set<string>();
    input.cards.forEach((c, i) => {
      const p = `cards[${i}]`;
      if (!isObj(c)) return void errors.push(`${p}: must be an object`);
      allowedKeys(c, ['id', 'name', 'shortCode', 'color', 'network', 'currency', 'foreignFeePct', 'baseRate', 'rules', 'preferredFor', 'enabled', 'last4', 'verify', 'note'], p, errors);
      if (typeof c.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(c.id)) errors.push(`${p}.id: lowercase letters, digits and dashes`);
      else if (ids.has(c.id)) errors.push(`${p}.id: duplicate id "${c.id}"`);
      else ids.add(c.id);
      if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 60) errors.push(`${p}.name: required, at most 60 characters`);
      if (c.shortCode !== undefined && (typeof c.shortCode !== 'string' || !/^[A-Z0-9]{1,4}$/.test(c.shortCode))) errors.push(`${p}.shortCode: 1 to 4 capital letters or digits`);
      if (c.color !== undefined && (typeof c.color !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(c.color))) errors.push(`${p}.color: must look like #1A4C8B`);
      if (typeof c.network !== 'string' || !NETS.has(c.network)) errors.push(`${p}.network: one of ${NETWORKS.join(', ')}`);
      if (typeof c.currency !== 'string') errors.push(`${p}.currency: required`);
      else if (isObj(pv) && !(c.currency in pv)) errors.push(`${p}.currency: "${c.currency}" has no entry in pointValuesCents`);
      if (!isNum(c.foreignFeePct) || c.foreignFeePct < 0 || c.foreignFeePct > 10) errors.push(`${p}.foreignFeePct: number from 0 to 10`);
      if (!isNum(c.baseRate) || c.baseRate < 0 || c.baseRate > 100) errors.push(`${p}.baseRate: number from 0 to 100`);
      if (c.last4 !== undefined && (typeof c.last4 !== 'string' || !/^\d{4}$/.test(c.last4))) errors.push(`${p}.last4: exactly 4 digits`);
      checkOptional(c, 'enabled', 'boolean', p, errors);
      checkOptional(c, 'note', 'string', p, errors);
      if (c.verify !== undefined && (!Array.isArray(c.verify) || !c.verify.every((x) => typeof x === 'string'))) errors.push(`${p}.verify: list of field names`);
      if (!Array.isArray(c.rules)) errors.push(`${p}.rules: must be a list`);
      else {
        c.rules.forEach((r, j) => {
          const rp = `${p}.rules[${j}]`;
          if (!isObj(r)) return void errors.push(`${rp}: must be an object`);
          allowedKeys(r, ['category', 'rate', 'capUsdPerYear', 'usOnly', 'verify', 'note'], rp, errors);
          if (typeof r.category !== 'string' || !CATS.has(r.category)) errors.push(`${rp}.category: unknown category "${String(r.category)}"`);
          if (!isNum(r.rate) || r.rate < 0 || r.rate > 100) errors.push(`${rp}.rate: number from 0 to 100`);
          if (r.capUsdPerYear !== undefined && (!isNum(r.capUsdPerYear) || r.capUsdPerYear <= 0)) errors.push(`${rp}.capUsdPerYear: positive number`);
          checkOptional(r, 'usOnly', 'boolean', rp, errors);
          checkOptional(r, 'verify', 'boolean', rp, errors);
          checkOptional(r, 'note', 'string', rp, errors);
        });
      }
      if (c.preferredFor !== undefined) {
        if (!Array.isArray(c.preferredFor)) errors.push(`${p}.preferredFor: must be a list`);
        else
          c.preferredFor.forEach((x, j) => {
            const pp = `${p}.preferredFor[${j}]`;
            if (!isObj(x)) return void errors.push(`${pp}: must be an object`);
            allowedKeys(x, ['category', 'reason'], pp, errors);
            if (typeof x.category !== 'string' || !CATS.has(x.category)) errors.push(`${pp}.category: unknown category`);
            if (typeof x.reason !== 'string') errors.push(`${pp}.reason: required text`);
          });
      }
    });
  }

  if (input.merchants !== undefined) {
    if (!Array.isArray(input.merchants)) errors.push('merchants: must be a list');
    else input.merchants.forEach((m, i) => checkMerchant(m, `merchants[${i}]`, errors));
  }

  privacyScan(input, 'cards.json', errors);
  return errors.length ? { ok: false, errors } : { ok: true, errors, value: input as unknown as CardsFile };
}

export function validateMerchantsFile(input: unknown): ValidationResult<MerchantsFile> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['merchants.json must be a JSON object'] };
  allowedKeys(input, ['version', 'updated', 'merchants'], 'merchants.json', errors);
  if (input.version !== 1) errors.push('version: must be 1');
  if (typeof input.updated !== 'string' || !DATE_RE.test(input.updated)) errors.push('updated: must be a YYYY-MM-DD date');
  if (!Array.isArray(input.merchants)) errors.push('merchants: must be a list');
  else {
    const seen = new Set<string>();
    input.merchants.forEach((m, i) => {
      checkMerchant(m, `merchants[${i}]`, errors);
      if (isObj(m) && typeof m.match === 'string') {
        const key = m.match.toLowerCase();
        if (seen.has(key)) errors.push(`merchants[${i}].match: duplicate "${m.match}"`);
        seen.add(key);
      }
    });
  }
  privacyScan(input, 'merchants.json', errors);
  return errors.length ? { ok: false, errors } : { ok: true, errors, value: input as unknown as MerchantsFile };
}
