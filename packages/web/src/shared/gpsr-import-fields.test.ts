import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  resolveMfrUpdateFields, overridesToFlat, crossCheckParties, parserPrefill, effectiveForm, toFlatFields, ampelForForm, emptyOverrides, resolveMfrImportFields, resolveEuImportFields,
  validateGpsrFlat, fieldProblems, buildPartyOptions, sortMfrOptions, nameMismatchWarning, canAdoptAsManufacturer, rawPartyNames,
  type GpsrFormOverrides,
} from './gpsr-import-fields';
import { gpsrFieldsFromRaw } from './gpsr-parser';

// Echter gpsr_raw von Produkt 92 (Produktions-DB, 01.10.2026): Hersteller mit 6-stelliger PLZ, aber ohne Land; EU-Person in Paris.
const RAW_92 = 'Herstellerinformationen\nName: Shenzhen Youtuobang Technology Co., Ltd\nAdresse: 208B, Yizhe Building, Yuquan Road, Nantou Street, Nanshan District, Shenzhen, 518000\nE-Mail: youtbus@163.com\nTelefon: 18988523813\n\n\nAngaben zur verantwortlichen Person in der EU\nName: GLOBAL ONE SOLUTION LTD\nAdresse: 6 rue d\'Armaillé 75017 Paris, Frankreich\nE-Mail: GOS.business@hotmail.com\nTelefon: +34 615 561159';

describe('parserPrefill / effectiveForm', () => {
  it('Produkt 92: Hersteller und EU-Person getrennt vorbefüllt, Hersteller-Land bleibt leer (nie geraten)', () => {
    const f = parserPrefill(RAW_92);
    expect(f.mfr).toMatchObject({ name: 'Shenzhen Youtuobang Technology Co., Ltd', city: '518000 Shenzhen', country: '', email: 'youtbus@163.com' });
    expect(f.eu).toMatchObject({ name: 'GLOBAL ONE SOLUTION LTD', city: '75017 Paris', country: 'FR', email: 'GOS.business@hotmail.com' });
  });
  it('Feldwert schlägt den Parser, leerer Override fällt auf den Parser zurück', () => {
    const ov: GpsrFormOverrides = { eu: { phone: '+33 1 23', email: '  ' }, mfr: { country: 'cn' } };
    const f = effectiveForm(RAW_92, ov);
    expect(f.eu.phone).toBe('+33 1 23');
    expect(f.eu.email).toBe('GOS.business@hotmail.com');
    expect(f.mfr.country).toBe('cn');
  });
  it('leerer Rohtext: alles leer', () => {
    const f = parserPrefill('');
    expect(Object.values(f.eu).every(v => v === '')).toBe(true);
    expect(Object.values(f.mfr).every(v => v === '')).toBe(true);
  });
});

describe('ampelForForm — live aus den Feldern (dieselbe Funktion wie der Produkte-Tab)', () => {
  it('Produkt 92 nur aus dem Rohtext: EU grün, Hersteller ROT (halbe Adresse: Land fehlt)', () => {
    const a = ampelForForm(RAW_92, effectiveForm(RAW_92, emptyOverrides()));
    expect(a.eu.ampel).toBe('GRUEN');
    expect(a.manufacturer.ampel).toBe('ROT');
    expect(a.manufacturer.missing).toContain('Hersteller: Land fehlt');
  });
  it('Land von Hand im Feld ergänzt → Ampel komplett GRÜN', () => {
    const a = ampelForForm(RAW_92, effectiveForm(RAW_92, { eu: {}, mfr: { country: 'CN' } }));
    expect(a.overall).toBe('GRUEN');
  });
});

describe('Import-Vorrang (Server)', () => {
  it('Hersteller: Feldwerte vor Parser, Parser füllt Lücken (gleicher Hersteller)', () => {
    const r = resolveMfrImportFields(RAW_92, { gpsrMfrCountry: 'CN', gpsrMfrEmail: 'neu@maker.cn' });
    expect(r).toMatchObject({ gpsrMfrName: 'Shenzhen Youtuobang Technology Co., Ltd', gpsrMfrCity: '518000 Shenzhen', gpsrMfrCountry: 'CN', gpsrMfrEmail: 'neu@maker.cn' });
  });
  it('anderer Hersteller im Formular: KEINE Parser-Felder dazugemischt', () => {
    const r = resolveMfrImportFields(RAW_92, { gpsrMfrName: 'Ganz anderer Hersteller GmbH', gpsrMfrCountry: 'CN' });
    expect(r).toEqual({ gpsrMfrName: 'Ganz anderer Hersteller GmbH', gpsrMfrCountry: 'CN' });
  });
  it('Re-Import (Update): Formularwerte gelten, Parser füllt nur Leeres, nie einen anderen Hersteller dazu', () => {
    const same = resolveMfrUpdateFields({ gpsrMfrName: 'Shenzhen Youtuobang Technology Co., Ltd', gpsrMfrEmail: 'alt@maker.cn' }, RAW_92, { gpsrMfrCountry: 'CN' });
    expect(same).toMatchObject({ gpsrMfrCountry: 'CN', gpsrMfrCity: '518000 Shenzhen' });
    expect(same.gpsrMfrEmail).toBeUndefined();
    expect(same.gpsrMfrName).toBeUndefined();
    const other = resolveMfrUpdateFields({ gpsrMfrName: 'Hand gepflegter Hersteller GmbH' }, RAW_92, { gpsrMfrCountry: 'CN' });
    expect(other).toEqual({ gpsrMfrCountry: 'CN' });
    const renamed = resolveMfrUpdateFields({ gpsrMfrName: 'Shenzhen Youtuobang Technology Co., Ltd' }, RAW_92, { gpsrMfrName: 'Neuer Hersteller AG' });
    expect(renamed).toEqual({ gpsrMfrName: 'Neuer Hersteller AG' });
  });
  it('overridesToFlat: nur echte Eingaben, nie die Parser-Vorbefüllung; Land wird groß gespeichert', () => {
    expect(overridesToFlat({ eu: { name: ' E GmbH ', country: 'es', phone: '' }, mfr: { country: 'cn' } })).toEqual({ gpsrName: 'E GmbH', gpsrCountry: 'ES', gpsrMfrCountry: 'CN' });
    expect(overridesToFlat(emptyOverrides())).toEqual({});
  });
  it('Re-Import ohne Eingaben: Hand-Pflege in der DB bleibt unberührt (Straße, Telefon, Land von Hand korrigiert)', () => {
    const existing = { gpsrMfrName: 'Shenzhen Youtuobang Technology Co., Ltd', gpsrMfrAddress: 'Von Hand korrigierte Straße 5', gpsrMfrPhone: '+86 111', gpsrMfrCountry: 'CN', gpsrMfrCity: '518000 Shenzhen' };
    const r = resolveMfrUpdateFields(existing, RAW_92, overridesToFlat(emptyOverrides()));
    expect(r.gpsrMfrAddress).toBeUndefined();
    expect(r.gpsrMfrPhone).toBeUndefined();
    expect(r.gpsrMfrCountry).toBeUndefined();
    expect(r).toEqual({ gpsrMfrEmail: 'youtbus@163.com' });
  });
  it('crossCheckParties auf Endwerten: gleicher Name, Hersteller-Land leer/außerhalb EU → Fehler; EU-Land oder anderer Name → ok', () => {
    expect(crossCheckParties({ name: 'Gleich GmbH' }, { name: 'gleich ltd', country: 'CN' })).toContain('identisch mit der EU-Person');
    expect(crossCheckParties({ name: 'Gleich GmbH' }, { name: 'gleich ltd', country: null })).toContain('identisch mit der EU-Person');
    expect(crossCheckParties({ name: 'Gleich GmbH' }, { name: 'gleich ltd', country: 'DE' })).toBeNull();
    expect(crossCheckParties({ name: 'A GmbH' }, { name: 'B Ltd', country: 'CN' })).toBeNull();
    expect(crossCheckParties({}, { name: 'B Ltd' })).toBeNull();
  });
  it('EU-Person: anderer Name im Formular → keine Parser-Felder dazugemischt (Server)', () => {
    const r = resolveEuImportFields(gpsrFieldsFromRaw(RAW_92) as never, { gpsrName: 'Fremde EU SARL', gpsrCountry: 'FR' });
    expect(r).toEqual({ gpsrName: 'Fremde EU SARL', gpsrCountry: 'FR' });
  });
  it('Formular: anderer Name (z. B. aus der Auswahlliste) → leere Felder bleiben leer, kein Parser-Telefon/-E-Mail der anderen Person', () => {
    const f = effectiveForm(RAW_92, { eu: { name: 'Fremde EU SARL', address: 'Rue 2', city: '75001 Paris', country: 'FR', email: 'x@fremd.fr' }, mfr: {} });
    expect(f.eu.phone).toBe('');
    expect(f.eu.name).toBe('Fremde EU SARL');
    expect(f.mfr.name).toBe('Shenzhen Youtuobang Technology Co., Ltd');
  });
  it('Formular: gleicher Name (Rechtsform egal) behält den Parser-Fallback', () => {
    const f = effectiveForm(RAW_92, { eu: { name: 'global one solution limited' }, mfr: {} });
    expect(f.eu.email).toBe('GOS.business@hotmail.com');
  });
  it('EU-Person: Feldwert vor Parser', () => {
    const r = resolveEuImportFields(gpsrFieldsFromRaw(RAW_92) as never, { gpsrEmail: 'neu@eu.fr' });
    expect(r.gpsrEmail).toBe('neu@eu.fr');
    expect(r.gpsrName).toBe('GLOBAL ONE SOLUTION LTD');
    expect(r.gpsrCity).toBe('75017 Paris');
  });
  it('toFlatFields lässt leere Felder weg', () => {
    expect(toFlatFields(effectiveForm('', { eu: { name: 'A' }, mfr: {} }))).toEqual({ gpsrName: 'A' });
  });
});

describe('validateGpsrFlat — gleiche Regeln wie Produkte-Tab/Senden', () => {
  it('gültige Werte → keine Fehler', () => {
    expect(validateGpsrFlat({ gpsrName: 'E GmbH', gpsrCity: '10115 Berlin', gpsrCountry: 'DE', gpsrEmail: 'e@e.de', gpsrMfrName: 'M Co', gpsrMfrCity: '518000 Shenzhen', gpsrMfrCountry: 'CN', gpsrMfrEmail: 'm@m.cn' })).toEqual([]);
  });
  it('fehlende Felder sind kein Formatfehler', () => {
    expect(validateGpsrFlat({})).toEqual([]);
    expect(validateGpsrFlat({ gpsrName: 'Nur Name' })).toEqual([]);
  });
  it('EU: Stadt ohne PLZ, Land außerhalb EU, Land kein ISO, E-Mail-Format, zu lang', () => {
    const e = validateGpsrFlat({ gpsrCity: 'Berlin', gpsrCountry: 'CN', gpsrEmail: 'keine-mail', gpsrName: 'x'.repeat(101) });
    expect(e).toContain('EU-Person: PLZ + Stadt muss das Format "PLZ Stadt" haben (z. B. 75017 Paris)');
    expect(e).toContain('EU-Person: Land CN liegt außerhalb der EU/des EWR');
    expect(e).toContain('EU-Person: E-Mail ist keine gültige Adresse');
    expect(e).toContain('EU-Person: Name ist zu lang (max. 100 Zeichen)');
    expect(validateGpsrFlat({ gpsrCountry: 'Deutschland' })).toContain('EU-Person: Land muss ein zweistelliger Ländercode sein');
  });
  it('Hersteller: Land kein ISO, URL, E-Mail, PLZ-Format', () => {
    const e = validateGpsrFlat({ gpsrMfrCountry: 'China', gpsrMfrUrl: 'ftp://x', gpsrMfrEmail: 'kaputt', gpsrMfrCity: 'Shenzhen' });
    expect(e.some(x => x.includes('gpsrMfrCountry'))).toBe(true);
    expect(e.some(x => x.includes('gpsrMfrUrl'))).toBe(true);
    expect(e.some(x => x.includes('gpsrMfrEmail'))).toBe(true);
    expect(e).toContain('Hersteller: PLZ + Stadt muss das Format "PLZ Stadt" haben (z. B. 518000 Shenzhen)');
  });
  it('EU-Person als Hersteller (gleicher Name, Hersteller-Land nicht EU oder leer) → Fehler; mit EU-Land erlaubt', () => {
    const base = { gpsrName: 'Gleich GmbH', gpsrMfrName: 'gleich ltd' };
    expect(validateGpsrFlat({ ...base, gpsrMfrCountry: 'CN' }).join(' ')).toContain('identisch mit der EU-Person');
    expect(validateGpsrFlat({ ...base }).join(' ')).toContain('identisch mit der EU-Person');
    expect(validateGpsrFlat({ ...base, gpsrMfrCountry: 'DE' }).join(' ')).not.toContain('identisch');
  });
});

describe('fieldProblems — rote Felder mit Klartext', () => {
  it('leerer EU-Block: alle Pflichtfelder rot; leerer Hersteller: keine Probleme (GELB, nicht rot)', () => {
    const p = fieldProblems(effectiveForm('', emptyOverrides()));
    expect(Object.keys(p.eu).sort()).toEqual(['address', 'city', 'country', 'email', 'name']);
    expect(p.mfr).toEqual({});
  });
  it('Hersteller mit Straße aber ohne PLZ/Land: genau die fehlenden Adressteile rot (alles oder nichts)', () => {
    const p = fieldProblems(effectiveForm('', { eu: {}, mfr: { name: 'M Co', address: 'Road 9' } }));
    expect(Object.keys(p.mfr).sort()).toEqual(['city', 'country']);
    expect(p.mfr.city).toContain('nur ganz oder gar nicht');
  });
  it('Hersteller nur mit Name: keine roten Felder', () => {
    expect(fieldProblems(effectiveForm('', { eu: {}, mfr: { name: 'Nur Name' } })).mfr).toEqual({});
  });
  it('Produkt 92 aus dem Rohtext: nur das Hersteller-Land ist rot', () => {
    const p = fieldProblems(effectiveForm(RAW_92, emptyOverrides()));
    expect(p.eu).toEqual({});
    expect(Object.keys(p.mfr)).toEqual(['country']);
  });
});

describe('Auswahllisten gespeicherter Personen (Nachtrag)', () => {
  const eu = { gpsrName: 'EU GmbH', gpsrAddress: 'Hauptstr 1', gpsrCity: '10115 Berlin', gpsrEmail: 'eu@example.de', gpsrPhone: null, gpsrCountry: 'DE' };
  const m = { gpsrMfrName: 'Maker Co', gpsrMfrAddress: 'Road 9', gpsrMfrCity: '518000 Shenzhen', gpsrMfrCountry: 'CN', gpsrMfrEmail: 'm@maker.cn', gpsrMfrPhone: null, gpsrMfrUrl: null };
  it('nur vollständige (Ampel grün), ohne Dubletten (Name + Adresse, Rechtsform/Satzzeichen egal)', () => {
    const rows = [
      { gpsrRaw: null, ...eu, ...m },
      { gpsrRaw: null, ...eu, gpsrName: 'EU GmbH.', ...m, gpsrMfrName: 'maker limited' },
      { gpsrRaw: null, ...eu, gpsrEmail: null },
      { gpsrRaw: null, ...eu, gpsrName: 'Kaputte Mail SARL', gpsrAddress: 'Rue 9', gpsrEmail: 'keine-mail' }, // Resolver nimmt sie, die Ampel ist ROT
      { gpsrRaw: null, ...eu, gpsrName: 'Andere EU SARL', gpsrAddress: 'Rue 2', ...m, gpsrMfrCountry: null },
    ];
    const o = buildPartyOptions(rows);
    expect(o.eu.map(x => x.name)).toEqual(['Andere EU SARL', 'EU GmbH']);
    expect(o.mfr.map(x => x.name)).toEqual(['Maker Co']);
    expect(o.eu[1]).toMatchObject({ city: '10115 Berlin', country: 'DE' });
    expect(o.mfr[0]).toMatchObject({ city: '518000 Shenzhen', country: 'CN' });
  });
  it('Dubletten aus der Praxis (5 Schreibweisen von SUCCESS COURIER SL): eine Zeile, die sauberste Straße; andere PLZ bleibt eigener Eintrag', () => {
    const base = { gpsrRaw: null, gpsrName: 'SUCCESS COURIER SL', gpsrCity: '28947 Madrid', gpsrEmail: 'successservice2@hotmail.com', gpsrPhone: null, gpsrCountry: 'ES' };
    const rows = [
      { ...base, gpsrAddress: 'ES-CALLE RIO TORMES NUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada' },
      { ...base, gpsrAddress: 'SUCCESS COURIER SLCALLE RIO TORMES NUM. 1' },
      { ...base, gpsrAddress: 'Calle Rio Tormes Num. 1, Planta 1, Derecha, Oficina 3' },
      { ...base, gpsrName: 'SUCCESSCOURIERSL', gpsrAddress: 'CALLERIOTORMESNUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada' },
      { ...base, gpsrCity: '28001 Madrid', gpsrAddress: 'Calle Otra 5' },
    ];
    const o = buildPartyOptions(rows).eu;
    expect(o.map(x => x.city).sort()).toEqual(['28001 Madrid', '28947 Madrid', '28947 Madrid']);
    expect(o.filter(x => x.city === '28947 Madrid').map(x => x.address).sort()).toEqual(['CALLERIOTORMESNUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada', 'Calle Rio Tormes Num. 1, Planta 1, Derecha, Oficina 3']);
  });
  it('Hersteller-Liste: zuerst gleicher Name wie im Rohtext, dann der Rest', () => {
    const opts = [
      { name: 'Alpha Co', address: 'a', city: '1', country: 'CN', email: '', phone: '', url: '' },
      { name: 'Shenzhen Youtuobang Technology Co., Ltd', address: 'b', city: '2', country: 'CN', email: '', phone: '', url: '' },
      { name: 'Zeta Co', address: 'c', city: '3', country: 'CN', email: '', phone: '', url: '' },
    ];
    expect(sortMfrOptions(opts, rawPartyNames(RAW_92).mfr).map(o => o.name)).toEqual(['Shenzhen Youtuobang Technology Co., Ltd', 'Alpha Co', 'Zeta Co']);
  });
  it('Warnhinweis bei abweichendem Namen, keiner bei gleichem oder fehlendem Rohtext-Namen', () => {
    expect(nameMismatchWarning('Alpha Co', 'Beta Co')).toBe('Gewählt: Alpha Co, Lieferant nennt: Beta Co – bitte prüfen');
    expect(nameMismatchWarning('Beta Co.', 'beta co')).toBeNull();
    expect(nameMismatchWarning('Alpha Co', '')).toBe('Der Lieferant nennt hier keine Person – bitte prüfen, ob diese zum Produkt gehört');
    expect(nameMismatchWarning('', 'Beta Co')).toBeNull();
  });
  it('EU-Person nie in den Hersteller-Block übernehmbar (gleicher Name, Land nicht EU)', () => {
    expect(canAdoptAsManufacturer({ name: 'EU GmbH', country: 'CN' }, 'eu gmbh').ok).toBe(false);
    expect(canAdoptAsManufacturer({ name: 'Maker Co', country: 'CN' }, 'EU GmbH').ok).toBe(true);
    expect(canAdoptAsManufacturer({ name: 'EU GmbH', country: 'DE' }, 'EU GmbH').ok).toBe(true);
  });
});

describe('Import-Tab sendet nur echte Eingaben (Wächter, A-010 Review-Blocker 1)', () => {
  it('lieferanten.tsx nutzt overridesToFlat(gpsrOverrides) und NICHT die Parser-Vorbefüllung (toFlatFields(effectiveForm(…)))', () => {
    const src = readFileSync(resolve(import.meta.dir, '..', 'web', 'pages', 'lieferanten.tsx'), 'utf-8');
    expect(src).toContain('...overridesToFlat(gpsrOverrides)');
    expect(src).not.toContain('toFlatFields(effectiveForm(');
  });
  it('POST /products validiert VOR den Gemini-Aufrufen und prüft die Endwerte (EU-Person nie als Hersteller)', () => {
    const src = readFileSync(resolve(import.meta.dir, '..', 'api', 'index.ts'), 'utf-8');
    const iValidate = src.indexOf('validateGpsrFlat(gpsrBody)');
    const iCross = src.indexOf('crossCheckParties(');
    const iGemini = src.indexOf('generateGermanTitle(rawTitle, specs)');
    expect(iValidate).toBeGreaterThan(0);
    expect(iCross).toBeGreaterThan(iValidate);
    expect(iGemini).toBeGreaterThan(iCross);
  });
});
