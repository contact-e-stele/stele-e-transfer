// eBay-Verstoßserie 2026-09-28: neuer, strengerer Validator — fängt JEDE Kontaktaufnahme-
// Möglichkeit (auch die eigene E-Mail-Adresse), nicht nur fremde Kontakte wie findForeignEmails().
import { describe, expect, it } from 'bun:test';
import { findDescriptionComplianceViolations, assertDescriptionCompliant } from './description-compliance';
import { buildEbayHTMLLight, type ScrapedProduct } from '../web/lib/ebay-description';
import { neutralizeGpsrTab } from './gpsr-description';

describe('findDescriptionComplianceViolations — ein Muster pro Test', () => {
  it('erkennt eine fremde E-Mail-Adresse', () => {
    const v = findDescriptionComplianceViolations('<p>Kontakt: service@zreeshop.com</p>');
    expect(v).toContainEqual({ kind: 'email', match: 'service@zreeshop.com' });
  });

  it('erkennt auch die EIGENE E-Mail-Adresse (nach diesem Fix soll gar keine mehr im Text stehen)', () => {
    const v = findDescriptionComplianceViolations('<p>contact@stele-e-transfer.com</p>');
    expect(v).toContainEqual({ kind: 'email', match: 'contact@stele-e-transfer.com' });
  });

  it('ignoriert Bild-Dateinamen mit @ (logo@2x.png)', () => {
    const v = findDescriptionComplianceViolations('<img src="https://cdn.example.com/logo@2x.png">');
    expect(v.some(x => x.kind === 'email')).toBe(false);
  });

  it('erkennt http://', () => {
    const v = findDescriptionComplianceViolations('<p>http://beispiel-shop.example</p>');
    expect(v.some(x => x.kind === 'url' && x.match === 'http://')).toBe(true);
  });

  it('erkennt https://', () => {
    const v = findDescriptionComplianceViolations('<a href="https://zreeshop.com/store">Link</a>');
    expect(v.some(x => x.kind === 'url' && x.match === 'https://')).toBe(true);
  });

  it('erkennt www.', () => {
    const v = findDescriptionComplianceViolations('Besuchen Sie www.beispiel-shop.de');
    expect(v.some(x => x.kind === 'url' && x.match.toLowerCase() === 'www.')).toBe(true);
  });

  it('erkennt eine Domain aus der Fixture (zreeshop.com)', () => {
    const v = findDescriptionComplianceViolations('Shop: zreeshop.com');
    expect(v).toContainEqual({ kind: 'domain', match: 'zreeshop.com' });
  });

  it('erkennt eine Domain aus der Fixture (163.com)', () => {
    const v = findDescriptionComplianceViolations('Rückfragen an 163.com');
    expect(v).toContainEqual({ kind: 'domain', match: '163.com' });
  });

  it('erkennt eine Domain aus der Fixture (qq.com)', () => {
    const v = findDescriptionComplianceViolations('Kontakt über qq.com');
    expect(v).toContainEqual({ kind: 'domain', match: 'qq.com' });
  });

  it('erkennt eine Domain aus der Fixture (hotmail.com)', () => {
    const v = findDescriptionComplianceViolations('Erreichbar über hotmail.com');
    expect(v).toContainEqual({ kind: 'domain', match: 'hotmail.com' });
  });

  it('keine Fehltreffer auf Maßangaben ("12.5 cm") oder Versionsnummern ("v1.2")', () => {
    expect(findDescriptionComplianceViolations('Durchmesser 12.5 cm, Firmware v1.2')).toEqual([]);
  });
});

describe('assertDescriptionCompliant', () => {
  it('wirft mit Klartext-Auflistung bei einem Verstoß', () => {
    expect(() => assertDescriptionCompliant('Kontakt: a@b.com')).toThrow(/a@b\.com/);
  });
  it('wirft nicht bei sauberem Text', () => {
    expect(() => assertDescriptionCompliant('<p>Hochwertige Qualität.</p>')).not.toThrow();
  });
});

describe('Ende-zu-Ende: vollständiges Listing durch den echten Generator, danach null Verstöße', () => {
  const product: ScrapedProduct = {
    title: 'Testartikel Backmatte AliExpress 200123456789',
    description:
      '###INTRO### Für Rückfragen kontaktieren Sie uns unter service@zreeshop.com oder per WeChat, Tel. +86 1387654321. Besuchen Sie auch unseren Shop unter https://zreeshop.com/store.' +
      '###BULLETS### - Hitzebeständig bis 250°C, ideal für Backofen und Grill\n- Lieferant erreichbar via kontakt2699523@qq.com bei Fragen zur Lieferung' +
      '###OUTRO### Bei Problemen schreiben Sie uns direkt, wir antworten via WhatsApp +34 652 768 898.',
    specs: {
      Material: 'Silikon, Kontakt: successservice2@hotmail.com',
      Herkunft: 'China, Rückfragen an support@163.com',
    },
    bullets: [],
    images: ['https://ae01.alicdn.com/kf/example.jpg'],
    skuVariants: [
      { name: 'Rot', price: 9.99, imageUrl: 'https://ae01.alicdn.com/kf/variant-red.jpg' },
      { name: 'Blau', price: 9.99, imageUrl: 'https://ae01.alicdn.com/kf/variant-blue.jpg' },
    ],
    gpsrRaw: 'Informationen zum Hersteller\nName: Foo Ltd\nE-Mail: hersteller@apex-ce.com\nTelefon: 8613800000000',
  };

  it('buildEbayHTMLLight-Ausgabe (nach neutralizeGpsrTab, wie in der echten Pipeline) hat null Compliance-Verstöße', () => {
    const html = neutralizeGpsrTab(buildEbayHTMLLight(product));
    const violations = findDescriptionComplianceViolations(html);
    expect(violations).toEqual([]);
  });
});
