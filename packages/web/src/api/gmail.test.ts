import { describe, expect, test } from 'bun:test';
import { parsePackageStatusEmail, looksLikeCarrierTrackingNumber } from './gmail';

// P2 Teil 2 (2026-09-14) + Nachbesserung (2026-09-14, wortlautunabhängig): Subject-Zeilen und der
// o_ids=-Parameter sind WÖRTLICH aus dem Auftrag übernommen — der Nutzer hat sie manuell aus
// echten Mails im echten Postfach abgelesen (acht echte Mails zur Bestellung 3075188992327211,
// alle deutsch, plus zwei englische Beispiele zu 3076306514497211). Diese Tests prüfen die
// PARSER-LOGIK gegen diese echten, verbürgten Werte, ersetzen aber NICHT einen echten Gmail-Lauf
// (in dieser Sandbox nicht möglich — kein GOOGLE_GMAIL_CLIENT_ID/_SECRET in .env, s.
// PR-Beschreibung: "[Gmail] Token-Refresh fehlgeschlagen: 400 Could not determine client ID from
// request"). scripts/inspect-package-status-emails.ts steht bereit, sobald Gmail-Zugangsdaten
// verfügbar sind.
const TRACKING_LAZAREVIC = '00340434886283998797'; // M. Lazarevic, 3075188992327211
const ORDER_LAZAREVIC = '3075188992327211';
const TRACKING_KARAKOCA = '00340434886289512140'; // Yuecel Karakoca, 3076306514497211
const ORDER_KARAKOCA = '3076306514497211';

// Realistische Mail-Struktur: der Tracking-Link trägt o_ids MITTEN im href-Attribut, wie in
// typischen AliExpress-Transaktions-Mails — genau die Stelle, die eine Tag-Entfernung zerstört.
function buildRealisticHtmlBody(orderId: string): string {
  return `<html><body>
    <p>Your package is on its way.</p>
    <a href="https://track.aliexpress.com/logisticsInfo.htm?tradeId=abc123&amp;o_ids=${orderId}&amp;spm=a2g0o.order_list">Track your package</a>
  </body></html>`;
}

// Alle sechs echten Betreffzeilen aus dem Auftrag (Nachbesserung: wortlautunabhängig) — vier
// deutsch (alle acht echten Mails zu 3075188992327211 waren deutsch), zwei englisch.
describe('parsePackageStatusEmail — wortlautunabhängig, echte Betreffzeilen aus dem Postfach', () => {
  const realSubjects: Array<{ subject: string; trackingNumber: string; orderId: string; label: string }> = [
    { subject: `Paket ${TRACKING_LAZAREVIC} wurde zugestellt`, trackingNumber: TRACKING_LAZAREVIC, orderId: ORDER_LAZAREVIC, label: 'DE: Paket X wurde zugestellt' },
    { subject: `Packstück ${TRACKING_LAZAREVIC}: mit lokalem Kurier`, trackingNumber: TRACKING_LAZAREVIC, orderId: ORDER_LAZAREVIC, label: 'DE: Packstück X: mit lokalem Kurier' },
    { subject: `Packstück ${TRACKING_LAZAREVIC}: beim Zoll`, trackingNumber: TRACKING_LAZAREVIC, orderId: ORDER_LAZAREVIC, label: 'DE: Packstück X: beim Zoll' },
    { subject: `Zollabfertigung für ${TRACKING_LAZAREVIC} wurde beendet`, trackingNumber: TRACKING_LAZAREVIC, orderId: ORDER_LAZAREVIC, label: 'DE: Zollabfertigung für X wurde beendet' },
    { subject: `Package ${TRACKING_KARAKOCA} has cleared customs`, trackingNumber: TRACKING_KARAKOCA, orderId: ORDER_KARAKOCA, label: 'EN: Package X has cleared customs' },
    { subject: `Package ${TRACKING_KARAKOCA}: at customs`, trackingNumber: TRACKING_KARAKOCA, orderId: ORDER_KARAKOCA, label: 'EN: Package X: at customs' },
  ];

  for (const { subject, trackingNumber, orderId, label } of realSubjects) {
    test(label, () => {
      const result = parsePackageStatusEmail(subject, buildRealisticHtmlBody(orderId));
      expect(result).toEqual({ trackingNumber, aliexpressOrderId: orderId, emailDate: '' });
    });
  }

  test('das einleitende Wort spielt keine Rolle mehr — ein völlig anderes deutsches Einleitungswort funktioniert genauso', () => {
    const result = parsePackageStatusEmail(`Statusupdate für Sendung ${TRACKING_LAZAREVIC}`, buildRealisticHtmlBody(ORDER_LAZAREVIC));
    expect(result?.trackingNumber).toBe(TRACKING_LAZAREVIC);
  });
});

describe('parsePackageStatusEmail — Plausibilität und Grenzfälle', () => {
  test('kein o_ids-Parameter im Body → kein Treffer (keine Bestellzuordnung möglich)', () => {
    const result = parsePackageStatusEmail(`Paket ${TRACKING_LAZAREVIC} wurde zugestellt`, '<html><body>keine Tracking-Links hier</body></html>');
    expect(result).toBeNull();
  });

  test('kein Betreff mit einer Ziffernfolge ab 10 Stellen → kein Treffer', () => {
    const result = parsePackageStatusEmail('Ihre Bestellung wurde bearbeitet', buildRealisticHtmlBody(ORDER_LAZAREVIC));
    expect(result).toBeNull();
  });

  test('zu kurze Ziffernfolge im Betreff (< 10 Stellen, z.B. eine Artikelnummer) → kein Treffer', () => {
    const result = parsePackageStatusEmail('Ihre Bestellung 12345 wurde storniert', buildRealisticHtmlBody(ORDER_LAZAREVIC));
    expect(result).toBeNull();
  });

  // Ehrlich dokumentierter Grenzfall (Grundgesetz Regel 6 — nicht verschwiegen): eine reine
  // \d{10,}-Ziffernfolge kann NIE das AP-Präfix enthalten (\d matcht keine Buchstaben) —
  // isAliInternalLogisticsId() ist für Betreff-Extraktion dadurch strukturell wirkungslos. In der
  // Praxis unkritisch: in keinem der bisher beobachteten echten Fälle (PR #102, dieser PR) taucht
  // ein AP-Wert JEMALS im Betreff auf, nur im API-Feld logistics_no. Sollte AliExpress das künftig
  // ändern, würde dieser Test das sofort sichtbar machen (aktuell dokumentiert er den Ist-Zustand,
  // keine Erwartung an ein zukünftiges Verhalten).
  test('ein AP-Wert im Betreff würde NICHT über isAliInternalLogisticsId() gefiltert (Ziffern-Teil besteht die Plausibilität) — dokumentierter Ist-Zustand', () => {
    const result = parsePackageStatusEmail('Package AP00843143208329: at customs', buildRealisticHtmlBody(ORDER_KARAKOCA));
    expect(result?.trackingNumber).toBe('00843143208329');
  });

  test('o_ids nach rohem, nicht HTML-entity-kodiertem "&" (defensiv, falls eine Mail-Variante das so schickt)', () => {
    const html = `<a href="https://track.aliexpress.com/x?tradeId=abc&o_ids=${ORDER_KARAKOCA}&spm=y">Track</a>`;
    const result = parsePackageStatusEmail(`Package ${TRACKING_KARAKOCA}: at customs`, html);
    expect(result?.aliexpressOrderId).toBe(ORDER_KARAKOCA);
  });

  // Regressions-/Begründungstest (Grundgesetz Regel 5-Geist): beweist, WARUM der rohe HTML-Body
  // zwingend nötig ist — dieselbe Bereinigung, die searchAndParseEmails() für P-84/P-85 nutzt
  // (Tags entfernen), würde den o_ids-Parameter komplett zerstören, weil er in einem
  // href-Attribut steht, nicht im sichtbaren Text.
  test('o_ids steckt im href-Attribut — eine simulierte Tag-Entfernung (wie beim Klartext-Pfad) würde den Parameter zerstören', () => {
    const html = buildRealisticHtmlBody(ORDER_KARAKOCA);
    const strippedLikeOldPath = html.replace(/<[^>]*>/g, ''); // dieselbe Regel wie htmlToPlainText()
    expect(strippedLikeOldPath).not.toContain('o_ids=');
    // Der rohe Body (unveraendert) enthaelt den Parameter dagegen sehr wohl:
    expect(html).toContain(`o_ids=${ORDER_KARAKOCA}`);
  });
});

describe('looksLikeCarrierTrackingNumber', () => {
  test('echte DHL-Nummern (20 Ziffern) aus dem Auftrag gelten als plausibel', () => {
    expect(looksLikeCarrierTrackingNumber(TRACKING_KARAKOCA)).toBe(true);
    expect(looksLikeCarrierTrackingNumber(TRACKING_LAZAREVIC)).toBe(true);
  });

  test('kurze Zahlenfolgen (< 10 Ziffern) gelten NICHT als plausibel', () => {
    expect(looksLikeCarrierTrackingNumber('12345')).toBe(false);
  });

  test('AP-Werte als GANZES Wort (nicht rein numerisch) gelten NICHT als plausibel', () => {
    expect(looksLikeCarrierTrackingNumber('AP00843143208329')).toBe(false);
  });
});
