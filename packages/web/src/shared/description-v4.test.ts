// Beschreibung v4 "eine Seite" (08.11.2026). Fixtures aus description-v3.test.ts übernommen (echte Werte aus dem DB-Backup
// stele-db-2026-11-05-23h.json, Produkte 225, 119, 127; Maß stele-119 aus DESIGN-VORGABE v2.3 Regel D2).
import { describe, expect, test } from 'bun:test';
import { buildEbayHTMLv4, buildEbayHTMLLight, buildEbayHTMLCurrent, activeDescriptionMarker } from '../web/lib/ebay-description';
import { buildProductDescriptionForEbay, resolveListingDescription } from '../api/ebay-description-builder';
import { findDescriptionComplianceViolations } from './description-compliance';
import { neutralizeGpsrTab, GPSR_DESCRIPTION_NOTICE } from './gpsr-description';
import { DESCRIPTION_V3_MARKER } from './description-v3';
import { DESCRIPTION_V4_MARKER, DESCRIPTION_VERSION, V4_KEYS, v4Rows, introSentence, trustChips, titleBarText, SHIPPING_CHIP_TEXT, PAYMENT_PROMISE_CHIP_TEXT } from './description-v4';
import { NEUTRAL_RETURN_TEXT } from './shipping-return-text';
import { deliveryFooterText, returnFooterText, PAYMENT_TEXT, PAYMENT_CHIP_TEXT, USTG19_FOOTER_TEXT, FOOTER_BLOCK_START, FOOTER_BLOCK_END } from './shipping-return-text';

const P225 = {
  title: 'Aufblasbares Reisekissen Nackenkissen Kopfstütze Kinnstütze, verbesserte Version',
  variants: [{ name: 'Varianten', values: ['BLAU', 'SCHWARZ', 'GRAU'] }],
  specs: { 'Brand Name': 'NONE', Filling: 'COTTON', 'High-concerned chemical': 'none', Origin: 'Mainland China', CN: 'Guangdong', Choice: 'yes' },
};
const P119 = {
  title: 'Einweg Frischhaltehauben, Lebensmittelabdeckung',
  variants: [{ name: 'Varianten ', values: ['200pcs', '100pcs'] }],
  specs: { 'Brand Name': 'NONE', 'High-concerned chemical': 'none', Origin: 'Mainland China', Choice: 'yes' },
};
const P127 = {
  title: 'Lebensmittelhaube Frischhalteplatte Mehrweg Abdeckungen Bunt Essensschutz',
  variants: [{ name: 'Varianten ', values: ['Multicolour 100pcs', 'Multicolour 50pcs', 'White 500pcs', 'Multicolour 500pcs'] }],
  specs: { 'Brand Name': 'NONE', Material: 'Plastic', 'Require Food Contact': 'Yes', 'High-concerned chemical': 'none', Origin: 'Mainland China', Choice: 'yes', semi_Choice: 'yes' },
};
const STRETCH_119 = { kind: 'STRETCH' as const, values: [14, 29], source: 'c' as const, location: 'Beschreibungsbild 3' };
const DETAILS_119 = { a: { displayNameDe: 'Transparent', pieces: 100, measure: STRETCH_119 }, b: { displayNameDe: 'Transparent', pieces: 200, measure: STRETCH_119 } };
const TERMS = { returnsAccepted: true, days: 30, costPayer: 'SELLER' as const };

const FULL = {
  ...P127,
  description: '###INTRO### Praktische Abdeckung für Schüsseln und Teller. Zweiter Satz.###BULLETS### - Elastischer Rand passt auf viele Schüsseln\n- Schnelle Lieferung aus dem EU-Lager\n- Anwendung: für Obst, Salat und Reste\n- Material: Kunststoff, lebensmittelecht\n- Wiederverwendbar und abwaschbar\n- Lieferumfang: Hauben im Beutel###OUTRO### Schluss.',
  deliveryTime: '7–12 Werktage',
  returnTerms: TERMS,
  images: ['https://ae01.alicdn.com/kf/a.jpg', 'https://i.ebayimg.com/images/b.jpg'],
  skuVariants: [{ name: 'Multicolour 100pcs', price: 1, imageUrl: 'https://ae01.alicdn.com/kf/x.jpg' }],
  gpsrRaw: 'Informationen zum Hersteller\nShenzhen X Co., Ltd\nTelefon: +86 755 1234 5678',
};
const html = neutralizeGpsrTab(buildEbayHTMLv4(FULL));
const count = (h: string, s: string) => h.split(s).length - 1;

describe('Schalter: Default v3 (AUS) — Live-Angebote gehen nicht automatisch auf v4', () => {
  test('DESCRIPTION_VERSION = v3, Weiche baut v3, Listen/Nachzieh-Weg bauen v3', () => {
    expect(DESCRIPTION_VERSION).toBe('v3');
    expect(activeDescriptionMarker()).toBe(DESCRIPTION_V3_MARKER);
    expect(buildEbayHTMLCurrent(FULL)).toBe(buildEbayHTMLLight(FULL));
    const built = buildProductDescriptionForEbay({ title: P119.title, variants: JSON.stringify(P119.variants) });
    expect(built.html).toContain(DESCRIPTION_V3_MARKER);
    expect(built.html).not.toContain(DESCRIPTION_V4_MARKER);
  });
  test('Weiche mit v4 baut v4; gespeicherte v3-Vorlage wird bei Schalter v4 nicht übernommen (Merkmal)', () => {
    expect(buildEbayHTMLCurrent(FULL, 'v4')).toBe(buildEbayHTMLv4(FULL));
    expect(activeDescriptionMarker('v4')).toBe(DESCRIPTION_V4_MARKER);
    expect(buildEbayHTMLLight(FULL)).not.toContain(DESCRIPTION_V4_MARKER);
  });
  test('gespeicherte v4-Vorlage wird bei Schalter v3 neu gebaut (v3)', () => {
    const r = resolveListingDescription({ title: P119.title }, html);
    expect(r.html).toContain(DESCRIPTION_V3_MARKER);
  });
});

describe('1 + 2: schmale Titelleiste, keine Bilder', () => {
  test('Titel in der Leiste, kein <img>, keine Bild-URL, kein Platzhalter-Kästchen', () => {
    expect(html).toContain(`>${P127.title}</h1>`);
    expect(count(html, '<h1')).toBe(1);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain('alicdn');
    expect(html).not.toContain('ebayimg');
    expect(html).not.toContain('width:34px;height:34px');
    expect(html).not.toContain('Multicolour');
  });
  test('<img> in Gemini-Stichpunkten gelangt nie ins HTML (S2: Stichpunkte füllen keine Zeile mehr); P7 von Hand wird bereinigt', () => {
    const h = buildEbayHTMLv4({ title: 'X', bullets: ['Besonderheit: sehr robust <img src="x.jpg"> und leicht'] });
    expect(h).not.toMatch(/<img/i);
    expect(h).not.toContain('sehr robust');
    const h2 = buildEbayHTMLv4({ title: 'X', pflichtDaten: { besonderheit: { value: 'sehr robust <img src="x.jpg"> und leicht', source: 'c', location: 'Bild 2', wording: 'robust' } } });
    expect(h2).not.toMatch(/<img/i);
    expect(h2).toContain('sehr robust und leicht');
  });
});

describe('3: genau 3 Vertrauens-Chips, Text aus shipping-return-text.ts', () => {
  test('mit eBay-Richtlinie und Lieferzeit', () => {
    expect(count(html, 'class="stele-v4-chip"')).toBe(3);
    expect(trustChips('7–12 Werktage', TERMS)).toEqual([SHIPPING_CHIP_TEXT, '30 Tage kostenlose R&uuml;ckgabe', PAYMENT_PROMISE_CHIP_TEXT]);
    for (const c of trustChips('7–12 Werktage', TERMS)) expect(html).toContain(`&#10003; ${c}</span>`);
  });
  test('ohne Daten: neutrale Sätze, keine erfundene Frist', () => {
    expect(trustChips(null, null)).toEqual([SHIPPING_CHIP_TEXT, NEUTRAL_RETURN_TEXT, PAYMENT_PROMISE_CHIP_TEXT]);
    const h = buildEbayHTMLv4({ title: 'Nur Titel' });
    expect(count(h, 'class="stele-v4-chip"')).toBe(3);
    // Fristen nur aus der AGB (v3-Text, unverändert) — oberhalb der aufklappbaren Bereiche keine Zahl mit Tagen
    expect(h.slice(0, h.indexOf('<details'))).not.toMatch(/\d+\s*(Tage|Werktage)/);
  });
});

// Design-Antwort 09.11. 07:45 (Punkt 2): ohne Produktart (P1) GAR KEINE Einleitung — auch nicht die Gemini-Einleitung.
// Vorher: 'Praktische Abdeckung für Schüsseln (100 / 200 Stück, Ma&szlig;e ↔ 14 – 29 cm).' bzw. 'Inhalt: 100 / 200 Stück.'
describe('4: Einleitung nur mit Produktart', () => {
  test('ohne P1: keine Einleitung, auch nicht aus Gemini oder Produktdaten', () => {
    expect(introSentence({ ...P119, variantDetails: DETAILS_119 }, 'Praktische Abdeckung für Schüsseln. Zweiter Satz.')).toBeNull();
    expect(introSentence(P225, 'Weiches Nackenkissen für unterwegs.')).toBeNull();
    expect(introSentence(P119, '')).toBeNull();
    expect(html).not.toContain('Praktische Abdeckung');
    expect(html).not.toContain('Zweiter Satz');
  });
  test('mit P1: "<Produktart> aus <Material>, <Menge>, <Maß>."', () => {
    const pd = { produktart: { value: 'Frischhaltehaube', source: 'b' as const, location: 'Spezifikation "Type" – b, übersetzt (Liste)', wording: 'food cover' } };
    expect(introSentence({ ...P119, material: 'PE', variantDetails: DETAILS_119, pflichtDaten: pd }, 'Gemini.')).toBe('Frischhaltehaube aus PE, 100 / 200 Stück, ↔ 14 – 29 cm.');
  });
});

describe('5: höchstens 5 Stichwort-Zeilen, nur feste Schlüssel, ersetzen die Datentabelle', () => {
  // Design-Sprint S2 (Auftrag 043): Zeilen NUR aus den Pflicht-Daten — Gemini-Stichpunkte ("Anwendung: …", erster freier Stichpunkt)
  // füllen keine Zeile mehr (nicht belegbar). Vorher: ANWENDUNG 'für Obst, Salat und Reste', BESONDERHEIT 'Elastischer Rand …'.
  test('Fixture 127: nur Pflicht-Daten (Material b, Menge a); Gemini-Stichpunkte füllen keine Zeile, Versand-Füllsatz fällt weg', () => {
    const rows = [...html.matchAll(/<tr class="stele-v4-row"><td[^>]*>([A-Z]+)<\/td><td[^>]*>(.*?)<\/td><\/tr>/g)].map(m => [m[1], m[2]]);
    expect(rows).toEqual([
      ['MATERIAL', 'Kunststoff'],
      ['LIEFERUMFANG', '50 / 100 / 500 Stück'],
    ]);
    expect(html).not.toContain('für Obst, Salat und Reste');
    expect(html).not.toContain('Elastischer Rand');
    expect(html).not.toContain('Schnelle Lieferung');
    expect(html).not.toContain('TECHNISCHE DATEN');
    expect(html).not.toContain('>Farbe</td>');
  });
  test('alle 5 belegt → genau 5, Reihenfolge fest, nur die 5 Schlüssel', () => {
    const rows = v4Rows({ ...P119, material: 'PE', usePurpose: 'Frischhaltehaube', variantDetails: DETAILS_119,
      pflichtDaten: { besonderheit: { value: 'dehnbarer Gummizug', source: 'c', location: 'Beschreibungsbild 2', wording: 'elastic band' } } });
    expect(rows.map(r => r.key)).toEqual([...V4_KEYS]);
    expect(rows.length).toBe(5);
    expect(rows.find(r => r.key === 'MASSE')!.text).toBe('↔ 14 – 29 cm');
    expect(rows.find(r => r.key === 'BESONDERHEIT')!.text).toBe('dehnbarer Gummizug');
  });
  test('leere Zeilen fallen weg; nur Titel → keine Zeile', () => {
    expect(v4Rows(P225)).toEqual([]);
    expect(buildEbayHTMLv4({ title: 'Nur Titel' })).not.toContain('stele-v4-row');
  });
});

describe('6: 3 Kästen Versand / Rückgabe / Zahlung, Text aus shipping-return-text.ts', () => {
  test('genau 3 Kästen innerhalb der Fußzeilen-Klammer', () => {
    const foot = html.slice(html.indexOf(FOOTER_BLOCK_START), html.indexOf(FOOTER_BLOCK_END));
    expect(count(foot, 'class="stele-v4-box"')).toBe(3);
    expect(foot).toContain('>Versand &amp; R&uuml;ckgabe</div>'); // Ziel des AGB-Verweises FOOTER_REFERENCE
    expect(foot).toContain(`>Versand</div>${deliveryFooterText('7–12 Werktage')}</div>`);
    expect(foot).toContain(`>R&uuml;ckgabe</div>${returnFooterText(TERMS)}</div>`);
    expect(foot).toContain(`>Zahlung</div>${PAYMENT_TEXT}<br/>${USTG19_FOOTER_TEXT}</div>`);
  });
});

describe('7: Impressum / AGB / Produktsicherheit aufklappbar, GPSR-Hinweis vollständig im DOM', () => {
  test('drei <details><summary>, keine Reiter, kein <style>, kein Script', () => {
    expect(count(html, '<details')).toBe(3);
    for (const s of ['Impressum', 'AGB', 'Produktsicherheit']) expect(html).toContain(`>${s}</summary>`);
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain('<label');
    expect(html).not.toMatch(/<style|<script|on\w+=/i);
  });
  test('GPSR: Hinweis (Hersteller + EU-Verantwortliche) im <pre>, Rohtext nie im HTML; neutralizeGpsrTab greift', () => {
    expect(html).toContain(`>${GPSR_DESCRIPTION_NOTICE}</pre>`);
    expect(GPSR_DESCRIPTION_NOTICE).toContain('Hersteller');
    expect(GPSR_DESCRIPTION_NOTICE).toContain('verantwortlichen Person in der EU');
    expect(html).not.toContain('Shenzhen');
    const tampered = html.replace(GPSR_DESCRIPTION_NOTICE, 'Shenzhen X Co., Ltd');
    expect(findDescriptionComplianceViolations(tampered).some(v => v.kind === 'gpsr')).toBe(true);
    expect(neutralizeGpsrTab(tampered)).toBe(html);
  });
  test('Impressum und AGB mit demselben Text wie v3', () => {
    const v3 = buildEbayHTMLLight(FULL);
    for (const s of ['Inhaber: Evgenij Stele', '&sect; 9 Streitbeilegung', PAYMENT_TEXT]) {
      expect(v3).toContain(s);
      expect(html).toContain(s);
    }
  });
});

describe('8: WEEE nur bei Elektro, Batterie nur bei Batterie — getrennt', () => {
  const WEEE = 'DE12345678';
  test('Nicht-Elektro (Bestand: isElectric null, hasBattery 0): kein Hinweis', () => {
    const h = buildEbayHTMLv4({ ...FULL, isElectric: null, hasBattery: 0, weeeRegNr: WEEE });
    expect(h).not.toContain('WEEE');
    expect(h).not.toContain('stele-v4-battery');
  });
  test('Elektro ja, ohne Batterie: nur WEEE', () => {
    const h = buildEbayHTMLv4({ ...FULL, isElectric: 1, hasBattery: 0, weeeRegNr: WEEE });
    expect(h).toContain(`<div class="stele-v4-weee">WEEE-Reg.-Nr. ${WEEE}</div>`);
    expect(h).not.toContain('stele-v4-battery');
  });
  test('Elektro ja, aber keine/ungültige Nummer: keine WEEE-Zeile (nichts erfunden)', () => {
    expect(buildEbayHTMLv4({ ...FULL, isElectric: 1, weeeRegNr: null })).not.toContain('WEEE');
    expect(buildEbayHTMLv4({ ...FULL, isElectric: 1, weeeRegNr: 'DE123' })).not.toContain('WEEE');
  });
  test('Batterie ja, Elektro nein: nur Batterie-Hinweis', () => {
    const h = buildEbayHTMLv4({ ...FULL, isElectric: 0, hasBattery: 1, weeeRegNr: WEEE });
    expect(h).toContain('stele-v4-battery');
    expect(h).not.toContain('WEEE');
  });
  test('Builder reicht isElectric/hasBattery/weeeRegNr durch (nur v4 zeigt sie)', () => {
    const v3 = buildProductDescriptionForEbay({ title: 'x', isElectric: 1, hasBattery: 1 }, { weeeRegNr: WEEE });
    expect(v3.html).not.toContain('WEEE');
    expect(v3.html).not.toContain('stele-v4-battery');
  });

  const P119_ROW = { title: P119.title, specs: JSON.stringify(P119.specs), variants: JSON.stringify(P119.variants) };
  test('Vorschau: ctx.version = v4 baut v4 (Schalter bleibt v3), ohne version wie bisher v3', () => {
    const v4 = buildProductDescriptionForEbay(P119_ROW, { version: 'v4' });
    expect(v4.html).toContain(DESCRIPTION_V4_MARKER);
    expect(v4.html).not.toContain('<img');
    expect(v4.violations).toEqual([]);
    const def = buildProductDescriptionForEbay(P119_ROW, {});
    expect(def.html).toContain(DESCRIPTION_V3_MARKER);
    expect(def.html).not.toContain(DESCRIPTION_V4_MARKER);
  });
});

describe('9: Compliance grün, keine externen Ressourcen', () => {
  test('alle Fixtures ohne Verstoß (auch Elektro/Batterie)', () => {
    for (const p of [FULL, P225, P119, P127, { title: 'Nur Titel' }, { ...FULL, isElectric: 1, hasBattery: 1, weeeRegNr: 'DE12345678' }]) {
      expect(findDescriptionComplianceViolations(neutralizeGpsrTab(buildEbayHTMLv4(p)))).toEqual([]);
    }
    expect(html).not.toMatch(/https?:|www\.|href=|src=|url\(/i);
  });
});

describe('ABNAHME DESIGN S1: M1 Titelleiste, M2 keine doppelten Angaben', () => {
  test('M1: 80-Zeichen-Titel (mitten im Wort gekürzt) endet am letzten ganzen Wort', () => {
    const t120 = 'Einweg Frischhaltehauben Lebensmittelabdeckung Elastisch, Staubdicht, Lebensmittelech';
    expect(t120.length).toBeGreaterThanOrEqual(80);
    const bar = titleBarText(t120.slice(0, 80));
    expect(bar.endsWith('Staubdicht')).toBe(true);
    const h = buildEbayHTMLv4({ title: t120.slice(0, 80) });
    expect(h).toContain(`>${bar}</h1>`);
    expect(h).not.toContain('Lebensmittelech</h1>');
  });
  test('M1: kurzer Titel bleibt unverändert', () => {
    expect(titleBarText('Einweg Frischhaltehauben, Lebensmittelabdeckung')).toBe('Einweg Frischhaltehauben, Lebensmittelabdeckung');
  });
  test('M2: Lieferzeit und Zahlungstext nur im Kasten, nicht in den Chips', () => {
    const h = buildEbayHTMLv4({ title: 'Test', deliveryTime: '7–12 Werktage', returnTerms: TERMS });
    const chips = h.split('class="stele-v4-chip"').slice(1).map(x => x.slice(0, x.indexOf('</span>'))).join(' ');
    expect(chips).not.toContain('Werktage');
    expect(chips).not.toContain(PAYMENT_CHIP_TEXT);
    const top = h.slice(0, h.indexOf('<details')); // AGB unten im Aufklapp-Bereich zählt nicht
    expect(count(top, '7–12 Werktage')).toBe(1);
    expect(count(top, PAYMENT_CHIP_TEXT)).toBe(1);
  });
});
