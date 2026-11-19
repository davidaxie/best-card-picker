// cards.json import and export. Export is a local file download made from a blob URL; no network.
import { validateCardsFile } from '../engine';
import type { CardsFile, ValidationResult } from '../engine';

export function exportCardsJson(file: CardsFile): string {
  return JSON.stringify(file, null, 2) + '\n';
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
