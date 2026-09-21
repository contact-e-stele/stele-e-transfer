// Paket 3 (A3/F3): Block-Erkennung Hersteller vs. verantwortliche Person in der EU, Land,
// Auflösung der Pflichtangaben fürs Listing, Beschreibungs-Bereinigung.
// Fixtures: echtes Textmuster (Aufbau wie Produkt 70/66: zwei Blöcke, feste Schlüssel).
import { describe, expect, it } from 'bun:test';
import { parseGpsrRaw, resolveGpsrForListing, isPostalCityFormat, EU_EEA_COUNTRIES, gpsrFieldsFromRaw } from './gpsr-parser';
import { buildEbayHTML, buildEbayHTMLLight } from '../web/lib/ebay-description';
import { GPSR_DESCRIPTION_NOTICE, neutralizeGpsrTab, findForeignEmails } from './gpsr-description';

const MANUF = `Informationen zum Hersteller
Name: Shenzhen Beispiel Technology Co., Ltd
Adresse: Building 5, Longgang District, Shenzhen, 518000, China
E-Mail: hersteller@beispiel-cn.com
Telefon: 8613800000000`;
const EU = `Angaben zur verantwortlichen Person in der EU
Name: Niulav UG
Adresse: Michelangelostr. 1/1401, 01217 Dresden, DE(Germany)
E-Mail: Kuland2@web.de
Telefon: 15252064185`;

describe('parseGpsrRaw — beide Blöcke, Hersteller getrennt gehalten', () => {
  const r = parseGpsrRaw(`${MANUF}\n\n${EU}`);
  it('EU-Person landet in den Hauptfeldern, NICHT der Hersteller', () => {
    expect(r.name).toBe('Niulav UG');
    expect(r.email).toBe('Kuland2@web.de');
    expect(r.address).toBe('Michelangelostr. 1/1401');
    expect(r.city).toBe('01217 Dresden');
    expect(r.country).toBe('DE');
    expect(r.euBlockFound).toBe(true);
  });
  it('Hersteller separat', () => {
    expect(r.manufacturer?.name).toBe('Shenzhen Beispiel Technology Co., Ltd');
    expect(r.manufacturer?.email).toBe('hersteller@beispiel-cn.com');
    expect(r.manufacturer?.country).toBe('CN');
  });
});

describe('parseGpsrRaw — vertauschte Reihenfolge (EU-Block zuerst, per Titel erkannt)', () => {
  const r = parseGpsrRaw(`${EU}\n\n${MANUF}`);
  it('nimmt den Block mit dem EU-Titel, nicht den zweiten', () => {
    expect(r.name).toBe('Niulav UG');
    expect(r.email).toBe('Kuland2@web.de');
    expect(r.manufacturer?.name).toBe('Shenzhen Beispiel Technology Co., Ltd');
  });
});

describe('parseGpsrRaw — EU-Block fehlt', () => {
  it('nur Hersteller-Block (Titel): EU-Felder leer, gemeldet, Hersteller NICHT ersatzweise eingetragen', () => {
    const r = parseGpsrRaw(MANUF);
    expect(r.name).toBeNull();
    expect(r.email).toBeNull();
    expect(r.address).toBeNull();
    expect(r.euBlockFound).toBe(false);
    expect(r.manufacturer?.name).toBe('Shenzhen Beispiel Technology Co., Ltd');
    expect(r.notes.join(' ')).toContain('EU');
  });
  it('einzelner Block ohne Titel: nicht zuordenbar, alles leer', () => {
    const r = parseGpsrRaw('Name: Irgendwer\nAdresse: Musterstr. 1, 12345 Musterstadt\nE-Mail: a@b.de');
    expect(r.name).toBeNull();
    expect(r.manufacturer).toBeNull();
    expect(r.euBlockFound).toBe(false);
  });
});

describe('resolveGpsrForListing — Pflichtangaben', () => {
  const full = { gpsrRaw: `${MANUF}\n\n${EU}`, gpsrName: null, gpsrAddress: null, gpsrCity: null, gpsrEmail: null, gpsrPhone: null };
  it('leere Einzelfelder werden aus dem Rohtext ergänzt (ohne DB-Schreiben)', () => {
    const r = resolveGpsrForListing(full);
    expect(r.missing).toEqual([]);
    expect(r.eu).toEqual({ name: 'Niulav UG', address: 'Michelangelostr. 1/1401', postalCode: '01217', city: 'Dresden', country: 'DE', email: 'Kuland2@web.de', phone: '15252064185' });
    expect(r.manufacturer?.name).toBe('Shenzhen Beispiel Technology Co., Ltd');
  });
  it('gespeicherte Einzelfelder haben Vorrang vor dem Parser', () => {
    const r = resolveGpsrForListing({ ...full, gpsrName: 'Stele Test GmbH', gpsrAddress: 'Am Hochfeld 47', gpsrCity: '65205 Wiesbaden', gpsrEmail: 'x@y.de', gpsrPhone: '123' });
    expect(r.eu?.name).toBe('Stele Test GmbH');
    expect(r.eu?.city).toBe('Wiesbaden');
    expect(r.eu?.postalCode).toBe('65205');
  });
  it('fehlender EU-Block → Blockade mit Klartext, KEIN Ersatz durch Hersteller oder Stele', () => {
    const r = resolveGpsrForListing({ ...full, gpsrRaw: MANUF });
    expect(r.eu).toBeNull();
    expect(r.missing.length).toBeGreaterThan(0);
    expect(r.missing.join(' ')).toContain('Name');
    expect(r.missing.join(' ')).toContain('E-Mail');
  });
  it('kein Rohtext und keine Felder → alles fehlt', () => {
    const r = resolveGpsrForListing({ gpsrRaw: null, gpsrName: null, gpsrAddress: null, gpsrCity: null, gpsrEmail: null, gpsrPhone: null });
    expect(r.eu).toBeNull();
    expect(r.missing.length).toBeGreaterThanOrEqual(4);
  });
  it('Adresse ohne PLZ/Stadt-Muster → fehlt "PLZ/Stadt", nichts geraten', () => {
    const raw = `${MANUF}\n\nAngaben zur verantwortlichen Person in der EU\nName: Niulav UG\nAdresse: Michelangelostr. 1/1401\nE-Mail: Kuland2@web.de`;
    const r = resolveGpsrForListing({ ...full, gpsrRaw: raw });
    expect(r.eu).toBeNull();
    expect(r.missing.join(' ')).toContain('PLZ');
  });
});

describe('Beschreibung: keine Fremd-Kontakte mehr im GPSR-Tab', () => {
  const tab = (inner: string) => `<div>x</div><!-- TAB 5: Produktsicherheit (GPSR) -->\n<div class="c"><h3>Produktsicherheit (GPSR)</h3><pre style="a">${inner}</pre></div>\n<div>Impressum contact@stele-e-transfer.com</div>`;
  it('ersetzt den Rohtext im GPSR-Tab durch den neutralen Hinweis', () => {
    const out = neutralizeGpsrTab(tab('Name: X\nE-Mail: fremd@lieferant.cn'));
    expect(out).toContain(GPSR_DESCRIPTION_NOTICE);
    expect(out).not.toContain('fremd@lieferant.cn');
    expect(out).toContain('contact@stele-e-transfer.com');
  });
  it('findForeignEmails ignoriert nur die eigene Adresse', () => {
    expect(findForeignEmails(tab('E-Mail: fremd@lieferant.cn'))).toEqual(['fremd@lieferant.cn']);
    expect(findForeignEmails(neutralizeGpsrTab(tab('E-Mail: fremd@lieferant.cn')))).toEqual([]);
  });
});

describe('Beschreibungs-Generator: GPSR-Tab ohne Fremd-Kontakte, eigene Pflichtstellen erhalten', () => {
  const product = { title: 'Testprodukt', description: 'Ein Text.', gpsrRaw: `${MANUF}

${EU}` };
  // Die sechs Pflichtstellen des Nutzers (Impressum, AGB-Anbieterzeile, Widerrufsadresse).
  const PFLICHT = ['Impressum', 'Am Hochfeld 47', '65205 Wiesbaden', 'contact@stele-e-transfer.com', 'Anbieter: Evgenij Stele, Am Hochfeld 47, 65205 Wiesbaden', 'Widerruf an:'];
  for (const [name, build] of [['dunkel', buildEbayHTML], ['hell', buildEbayHTMLLight]] as const) {
    it(`${name}: keine Fremd-E-Mail und kein Hersteller-/EU-Kontakt mehr`, () => {
      const html = build(product);
      expect(findForeignEmails(html)).toEqual([]);
      expect(html).not.toContain('Kuland2@web.de');
      expect(html).not.toContain('15252064185');
      expect(html).toContain(GPSR_DESCRIPTION_NOTICE);
    });
    it(`${name}: alle sechs Pflichtstellen vorhanden`, () => {
      const html = build(product);
      for (const stelle of PFLICHT) expect(html).toContain(stelle);
    });
  }
});

describe('parseGpsrRaw — Länderwort in echten Adressformen (Produktions-Adressen)', () => {
  const eu = (addr: string) => parseGpsrRaw(`${MANUF}

Angaben zur verantwortlichen Person in der EU
Name: X
Adresse: ${addr}
E-Mail: a@b.de`);
  it.each([
    ['6 RUE D ARMAILLE,75017,PARIS FR', 'FR'],
    ['FR-79 rue de Patay 75013 Paris Frankreich', 'FR'],
    ['CALLE RIO TORMES NUM. 1, Fuenlabrada, Madrid, 28947 Spanien', 'ES'],
    ['ES-CALLE RIO TORMES NUM. 1, PLANTA 1, Fuenlabrada, 28947 Madrid', 'ES'],
    ['Michelangelostr. 1/1401, 01217 Dresden, DE(Germany)', 'DE'],
  ])('%s → %s', (addr, iso) => { expect(eu(addr).country).toBe(iso); });
  it('ohne Länderwort bleibt das Land unbekannt (nicht aus der PLZ geraten)', () => {
    expect(eu('Hammfelddamm 4A, 41460 Neuss').country).toBeNull();
  });
});

describe('Review-Nachträge Paket 3', () => {
  it('findForeignEmails ignoriert Bild-Dateinamen mit @ (logo@2x.png)', () => {
    expect(findForeignEmails('<img src="https://cdn.example.com/logo@2x.png">')).toEqual([]);
    expect(findForeignEmails('<img src="a@2x.png"> Kontakt: x@y.de')).toEqual(['x@y.de']);
  });
  it('neutralizeGpsrTab ersetzt nicht ein späteres <pre> außerhalb des GPSR-Tabs', () => {
    const html = '<!-- TAB 5: Produktsicherheit (GPSR) --><div>kein pre</div><!-- TAB 6 --><pre>BEHALTEN</pre>';
    expect(neutralizeGpsrTab(html)).toContain('BEHALTEN');
  });
  it('weitere EU-Länder werden erkannt (IT, NL, CZ, AT)', () => {
    const eu = (a: string) => parseGpsrRaw(`${MANUF}

Angaben zur verantwortlichen Person in der EU
Name: X
Adresse: ${a}
E-Mail: a@b.de`).country;
    expect(eu('Via Roma 1, 00100 Roma, Italien')).toBe('IT');
    expect(eu('Damrak 1, 1012 Amsterdam, Netherlands')).toBe('NL');
    expect(eu('Hlavni 1, 11000 Praha, Czech Republic')).toBe('CZ');
    expect(eu('Ringstr. 1, 1010 Wien, Österreich')).toBe('AT');
  });
});

// ─── Paket 3b ─────────────────────────────────────────────────────────────────────────────
const NONE = { gpsrRaw: null, gpsrName: null, gpsrAddress: null, gpsrCity: null, gpsrEmail: null, gpsrPhone: null, gpsrCountry: null };

describe('Paket 3b — gespeichertes Land (gpsrCountry)', () => {
  const raw = `${MANUF}\n\n${EU}`; // Rohtext erkennt DE
  it('gespeichertes Land gewinnt gegen den Rohtext (auch klein/mit Leerzeichen → normalisiert)', () => {
    expect(resolveGpsrForListing({ ...NONE, gpsrRaw: raw, gpsrCountry: ' fr ' }).eu?.country).toBe('FR');
  });
  it('ohne gespeichertes Land gilt der Rohtext', () => {
    expect(resolveGpsrForListing({ ...NONE, gpsrRaw: raw }).eu?.country).toBe('DE');
  });
  it('ungültiges gespeichertes Land (kein 2-Buchstaben-Code) wird ignoriert, Rohtext gilt', () => {
    expect(resolveGpsrForListing({ ...NONE, gpsrRaw: raw, gpsrCountry: 'Deutschland' }).eu?.country).toBe('DE');
  });
  it('Land außerhalb EU/EWR (gespeichert, z. B. CN) blockiert mit Klartext', () => {
    const r = resolveGpsrForListing({ ...NONE, gpsrRaw: raw, gpsrCountry: 'CN' });
    expect(r.eu).toBeNull();
    expect(r.missing.join(' ')).toContain('außerhalb der EU');
  });
  it('EU-Adresstext, der auf ein Nicht-EU-Landwort endet (…, China), blockiert statt CN zu senden', () => {
    const cn = `${MANUF}\n\nAngaben zur verantwortlichen Person in der EU\nName: X GmbH\nAdresse: Musterstr. 1, 12345 Musterstadt, China\nE-Mail: a@b.de`;
    const r = resolveGpsrForListing({ ...NONE, gpsrRaw: cn });
    expect(r.eu).toBeNull();
    expect(r.missing.join(' ')).toContain('außerhalb der EU');
  });
  it('EU/EWR-Liste: 27 EU + IS, LI, NO, ohne CN', () => {
    expect(EU_EEA_COUNTRIES).toHaveLength(30);
    expect(EU_EEA_COUNTRIES.some(c => c.code === 'CN')).toBe(false);
    for (const c of ['DE', 'FR', 'ES', 'NL', 'PT', 'NO']) expect(EU_EEA_COUNTRIES.some(x => x.code === c)).toBe(true);
  });
});

describe('Paket 3b — PLZ-Formate NL und PT (vorher: still falsch bzw. nicht erkannt)', () => {
  const eu = (addr: string) => parseGpsrRaw(`${MANUF}\n\nAngaben zur verantwortlichen Person in der EU\nName: X\nAdresse: ${addr}\nE-Mail: a@b.de`);
  const stored = (city: string, country: string) => resolveGpsrForListing({ ...NONE, gpsrName: 'X', gpsrAddress: 'Str. 1', gpsrCity: city, gpsrEmail: 'a@b.de', gpsrCountry: country });
  it('"1012 AB Amsterdam" → PLZ "1012 AB", Stadt "Amsterdam" (nicht PLZ "1012" + Stadt "AB Amsterdam")', () => {
    expect(stored('1012 AB Amsterdam', 'NL').eu).toMatchObject({ postalCode: '1012 AB', city: 'Amsterdam' });
    expect(eu('Damrak 1, 1012 AB Amsterdam, Netherlands')).toMatchObject({ address: 'Damrak 1', city: '1012 AB Amsterdam', country: 'NL' });
  });
  it('"1000-001 Lisboa" → PLZ "1000-001", Stadt "Lisboa"', () => {
    expect(stored('1000-001 Lisboa', 'PT').eu).toMatchObject({ postalCode: '1000-001', city: 'Lisboa' });
    expect(eu('Rua Augusta 10, 1000-001 Lisboa, Portugal')).toMatchObject({ address: 'Rua Augusta 10', city: '1000-001 Lisboa', country: 'PT' });
  });
  it('bestehende Formate unverändert (DE 5-stellig, PL, ES)', () => {
    expect(stored('65205 Wiesbaden', 'DE').eu).toMatchObject({ postalCode: '65205', city: 'Wiesbaden' });
    expect(stored('00-950 Warszawa', 'PL').eu).toMatchObject({ postalCode: '00-950', city: 'Warszawa' });
    expect(stored('28947 Fuenlabrada', 'ES').eu).toMatchObject({ postalCode: '28947', city: 'Fuenlabrada' });
  });
  it('isPostalCityFormat: gültig/ungültig', () => {
    for (const ok of ['75017 Paris', '1012 AB Amsterdam', '1000-001 Lisboa', '00-950 Warszawa']) expect(isPostalCityFormat(ok)).toBe(true);
    for (const bad of ['Paris', 'Fuenlabrada, Madrid, Spanien', '', '75017']) expect(isPostalCityFormat(bad)).toBe(false);
  });
});

describe('Paket 3b — Fixtures Produktion 195 und 191 (echte Feldwerte, 21.09.2026)', () => {
  const p195 = {
    gpsrName: 'Ma Wei Aasheng International Investment Consultin', gpsrAddress: 'Rodenberger Allee 23', gpsrCity: '31542 Bad Nenndorf',
    gpsrEmail: 'sibingqian1013@163.com', gpsrPhone: '+49 171 3213134', gpsrCountry: null,
    // Rohtext hat ENGLISCHE Schlüssel ("Address:", "Email:") — der Parser liest daraus kein Land (OFFEN).
    gpsrRaw: 'Manufacturer information\nName: Shenzhen Jiuzhou Junao Technology Co., Ltd.\nAddress: Room 603, No. 2, Area 1, Langkou Village, Langkou Community, Dalang Street, Longhua District, Shenzhen City\nEmail: leafy998@163.com\nPhone: 13049993661\nEU responsible person\nName: Ma Wei Aasheng International Investment Consultin\nAddress: Rodenberger Allee 23, 31542 Bad Nenndorf, Germany\nEmail: sibingqian1013@163.com\nPhone: 01713213134',
  };
  it('195: alle vier Felder von Hand korrekt, aber ohne gespeichertes Land blockiert (bisheriges Verhalten)', () => {
    const r = resolveGpsrForListing(p195);
    expect(r.eu).toBeNull();
    expect(r.missing.join(' ')).toContain('Land');
  });
  it('195: mit gespeichertem Land DE ist die Blockade auflösbar', () => {
    const r = resolveGpsrForListing({ ...p195, gpsrCountry: 'DE' });
    expect(r.missing).toEqual([]);
    expect(r.eu).toMatchObject({ address: 'Rodenberger Allee 23', postalCode: '31542', city: 'Bad Nenndorf', country: 'DE', email: 'sibingqian1013@163.com' });
  });
  const p191 = {
    gpsrName: 'Lynxi E-Commerce SL', gpsrAddress: 'Calle Branuelas Numero 2-4', gpsrCity: 'Fuenlabrada, Madrid, Spanien',
    gpsrEmail: 'Lyrep@hotmail.com', gpsrPhone: '+34 613583692', gpsrCountry: null,
    gpsrRaw: "Informationen zum Hersteller\nName: Dongguan Qihang Zhimao E-Commerce Co., Ltd\nAdresse: Room 802, Unit 1, No. 2, Xin'an Er Road, Chang'an Town, Dongguan City, Guangdong Province, China\nE-Mail-Adresse: 3865254535@qq.com\nTelefon: 18002253873\n\nInformationen zum EU-Verantwortlichen\nName: Lynxi E-Commerce SL\nAdresse: Calle Branuelas Numero 2-4, Fuenlabrada, Madrid, Spain\nE-Mail-Adresse: Lyrep@hotmail.com\nTelefon: +34 613583692\n\nProduktkennzeichnung: 1005012869497310",
  };
  it('191: "Fuenlabrada, Madrid, Spanien" blockiert mit Formathinweis (Land kommt aus dem Rohtext: ES)', () => {
    const r = resolveGpsrForListing(p191);
    expect(r.eu).toBeNull();
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]).toContain('PLZ Stadt');
  });
  it('191: nach Korrektur auf "28947 Fuenlabrada" ist die Blockade aufgelöst', () => {
    const r = resolveGpsrForListing({ ...p191, gpsrCity: '28947 Fuenlabrada' });
    expect(r.missing).toEqual([]);
    expect(r.eu).toMatchObject({ postalCode: '28947', city: 'Fuenlabrada', country: 'ES' });
  });
});

describe('Paket 3b — Hinweistext', () => {
  it('verweist nicht mehr auf einen Abschnitt "Produktsicherheit"', () => {
    expect(GPSR_DESCRIPTION_NOTICE).not.toContain('Produktsicherheit');
    expect(GPSR_DESCRIPTION_NOTICE).toContain('Herstellerinformationen');
    expect(GPSR_DESCRIPTION_NOTICE).toContain('Verantwortliche Person in der EU');
  });
});

describe('Paket 3b — Re-Import: kein veraltetes Land (Review-Blocker) und NL-Format nur bei Land NL', () => {
  const complete = (addr: string, extra = '') => `${MANUF}\n\nAngaben zur verantwortlichen Person in der EU\nName: Neue Firma\nAdresse: ${addr}\nE-Mail: n@f.fr\nTelefon: +33 1 234567${extra}`;
  it('Re-Import mit vollständigem Rohtext, Land erkannt (FR) → Land wird mitüberschrieben', () => {
    const f = gpsrFieldsFromRaw(complete('6 Rue X, 75017 Paris, France'), true);
    expect(f).toMatchObject({ gpsrName: 'Neue Firma', gpsrCity: '75017 Paris', gpsrCountry: 'FR' });
  });
  it('Re-Import vollständig, Land NICHT erkannt → gespeichertes Land wird auf null gesetzt (kein Rest der alten Firma)', () => {
    const f = gpsrFieldsFromRaw(complete('6 Rue X, 75017 Paris'), true);
    expect(f.gpsrName).toBe('Neue Firma');
    expect('gpsrCountry' in f).toBe(true);
    expect(f.gpsrCountry).toBeNull();
  });
  it('Re-Import mit Nicht-EU-Landwort → Land null statt CN', () => {
    expect(gpsrFieldsFromRaw(complete('6 Rue X, 75017 Paris, China'), true).gpsrCountry).toBeNull();
  });
  it('Re-Import unvollständig → nichts wird überschrieben', () => {
    expect(gpsrFieldsFromRaw(`${MANUF}\n\nAngaben zur verantwortlichen Person in der EU\nName: Nur Name`, true)).toEqual({});
  });
  it('Erstimport: nicht erkanntes Land wird NICHT als Schlüssel gesetzt (Feld bleibt leer)', () => {
    const f = gpsrFieldsFromRaw(complete('6 Rue X, 75017 Paris'));
    expect('gpsrCountry' in f).toBe(false);
    expect(gpsrFieldsFromRaw(complete('6 Rue X, 75017 Paris, France')).gpsrCountry).toBe('FR');
  });
  it('Hersteller-Daten landen nie in den Feldern', () => {
    const f = gpsrFieldsFromRaw(complete('6 Rue X, 75017 Paris, France'), true);
    expect(JSON.stringify(f)).not.toContain('hersteller@beispiel-cn.com');
    expect(JSON.stringify(f)).not.toContain('Shenzhen');
  });
  it('"1010 AT Wien" mit Land AT: PLZ im NL-Format bei Nicht-NL-Land blockiert statt "1010 AT" an eBay zu senden', () => {
    const r = resolveGpsrForListing({ ...NONE, gpsrName: 'X', gpsrAddress: 'Ring 1', gpsrCity: '1010 AT Wien', gpsrEmail: 'a@b.at', gpsrCountry: 'AT' });
    expect(r.eu).toBeNull();
    expect(r.missing.join(' ')).toContain('niederländische');
  });
  it('"1010 Wien" mit Land AT ist gültig', () => {
    expect(resolveGpsrForListing({ ...NONE, gpsrName: 'X', gpsrAddress: 'Ring 1', gpsrCity: '1010 Wien', gpsrEmail: 'a@b.at', gpsrCountry: 'AT' }).eu)
      .toMatchObject({ postalCode: '1010', city: 'Wien', country: 'AT' });
  });
});
