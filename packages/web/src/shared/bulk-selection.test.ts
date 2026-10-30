// Fixtures: Preisalarm-Liste live 30.10.2026 (119, 150, 189, 229).
import { describe, expect, test } from 'bun:test';
import { allVisibleSelected, dedupeVerdict, priceCheckUrl, selectedVisible, toggleAllVisible, toggleOne } from './bulk-selection';

const visible = [119, 150, 189, 229];

describe('Sammel-Auswahl Produkte-Tab', () => {
  test('Alle auswählen: leer → alle 4 sichtbaren', () => {
    expect([...toggleAllVisible(new Set(), visible)].sort((a, b) => a - b)).toEqual(visible);
  });
  test('Alle auswählen bei voller Auswahl → abwählen, fremde Auswahl bleibt', () => {
    const r = toggleAllVisible(new Set([...visible, 234]), visible);
    expect([...r]).toEqual([234]);
  });
  test('teilweise ausgewählt → alle dazu', () => {
    expect(allVisibleSelected(toggleAllVisible(new Set([150]), visible), visible)).toBe(true);
  });
  test('leere sichtbare Liste ist nie "alle ausgewählt"', () => {
    expect(allVisibleSelected(new Set([1]), [])).toBe(false);
  });
  test('ausführen nur für sichtbare, in Listenreihenfolge', () => {
    expect(selectedVisible(new Set([229, 234, 119]), visible)).toEqual([119, 229]);
  });
  test('einzeln an/aus', () => {
    expect([...toggleOne(toggleOne(new Set(), 189), 189)]).toEqual([]);
  });
  test('Preis prüfen nur mit Quell-URL', () => {
    expect(priceCheckUrl({ sourceUrl: 'https://de.aliexpress.com/item/1.html' })).toBe('https://de.aliexpress.com/item/1.html');
    expect(priceCheckUrl({ sourceUrl: 'manual' })).toBeNull();
    expect(priceCheckUrl({ sourceUrl: null, amazonUrl: null })).toBeNull();
  });
  test('Dubletten-Einordnung wie POST-Route', () => {
    expect(dedupeVerdict({ changes: [] }, true)).toBe('clean');
    expect(dedupeVerdict({ changes: [1, 2, 3, 4, 5, 6], stillAmbiguous: [] }, true)).toBe('fixable');
    expect(dedupeVerdict({ changes: [1], stillAmbiguous: [{}] }, true)).toBe('blocked');
    expect(dedupeVerdict({ error: 'ruht' }, false)).toBe('error');
  });
});
