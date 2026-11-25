// P-2611-25B GPSR-PLZ: Feld „PLZ + Stadt“ aus der Adresse befüllen, ohne zu raten; sonst „PLZ fehlt“ + Knopf „PLZ suchen“.
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { postalCityFromAddress, parseGpsrRaw } from '../../shared/gpsr-parser';
import { plzFeldStatus, plzSucheUrl, PLZ_FEHLT } from '../../shared/gpsr-plz';
import { effectiveForm, fieldProblems, emptyOverrides } from '../../shared/gpsr-import-fields';
import { gpsrCompleteGate } from '../../shared/gpsr-import-gate';
import { GpsrFieldsEditor } from './gpsr-fields-editor';

const MADRID = 'EC REP SERVICES SL, Calle Gran Via 49, Madrid 28013';

describe('Auftrag Punkt 4 – die drei Pflichtfälle', () => {
  test('„EC REP SERVICES SL, Calle Gran Via 49, Madrid 28013“ → „28013 Madrid“', () => {
    expect(postalCityFromAddress(MADRID)).toBe('28013 Madrid');
    expect(plzFeldStatus('', MADRID)).toEqual({ ausAdresse: '28013 Madrid', hinweis: null });
  });
  test('Adresse ohne Postleitzahl → „PLZ fehlt“', () => {
    expect(plzFeldStatus('', 'Calle Gran Via 49, Madrid')).toEqual({ ausAdresse: null, hinweis: PLZ_FEHLT });
    expect(PLZ_FEHLT).toBe('PLZ fehlt');
  });
  test('„Yiwu City“ ohne Postleitzahl → „PLZ fehlt“ und der Knopf ist sichtbar', () => {
    expect(plzFeldStatus('Yiwu City', 'No. 88 Chouzhou Road, Yiwu City', { manufacturer: true })).toEqual({ ausAdresse: null, hinweis: PLZ_FEHLT });
    const html = renderToStaticMarkup(createElement(GpsrFieldsEditor, {
      raw: '', theme: 'light', onChange: () => {},
      overrides: { eu: {}, mfr: { name: 'Yiwu Beispiel Trading Co., Ltd', address: 'No. 88 Chouzhou Road', city: 'Yiwu City', country: 'CN', email: 'a@b.cn' } },
    }));
    expect(html).toContain('PLZ fehlt');
    expect((html.match(/data-testid="plz-suchen"/g) ?? []).length).toBe(2); // Hersteller + EU-Person
    expect(html).toContain('Yiwu+Beispiel+Trading+Co.%2C+Ltd+No.+88+Chouzhou+Road+Yiwu+City+Postleitzahl');
  });
});

describe('Auslesen ohne Raten', () => {
  test('vorwärts „60325 Frankfurt am Main“ bleibt wie bisher', () => {
    expect(postalCityFromAddress('Bockenheimer Landstraße 2, 60325 Frankfurt am Main')).toBe('60325 Frankfurt am Main');
  });
  test('Stadt wird so geschrieben wie in der Adresse (keine Übersetzung)', () => {
    expect(postalCityFromAddress('ul. Marszałkowska 10, Warszawa 00-590')).toBe('00-590 Warszawa');
  });
  test('Länder-Segment am Ende wird abgezogen, nie als Stadt übernommen', () => {
    expect(postalCityFromAddress('Calle Gran Via 49, Madrid 28013, Spain')).toBe('28013 Madrid');
    expect(postalCityFromAddress('Calle Gran Via 49, Spain 28013')).toBeNull();
  });
  test('Hausnummer hinter Straßen-/Zimmerwort ist keine PLZ', () => {
    expect(postalCityFromAddress('Yiwu City, Huacheng Road 1188', { manufacturer: true })).toBeNull();
    expect(postalCityFromAddress('Bao An, Room 1001')).toBeNull();
    expect(postalCityFromAddress('Musterfirma, Calle 2801')).toBeNull();
  });
  test('Korrektur 1 (Aufsicht 10:40): Gebäude-/Gewerbe-Wörter und 4-stellige Zahlen ohne Land sind keine PLZ', () => {
    expect(postalCityFromAddress('EC REP, Tower 2088')).toBeNull();
    expect(postalCityFromAddress('Firma, Gewerbepark 1234')).toBeNull();
    expect(postalCityFromAddress('Musterweg 12, Gewerbepark 12345')).toBeNull();
    expect(postalCityFromAddress('Calle Gran Via 49, Madrid 28013')).toBe('28013 Madrid');
    expect(postalCityFromAddress('Firma, Lindenallee 12345')).toBeNull();
    expect(postalCityFromAddress('EC REP, Tower 20885')).toBeNull();
    expect(postalCityFromAddress('Firma, Industrial Zone 51800')).toBeNull();
    // echte Adresse aus der Live-DB (25.11.): Provinz ist keine Stadt
    expect(postalCityFromAddress('Taihang Road in Qinghe County, Xingtai City, Hebei Province 054800', { manufacturer: true })).toBeNull();
    expect(postalCityFromAddress('Firma, Wien 1010')).toBeNull();               // 4-stellig ohne Land → nicht raten
    expect(postalCityFromAddress('Stephansplatz 1, Wien 1010, Austria')).toBe('1010 Wien'); // 4-stellig mit Land → ok
  });
  test('ohne Komma (nur ein Segment) wird nichts geraten', () => {
    expect(postalCityFromAddress('Madrid 28013')).toBeNull();
  });
  test('6-stellige PLZ nur beim Hersteller', () => {
    expect(postalCityFromAddress('No. 88 Chouzhou Road, Yiwu 322000', { manufacturer: true })).toBe('322000 Yiwu');
    expect(postalCityFromAddress('No. 88 Chouzhou Road, Yiwu 322000')).toBeNull();
  });
  test('Feld mit gültigem Wert wird nicht angefasst', () => {
    expect(plzFeldStatus('28001 Madrid', MADRID)).toEqual({ ausAdresse: null, hinweis: null });
  });
  test('Import aus dem Rohtext erkennt „Stadt PLZ“ jetzt auch', () => {
    const g = parseGpsrRaw('Verantwortliche Person in der EU\nName: EC REP SERVICES SL\nAdresse: Calle Gran Via 49, Madrid 28013\nE-Mail: info@ecrep.es');
    expect(g.city).toBe('28013 Madrid');
    expect(g.address).toBe('Calle Gran Via 49');
  });
});

describe('Formular und Sperre', () => {
  test('Import-Tab: leeres Feld wird aus der eingetragenen Straße befüllt', () => {
    const f = effectiveForm('', { eu: { name: 'EC REP SERVICES SL', address: 'Calle Gran Via 49, Madrid 28013' }, mfr: {} });
    expect(f.eu.city).toBe('28013 Madrid');
    expect(fieldProblems(f).eu.city).toBeUndefined();
  });
  test('Import-Tab: Eingabe des Nutzers hat Vorrang', () => {
    const f = effectiveForm('', { eu: { address: 'Calle Gran Via 49, Madrid 28013', city: '28001 Madrid' }, mfr: {} });
    expect(f.eu.city).toBe('28001 Madrid');
  });
  test('Feldtext „PLZ fehlt“ bei leerem Feld und bei Stadt ohne Ziffer', () => {
    expect(fieldProblems(effectiveForm('', emptyOverrides())).eu.city).toBe(PLZ_FEHLT);
    expect(fieldProblems(effectiveForm('', { eu: { city: 'Madrid' }, mfr: {} })).eu.city).toBe(PLZ_FEHLT);
    expect(fieldProblems(effectiveForm('', { eu: {}, mfr: { name: 'M', address: 'Road 9', city: 'Yiwu City', country: 'CN' } })).mfr.city).toBe(PLZ_FEHLT);
  });
  test('ohne PLZ bleibt das Einstellen gesperrt (A-040-Sperre)', () => {
    const base = { gpsrRaw: null, gpsrName: 'EC REP SERVICES SL', gpsrAddress: 'Calle Gran Via 49', gpsrCountry: 'ES', gpsrEmail: 'info@ecrep.es', gpsrPhone: null,
      gpsrMfrName: 'Yiwu Beispiel Trading Co., Ltd', gpsrMfrAddress: 'No. 88 Chouzhou Road', gpsrMfrCountry: 'CN', gpsrMfrEmail: 'a@b.cn', gpsrMfrPhone: null, gpsrMfrUrl: null };
    expect(gpsrCompleteGate({ ...base, gpsrCity: '28013 Madrid', gpsrMfrCity: 'Yiwu City' } as never).ok).toBe(false);
    expect(gpsrCompleteGate({ ...base, gpsrCity: '', gpsrMfrCity: '322000 Yiwu' } as never).ok).toBe(false);
    expect(gpsrCompleteGate({ ...base, gpsrCity: '28013 Madrid', gpsrMfrCity: '322000 Yiwu' } as never).ok).toBe(true);
  });
  test('Such-Link: Firma + Straße + Stadt + „Postleitzahl“, nichts weiter', () => {
    expect(plzSucheUrl('EC REP SERVICES SL', 'Calle Gran Via 49', 'Madrid'))
      .toBe('https://www.google.com/search' + '?q=EC+REP+SERVICES+SL+Calle+Gran+Via+49+Madrid+Postleitzahl');
  });
});
