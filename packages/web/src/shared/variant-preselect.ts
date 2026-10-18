// R2 „höchstens 5 Varianten“ (BESCHLUSS 18.10.2026 19:21, OFFEN 006 Teil 3): automatische Vorauswahl beim Import. REINE Funktion.
// Regel (Vorschlag Aufsicht, gilt bis der Inhaber anders entscheidet): nur Varianten mit Lager ≥ 5 und Gewinn ≥ 1,00 €,
// davon die `max` mit dem besten Gewinn (bei Gleichstand mehr Lager zuerst). Lager oder Gewinn unbekannt → nicht wählbar (nichts raten).
// Nur bei EINER Varianten-Gruppe: bei mehreren Gruppen (Farbe × Länge) lässt sich eine Auswahl von Kombinationen nicht durch
// Löschen einzelner Werte abbilden — dann keine Automatik, der Inhaber wählt selbst (Speichern bleibt über 5 gesperrt).
import { buildCombinations, entryMatchesCombo, type VariantGroup, type VariantPriceEntry } from './variant-resolver';

export const PRESELECT_MIN_STOCK = 5;
export const PRESELECT_MIN_PROFIT_EUR = 1.0;

export interface PreselectRow { value: string; stock: number | null; profit: number | null; eligible: boolean }
export interface PreselectResult {
  applied: boolean;
  groups: VariantGroup[];          // Gruppen nach der Auswahl (unverändert, wenn applied = false)
  kept: string[];
  removed: string[];
  rows: PreselectRow[];
  reason: string | null;           // warum nicht automatisch gewählt wurde bzw. Hinweis
}

export function preselectVariants<T extends VariantPriceEntry>(
  groups: VariantGroup[], entries: T[], max: number, profitOf: (entry: T) => number | null,
): PreselectResult {
  const g = groups.filter(x => Array.isArray(x.values) && x.values.length > 0);
  const unchanged = (reason: string | null, rows: PreselectRow[] = []): PreselectResult => ({ applied: false, groups, kept: [], removed: [], rows, reason });
  if (g.length === 0) return unchanged(null);
  if (buildCombinations(g).length <= max) return unchanged(null);
  if (g.length > 1) return unchanged(`Mehrere Varianten-Gruppen (${g.map(x => x.name).join(' × ')}) — bitte selbst auf höchstens ${max} reduzieren.`);
  const group = g[0];
  const rows: PreselectRow[] = group.values.map(value => {
    const entry = entries.find(e => entryMatchesCombo({ [group.name]: value }, e));
    const stock = typeof entry?.stock === 'number' && Number.isFinite(entry.stock) ? entry.stock : null;
    const p = entry ? profitOf(entry) : null;
    const profit = typeof p === 'number' && Number.isFinite(p) ? Math.round(p * 100) / 100 : null;
    return { value, stock, profit, eligible: stock !== null && stock >= PRESELECT_MIN_STOCK && profit !== null && profit >= PRESELECT_MIN_PROFIT_EUR - 1e-9 };
  });
  const ranked = rows.filter(r => r.eligible).sort((a, b) => (b.profit! - a.profit!) || (b.stock! - a.stock!));
  if (ranked.length === 0) return unchanged(`Keine Variante erfüllt Lager ≥ ${PRESELECT_MIN_STOCK} und Gewinn ≥ 1,00 € — bitte selbst wählen.`, rows);
  const keepSet = new Set(ranked.slice(0, max).map(r => r.value));
  const kept = group.values.filter(v => keepSet.has(v));
  const removed = group.values.filter(v => !keepSet.has(v));
  return {
    applied: true,
    groups: groups.map(x => (x === group ? { ...x, values: kept } : x)),
    kept, removed, rows,
    reason: ranked.length < max ? `Nur ${ranked.length} Varianten erfüllen Lager ≥ ${PRESELECT_MIN_STOCK} und Gewinn ≥ 1,00 €.` : null,
  };
}
