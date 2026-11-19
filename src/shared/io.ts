// cards.json import and export. Export is a local file download made from a blob URL; no network.
import { validateCardsFile } from '../engine';
import type { CardsFile, ValidationResult } from '../engine';

/**
 * The exported file never carries last four digits unless the caller passes them in (the options
 * page does that only when "Include last four digits" is ticked).
 */
export function exportCardsJson(file: CardsFile, includeLast4?: Record<string, string>): string {
  const copy = JSON.parse(JSON.stringify(file)) as CardsFile;
  for (const c of copy.cards) {
    delete c.last4;
    const d = includeLast4?.[c.id];
    if (d && /^\d{4}$/.test(d)) c.last4 = d;
  }
  return JSON.stringify(copy, null, 2) + '\n';
}

export function importCardsJson(text: string): ValidationResult<CardsFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] };
  }
  return validateCardsFile(parsed);
}
