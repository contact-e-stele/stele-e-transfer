// P71-B Teil 2: Dauerregeln 2–4 (alicdn, GPSR-Rohtext, Versandangaben) — je Muster positiv + negativ,
// Zählung mit echter Anzahl, Beispiel aus der ALTEN Vorlage, Ende-zu-Ende mit dem heutigen Generator.
// (Regel 1 E-Mail/URL/Domain: description-compliance.test.ts; Regel 5 MPN: mpn-guard.test.ts.)
import { describe, expect, it } from 'bun:test';
import {
  checkOutgoingListingText, findDescriptionComplianceViolations, summarizeDescriptionViolations,
} from './description-compliance';
import { GPSR_DESCRIPTION_NOTICE } from './gpsr-description';
import { buildProductDescriptionForEbay } from '../api/ebay-description-builder';

const kinds = (html: string, kind: string) => findDescriptionComplianceViolations(html).filter(v => v.kind === kind);

describe('Regel 2 — alicdn', () => {
  it('erkennt ae01.alicdn.com als eigene Art "alicdn"', () => {
    expect(kinds('<img src="https://ae01.alicdn.com/kf/a.jpg">', 'alicdn')).toEqual([{ kind: 'alicdn', match: 'ae01.alicdn.com' }]);
  });
  it('kein alicdn-Treffer bei einem eBay-Bild-Host', () => {
    expect(kinds('<img src="https://i.ebayimg.com/images/a.jpg">', 'alicdn')).toEqual([]);
  });
});

describe('Regel 3 — GPSR-Rohtext nur in regulatory, in der Beschreibung nur der Hinweis', () => {
  it('erkennt die Rohtext-Überschrift "Informationen zum Hersteller"', () => {
    expect(kinds('<p>Informationen zum Hersteller</p>', 'gpsr').length).toBe(1);
  });
  it('erkennt die Rohtext-Überschrift "Angaben zur verantwortlichen Person"', () => {
    expect(kinds('<p>Angaben zur verantwortlichen Person in der EU</p>', 'gpsr').length).toBe(1);
  });
  it('erkennt eine Telefonzeile aus dem GPSR-Rohtext', () => {
    expect(kinds('Telefon: 8613800000000', 'gpsr').length).toBe(1);
  });
  it('erkennt einen GPSR-Tab, dessen <pre> etwas anderes als den Hinweis enthält', () => {
    const html = '<!-- TAB 5: Produktsicherheit (GPSR) --><pre>Foo Ltd, Shenzhen</pre>';
    expect(kinds(html, 'gpsr')).toEqual([{ kind: 'gpsr', match: 'GPSR-Tab enthält Rohtext statt GPSR_DESCRIPTION_NOTICE' }]);
  });
  it('kein Treffer: GPSR-Tab mit genau GPSR_DESCRIPTION_NOTICE (auch mit anderer Tab-Nummer)', () => {
    const html = `<!-- TAB 3: Produktsicherheit (GPSR) --><pre style="x">${GPSR_DESCRIPTION_NOTICE}</pre>`;
    expect(kinds(html, 'gpsr')).toEqual([]);
  });
  it('kein Treffer: der Hinweistext selbst enthält keine Rohtext-Überschrift', () => {
    expect(kinds(`<p>${GPSR_DESCRIPTION_NOTICE}</p>`, 'gpsr')).toEqual([]);
  });
});

describe('Regel 4 (shipping) entfernt — P71-C: Versandangaben sind Bestandteil der Vorlage', () => {
  const texte = ['Lieferzeit 3–10 Werktage', 'Versand per DHL oder Deutsche Post', 'Kostenloser Versand', 'Versandkosten: 0 EUR'];
  for (const text of texte) {
    it(`kein Verstoß bei: ${text}`, () => {
      expect(findDescriptionComplianceViolations(`<p>${text}</p>`)).toEqual([]);
    });
  }
});

describe('checkOutgoingListingText — Titel UND Beschreibung, eine Stelle', () => {
  it('sauberer Titel + saubere Beschreibung → keine Treffer', () => {
    expect(checkOutgoingListingText({ title: 'Frischhaltedose Edelstahl', description: '<p>Spülmaschinenfest</p>' })).toEqual([]);
  });
  it('Verstoß nur im Titel wird erkannt', () => {
    const v = checkOutgoingListingText({ title: 'Dose info@shop.com', description: '<p>ok</p>' });
    expect(v.some(x => x.kind === 'email')).toBe(true);
  });
  it('Verstoß nur in der Beschreibung wird erkannt', () => {
    const v = checkOutgoingListingText({ title: 'Dose', description: '<p>a@b.com</p>' });
    expect(v.filter(x => x.kind === "email")).toEqual([{ kind: "email", match: "a@b.com" }]);
  });
  it('Wort am Titel-Ende und am Beschreibungs-Anfang bilden keinen Fehltreffer über die Grenze hinweg', () => {
    expect(checkOutgoingListingText({ title: 'Dose Versand', description: 'per Hand waschen' })).toEqual([]);
  });
});

describe('summarizeDescriptionViolations — echte Anzahl je Muster (nicht dedupliziert)', () => {
  it('zählt dieselbe E-Mail-Adresse mehrfach, obwohl die Verstoßliste sie nur einmal führt', () => {
    const html = '<p>x@y.com</p><p>x@y.com</p><p>x@y.com</p><p>x@y.com</p>';
    expect(findDescriptionComplianceViolations(html).filter(v => v.kind === 'email').length).toBe(1);
    expect(summarizeDescriptionViolations(html).email).toBe(4);
  });
  it('zählt externe Hosts mit Anzahl, absteigend', () => {
    const html = '<img src="https://ae01.alicdn.com/1.jpg"><img src="https://ae01.alicdn.com/2.jpg"><a href="http://shop.example.de/x">l</a>';
    const s = summarizeDescriptionViolations(html);
    expect(s.hosts).toEqual([{ host: 'ae01.alicdn.com', count: 2 }, { host: 'shop.example.de', count: 1 }]);
    expect(s.alicdn).toBe(2);
    expect(s.url).toBe(3);
  });
  it('sauberer Text → alles 0', () => {
    const s = summarizeDescriptionViolations('<p>Hochwertige Qualität.</p>');
    expect(s).toEqual({ email: 0, url: 0, domain: 0, alicdn: 0, gpsr: 0, total: 0, hosts: [] });
  });
});

describe('Beispiel aus der ALTEN Vorlage — alle Regeln lösen aus', () => {
  const OLD_TEMPLATE = `<div>
<!-- TAB 1: Beschreibung -->
<img src="https://ae01.alicdn.com/kf/a.jpg"><img src="https://ae01.alicdn.com/kf/b.jpg">
<p>Lieferzeit 7-14 Werktage per DHL. Kostenloser Versand.</p>
<!-- TAB 2: Impressum --><p>contact@stele-e-transfer.com</p>
<!-- TAB 3: AGB --><p>contact@stele-e-transfer.com</p>
<!-- TAB 4: Widerruf --><p>contact@stele-e-transfer.com</p>
<!-- TAB 4b: Kontakt --><p>contact@stele-e-transfer.com</p>
<!-- TAB 5: Produktsicherheit (GPSR) --><pre>Informationen zum Hersteller
Name: Foo Ltd
E-Mail: hersteller@apex-ce.com
Telefon: 8613800000000</pre>
</div>`;

  it('E-Mail (4 eigene + 1 Hersteller), URL, alicdn, GPSR-Rohtext: jede Art hat Treffer, mit echten Anzahlen', () => {
    const s = summarizeDescriptionViolations(OLD_TEMPLATE);
    expect(s.email).toBe(5);
    expect(s.url).toBe(2);
    expect(s.alicdn).toBe(2);
    expect(s.gpsr).toBe(3);
    expect(s.domain).toBeGreaterThan(0);
    expect(s.hosts).toEqual([{ host: 'ae01.alicdn.com', count: 2 }]);
  });

  it('checkOutgoingListingText blockiert die alte Vorlage mit allen fünf Arten', () => {
    const arten = new Set(checkOutgoingListingText({ title: 'Dose', description: OLD_TEMPLATE }).map(v => v.kind));
    expect([...arten].sort()).toEqual(['alicdn', 'domain', 'email', 'gpsr', 'url']);
  });
});

describe('Ende-zu-Ende Regel 1–4: Ausgabe des heutigen Generators (buildProductDescriptionForEbay) hat 0 Treffer', () => {
  it('vollständiges Beispiel-Listing mit Varianten, Specs, Bullets und Bildern', () => {
    const { html, violations } = buildProductDescriptionForEbay({
      title: 'Frischhaltedose Edelstahl 3er Set',
      generatedTitle: 'Frischhaltedose Edelstahl 3er Set',
      description: null,
      generatedDescription: '###INTRO### Praktisches Set für Küche und Aufbewahrung.###BULLETS### - Auslaufsicher\n- Spülmaschinenfest###OUTRO### Ideal für Meal Prep.',
      specs: JSON.stringify({ Material: 'Edelstahl', Farbe: 'Silber' }),
      variants: JSON.stringify([{ name: 'Größe', values: ['S', 'M'] }]),
      variantContents: null,
      variantPrices: null,
      bullets: JSON.stringify([]),
      images: JSON.stringify(['https://ae01.alicdn.com/kf/example.jpg']),
    });
    expect(violations).toEqual([]);
    expect(summarizeDescriptionViolations(html).total).toBe(0);
    expect(checkOutgoingListingText({ title: 'Frischhaltedose Edelstahl 3er Set', description: html })).toEqual([]);
  });
});

describe('P71-C: Generator mit gpsrRaw — 5 Tabs, 0 Verstöße, kein @/http/alicdn', () => {
  it('buildProductDescriptionForEbay erzeugt den Tab Produktsicherheit (nur Hinweis) und bleibt sauber', () => {
    const { html, violations } = buildProductDescriptionForEbay({
      title: 'Frischhaltedose Edelstahl 3er Set',
      generatedTitle: 'Frischhaltedose Edelstahl 3er Set',
      generatedDescription: '###INTRO### Praktisches Set.###BULLETS### - Auslaufsicher###OUTRO### Ideal.',
      specs: JSON.stringify({ Material: 'Edelstahl' }),
      variants: JSON.stringify([{ name: 'Größe', values: ['S', 'M'] }]),
      variantPrices: JSON.stringify([{ sku: 'S', price: 9.95, imageUrl: 'https://ae01.alicdn.com/kf/s.jpg' }]),
      images: JSON.stringify(['https://ae01.alicdn.com/kf/example.jpg']),
      gpsrRaw: 'Informationen zum Hersteller\nName: Foo Ltd\nE-Mail: hersteller@apex-ce.com\nTelefon: 8613800000000',
    });
    expect(violations).toEqual([]);
    expect(summarizeDescriptionViolations(html).total).toBe(0);
    for (const label of ['Beschreibung', 'Versand &amp; Retouren', 'Impressum', 'AGB', 'Produktsicherheit']) {
      expect(html).toContain(`>${label}</label>`);
    }
    expect(html).toContain(GPSR_DESCRIPTION_NOTICE);
    expect(html).not.toContain('@');
    expect(html).not.toContain('http');
    expect(html).not.toContain('alicdn');
  });
});
