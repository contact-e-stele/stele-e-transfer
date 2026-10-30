// Sammel-Auswahl im Produkte-Tab (Inhaber 30.10.2026): Häkchen je Produkt + "Alle auswählen" für die
// gerade sichtbare (gefilterte) Liste, danach "Preise prüfen" / "Dubletten prüfen" für die Auswahl.
// Reine Funktionen (Grundgesetz 2) — produkte.tsx nutzt nur diese Regeln.

/** Ausgewählte Produkte, die gerade sichtbar sind — in der Reihenfolge der sichtbaren Liste. */
export function selectedVisible(selected: ReadonlySet<number>, visibleIds: readonly number[]): number[] {
  return visibleIds.filter(id => selected.has(id));
}

/** Sind alle sichtbaren Produkte ausgewählt? (leere Liste → false) */
export function allVisibleSelected(selected: ReadonlySet<number>, visibleIds: readonly number[]): boolean {
  return visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
}

/**
 * "Alle auswählen": sind schon alle sichtbaren ausgewählt → genau diese abwählen, sonst alle sichtbaren dazunehmen.
 * Nicht sichtbare Auswahl bleibt unberührt (wird beim Ausführen ohnehin ignoriert, s. selectedVisible).
 */
export function toggleAllVisible(selected: ReadonlySet<number>, visibleIds: readonly number[]): Set<number> {
  const next = new Set(selected);
  if (allVisibleSelected(selected, visibleIds)) visibleIds.forEach(id => next.delete(id));
  else visibleIds.forEach(id => next.add(id));
  return next;
}

export function toggleOne(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** "Preis prüfen" braucht eine AliExpress-/Quell-URL (wie der Einzel-Knopf: "manual" zählt nicht). */
export function priceCheckUrl(p: { sourceUrl?: string | null; amazonUrl?: string | null }): string | null {
  const url = p.sourceUrl || p.amazonUrl;
  return url && url !== 'manual' ? url : null;
}

/** Vorschau-Antwort von GET /api/products/:id/variant-dedupe (nur die genutzten Felder). */
export interface DedupePreviewLite { before?: number; after?: number; changes?: unknown[]; stillAmbiguous?: unknown[]; error?: string }

export type DedupeVerdict = 'clean' | 'fixable' | 'blocked' | 'error';

/**
 * Einordnung je Produkt: nur "fixable" wird beim Sammel-Bereinigen geschrieben —
 * dieselben Sperren wie die POST-Route (keine Änderungen → nichts; danach noch mehrdeutig → nichts).
 */
export function dedupeVerdict(d: DedupePreviewLite, httpOk: boolean): DedupeVerdict {
  if (!httpOk || d.error) return 'error';
  if (!d.changes || d.changes.length === 0) return 'clean';
  if (d.stillAmbiguous && d.stillAmbiguous.length > 0) return 'blocked';
  return 'fixable';
}
