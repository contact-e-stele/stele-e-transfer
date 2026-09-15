import { describe, expect, test } from 'bun:test';
import { parseGetStoreResponseXml, buildStoreCategoryBlock, parseGetCampaignsResponse, hasScope, getRequestedScopeList } from './ebay';

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

// P-81 Stufe 1 (2026-09-14): Feldnamen laut eBay-Doku recherchiert (developer.ebay.com,
// getCampaigns) — in dieser Sandbox nicht gegen die echte API verifizierbar (kein eBay-Zugriff,
// s. PR-Beschreibung). Diese Fixture bildet die dokumentierte Struktur nach, ist keine echte
// API-Antwort.
describe('parseGetCampaignsResponse', () => {
  test('echte Feldstruktur laut Doku — campaignId/campaignName/campaignStatus/campaignTargetingType/fundingStrategy.fundingModel', () => {
    const response = {
      campaigns: [
        {
          campaignId: '10123456789',
          campaignName: 'Herbst-Kampagne',
          campaignStatus: 'RUNNING',
          campaignTargetingType: 'PROMOTED_LISTINGS_ADVANCED',
          fundingStrategy: { fundingModel: 'COST_PER_SALE', biddingStrategy: 'FIXED' },
        },
      ],
    };

    expect(parseGetCampaignsResponse(response)).toEqual([
      { campaignId: '10123456789', campaignName: 'Herbst-Kampagne', campaignStatus: 'RUNNING', campaignTargetingType: 'PROMOTED_LISTINGS_ADVANCED', fundingModel: 'COST_PER_SALE' },
    ]);
  });

  test('keine Kampagnen → leeres Array, kein Absturz', () => {
    expect(parseGetCampaignsResponse({ campaigns: [] })).toEqual([]);
    expect(parseGetCampaignsResponse({})).toEqual([]);
  });

  test('fehlendes fundingStrategy/campaignTargetingType → null statt Absturz', () => {
    const response = { campaigns: [{ campaignId: '1', campaignName: 'X', campaignStatus: 'DRAFT' }] };
    expect(parseGetCampaignsResponse(response)).toEqual([
      { campaignId: '1', campaignName: 'X', campaignStatus: 'DRAFT', campaignTargetingType: null, fundingModel: null },
    ]);
  });

  test('Kampagne ohne campaignId/campaignName wird übersprungen statt mit leeren Feldern übernommen', () => {
    const response = { campaigns: [{ campaignStatus: 'ENDED' }] };
    expect(parseGetCampaignsResponse(response)).toEqual([]);
  });

  test('mehrere Kampagnen, gemischter Status', () => {
    const response = {
      campaigns: [
        { campaignId: '1', campaignName: 'A', campaignStatus: 'RUNNING', fundingStrategy: { fundingModel: 'COST_PER_CLICK' } },
        { campaignId: '2', campaignName: 'B', campaignStatus: 'PAUSED', fundingStrategy: { fundingModel: 'COST_PER_SALE' } },
      ],
    };
    expect(parseGetCampaignsResponse(response).map(c => [c.campaignId, c.campaignStatus])).toEqual([
      ['1', 'RUNNING'], ['2', 'PAUSED'],
    ]);
  });
});

describe('getRequestedScopeList', () => {
  test('enthält alle vier benötigten Scopes inkl. sell.marketing', () => {
    const scopes = getRequestedScopeList();
    expect(scopes.some(s => s.endsWith('/sell.inventory'))).toBe(true);
    expect(scopes.some(s => s.endsWith('/sell.account'))).toBe(true);
    expect(scopes.some(s => s.endsWith('/sell.fulfillment'))).toBe(true);
    expect(scopes.some(s => s.endsWith('/sell.marketing'))).toBe(true);
  });
});

describe('hasScope', () => {
  const granted = [
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    'https://api.ebay.com/oauth/api_scope/sell.marketing',
  ].join(' ');

  test('erkennt vorhandenen Scope', () => {
    expect(hasScope(granted, 'sell.marketing')).toBe(true);
  });

  test('erkennt fehlenden Scope (alter Token vor P-81)', () => {
    const oldGrant = [
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    ].join(' ');
    expect(hasScope(oldGrant, 'sell.marketing')).toBe(false);
  });

  test('leerer Scope-String → immer false', () => {
    expect(hasScope('', 'sell.marketing')).toBe(false);
  });
});
