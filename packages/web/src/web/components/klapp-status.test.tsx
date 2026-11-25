// P-2611-25E: Produkte-Tab auf-/zuklappbar (Standard ZU, ROT öffnet sich) + Lagerort-Feld auffindbar.
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  klappDefaultOpen, electricKlappStatus, originRowsForDisplay, lagerortHinweis, lagerortIsoFromError, lagerortLink, lagerortIsoFromHash, FIXED_ORIGIN_ROWS,
} from '../../shared/klapp-status';
import { ProductDataPanel } from './product-data-panel';
import { ElectricPanel } from './electric-panel';
import { PflichtVorschlagPanel } from './pflicht-vorschlag-panel';

const noGate = { blocked: false, reasons: [], message: null };
const html = (el: unknown) => renderToStaticMarkup(el as never);

describe('Regeln', () => {
  test('Standard ZU, nur ROT öffnet', () => {
    expect(['GRUEN', 'GELB', 'GRAU', 'ROT'].map(f => klappDefaultOpen(f as never))).toEqual([false, false, false, true]);
  });
  test('Elektro-Status im Kopf', () => {
    expect(electricKlappStatus(0, noGate)).toEqual({ text: 'kein Elektro-Artikel', farbe: 'GRUEN' });
    expect(electricKlappStatus(null, noGate).farbe).toBe('GRAU');
    expect(electricKlappStatus(1, { blocked: true, reasons: ['WEEE-Reg.-Nr. fehlt'], message: 'Elektro-Sperre: WEEE-Reg.-Nr. fehlt' }))
      .toEqual({ text: 'Elektro-Sperre: WEEE-Reg.-Nr. fehlt', farbe: 'ROT' });
  });
  test('Lagerorte: DE, PL, ES, FR, CZ immer da, weitere dahinter', () => {
    expect(originRowsForDisplay({})).toEqual(['DE', 'PL', 'ES', 'FR', 'CZ']);
    expect(originRowsForDisplay({ IT: { city: 'Milano' }, DE: { city: 'Berlin' } })).toEqual([...FIXED_ORIGIN_ROWS, 'IT']);
  });
  test('Hinweis-Wortlaut und Sprung aus der Fehlermeldung', () => {
    expect(lagerortHinweis('DE')).toBe('Gilt für alle Produkte mit Herkunft DE. Nur echten Versandort des Lieferanten eintragen, nicht die Hersteller-Adresse.');
    const msg = 'Kein Lagerort für Herkunft DE hinterlegt (Einstellungen › Lagerorte: Ort + PLZ des Lieferanten-Lagers) — nicht gelistet, kein Ort wird geraten.';
    expect(lagerortIsoFromError(msg)).toBe('DE');
    expect(lagerortIsoFromError('Elektro-Sperre: WEEE-Reg.-Nr. fehlt')).toBeNull();
    expect(lagerortLink('DE')).toBe('/einstellungen#lagerort-DE');
    expect(lagerortIsoFromHash('#lagerort-DE')).toBe('DE');
    expect(lagerortIsoFromHash('#anders')).toBeNull();
  });
});

describe('Anzeige (gerendert)', () => {
  test('Produktdaten: zu, Ampel R8 im Kopf sichtbar, Felder versteckt', () => {
    const h = html(createElement(ProductDataPanel, { product: { id: 1, variantPrices: '[]' } as never, onSaved: () => {} }));
    expect(h).toContain('▸ 📐 Produktdaten');
    expect(h).toMatch(/R8 (GRÜN|GELB)/);
    expect(h).not.toContain('Einsatzzweck');
  });
  test('Elektro: „kein Elektro-Artikel“ zu, Status im Kopf', () => {
    const h = html(createElement(ElectricPanel, { product: { id: 1, isElectric: 0 } as never, onSaved: () => {} }));
    expect(h).toContain('▸ 🔌 Elektro');
    expect(h).toContain('kein Elektro-Artikel');
    expect(h).not.toContain('Elektro speichern');
  });
  test('Elektro: Sperre (ROT) öffnet von selbst', () => {
    const h = html(createElement(ElectricPanel, { product: { id: 1, isElectric: 1 } as never, onSaved: () => {} }));
    expect(h).toContain('▾ 🔌 Elektro');
    expect(h).toContain('Elektro speichern');
  });
  test('Vorschläge: zu, „nicht geladen“', () => {
    const h = html(createElement(PflichtVorschlagPanel, { product: { id: 1 }, onSaved: () => {} }));
    expect(h).toContain('▸ Vorschläge für fehlende Pflicht-Daten');
    expect(h).toContain('(nicht geladen)');
  });
});
