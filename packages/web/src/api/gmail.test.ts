import { describe, expect, test } from 'bun:test';
import { parsePackageStatusEmail, looksLikeCarrierTrackingNumber } from './gmail';

// P2 Teil 2 (2026-09-14): Subject-Zeilen und der o_ids=-Parameter sind WÖRTLICH aus dem Auftrag
// übernommen — der Nutzer hat sie manuell aus echten Mails abgelesen ("im geprüften Beispiel
// o_ids=3076306514497211"). Diese Tests prüfen die PARSER-LOGIK gegen diese echten, verbürgten
// Werte, ersetzen aber NICHT einen echten Gmail-Lauf (in dieser Sandbox nicht möglich — kein
// GOOGLE_GMAIL_CLIENT_ID/_SECRET in .env, s. PR-Beschreibung: "[Gmail] Token-Refresh
// fehlgeschlagen: 400 Could not determine client ID from request"). scripts/inspect-package-
// status-emails.ts steht bereit, sobald Gmail-Zugangsdaten verfügbar sind.
const REAL_TRACKING_NUMBER = '00340434886289512140'; // Yuecel Karakoca, 3076306514497211
const REAL_ORDER_ID = '3076306514497211';

// Realistische Mail-Struktur: der Tracking-Link trägt o_ids MITTEN im href-Attribut, wie in
// typischen AliExpress-Transaktions-Mails — genau die Stelle, die eine Tag-Entfernung zerstört.
function buildRealisticHtmlBody(orderId: string): string {
  return `<html><body>
    <p>Your package is on its way.</p>
    <a href="https://track.aliexpress.com/logisticsInfo.htm?tradeId=abc123&amp;o_ids=${orderId}&amp;spm=a2g0o.order_list">Track your package</a>
  </body></html>`;
}

describe('parsePackageStatusEmail', () => {
  test('Betreff-Variante "Package X: at customs" — echter Wert aus dem Auftrag', () => {
    const result = parsePackageStatusEmail(
      `Package ${REAL_TRACKING_NUMBER}: at customs`,
      buildRealisticHtmlBody(REAL_ORDER_ID)
    );
    expect(result).toEqual({ trackingNumber: REAL_TRACKING_NUMBER, aliexpressOrderId: REAL_ORDER_ID, emailDate: '' });
  });

  test('Betreff-Variante "Package X has cleared customs" (kein Doppelpunkt)', () => {
    const result = parsePackageStatusEmail(
      `Package ${REAL_TRACKING_NUMBER} has cleared customs`,
      buildRealisticHtmlBody(REAL_ORDER_ID)
    );
    expect(result?.trackingNumber).toBe(REAL_TRACKING_NUMBER);
    expect(result?.aliexpressOrderId).toBe(REAL_ORDER_ID);
  });

  test('Betreff-Variante "Package X: in your country/region"', () => {
    const result = parsePackageStatusEmail(
      `Package ${REAL_TRACKING_NUMBER}: in your country/region`,
      buildRealisticHtmlBody(REAL_ORDER_ID)
    );
    expect(result?.trackingNumber).toBe(REAL_TRACKING_NUMBER);
    expect(result?.aliexpressOrderId).toBe(REAL_ORDER_ID);
  });

  test('zweite echte Bestellung aus dem Auftrag (M. Lazarevic, 3075188992327211)', () => {
    const result = parsePackageStatusEmail(
      'Package 00340434886283998797: at customs',
      buildRealisticHtmlBody('3075188992327211')
    );
    expect(result).toEqual({ trackingNumber: '00340434886283998797', aliexpressOrderId: '3075188992327211', emailDate: '' });
  });

  test('Aufgabe 2: AP-Präfix (AliExpress-interne ID, s. PR #102) wird NIE übernommen', () => {
    const result = parsePackageStatusEmail('Package AP00843143208329: at customs', buildRealisticHtmlBody(REAL_ORDER_ID));
    expect(result).toBeNull();
  });

  test('o_ids nach rohem, nicht HTML-entity-kodiertem "&" (defensiv, falls eine Mail-Variante das so schickt)', () => {
    const html = '<a href="https://track.aliexpress.com/x?tradeId=abc&o_ids=3076306514497211&spm=y">Track</a>';
    const result = parsePackageStatusEmail(`Package ${REAL_TRACKING_NUMBER}: at customs`, html);
    expect(result?.aliexpressOrderId).toBe(REAL_ORDER_ID);
  });

  test('kein o_ids-Parameter im Body → kein Treffer (keine Bestellzuordnung möglich)', () => {
    const result = parsePackageStatusEmail(`Package ${REAL_TRACKING_NUMBER}: at customs`, '<html><body>keine Tracking-Links hier</body></html>');
    expect(result).toBeNull();
  });

  test('Betreff ohne "Package"-Muster → kein Treffer', () => {
    const result = parsePackageStatusEmail('Ihre Bestellung wurde bearbeitet', buildRealisticHtmlBody(REAL_ORDER_ID));
    expect(result).toBeNull();
  });

  // Regressions-/Begründungstest (Grundgesetz Regel 5-Geist): beweist, WARUM der rohe HTML-Body
  // zwingend nötig ist — dieselbe Bereinigung, die searchAndParseEmails() für P-84/P-85 nutzt
  // (Tags entfernen), würde den o_ids-Parameter komplett zerstören, weil er in einem
  // href-Attribut steht, nicht im sichtbaren Text.
  test('o_ids steckt im href-Attribut — eine simulierte Tag-Entfernung (wie beim Klartext-Pfad) würde den Parameter zerstören', () => {
    const html = buildRealisticHtmlBody(REAL_ORDER_ID);
    const strippedLikeOldPath = html.replace(/<[^>]*>/g, ''); // dieselbe Regel wie htmlToPlainText()
    expect(strippedLikeOldPath).not.toContain('o_ids=');
    // Der rohe Body (unveraendert) enthaelt den Parameter dagegen sehr wohl:
    expect(html).toContain(`o_ids=${REAL_ORDER_ID}`);
  });
});

describe('looksLikeCarrierTrackingNumber', () => {
  test('echte DHL-Nummern (20 Ziffern) aus dem Auftrag gelten als plausibel', () => {
    expect(looksLikeCarrierTrackingNumber('00340434886289512140')).toBe(true);
    expect(looksLikeCarrierTrackingNumber('00340434886283998797')).toBe(true);
  });

  test('kurze Zahlenfolgen (< 10 Ziffern) gelten NICHT als plausibel', () => {
    expect(looksLikeCarrierTrackingNumber('12345')).toBe(false);
  });

  test('AP-Werte (nicht rein numerisch) gelten NICHT als plausibel', () => {
    expect(looksLikeCarrierTrackingNumber('AP00843143208329')).toBe(false);
  });
});
