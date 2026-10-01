import { describe, expect, it } from 'bun:test';
import { resolveGpsrForListing } from './gpsr-parser';
import { buildRegulatoryBlock } from '../api/ebay';

// A-008 Teil 3d: Hersteller aus den gespeicherten DB-Feldern (Vorrang), Rohtext nur als belegter Fallback.
const EU_BLOCK = 'Informationen zum EU-Verantwortlichen\nName: EU GmbH\nAdresse: Hauptstr 1, 10115 Berlin, Deutschland\nE-Mail: eu@example.de';
const RAW_MIT_HERSTELLER = 'Herstellerinformationen\nName: Raw Maker Ltd\nAdresse: Building 2, Longgang District, Shenzhen, 518000, China\nE-Mail: raw@maker.cn\n\n' + EU_BLOCK;
const RAW_OHNE_LAND = RAW_MIT_HERSTELLER.replace(', China', '');
const noStored = { gpsrName: null, gpsrAddress: null, gpsrCity: null, gpsrEmail: null, gpsrPhone: null, gpsrCountry: null };
const fullMfr = { gpsrMfrName: 'Stored Maker Co', gpsrMfrAddress: 'Road 9', gpsrMfrCity: '518000 Shenzhen', gpsrMfrCountry: 'CN', gpsrMfrEmail: 'st@maker.cn', gpsrMfrPhone: null, gpsrMfrUrl: 'https://maker.example/contact' };

describe('resolveGpsrForListing — A-008 Herstellerfelder', () => {
  it('gespeicherte Felder haben Vorrang vor dem Rohtext', () => {
    const r = resolveGpsrForListing({ gpsrRaw: RAW_MIT_HERSTELLER, ...noStored, ...fullMfr });
    expect(r.manufacturer).toMatchObject({ name: 'Stored Maker Co', address: 'Road 9', postalCode: '518000', city: 'Shenzhen', country: 'CN', email: 'st@maker.cn', url: 'https://maker.example/contact' });
    expect(r.manufacturerMissing).toEqual([]);
  });
  it('leere gespeicherte Felder: Fallback auf den (per Titel belegten) Rohtext → vollständig', () => {
    const r = resolveGpsrForListing({ gpsrRaw: RAW_MIT_HERSTELLER, ...noStored });
    expect(r.manufacturer).toMatchObject({ name: 'Raw Maker Ltd', postalCode: '518000', city: 'Shenzhen', country: 'CN' });
  });
  it('Rohtext ohne Länderwort: unvollständig, Land benannt (nie aus der Stadt geraten)', () => {
    const r = resolveGpsrForListing({ gpsrRaw: RAW_OHNE_LAND, ...noStored });
    expect(r.manufacturer).toBeNull();
    expect(r.manufacturerMissing).toEqual(['Land']);
  });
  it('Land von Hand ergänzt + Rest aus dem Rohtext → vollständig', () => {
    const r = resolveGpsrForListing({ gpsrRaw: RAW_OHNE_LAND, ...noStored, gpsrMfrCountry: 'CN' });
    expect(r.manufacturer).toMatchObject({ name: 'Raw Maker Ltd', postalCode: '518000', city: 'Shenzhen', country: 'CN' });
  });
  it('kein Fallback auf den Rohtext, wenn die Herstellerzuordnung nicht per Titel belegt ist (EU-Person nie als Hersteller)', () => {
    const untitled = 'Name: A Ltd\nAdresse: Weg 1, 10115 Berlin, DE\nE-Mail: a@b.de\n\nName: B Ltd\nAdresse: Weg 2, 20095 Hamburg, DE\nE-Mail: b@c.de';
    const r = resolveGpsrForListing({ gpsrRaw: untitled, ...noStored });
    expect(r.manufacturer).toBeNull();
    expect(r.manufacturerMissing).toEqual([]);
  });
  it('Hersteller-Name == EU-Person-Name bei Sitz außerhalb der EU → nicht senden, Klartext', () => {
    const r = resolveGpsrForListing({ gpsrRaw: EU_BLOCK, gpsrName: 'Gleich Ltd', gpsrAddress: 'Weg 1', gpsrCity: '10115 Berlin', gpsrEmail: 'e@e.de', gpsrPhone: null, gpsrCountry: 'DE',
      ...fullMfr, gpsrMfrName: 'gleich ltd' });
    expect(r.eu).not.toBeNull();
    expect(r.manufacturer).toBeNull();
    expect(r.manufacturerMissing.join(' ')).toContain('identisch mit der EU-Person');
  });
  it('Hersteller in der EU mit gleichem Namen wie die EU-Person ist erlaubt (ein Block)', () => {
    const r = resolveGpsrForListing({ gpsrRaw: EU_BLOCK, gpsrName: 'Gleich GmbH', gpsrAddress: 'Weg 1', gpsrCity: '10115 Berlin', gpsrEmail: 'e@e.de', gpsrPhone: null, gpsrCountry: 'DE',
      gpsrMfrName: 'Gleich GmbH', gpsrMfrAddress: 'Weg 1', gpsrMfrCity: '10115 Berlin', gpsrMfrCountry: 'DE', gpsrMfrEmail: null, gpsrMfrPhone: null, gpsrMfrUrl: null });
    expect(r.manufacturer).not.toBeNull();
  });
  it('halbe Herstelleradresse (nur Straße) → manufacturer null, genau die fehlenden Felder benannt (25110-Schutz)', () => {
    const r = resolveGpsrForListing({ gpsrRaw: EU_BLOCK, ...noStored, gpsrMfrName: 'Halb Co', gpsrMfrAddress: 'Road 9' });
    expect(r.manufacturer).toBeNull();
    expect(r.manufacturerMissing).toEqual(['PLZ und Ort', 'Land']);
  });
});

describe('buildRegulatoryBlock — A-008 Herstellerblock', () => {
  const base = { gpsrRaw: EU_BLOCK, gpsrName: 'EU GmbH', gpsrAddress: 'Hauptstr 1', gpsrCity: '10115 Berlin', gpsrEmail: 'eu@example.de', gpsrPhone: null, gpsrCountry: 'DE' };
  it('mit vollständigem Hersteller: manufacturer im Block inkl. contactUrl; EU-Person bleibt getrennt', () => {
    const b = buildRegulatoryBlock(resolveGpsrForListing({ ...base, ...fullMfr })) as any;
    expect(b.responsiblePersons[0]).toMatchObject({ companyName: 'EU GmbH', types: ['EU_RESPONSIBLE_PERSON'] });
    expect(b.manufacturer).toMatchObject({ companyName: 'Stored Maker Co', postalCode: '518000', city: 'Shenzhen', country: 'CN', contactUrl: 'https://maker.example/contact' });
    expect(b.responsiblePersons[0].companyName).not.toBe(b.manufacturer.companyName);
  });
  it('ohne (vollständigen) Hersteller: kein manufacturer-Schlüssel', () => {
    const b = buildRegulatoryBlock(resolveGpsrForListing({ ...base, gpsrMfrName: 'Halb Co' })) as any;
    expect(b.manufacturer).toBeUndefined();
    expect(b.responsiblePersons.length).toBe(1);
  });
  it('EU-Person ROT (Pflichtfeld fehlt) → buildRegulatoryBlock wirft wie bisher (Listen/Nachziehen 422)', () => {
    expect(() => buildRegulatoryBlock(resolveGpsrForListing({ ...base, gpsrEmail: null, gpsrRaw: null, ...fullMfr }))).toThrow(/GPSR-Pflichtangaben fehlen/);
  });
});
