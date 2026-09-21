// Paket 3 (A3/F3): Block-Erkennung Hersteller vs. verantwortliche Person in der EU, Land,
// Auflösung der Pflichtangaben fürs Listing, Beschreibungs-Bereinigung.
// Fixtures: echtes Textmuster (Aufbau wie Produkt 70/66: zwei Blöcke, feste Schlüssel).
import { describe, expect, it } from 'bun:test';
import { parseGpsrRaw, resolveGpsrForListing } from './gpsr-parser';
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
