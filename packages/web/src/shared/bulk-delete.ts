// OFFEN 022 (Aufsicht 02.11.2026, Inhaber-Freigabe 16:41): "Ausgewählte löschen (n)" im Produkte-Tab.
// Reine Regeln (Grundgesetz 2): wer darf gelöscht werden, wer ist gesperrt. Kein eBay-Aufruf, keine Preislogik.

export interface BulkDeleteRow { id: number; ebayListingId: string | null; ebayStatus: string | null; title?: string | null }
export interface BulkDeletePlan {
  deletable: number[];
  blocked: Array<{ id: number; reason: string }>;
  missing: number[];
}

export const BLOCKED_LISTED_REASON = 'noch bei eBay gelistet – erst im Listings-Tab beenden';

/** Gesperrt ist jedes Produkt mit gesetzter eBay-Angebotsnummer oder Status "listed". Doppelte IDs zählen einmal. */
export function planBulkDelete(requestedIds: readonly number[], rows: readonly BulkDeleteRow[]): BulkDeletePlan {
  const byId = new Map(rows.map(r => [r.id, r]));
  const plan: BulkDeletePlan = { deletable: [], blocked: [], missing: [] };
  for (const id of [...new Set(requestedIds)]) {
    const r = byId.get(id);
    if (!r) { plan.missing.push(id); continue; }
    if ((r.ebayListingId ?? '').trim() !== '' || r.ebayStatus === 'listed') plan.blocked.push({ id, reason: BLOCKED_LISTED_REASON });
    else plan.deletable.push(id);
  }
  return plan;
}

/** Dateiname der Sicherung vor dem Löschen (Drive-Ordner APP/STELE-DS-APP/Backups). */
export function bulkDeleteBackupName(now: Date, ids: readonly number[]): string {
  const ts = now.toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
  return `geloeschte-produkte-${ts}-${ids.length}-stueck.json`;
}
