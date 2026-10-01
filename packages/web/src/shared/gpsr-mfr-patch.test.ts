import { describe, expect, it } from 'bun:test';
import { parseMfrPatch } from './gpsr-mfr-patch';

describe('parseMfrPatch (A-008)', () => {
  it('trimmt, leere Strings und null werden zu null; nur gesendete Schlüssel erscheinen', () => {
    const r = parseMfrPatch({ gpsrMfrName: '  Maker Co ', gpsrMfrAddress: '   ', gpsrMfrEmail: null, other: 'x' });
    expect(r).toEqual({ ok: true, fields: { gpsrMfrName: 'Maker Co', gpsrMfrAddress: null, gpsrMfrEmail: null } });
  });
  it('Land: ISO-2, Kleinschreibung wird normalisiert, leer = null, kein EU-Zwang (CN erlaubt)', () => {
    expect(parseMfrPatch({ gpsrMfrCountry: 'cn' })).toEqual({ ok: true, fields: { gpsrMfrCountry: 'CN' } });
    expect(parseMfrPatch({ gpsrMfrCountry: '' })).toEqual({ ok: true, fields: { gpsrMfrCountry: null } });
  });
  it('Land ungültig (nicht 2 Buchstaben) → Fehler', () => {
    expect(parseMfrPatch({ gpsrMfrCountry: 'China' })).toEqual({ ok: false, error: '"gpsrMfrCountry" muss ein zweistelliger Ländercode sein (z. B. CN)' });
  });
  it('URL nur http(s)', () => {
    expect(parseMfrPatch({ gpsrMfrUrl: 'https://maker.example/kontakt' }).ok).toBe(true);
    expect(parseMfrPatch({ gpsrMfrUrl: 'javascript:alert(1)' })).toEqual({ ok: false, error: '"gpsrMfrUrl" muss mit http:// oder https:// beginnen' });
  });
  it('E-Mail ohne gültiges Format und zu lange Werte werden abgelehnt', () => {
    expect(parseMfrPatch({ gpsrMfrEmail: 'keine-mail' })).toEqual({ ok: false, error: '"gpsrMfrEmail" ist keine gültige E-Mail-Adresse' });
    expect(parseMfrPatch({ gpsrMfrEmail: 'a@b.cn' }).ok).toBe(true);
    expect(parseMfrPatch({ gpsrMfrName: 'x'.repeat(101) })).toEqual({ ok: false, error: '"gpsrMfrName" ist zu lang (max. 100 Zeichen)' });
  });
  it('falscher Typ → Fehler mit Feldname', () => {
    expect(parseMfrPatch({ gpsrMfrName: 5 })).toEqual({ ok: false, error: '"gpsrMfrName" muss ein Text oder null sein' });
  });
});
