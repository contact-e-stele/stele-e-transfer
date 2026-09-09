// P-27/P-28 PR 6, Teil B (2026-09-09): AliExpress-Verfügbarkeit prüfen + eBay automatisch
// deaktivieren. Live-Fund: Produkt 71 (de.aliexpress.com/item/1005006895494400.html) — Quellartikel
// nicht mehr verfügbar, gleichzeitig sind normale Scraping-Fehler/Timeouts (Netzwerk-Hänger,
// 403/429/5xx, AliExpress-Rate-Limiting) im laufenden Betrieb häufig und dürfen NIEMALS eine
// automatische Deaktivierung einer noch aktiven, verkaufenden Anzeige auslösen (Umsatzschaden-
// Risiko, explizite Anforderung von Evgenij). Diese Tests prüfen beide Seiten: (a) eindeutige
// Nicht-Verfügbarkeit wird erkannt, (b) alles Uneindeutige wird explizit NICHT als "unavailable"
// gewertet.
import { describe, expect, test } from 'bun:test';

process.env.TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL || 'file:/tmp/aliexpress-test.db';
const {
  classifySourceUnavailability, checkSourceAvailability, checkDsApiUnavailability, raceWithHardTimeout,
} = await import('./aliexpress');

describe('classifySourceUnavailability (reine Klassifikation, kein Netzwerkzugriff)', () => {
  test('HTTP 404 gilt immer als eindeutig nicht verfügbar', () => {
    const result = classifySourceUnavailability(404, '');
    expect(result.unavailable).toBe(true);
    expect(result.reason).toContain('404');
  });

  test('bestätigter "currently unavailable in your location"-Text (Live-Fund Produkt 71) gilt als nicht verfügbar', () => {
    const body = '<html><body>Sorry, this item is currently unavailable in your location.</body></html>';
    const result = classifySourceUnavailability(200, body);
    expect(result.unavailable).toBe(true);
    expect(result.reason).toContain('currently unavailable in your location');
  });

  test('Textmarker-Erkennung ist case-insensitiv', () => {
    const body = 'THIS ITEM IS NO LONGER AVAILABLE for purchase.';
    const result = classifySourceUnavailability(200, body);
    expect(result.unavailable).toBe(true);
  });

  // Der zentrale False-Positive-Schutz: alles außer 404 oder einem der vier bekannten
  // Textmarker gilt als NICHT nachgewiesen nicht-verfügbar — auch bei Status 200. Ein normaler
  // Seiteninhalt (z.B. weil der Artikel weiterhin verfügbar ist, aber der Scraper aus einem
  // ANDEREN Grund keine Daten extrahieren konnte) löst nichts aus.
  test('normaler Seiteninhalt (Status 200, kein Marker) gilt NICHT als nicht verfügbar', () => {
    const body = '<html><body>Produkt XY — Preis 12,99€ — Auf Lager</body></html>';
    const result = classifySourceUnavailability(200, body);
    expect(result.unavailable).toBe(false);
  });

  test('403 (Bot-/Rate-Limit-Block, KEIN Beweis für Nichtverfügbarkeit) gilt NICHT als nicht verfügbar', () => {
    const result = classifySourceUnavailability(403, 'Access Denied');
    expect(result.unavailable).toBe(false);
  });

  test('429 (Rate Limiting) gilt NICHT als nicht verfügbar', () => {
    const result = classifySourceUnavailability(429, '');
    expect(result.unavailable).toBe(false);
  });

  test('5xx-Serverfehler bei AliExpress gilt NICHT als nicht verfügbar', () => {
    const result = classifySourceUnavailability(503, 'Service Unavailable');
    expect(result.unavailable).toBe(false);
  });
});

describe('checkSourceAvailability (Netzwerk-Wrapper, gemockter fetch)', () => {
  test('404-Response → unavailable: true', async () => {
    globalThis.fetch = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch;
    const result = await checkSourceAvailability('https://de.aliexpress.com/item/1005006895494400.html');
    expect(result.unavailable).toBe(true);
  });

  test('Status 200 mit bestätigtem Nicht-verfügbar-Text → unavailable: true', async () => {
    globalThis.fetch = (async () =>
      new Response('<html>This product is no longer available.</html>', { status: 200 })
    ) as unknown as typeof fetch;
    const result = await checkSourceAvailability('https://de.aliexpress.com/item/123.html');
    expect(result.unavailable).toBe(true);
  });

  // Der wichtigste Einzeltest hier: ein Netzwerk-Timeout/-Fehler (z.B. Verbindungsabbruch,
  // AbortSignal-Timeout) — der HÄUFIGSTE Fall eines fehlgeschlagenen Scrapes im Live-Betrieb —
  // darf NIEMALS als "nicht verfügbar" interpretiert werden. Ohne dieses Verhalten würde jeder
  // vorübergehende Netzwerk-Hänger eine noch aktive, verkaufende eBay-Anzeige automatisch
  // beenden — genau das vom Nutzer explizit verlangte False-Positive-Szenario.
  test('Netzwerkfehler/Timeout beim fetch → unavailable: false (kein False Positive)', async () => {
    globalThis.fetch = (async () => { throw new Error('network timeout'); }) as unknown as typeof fetch;
    const result = await checkSourceAvailability('https://de.aliexpress.com/item/123.html');
    expect(result.unavailable).toBe(false);
  });

  test('403 (Bot-Block, transient) → unavailable: false (kein False Positive)', async () => {
    globalThis.fetch = (async () => new Response('Access Denied', { status: 403 })) as unknown as typeof fetch;
    const result = await checkSourceAvailability('https://de.aliexpress.com/item/123.html');
    expect(result.unavailable).toBe(false);
  });
});

// Schritt 1 (2026-09-09, live nachgewiesen): tote/blockierte Quellen liefern über die DS-API
// oft KEINEN HTTP-Fehler und KEINEN Textmarker auf der HTML-Seite, sondern einen eigenen
// API-Fehlercode 482 mit sub_code "isv.SHIP_TO_COUNTRY_PROHIBITED". classifySourceUnavailability()
// muss dieses Signal zusätzlich zu HTTP 404 + den 4 bestehenden Textmarkern erkennen — aber
// NICHT bei einem beliebigen/unbekannten DS-API-Fehlercode (sonst wäre jeder andere DS-API-Fehler
// ein neuer False-Positive-Kanal).
describe('classifySourceUnavailability — DS-API-Fehlercode 482 (SHIP_TO_COUNTRY_PROHIBITED)', () => {
  test('rsp_code 482 (numerisch, ohne sub_code) wird korrekt als nicht verfügbar erkannt', () => {
    const result = classifySourceUnavailability(200, '', '482');
    expect(result.unavailable).toBe(true);
    expect(result.reason).toContain('482');
  });

  test('sub_code "isv.SHIP_TO_COUNTRY_PROHIBITED" (Textform) wird korrekt erkannt', () => {
    const result = classifySourceUnavailability(200, '', 'isv.SHIP_TO_COUNTRY_PROHIBITED');
    expect(result.unavailable).toBe(true);
  });

  test('code+sub_code kombiniert ("482 isv.SHIP_TO_COUNTRY_PROHIBITED") wird erkannt', () => {
    const result = classifySourceUnavailability(200, '', '482 isv.SHIP_TO_COUNTRY_PROHIBITED');
    expect(result.unavailable).toBe(true);
  });

  // False-Positive-Schutz: ein beliebiger ANDERER DS-API-Fehlercode (z.B. Rate-Limit,
  // Auth-Fehler, temporärer Serverfehler) darf NICHT automatisch als "nicht verfügbar" gelten —
  // nur der spezifisch bestätigte 482/SHIP_TO_COUNTRY_PROHIBITED-Fall.
  test('anderer/unbekannter DS-API-Fehlercode löst NICHTS aus (kein False Positive)', () => {
    const result = classifySourceUnavailability(200, '', '15 isv.INVALID_TIMESTAMP');
    expect(result.unavailable).toBe(false);
  });

  test('kein dsApiErrorCode übergeben → Verhalten bleibt exakt wie vorher (Regressionsschutz)', () => {
    const result = classifySourceUnavailability(200, 'normaler Inhalt');
    expect(result.unavailable).toBe(false);
  });
});

describe('checkDsApiUnavailability (Netzwerk-Wrapper für die DS-API-Fehlercode-Prüfung, gemockter fetch)', () => {
  test('error_response mit code 482 → unavailable: true', async () => {
    process.env.ALIEXPRESS_ACCESS_TOKEN = 'test-token';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error_response: { code: '482', sub_code: 'isv.SHIP_TO_COUNTRY_PROHIBITED', msg: 'Ship to country prohibited' } }), { status: 200 })
    ) as unknown as typeof fetch;
    const result = await checkDsApiUnavailability('1005006895494400');
    expect(result.unavailable).toBe(true);
    delete process.env.ALIEXPRESS_ACCESS_TOKEN;
  });

  test('erfolgreiche DS-API-Antwort (aliexpress_ds_product_get_response vorhanden) → unavailable: false', async () => {
    process.env.ALIEXPRESS_ACCESS_TOKEN = 'test-token';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ aliexpress_ds_product_get_response: { result: { subject: 'Test' } } }), { status: 200 })
    ) as unknown as typeof fetch;
    const result = await checkDsApiUnavailability('123');
    expect(result.unavailable).toBe(false);
    delete process.env.ALIEXPRESS_ACCESS_TOKEN;
  });

  test('anderer error_response-Code (z.B. Rate-Limit) → unavailable: false (kein False Positive)', async () => {
    process.env.ALIEXPRESS_ACCESS_TOKEN = 'test-token';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error_response: { code: '38', sub_code: 'isv.SUMMER-FLOW-CONTROL', msg: 'Rate limit' } }), { status: 200 })
    ) as unknown as typeof fetch;
    const result = await checkDsApiUnavailability('123');
    expect(result.unavailable).toBe(false);
    delete process.env.ALIEXPRESS_ACCESS_TOKEN;
  });

  test('Netzwerkfehler bei der DS-API selbst → unavailable: false (kein False Positive)', async () => {
    process.env.ALIEXPRESS_ACCESS_TOKEN = 'test-token';
    globalThis.fetch = (async () => { throw new Error('network error'); }) as unknown as typeof fetch;
    const result = await checkDsApiUnavailability('123');
    expect(result.unavailable).toBe(false);
    delete process.env.ALIEXPRESS_ACCESS_TOKEN;
  });

  test('kein Access Token vorhanden → unavailable: false, kein Absturz', async () => {
    delete process.env.ALIEXPRESS_ACCESS_TOKEN;
    globalThis.fetch = (async () => { throw new Error('sollte nicht aufgerufen werden'); }) as unknown as typeof fetch;
    const result = await checkDsApiUnavailability('123');
    expect(result.unavailable).toBe(false);
  });
});

// Schritt 1 (2026-09-09, live nachgewiesen: Playwright hängt >3 Min. bei toten Quellen ohne
// jemals aufzulösen). scrapeWithPlaywright() selbst kann hier nicht direkt getestet werden, da
// echtes Playwright/Chromium im Sandbox/CI nicht verfügbar ist (PLAYWRIGHT_AVAILABLE=false) —
// ein hängender echter Browser-Call lässt sich damit nicht reproduzieren. raceWithHardTimeout()
// ist die exakte, aus scrapeWithPlaywright() extrahierte generische Absicherung, die das
// Hänge-Problem behebt — dieser Test beweist sie direkt und ohne Mocks, mit echten Timern.
describe('raceWithHardTimeout (generische Timeout-Absicherung hinter scrapeWithPlaywright())', () => {
  test('eine für immer hängende Promise löst nach dem Timeout trotzdem mit null auf (statt unendlich zu hängen)', async () => {
    const neverResolves = new Promise<string>(() => { /* löst absichtlich nie auf — simuliert den Live-Hang */ });
    const start = Date.now();
    let timeoutCalled = false;

    const result = await raceWithHardTimeout(neverResolves, 50, () => { timeoutCalled = true; });

    const elapsed = Date.now() - start;
    expect(result).toBeNull();
    expect(timeoutCalled).toBe(true);
    // Muss nach ~50ms zurückkommen, nicht nach Minuten — die eigentliche Behauptung des Fixes.
    expect(elapsed).toBeLessThan(1000);
  });

  test('eine werfende (rejected) Promise wird ebenfalls sicher aufgefangen, wenn der Aufrufer selbst catcht', async () => {
    // scrapeWithPlaywrightInner() fängt intern jeden Fehler ab und löst mit null auf statt zu
    // werfen (siehe catch-Block dort) — hier wird genau dieses Vertragsverhalten nachgebildet.
    const throwingWork = (async () => {
      try {
        throw new Error('Playwright-Absturz');
      } catch {
        return null;
      }
    })();
    const result = await raceWithHardTimeout(throwingWork, 5000);
    expect(result).toBeNull();
  });

  test('eine normale, schnell auflösende Quelle bleibt unverändert schnell/fehlerfrei — Timeout greift nicht ein', async () => {
    const fastWork = Promise.resolve('erfolgreiches Ergebnis');
    let timeoutCalled = false;

    const start = Date.now();
    const result = await raceWithHardTimeout(fastWork, 5000, () => { timeoutCalled = true; });
    const elapsed = Date.now() - start;

    expect(result).toBe('erfolgreiches Ergebnis');
    expect(timeoutCalled).toBe(false);
    expect(elapsed).toBeLessThan(200);
  });
});
