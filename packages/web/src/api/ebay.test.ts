import { describe, expect, test } from 'bun:test';
import { parseGetStoreResponseXml, buildStoreCategoryBlock } from './ebay';

// P-82 (2026-09-14): XML-Struktur laut eBay-Doku recherchiert (developer.ebay.com,
// GetStoreResponseType/StoreCustomCategoryType) — Store.CustomCategories.CustomCategory[], jede
// mit CategoryID/Name/Order, optional verschachtelten ChildCategory-Elementen (bis zu 3 Ebenen).
// In dieser Sandbox nicht gegen die echte API verifizierbar (kein eBay-Zugriff, s. PR-Beschreibung)
// — diese Fixture bildet die dokumentierte Struktur nach, ist aber keine echte API-Antwort.
// Kategorienamen sind wörtlich aus dem Auftrag übernommen (echter Befund im eBay-Cockpit,
// 14.09.2026: "Sonstiges", "Wohnen & Möbel", "Haustierbedarf").
function buildFixtureResponse(inner: string, ack: 'Success' | 'Failure' = 'Success'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<GetStoreResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>${ack}</Ack>
  <Store>
    <CustomCategories>
      ${inner}
    </CustomCategories>
  </Store>
</GetStoreResponse>`;
}

describe('parseGetStoreResponseXml', () => {
  test('flache Liste ohne Unterkategorien (Top-Level, Auftrag-Beispiele)', () => {
    const xml = buildFixtureResponse(`
      <CustomCategory>
        <CategoryID>101</CategoryID>
        <Name>Sonstiges</Name>
        <Order>1</Order>
      </CustomCategory>
      <CustomCategory>
        <CategoryID>102</CategoryID>
        <Name>Wohnen &amp; Möbel</Name>
        <Order>2</Order>
      </CustomCategory>
      <CustomCategory>
        <CategoryID>103</CategoryID>
        <Name>Haustierbedarf</Name>
        <Order>3</Order>
      </CustomCategory>
    `);

    const result = parseGetStoreResponseXml(xml);

    expect(result).toEqual([
      { categoryId: '101', name: 'Sonstiges', level: 1, fullPath: '/Sonstiges' },
      { categoryId: '102', name: 'Wohnen & Möbel', level: 1, fullPath: '/Wohnen & Möbel' },
      { categoryId: '103', name: 'Haustierbedarf', level: 1, fullPath: '/Haustierbedarf' },
    ]);
  });

  test('verschachtelte Unterkategorien (2 Ebenen) — fullPath baut den kompletten Pfad', () => {
    const xml = buildFixtureResponse(`
      <CustomCategory>
        <CategoryID>102</CategoryID>
        <Name>Wohnen &amp; Möbel</Name>
        <Order>1</Order>
        <ChildCategory>
          <CategoryID>1021</CategoryID>
          <Name>Sofas</Name>
          <Order>1</Order>
        </ChildCategory>
        <ChildCategory>
          <CategoryID>1022</CategoryID>
          <Name>Tische</Name>
          <Order>2</Order>
        </ChildCategory>
      </CustomCategory>
    `);

    const result = parseGetStoreResponseXml(xml);

    expect(result).toEqual([
      { categoryId: '102', name: 'Wohnen & Möbel', level: 1, fullPath: '/Wohnen & Möbel' },
      { categoryId: '1021', name: 'Sofas', level: 2, fullPath: '/Wohnen & Möbel/Sofas' },
      { categoryId: '1022', name: 'Tische', level: 2, fullPath: '/Wohnen & Möbel/Tische' },
    ]);
  });

  test('drei Ebenen (Maximum laut eBay-Doku) — fullPath ist der vollständige Pfad über alle Ebenen', () => {
    const xml = buildFixtureResponse(`
      <CustomCategory>
        <CategoryID>103</CategoryID>
        <Name>Haustierbedarf</Name>
        <Order>1</Order>
        <ChildCategory>
          <CategoryID>1031</CategoryID>
          <Name>Hunde</Name>
          <Order>1</Order>
          <ChildCategory>
            <CategoryID>10311</CategoryID>
            <Name>Leinen &amp; Halsbänder</Name>
            <Order>1</Order>
          </ChildCategory>
        </ChildCategory>
      </CustomCategory>
    `);

    const result = parseGetStoreResponseXml(xml);

    expect(result).toEqual([
      { categoryId: '103', name: 'Haustierbedarf', level: 1, fullPath: '/Haustierbedarf' },
      { categoryId: '1031', name: 'Hunde', level: 2, fullPath: '/Haustierbedarf/Hunde' },
      { categoryId: '10311', name: 'Leinen & Halsbänder', level: 3, fullPath: '/Haustierbedarf/Hunde/Leinen & Halsbänder' },
    ]);
  });

  test('mehrere Geschwister-Kategorien mit je eigenen Unterkategorien werden nicht vermischt', () => {
    const xml = buildFixtureResponse(`
      <CustomCategory>
        <CategoryID>102</CategoryID>
        <Name>Wohnen &amp; Möbel</Name>
        <Order>1</Order>
        <ChildCategory>
          <CategoryID>1021</CategoryID>
          <Name>Sofas</Name>
          <Order>1</Order>
        </ChildCategory>
      </CustomCategory>
      <CustomCategory>
        <CategoryID>103</CategoryID>
        <Name>Haustierbedarf</Name>
        <Order>2</Order>
        <ChildCategory>
          <CategoryID>1031</CategoryID>
          <Name>Hunde</Name>
          <Order>1</Order>
        </ChildCategory>
      </CustomCategory>
    `);

    const result = parseGetStoreResponseXml(xml);

    expect(result.map(r => r.fullPath)).toEqual([
      '/Wohnen & Möbel', '/Wohnen & Möbel/Sofas',
      '/Haustierbedarf', '/Haustierbedarf/Hunde',
    ]);
  });

  test('Ack=Failure wirft mit der ShortMessage als Fehlertext', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetStoreResponse xmlns="urn:ebay:apis:eBLBaseComponents">
  <Ack>Failure</Ack>
  <Errors>
    <ShortMessage>Auth token is invalid.</ShortMessage>
  </Errors>
</GetStoreResponse>`;

    expect(() => parseGetStoreResponseXml(xml)).toThrow('Auth token is invalid.');
  });

  test('leere CustomCategories → leeres Array, kein Absturz', () => {
    const xml = buildFixtureResponse('');
    expect(parseGetStoreResponseXml(xml)).toEqual([]);
  });
});

describe('buildStoreCategoryBlock — Aufgabe 5: ohne Kategorie wird NICHTS mitgesendet', () => {
  test('keine Kategorie hinterlegt (undefined) → leeres Objekt, storeCategoryNames fehlt komplett', () => {
    expect(buildStoreCategoryBlock(undefined)).toEqual({});
  });

  test('leerer String → ebenfalls leeres Objekt (kein Whitespace-Fallback)', () => {
    expect(buildStoreCategoryBlock('   ')).toEqual({});
  });

  test('Kategorie hinterlegt → storeCategoryNames mit genau einem Pfad', () => {
    expect(buildStoreCategoryBlock('/Wohnen & Möbel/Sofas')).toEqual({ storeCategoryNames: ['/Wohnen & Möbel/Sofas'] });
  });
});
