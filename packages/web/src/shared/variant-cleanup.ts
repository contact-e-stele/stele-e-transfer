// Varianten aufräumen + höchstens 5 Varianten (Inhaber 18.10.2026; Befund Aufsicht 16.10. Nr 238 „zeigt nach Säubern weiter 9 Varianten“,
// ANTWORT 004 Teil B). REINE Funktionen, dieselbe Zuordnungsregel wie Listing/Preis-Lauf (variant-resolver.ts, Grundgesetz 8).
//
// Regel „entfernte Werte“: Ein variantPrices-Eintrag wird NUR entfernt, wenn er zu einer ALTEN Kombination gehörte, die es nach der
// Änderung der Varianten-Gruppen nicht mehr gibt. Einträge, die schon vorher zu keiner Kombination passten (z. B. stele-70: eBay
// „Silber-Optik/Gold-Optik“, App-Einträge „1PCS/Gold“), bleiben unangetastet — sonst gingen EK-Daten verloren, die der Preis-Lauf nutzt.
import { buildCombinations, entryMatchesCombo, type VariantGroup, type VariantPriceEntry } from './variant-resolver';

export const MAX_VARIANT_COMBINATIONS = 5;
/** app_settings "max_variant_combinations" lesen (OFFEN 006: einstellbar); ungültig/leer → 5. */
export function parseMaxVariantCombinations(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : MAX_VARIANT_COMBINATIONS;
}

const usable = (groups: VariantGroup[]) => groups.filter(g => Array.isArray(g.values) && g.values.length > 0);

/** Anzahl der Kombinationen (= eBay-Varianten) der Gruppen; ohne Gruppen 0 (Einzelartikel). */
export function countVariantCombinations(groups: VariantGroup[]): number {
  const g = usable(groups);
  return g.length === 0 ? 0 : buildCombinations(g).length;
}

/** Fehlertext, wenn mehr als `max` Varianten — sonst null. */
export function maxVariantsError(groups: VariantGroup[], max = MAX_VARIANT_COMBINATIONS): string | null {
  const n = countVariantCombinations(groups);
  return n > max ? `Mehr als ${max} Varianten (${n}) – bitte im Import-Tab die übrigen löschen, höchstens ${max} sind erlaubt.` : null;
}

/** Entfernt die Einträge, deren alte Kombination weggefallen ist. Struktur gleich (nur Umbenennung) → nichts entfernen. */
export function pruneRemovedVariantEntries<T extends VariantPriceEntry>(
  oldGroups: VariantGroup[],
  newGroups: VariantGroup[],
  entries: T[],
): { kept: T[]; removed: T[]; renamedAndRemoved: boolean } {
  const oldG = usable(oldGroups);
  const newG = usable(newGroups);
  if (oldG.length === 0 || newG.length === 0) return { kept: [...entries], removed: [], renamedAndRemoved: false };
  // Reine Umbenennung (gleiche Gruppen- und Werte-Anzahl) übernimmt syncDisplayValuesOnRename — hier nichts entfernen.
  const sameStructure = oldG.length === newG.length && oldG.every((g, i) => g.values.length === newG[i].values.length);
  if (sameStructure) return { kept: [...entries], removed: [], renamedAndRemoved: false };
  // Umbenannt UND gelöscht im selben Schritt: ein umbenannter Wert passt nicht mehr auf die AliExpress-Merkmale, das Entfernen würde
  // dann auch behaltene Varianten treffen. Nichts raten — nichts entfernen, Aufrufer zeigt den Hinweis „getrennt speichern“.
  const oldValues = new Set(oldG.flatMap(g => g.values.map(v => v.trim().toLowerCase())));
  if (newG.some(g => g.values.some(v => !oldValues.has(v.trim().toLowerCase())))) return { kept: [...entries], removed: [], renamedAndRemoved: true };
  const oldCombos = buildCombinations(oldG);
  const newCombos = buildCombinations(newG);
  const kept: T[] = [];
  const removed: T[] = [];
  for (const e of entries) {
    const wasMapped = oldCombos.some(c => entryMatchesCombo(c, e));
    const stillMapped = newCombos.some(c => entryMatchesCombo(c, e));
    if (wasMapped && !stillMapped) removed.push(e); else kept.push(e);
  }
  return { kept, removed, renamedAndRemoved: false };
}
