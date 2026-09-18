import { describe, expect, test } from 'bun:test';
import { parseGetStoreResponseXml, buildStoreCategoryBlock, parseGetCampaignsResponse, hasScope, getRequestedScopeList, deriveConstantVariantAttrs, mapSpecsToAspects, isAspectValueTrusted, buildAspects, findUnresolvedRequiredAspects } from './ebay';

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

// P-88 Schritt 1b — Live-Fund stele-163/164 (18.09.2026): AliExpress liefert den Attribut-Schlüssel
// "Color" auch dann, wenn der Wert gar keine Farbe ist (z.B. "832pcs-No box" = Stückzahl). Ein Wert,
// der zwischen den Varianten eines Produkts wechselt, ist entweder eine echte Variationsachse (wird
// bereits pro Kombination gesetzt) oder genau dieser Fehlbeschriftungs-Fall — beides darf NICHT als
// Basis-Aspekt übernommen werden (Grundgesetz Regel 4). Nur ein über ALLE Varianten hinweg
// konstanter Wert ist eine echte Produkteigenschaft.
describe('deriveConstantVariantAttrs', () => {
  test('Wert konstant über alle Varianten → wird übernommen', () => {
    const result = deriveConstantVariantAttrs([
      { Material: 'Kunststoff', Color: 'Rot' },
      { Material: 'Kunststoff', Color: 'Blau' },
    ]);
    expect(result).toEqual({ Material: 'Kunststoff' });
  });

  test('Live-Fund stele-163: "Color" enthält Stückzahl statt Farbe, wechselt pro Variante → verworfen', () => {
    const result = deriveConstantVariantAttrs([
      { Color: '832pcs-No box' },
      { Color: '100pcs-No box' },
    ]);
    expect(result).toEqual({});
  });

  test('nur eine Variante (Einzelprodukt) → alle Attribute gelten als konstant', () => {
    const result = deriveConstantVariantAttrs([{ Color: 'Schwarz', Material: 'Metall' }]);
    expect(result).toEqual({ Color: 'Schwarz', Material: 'Metall' });
  });

  test('keine Varianten → leeres Objekt', () => {
    expect(deriveConstantVariantAttrs([])).toEqual({});
  });
});

describe('mapSpecsToAspects', () => {
  test('bekannte AliExpress-Keys werden auf eBay-Aspektnamen gemappt', () => {
    const result = mapSpecsToAspects({ Color: 'Rot', Material: 'Holz', UnbekannterKey: 'x' });
    expect(result).toEqual({ Farbe: 'Rot', Material: 'Holz' });
  });
});

describe('isAspectValueTrusted', () => {
  test('manuell gesetzter Wert ist immer vertrauenswürdig, auch außerhalb der erlaubten Liste', () => {
    expect(isAspectValueTrusted('Irgendwas', ['Rot', 'Blau'], true)).toBe(true);
  });

  test('Freitext-Aspekt (keine erlaubte Liste) ist immer vertrauenswürdig', () => {
    expect(isAspectValueTrusted('Irgendwas', [], false)).toBe(true);
  });

  test('Wert aus eBays erlaubter Liste (case-insensitive) ist vertrauenswürdig', () => {
    expect(isAspectValueTrusted('rot', ['Rot', 'Blau'], false)).toBe(true);
  });

  test('Wert NICHT in eBays erlaubter Liste ist nicht vertrauenswürdig', () => {
    expect(isAspectValueTrusted('832pcs-No box', ['Rot', 'Blau'], false)).toBe(false);
  });
});

// P-88 Schritt 1a — Root Cause: getRawAspectsForCategory() cachte einen einzelnen Fehlschlag (z.B.
// 401/500) dauerhaft als [] ohne TTL/Reset, wodurch die Kategorie für den Rest des Prozesses auf
// "keine Pflichtfelder bekannt" gesperrt war (aspectCache/rawAspectsCache, ebay.ts). Diese Tests
// injizieren fetchFn, damit der reale Netzwerkaufruf durch eine Fixture ersetzt werden kann.
function aspectsResponse(aspects: Array<{ name: string; required: boolean; values?: string[] }>): Response {
  return new Response(JSON.stringify({
    aspects: aspects.map(a => ({
      localizedAspectName: a.name,
      aspectConstraint: { aspectRequired: a.required },
      aspectValues: a.values?.map(v => ({ localizedValue: v })),
    })),
  }), { status: 200 });
}

describe('buildAspects — Negativ-Cache-Regression (P-88 1a)', () => {
  test('ein fehlgeschlagener Abruf (500) sperrt die Kategorie NICHT dauerhaft — nächster Aufruf mit funktionierendem Fetch liefert den echten Wert', async () => {
    let callCount = 0;
    const fetchFn = (async () => {
      callCount++;
      if (callCount === 1) return new Response('{"errorId":123}', { status: 500 });
      return aspectsResponse([{ name: 'Farbe', required: true, values: ['Mehrfarbig', 'Schwarz'] }]);
    }) as unknown as typeof fetch;

    const first = await buildAspects({}, undefined, 'CAT-A', 'token', undefined, undefined, [], fetchFn);
    // Beim Fehlschlag ist "Farbe" eBay unbekannt (getRequiredAspects liefert {}) — buildAspects
    // befüllt nur, was es als "required" kennt, kann hier also gar nichts setzen. Genau dieser
    // Zustand (ein Pflichtfeld wurde nie befüllt, weil der Abruf scheiterte) ist der Kern des
    // 1a-Bugs — 1e fängt ihn zusätzlich per findUnresolvedRequiredAspects ab (eigener Test unten).
    expect(first['Farbe']).toBeUndefined();

    const second = await buildAspects({}, undefined, 'CAT-A', 'token', undefined, undefined, [], fetchFn);
    // Regressionsbeweis: ohne den 1a-Fix bliebe hier weiterhin "Nicht angegeben" (dauerhaft gecachtes [])
    expect(second['Farbe']).toEqual(['Mehrfarbig']);
    expect(callCount).toBe(2);
  });
});

describe('buildAspects — Variantenattribute als Aspekt-Quelle (P-88 1b)', () => {
  test('konstanter, von eBay erlaubter Variantenwert wird übernommen', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Material', required: true, values: ['Kunststoff', 'Holz'] }])) as unknown as typeof fetch;
    const result = await buildAspects(
      {}, undefined, 'CAT-B', 'token', undefined, undefined,
      [{ Material: 'Kunststoff' }, { Material: 'Kunststoff' }],
      fetchFn,
    );
    expect(result['Material']).toEqual(['Kunststoff']);
  });

  test('Live-Fund stele-163: Variantenwert nicht in eBays erlaubter Liste → verworfen, echter erlaubter Wert stattdessen', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Farbe', required: true, values: ['Mehrfarbig', 'Schwarz'] }])) as unknown as typeof fetch;
    const result = await buildAspects(
      {}, undefined, 'CAT-C', 'token', undefined, undefined,
      [{ Color: '832pcs-No box' }, { Color: '100pcs-No box' }],
      fetchFn,
    );
    // "Color" wechselt pro Variante → deriveConstantVariantAttrs verwirft es bereits (eigener Test oben) —
    // hier zusätzlich bewiesen: selbst wenn es durchrutschen würde, weist isAspectValueTrusted es zurück.
    expect(result['Farbe']).toEqual(['Mehrfarbig']);
  });

  test('manuelles Feld überschreibt weiterhin alles, auch einen automatisch befüllten Wert', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Farbe', required: true, values: ['Mehrfarbig'] }])) as unknown as typeof fetch;
    const result = await buildAspects(
      {}, undefined, 'CAT-D', 'token', undefined, { Farbe: 'Regenbogen' },
      [{ Color: 'Rot' }, { Color: 'Rot' }],
      fetchFn,
    );
    expect(result['Farbe']).toEqual(['Regenbogen']);
  });
});

// P-88 Schritt 1e — Vorab-Prüfung: ein von eBay bereits als fehlend gemeldetes Pflichtmerkmal
// (product.ebayMissingAspect, echte eBay-Fehlermeldung aus einem vorherigen Versuch) blockiert den
// nächsten eBay-Aufruf, solange kein vertrauenswürdiger Wert (manuell oder Auto-Heal) vorliegt.
describe('findUnresolvedRequiredAspects', () => {
  test('bekanntes fehlendes Merkmal ohne manuellen Wert und ohne trusted Auto-Wert → bleibt ungelöst', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Farbe', required: true, values: ['Mehrfarbig', 'Schwarz'] }])) as unknown as typeof fetch;
    const unresolved = await findUnresolvedRequiredAspects(
      ['Farbe'], {}, 'CAT-E', 'token', {}, [{ Color: '832pcs-No box' }, { Color: '100pcs-No box' }], fetchFn,
    );
    expect(unresolved).toEqual([]); // "Farbe" hat einen erlaubten Fallback-Wert (Mehrfarbig) → nicht blockierend
  });

  test('manueller Wert vorhanden → gilt als gelöst', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Produktart', required: true }])) as unknown as typeof fetch;
    const unresolved = await findUnresolvedRequiredAspects(
      ['Produktart'], {}, 'CAT-F', 'token', { Produktart: 'Haarspange' }, [], fetchFn,
    );
    expect(unresolved).toEqual([]);
  });

  test('Merkmal ohne erlaubte Werteliste (Freitext) und ohne bekannten Default → bleibt ungelöst, wird namentlich genannt', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Produktart', required: true, values: [] }])) as unknown as typeof fetch;
    const unresolved = await findUnresolvedRequiredAspects(
      ['Produktart'], {}, 'CAT-G', 'token', {}, [], fetchFn,
    );
    expect(unresolved).toEqual(['Produktart']);
  });
});
