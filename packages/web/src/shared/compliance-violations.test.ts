import { describe, expect, test } from 'bun:test';
import { flattenViolations, groupByListing, formatReport, truncate } from './compliance-violations';

const raw = [
  {
    listingId: '111', sku: 'A', complianceType: 'HTTPS',
    violations: [{ reasonCode: 'HTTP_LINK', message: 'x'.repeat(250) }],
  },
  {
    listingId: '222', sku: 'B', complianceType: 'OUTSIDE_EBAY_BUYING_AND_SELLING',
    violations: [{ ruleId: 'R1', message: 'Kontakt' }],
    variations: [{ sku: 'B-1', violations: [{ reasonCode: 'EMAIL', message: 'mail' }] }],
  },
];
const products = [
  { id: 147, title: 'Nachgezogen', ebayListingId: '111' },
  { id: 5, title: 'Offen', ebayListingId: '222' },
  { id: 9, title: 'Ohne Listing', ebayListingId: null },
];

describe('compliance-violations', () => {
  test('truncate kürzt auf 200 Zeichen', () => {
    expect(truncate('x'.repeat(250)).length).toBe(200);
    expect(truncate(' a   b ')).toBe('a b');
  });

  test('flattenViolations: Angebots- und Varianten-Verstöße, ruleId als Fallback', () => {
    const rows = flattenViolations(raw, 'HTTPS');
    expect(rows.length).toBe(3);
    expect(rows[0].message.length).toBe(200);
    expect(rows[1]).toMatchObject({ listingId: '222', reasonCode: 'R1', variantSku: '' });
    expect(rows[2]).toMatchObject({ reasonCode: 'EMAIL', variantSku: 'B-1' });
  });

  test('groupByListing ordnet Produkt zu und markiert nachgezogene', () => {
    const g = groupByListing(flattenViolations(raw, 'HTTPS'), products);
    expect(g.length).toBe(2);
    expect(g[0]).toMatchObject({ listingId: '111', productId: 147, nachgezogen: true });
    expect(g[1]).toMatchObject({ listingId: '222', productId: 5, nachgezogen: false });
    expect(g[1].violations.length).toBe(2);
  });

  test('groupByListing: unbekanntes Angebot → productId null', () => {
    const g = groupByListing(flattenViolations(raw, 'HTTPS'), []);
    expect(g[0]).toMatchObject({ productId: null, title: '', nachgezogen: false });
  });

  test('formatReport enthält Summen, Tabelle und Liste ohne Verstoß', () => {
    const md = formatReport({
      summaryCounts: { HTTPS: 1 },
      listings: groupByListing(flattenViolations(raw, 'HTTPS'), products),
      activeWithoutViolation: [{ itemId: '333', title: 'Sauber', productId: 7 }],
      activeTotal: 3,
    });
    expect(md).toContain('- HTTPS: 1');
    expect(md).toContain('| 111 | 147 | Nachgezogen | ja | HTTPS | HTTP_LINK |');
    expect(md).toContain('Aktiv ohne Verstoß: 1 von 3');
    expect(md).toContain('| 333 | 7 | Sauber |');
  });
});
