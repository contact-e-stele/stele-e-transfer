import { describe, expect, it } from 'bun:test';
import { gpsrAmpel } from './gpsr-ampel';

// A-008 Teil 3c — Ampel nach A-006 Antwort 5.
const eu = { gpsrRaw: null, gpsrName: 'EU GmbH', gpsrAddress: 'Hauptstr 1', gpsrCity: '10115 Berlin', gpsrEmail: 'eu@example.de', gpsrPhone: null, gpsrCountry: 'DE' };
const mfr = { gpsrMfrName: 'Maker Co', gpsrMfrAddress: 'Road 9', gpsrMfrCity: '518000 Shenzhen', gpsrMfrCountry: 'CN', gpsrMfrEmail: 'm@maker.cn', gpsrMfrPhone: null, gpsrMfrUrl: null };

describe('gpsrAmpel', () => {
  it('EU vollständig + Hersteller vollständig (mit E-Mail) → GRÜN', () => {
    const a = gpsrAmpel({ ...eu, ...mfr });
    expect(a.overall).toBe('GRUEN');
    expect(a.eu).toEqual({ ampel: 'GRUEN', missing: [] });
    expect(a.manufacturer.ampel).toBe('GRUEN');
  });
  it('Hersteller vollständig, nur Kontakt-URL statt E-Mail → GRÜN', () => {
    expect(gpsrAmpel({ ...eu, ...mfr, gpsrMfrEmail: null, gpsrMfrUrl: 'https://maker.example' }).overall).toBe('GRUEN');
  });
  it('Hersteller vollständig, weder E-Mail noch URL → GELB mit Klartext', () => {
    const a = gpsrAmpel({ ...eu, ...mfr, gpsrMfrEmail: null });
    expect(a.manufacturer.ampel).toBe('GELB');
    expect(a.manufacturer.missing).toEqual(['Hersteller: E-Mail oder Kontakt-URL fehlt']);
    expect(a.overall).toBe('GELB');
  });
  it('kein Hersteller (nur EU-Person) → GELB', () => {
    const a = gpsrAmpel({ ...eu });
    expect(a.manufacturer.ampel).toBe('GELB');
    expect(a.manufacturer.missing[0]).toContain('Hersteller fehlt');
    expect(a.overall).toBe('GELB');
  });
  it('Hersteller nur mit Name, ohne jede Anschrift → GELB', () => {
    const a = gpsrAmpel({ ...eu, gpsrMfrName: 'Nur Name' });
    expect(a.manufacturer.ampel).toBe('GELB');
    expect(a.manufacturer.halbeAdresse).toBe(false);
  });
  it('halbe Hersteller-Adresse (Straße da, PLZ/Ort + Land fehlen) → ROT, 25110-Hinweis, Klartext je Feld', () => {
    const a = gpsrAmpel({ ...eu, gpsrMfrName: 'Halb Co', gpsrMfrAddress: 'Road 9' });
    expect(a.manufacturer.ampel).toBe('ROT');
    expect(a.manufacturer.halbeAdresse).toBe(true);
    expect(a.manufacturer.missing.slice(0, 3)).toEqual(['Hersteller: PLZ und Ort fehlt', 'Hersteller: Land fehlt', 'Halbe Hersteller-Adresse (25110-Risiko: alles oder nichts)']);
    expect(a.manufacturer.missing[3]).toContain('Import und neues Listen sind gesperrt');
    expect(a.overall).toBe('ROT');
  });
  it('EU-Person ohne Land → ROT mit Klartext, unabhängig vom Hersteller', () => {
    const a = gpsrAmpel({ ...eu, gpsrCountry: null, ...mfr });
    expect(a.eu.ampel).toBe('ROT');
    expect(a.eu.missing.join(' ')).toContain('Land der verantwortlichen Person');
    expect(a.overall).toBe('ROT');
  });
  it('EU-Person ohne E-Mail → ROT', () => {
    expect(gpsrAmpel({ ...eu, gpsrEmail: null }).eu.ampel).toBe('ROT');
  });
  it('EU-E-Mail ohne gültiges Format → ROT', () => {
    const a = gpsrAmpel({ ...eu, gpsrEmail: 'keine-mail' });
    expect(a.eu.ampel).toBe('ROT');
    expect(a.eu.missing).toEqual(['EU-Person: E-Mail hat kein gültiges Format']);
  });
  it('Hersteller-Name == EU-Person-Name bei Sitz außerhalb der EU → ROT', () => {
    const a = gpsrAmpel({ ...eu, ...mfr, gpsrMfrName: 'eu gmbh' });
    expect(a.manufacturer.ampel).toBe('ROT');
    expect(a.manufacturer.missing[0]).toContain('identisch mit der EU-Person');
  });
  it('Hersteller-Name über 100 Zeichen → ROT', () => {
    const a = gpsrAmpel({ ...eu, ...mfr, gpsrMfrName: 'x'.repeat(101) });
    expect(a.manufacturer.ampel).toBe('ROT');
  });
});
