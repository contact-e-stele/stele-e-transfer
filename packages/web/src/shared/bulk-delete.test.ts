// OFFEN 022. Fixtures: Stand 02.11.2026 — TOT-Produkte nach Beenden (ebayStatus none, entknüpft) vs. ein noch gelistetes.
import { describe, expect, test } from 'bun:test';
import { BLOCKED_LISTED_REASON, bulkDeleteBackupName, planBulkDelete } from './bulk-delete';

const rows = [
  { id: 229, ebayListingId: null, ebayStatus: 'none' },
  { id: 150, ebayListingId: null, ebayStatus: 'none' },
  { id: 234, ebayListingId: '198755307690', ebayStatus: 'listed' },
  { id: 300, ebayListingId: '123', ebayStatus: 'error' },   // Nummer gesetzt → gesperrt
  { id: 301, ebayListingId: null, ebayStatus: 'listed' },   // Status listed → gesperrt
];

describe('Ausgewählte löschen (OFFEN 022)', () => {
  test('nur entknüpfte, nicht gelistete werden gelöscht', () => {
    const p = planBulkDelete([229, 150, 234, 300, 301, 999, 229], rows);
    expect(p.deletable).toEqual([229, 150]);
    expect(p.blocked).toEqual([
      { id: 234, reason: BLOCKED_LISTED_REASON },
      { id: 300, reason: BLOCKED_LISTED_REASON },
      { id: 301, reason: BLOCKED_LISTED_REASON },
    ]);
    expect(p.missing).toEqual([999]);
  });
  test('leere Angebotsnummer zählt als nicht gelistet', () => {
    expect(planBulkDelete([1], [{ id: 1, ebayListingId: '  ', ebayStatus: 'unavailable' }]).deletable).toEqual([1]);
  });
  test('Sicherungs-Dateiname', () => {
    expect(bulkDeleteBackupName(new Date('2026-11-02T15:50:12.345Z'), [229, 150])).toBe('geloeschte-produkte-2026-11-02T15-50-12-2-stueck.json');
  });
});
