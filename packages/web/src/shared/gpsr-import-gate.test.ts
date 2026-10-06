import { describe, expect, test } from 'bun:test';
import { gpsrCompleteGate, gpsrFinalFields } from './gpsr-import-gate';
import type { GpsrProductFields } from './gpsr-parser';

const EU = {
  gpsrName: 'ATTEMIA OU', gpsrAddress: 'Harju maakond, Tallinn, Kesklinna linnaosa, Tornimae tn 5', gpsrCity: '10145 Tallinn',
  gpsrCountry: 'EE', gpsrEmail: 'eu@example.com', gpsrPhone: null,
};
const MFR = {
  gpsrMfrName: 'Yiwu Example Trading Co., Ltd.', gpsrMfrAddress: 'No. 8 Example Road', gpsrMfrCity: '322000 Yiwu',
  gpsrMfrCountry: 'CN', gpsrMfrEmail: 'mfr@example.com', gpsrMfrPhone: null, gpsrMfrUrl: null,
};
const full = (o: Partial<GpsrProductFields> = {}): GpsrProductFields => ({ gpsrRaw: null, ...EU, ...MFR, ...o });

describe('A-040 gpsrCompleteGate — Hersteller UND EU-Person vollständig', () => {
  test('beide vollständig → ok', () => {
    expect(gpsrCompleteGate(full())).toEqual({ ok: true, missing: [] });
  });
  test('Hersteller fehlt ganz → gesperrt (bisher nur GELB, Listen erlaubt)', () => {
    const r = gpsrCompleteGate(full({ gpsrMfrName: null, gpsrMfrAddress: null, gpsrMfrCity: null, gpsrMfrCountry: null, gpsrMfrEmail: null }));
    expect(r.ok).toBe(false);
    expect(r.missing.join(' ')).toContain('Hersteller fehlt');
  });
  test('Hersteller ohne PLZ/Ort → gesperrt, Fehlteil benannt', () => {
    const r = gpsrCompleteGate(full({ gpsrMfrCity: null }));
    expect(r.ok).toBe(false);
    expect(r.missing).toContain('Hersteller: PLZ und Ort fehlt');
    expect(r.missing.some(m => m.startsWith('Folge: '))).toBe(false);
  });
  test('Hersteller ohne E-Mail und ohne Kontakt-URL → gesperrt; mit Kontakt-URL → ok', () => {
    expect(gpsrCompleteGate(full({ gpsrMfrEmail: null })).ok).toBe(false);
    expect(gpsrCompleteGate(full({ gpsrMfrEmail: null, gpsrMfrUrl: 'https://example.com/kontakt' })).ok).toBe(true);
  });
  test('EU-Person ohne PLZ/Stadt (Fall 70/95/121/153/167) → gesperrt', () => {
    const r = gpsrCompleteGate(full({ gpsrCity: null }));
    expect(r.ok).toBe(false);
    expect(r.missing.join(' ')).toContain('PLZ und Stadt der verantwortlichen Person in der EU');
  });
  test('EU-Person außerhalb EU/EWR → gesperrt', () => {
    expect(gpsrCompleteGate(full({ gpsrCountry: 'CN' })).ok).toBe(false);
  });
});

describe('A-040 gpsrFinalFields — Endwerte wie beim Speichern', () => {
  test('Import-Felder überschreiben die DB-Zeile, undefined lässt den DB-Wert stehen', () => {
    const existing = { ...EU, ...MFR, gpsrMfrCity: null, gpsrRaw: 'alt' };
    const f = gpsrFinalFields(existing, undefined, {}, { gpsrMfrCity: '322000 Yiwu' });
    expect(f.gpsrMfrCity).toBe('322000 Yiwu');
    expect(f.gpsrName).toBe('ATTEMIA OU');
    expect(f.gpsrRaw).toBe('alt');
    expect(gpsrCompleteGate(f).ok).toBe(true);
  });
  test('explizites null aus dem Parser (Land) löscht den DB-Wert → gesperrt', () => {
    const f = gpsrFinalFields({ ...EU, ...MFR }, 'neu', { gpsrCountry: null }, {});
    expect(f.gpsrCountry).toBeNull();
    expect(f.gpsrRaw).toBe('neu');
    expect(gpsrCompleteGate(f).ok).toBe(false);
  });
  test('neues Produkt ohne GPSR-Angaben → gesperrt', () => {
    expect(gpsrCompleteGate(gpsrFinalFields(undefined, undefined, {}, {})).ok).toBe(false);
  });
});

describe('A-040 Verdrahtung (Wächter)', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { resolve } = require('path') as typeof import('path');
  const idx = readFileSync(resolve(import.meta.dir, '..', 'api', 'index.ts'), 'utf-8');
  const lief = readFileSync(resolve(import.meta.dir, '..', 'web', 'pages', 'lieferanten.tsx'), 'utf-8');
  test('POST /products sperrt VOR Gemini und VOR dem Speichern (422), ohne Override-Ausnahme', () => {
    const iGate = idx.indexOf('gpsrCompleteGate(gpsrFinal)');
    expect(iGate).toBeGreaterThan(0);
    expect(iGate).toBeLessThan(idx.indexOf('generateGermanTitle(rawTitle, specs)'));
    expect(iGate).toBeLessThan(idx.indexOf('db.insert(schema.products)'));
    expect(idx.slice(iGate, iGate + 300)).toContain('if (!gpsrGate.ok) return c.json(');
    expect(idx.slice(iGate, iGate + 300)).toContain('422');
    expect(idx.slice(iGate - 200, iGate + 300)).not.toContain('complianceOverride');
  });
  test('Listen sperrt bei unvollständigem Hersteller (vor dem eBay-Aufruf)', () => {
    const iList = idx.indexOf('gpsrCompleteGate(product)');
    expect(iList).toBeGreaterThan(0);
    expect(idx.slice(iList, iList + 400)).toContain('if (!gpsrListGate.ok) {');
    expect(idx.slice(iList, iList + 600)).toContain('}, 400);');
  });
  test('Import-Tab: Speichern-Knopf gesperrt + Rücksprung in handleSave auch mit Override', () => {
    expect(lief).toContain('complianceBlocked || gpsrBlocked}');
    expect(lief).toContain('if (gpsrBlocked) return;');
  });
});
