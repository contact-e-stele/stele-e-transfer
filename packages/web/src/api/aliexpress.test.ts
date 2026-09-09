// P-27/P-28 PR 6, Teil B (2026-09-09): AliExpress-Verfügbarkeit prüfen + eBay automatisch
// deaktivieren. Live-Fund: Produkt 71 (de.aliexpress.com/item/1005006895494400.html) — Quellartikel
// nicht mehr verfügbar, gleichzeitig sind normale Scraping-Fehler/Timeouts (Netzwerk-Hänger,
// 403/429/5xx, AliExpress-Rate-Limiting) im laufenden Betrieb häufig und dürfen NIEMALS eine
// automatische Deaktivierung einer noch aktiven, verkaufenden Anzeige auslösen (Umsatzschaden-
// Risiko, explizite Anforderung von Evgenij). Diese Tests prüfen beide Seiten: (a) eindeutige
// Nicht-Verfügbarkeit wird erkannt, (b) alles Uneindeutige wird explizit NICHT als "unavailable"
// gewertet.
import { describe, expect, test } from 'bun:test';

const { classifySourceUnavailability, checkSourceAvailability } = await import('./aliexpress');

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
