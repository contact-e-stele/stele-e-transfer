import { describe, expect, test } from 'bun:test';
import { parseGetStoreResponseXml, buildStoreCategoryBlock, parseGetCampaignsResponse, hasScope, getRequestedScopeList, deriveConstantVariantAttrs, mapSpecsToAspects, isAspectValueTrusted, buildAspects, findUnresolvedRequiredAspects, findColorInTitle, getAspectDefaultWithSource, resolveRequiredAspect } from './ebay';

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

// P-88 1b: Farb-Übersetzung Englisch→Deutsch (AliExpress-Titel sind fast immer Englisch).
describe('findColorInTitle', () => {
  test('englisches Farbwort im Titel wird erkannt und übersetzt', () => {
    expect(findColorInTitle('White Cotton T-Shirt for Kids')).toBe('Weiß');
  });

  test('deutsches Farbwort im Titel wird direkt erkannt', () => {
    expect(findColorInTitle('Katzenstreuschaufel Set Schwarz Groß & Klein')).toBe('Schwarz');
  });

  test('kein bekanntes Farbwort → null (kein Raten, Grundgesetz Regel 4)', () => {
    expect(findColorInTitle('Katzenstreuschaufel Set Groß & Klein für Katzenklo Reinigen Pet Streu')).toBeNull();
  });

  test('kein Titel → null', () => {
    expect(findColorInTitle(undefined)).toBeNull();
  });

  test('Wortgrenzen-Treffer, keine Teilstring-Fehltreffer (z.B. "Redmi" enthält NICHT "red")', () => {
    expect(findColorInTitle('Xiaomi Redmi Note 12 Case')).toBeNull();
  });

  test('Mehrfarbig-Synonyme (Englisch) werden erkannt', () => {
    expect(findColorInTitle('Multicolor Hair Clips 12 Pack')).toBe('Mehrfarbig');
  });
});

// P-88 1a/1b: hartcodierte Kategorie-/globale Defaults, mit Quellen-Label für den Dry-Run-Bericht.
// Läuft ohne .env-Datei (bun test lädt keine env vars) → DB-Zugriff schlägt fehl, catch-Fallback
// auf die hartcodierten Defaults greift — genau das testet dieser Block (kein echter DB-Zugriff nötig).
describe('getAspectDefaultWithSource', () => {
  test('Kategorie-spezifischer Default (Brillen-Kategorie 179247) → Quelle "kategorie"', async () => {
    const result = await getAspectDefaultWithSource('179247', 'Rahmenmaterial');
    expect(result).toEqual({ value: 'Kunststoff', source: 'kategorie' });
  });

  test('globaler Default (keine Kategorie-Übereinstimmung) → Quelle "global"', async () => {
    const result = await getAspectDefaultWithSource(undefined, 'Marke');
    expect(result).toEqual({ value: 'Markenlos', source: 'global' });
  });

  test('kein Default bekannt → null', async () => {
    const result = await getAspectDefaultWithSource('CAT-UNBEKANNT', 'VoelligUnbekanntesFeld');
    expect(result).toBeNull();
  });
});

// P-88 1a — Live-Fund Kategorie 57920: SELECTION_ONLY-Merkmale müssen exakt in eBays Liste stehen,
// FREE_TEXT-Merkmale (wie "Farbe"/"Produktart" in dieser Kategorie, TROTZ populierter Werteliste)
// akzeptieren jeden nicht-leeren Wert. Ohne diese Unterscheidung hätte der ursprüngliche Bug
// stele-163/164 nie richtig behoben werden können.
describe('resolveRequiredAspect — SELECTION_ONLY vs. FREE_TEXT (P-88 1a, Live-Fund Kategorie 57920)', () => {
  test('SELECTION_ONLY: AliExpress-Kandidat NICHT in der Liste UND Kategorie-Default auch nicht in der Liste → Lücke (kein Rateversuch mit einem Wert, den eBay ohnehin ablehnen würde)', async () => {
    const result = await resolveRequiredAspect(
      'Rahmenform',
      { allowedValues: ['Rund', 'Eckig'], mode: 'SELECTION_ONLY' },
      { Rahmenform: 'Oval' }, // nicht in der Liste
      '179247', // Brillen-Kategorie, ASPECT_DEFAULTS_GLASSES.Rahmenform = 'Unbekannt' — steht aber auch nicht in ['Rund','Eckig']
      {},
    );
    expect(result).toEqual({ value: null, source: null });
  });

  test('SELECTION_ONLY: Kategorie-Default steht tatsächlich in eBays Liste → übernommen, Quelle "kategorie"', async () => {
    const result = await resolveRequiredAspect(
      'Rahmenform',
      { allowedValues: ['Rund', 'Eckig', 'Unbekannt'], mode: 'SELECTION_ONLY' }, // eBay listet hier "Unbekannt" tatsächlich als gültige Option
      {}, // kein AliExpress-Kandidat
      '179247',
      {},
    );
    expect(result).toEqual({ value: 'Unbekannt', source: 'kategorie' });
  });

  test('SELECTION_ONLY: AliExpress-Kandidat IN der Liste → übernommen, Quelle "ali"', async () => {
    const result = await resolveRequiredAspect(
      'Rahmenform',
      { allowedValues: ['Rund', 'Eckig'], mode: 'SELECTION_ONLY' },
      { Rahmenform: 'Rund' },
      '179247',
      {},
    );
    expect(result).toEqual({ value: 'Rund', source: 'ali' });
  });

  test('FREE_TEXT (Live-Fund Farbe/Produktart, Kategorie 57920): Kandidat NICHT in der empfohlenen Liste wird trotzdem übernommen', async () => {
    const result = await resolveRequiredAspect(
      'Farbe',
      { allowedValues: ['Beige', 'Blau', 'Rot'], mode: 'FREE_TEXT' },
      { Farbe: 'Türkis' }, // nicht in eBays Empfehlungsliste, aber FREE_TEXT erlaubt es
      '57920',
      {},
    );
    expect(result).toEqual({ value: 'Türkis', source: 'ali' });
  });

  test('manueller Wert gewinnt immer, auch bei SELECTION_ONLY außerhalb der Liste', async () => {
    const result = await resolveRequiredAspect(
      'Rahmenform',
      { allowedValues: ['Rund', 'Eckig'], mode: 'SELECTION_ONLY' },
      {},
      '179247',
      { Rahmenform: 'Herzförmig' },
    );
    expect(result).toEqual({ value: 'Herzförmig', source: 'manuell' });
  });

  test('nichts gefunden (keine AliExpress-Daten, kein Default, kein manueller Wert) → Lücke', async () => {
    const result = await resolveRequiredAspect(
      'VoelligUnbekanntesFeld',
      { allowedValues: [], mode: 'FREE_TEXT' },
      {},
      undefined,
      {},
    );
    expect(result).toEqual({ value: null, source: null });
  });
});

// P-88 Schritt 1a — Root Cause: getRawAspectsForCategory() cachte einen einzelnen Fehlschlag (z.B.
// 401/500) dauerhaft als [] ohne TTL/Reset, wodurch die Kategorie für den Rest des Prozesses auf
// "keine Pflichtfelder bekannt" gesperrt war (aspectCache/rawAspectsCache, ebay.ts). Diese Tests
// injizieren fetchFn, damit der reale Netzwerkaufruf durch eine Fixture ersetzt werden kann.
function aspectsResponse(aspects: Array<{ name: string; required: boolean; values?: string[]; mode?: 'FREE_TEXT' | 'SELECTION_ONLY' }>): Response {
  return new Response(JSON.stringify({
    aspects: aspects.map(a => ({
      localizedAspectName: a.name,
      aspectConstraint: { aspectRequired: a.required, aspectMode: a.mode },
      aspectValues: a.values?.map(v => ({ localizedValue: v })),
    })),
  }), { status: 200 });
}

// getAppToken() (der Default für getTokenFn) macht einen ECHTEN Netzwerkaufruf — ohne Mock würde
// jeder Test, der ihn nicht explizit ersetzt, real gegen eBay laufen (und ohne .env-Datei mit
// echten Credentials fehlschlagen). Diese Fixture ersetzt ihn überall, wo der konkrete Token-Wert
// keine Rolle spielt (fetchFn ignoriert ihn ohnehin, außer im dedizierten Wiring-Test unten).
const testTokenFn = async () => 'test-token';

describe('buildAspects — Negativ-Cache-Regression (P-88 1a)', () => {
  test('ein fehlgeschlagener Abruf (500) sperrt die Kategorie NICHT dauerhaft — nächster Aufruf mit funktionierendem Fetch liefert den echten Wert', async () => {
    let callCount = 0;
    const fetchFn = (async () => {
      callCount++;
      if (callCount === 1) return new Response('{"errorId":123}', { status: 500 });
      return aspectsResponse([{ name: 'Farbe', required: true, values: ['Mehrfarbig', 'Schwarz'] }]);
    }) as unknown as typeof fetch;

    const first = await buildAspects({}, undefined, 'CAT-A', undefined, undefined, [], undefined, fetchFn, testTokenFn);
    // Beim Fehlschlag ist "Farbe" eBay unbekannt (getRequiredAspects liefert {}) — buildAspects
    // befüllt nur, was es als "required" kennt, kann hier also gar nichts setzen. Genau dieser
    // Zustand (ein Pflichtfeld wurde nie befüllt, weil der Abruf scheiterte) ist der Kern des
    // 1a-Bugs — 1e fängt ihn zusätzlich per findUnresolvedRequiredAspects ab (eigener Test unten).
    expect(first['Farbe']).toBeUndefined();

    const second = await buildAspects({}, undefined, 'CAT-A', undefined, undefined, [], undefined, fetchFn, testTokenFn);
    // Regressionsbeweis: ohne den 1a-Fix bliebe hier weiterhin "Nicht angegeben" (dauerhaft gecachtes [])
    expect(second['Farbe']).toEqual(['Mehrfarbig']);
    expect(callCount).toBe(2);
  });
});

// P-88 Schritt 1a — ECHTER Root Cause (20.09.2026, live gegen category_id=57920 geprüft):
// getRawAspectsForCategory() rief die Taxonomy API bisher mit dem User-Access-Token
// (getAccessToken(), refresh_token-Flow) auf. Live-Test: User-Token → 403 Forbidden
// ({"errorId":1100,...,"message":"Access denied","longMessage":"Insufficient permissions to
// fulfill the request."}), App-Token (getAppToken(), client_credentials-Flow) → 200 OK mit allen
// 18 Aspekten der Kategorie (inkl. Farbe: 16 Werte, Produktart: 24 Werte, beide required=true).
// Der 403 wurde vom alten Negativ-Cache dauerhaft als "keine Aspekte" gespeichert — das erklärt
// den GESAMTEN ursprünglichen Bug (nicht nur Kategorie 57920): buildAspects() konnte für KEINE
// Kategorie je ein Pflichtfeld automatisch befüllen, weil der Taxonomy-Abruf grundsätzlich mit dem
// falschen Token-Typ scheiterte. Fix: getTokenFn-Parameter (Default: getAppToken), keine
// User-Token-Abhängigkeit mehr für die Taxonomy API.
describe('buildAspects — App-Token statt User-Token für die Taxonomy API (P-88 1a, echter Root Cause)', () => {
  test('getTokenFn wird tatsächlich für den Authorization-Header verwendet, nicht ignoriert', async () => {
    const seen: { authHeader: string | null } = { authHeader: null };
    const fetchFn = (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      seen.authHeader = init?.headers?.['Authorization'] ?? null;
      return aspectsResponse([{ name: 'Farbe', required: true, values: ['Mehrfarbig'] }]);
    }) as unknown as typeof fetch;
    const getTokenFn = async () => 'APP-TOKEN-XYZ';

    await buildAspects({}, undefined, 'CAT-H', undefined, undefined, [], undefined, fetchFn, getTokenFn);

    expect(seen.authHeader).toBe('Bearer APP-TOKEN-XYZ');
  });

  test('Regressionsbeweis: 403 (falscher Token-Typ, wie beim echten User-Token) verhält sich wie jeder andere Abruf-Fehler — kein Absturz, kein falscher Wert', async () => {
    const fetchFn = (async () => new Response(
      '{"errors":[{"errorId":1100,"domain":"ACCESS","category":"REQUEST","message":"Access denied","longMessage":"Insufficient permissions to fulfill the request."}]}',
      { status: 403 },
    )) as unknown as typeof fetch;

    const result = await buildAspects({}, undefined, 'CAT-I', undefined, undefined, [], undefined, fetchFn, testTokenFn);
    expect(result['Farbe']).toBeUndefined();
  });
});

describe('buildAspects — Variantenattribute als Aspekt-Quelle (P-88 1b)', () => {
  test('konstanter, von eBay erlaubter Variantenwert wird übernommen', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Material', required: true, values: ['Kunststoff', 'Holz'] }])) as unknown as typeof fetch;
    const result = await buildAspects(
      {}, undefined, 'CAT-B', undefined, undefined,
      [{ Material: 'Kunststoff' }, { Material: 'Kunststoff' }],
      undefined, fetchFn, testTokenFn,
    );
    expect(result['Material']).toEqual(['Kunststoff']);
  });

  test('Live-Fund stele-163: Variantenwert nicht in eBays erlaubter Liste → verworfen, echter erlaubter Wert stattdessen', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Farbe', required: true, values: ['Mehrfarbig', 'Schwarz'] }])) as unknown as typeof fetch;
    const result = await buildAspects(
      {}, undefined, 'CAT-C', undefined, undefined,
      [{ Color: '832pcs-No box' }, { Color: '100pcs-No box' }],
      undefined, fetchFn, testTokenFn,
    );
    // "Color" wechselt pro Variante → deriveConstantVariantAttrs verwirft es bereits (eigener Test oben) —
    // hier zusätzlich bewiesen: selbst wenn es durchrutschen würde, weist isAspectValueTrusted es zurück.
    expect(result['Farbe']).toEqual(['Mehrfarbig']);
  });

  test('manuelles Feld überschreibt weiterhin alles, auch einen automatisch befüllten Wert', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Farbe', required: true, values: ['Mehrfarbig'] }])) as unknown as typeof fetch;
    const result = await buildAspects(
      {}, undefined, 'CAT-D', undefined, { Farbe: 'Regenbogen' },
      [{ Color: 'Rot' }, { Color: 'Rot' }],
      undefined, fetchFn, testTokenFn,
    );
    expect(result['Farbe']).toEqual(['Regenbogen']);
  });
});

// P-88 Schritt 1e — Vorab-Prüfung: prüft PROAKTIV alle Pflichtmerkmale einer Kategorie, bevor der
// eBay-Aufruf überhaupt versucht wird — nicht erst nach einem eBay-Fehler abwarten (Nutzer-Auftrag
// 20.09.2026, erweitert gegenüber der ursprünglichen 1e-Fassung, die nur bereits bekannte
// ebayMissingAspect-Namen prüfte).
describe('findUnresolvedRequiredAspects', () => {
  test('Pflichtmerkmal mit eigenem erlaubten Fallback-Wert → nicht blockierend, auch ohne manuellen/Auto-Wert', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Farbe', required: true, values: ['Mehrfarbig', 'Schwarz'] }])) as unknown as typeof fetch;
    const unresolved = await findUnresolvedRequiredAspects(
      {}, 'CAT-E', {}, [{ Color: '832pcs-No box' }, { Color: '100pcs-No box' }], undefined, fetchFn, testTokenFn,
    );
    expect(unresolved).toEqual([]); // "Farbe" hat einen erlaubten Fallback-Wert (Mehrfarbig) → nicht blockierend
  });

  test('manueller Wert vorhanden → gilt als gelöst', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Produktart', required: true }])) as unknown as typeof fetch;
    const unresolved = await findUnresolvedRequiredAspects(
      {}, 'CAT-F', { Produktart: 'Haarspange' }, [], undefined, fetchFn, testTokenFn,
    );
    expect(unresolved).toEqual([]);
  });

  test('Merkmal ohne erlaubte Werteliste (Freitext) und ohne bekannten Default → bleibt ungelöst, wird namentlich genannt', async () => {
    const fetchFn = (async () => aspectsResponse([{ name: 'Produktart', required: true, values: [] }])) as unknown as typeof fetch;
    const unresolved = await findUnresolvedRequiredAspects(
      {}, 'CAT-G', {}, [], undefined, fetchFn, testTokenFn,
    );
    expect(unresolved).toEqual(['Produktart']);
  });

  test('proaktiv: auch ohne vorherigen eBay-Fehlschlag werden ALLE Pflichtmerkmale der Kategorie geprüft', async () => {
    const fetchFn = (async () => aspectsResponse([
      { name: 'Farbe', required: true, values: ['Mehrfarbig', 'Schwarz'] },
      { name: 'Produktart', required: true, values: [] },
    ])) as unknown as typeof fetch;
    // Kein bekannter Fehlschlag, keine manuellen Werte — trotzdem wird "Produktart" gefunden,
    // weil es proaktiv (nicht nur reaktiv nach einem eBay-Fehler) geprüft wird.
    const unresolved = await findUnresolvedRequiredAspects({}, 'CAT-J', {}, [], undefined, fetchFn, testTokenFn);
    expect(unresolved).toEqual(['Produktart']);
  });
});
