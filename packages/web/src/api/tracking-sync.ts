// Sendungsnummer automatisch von AliExpress übernehmen (2026-09-14).
//
// Problem (real aufgetreten): die Sendungsnummer entsteht bei AliExpress, sobald der Lieferant
// versendet. Bisher musste jemand dort von Hand nachsehen und sie im Bestellungen-Tab eintragen —
// passiert das nicht, wartet der Kunde grundlos (konkreter Fall: Bestellung Yuecel Karakoca, eBay
// 20-15127-76586, AliExpress 3076306514497211, lag seit dem 09.09. ohne Sendungsnummer, obwohl
// AliExpress bereits "SELLER_SEND_GOODS" meldete).
//
// P2-KORREKTUR (2026-09-14, Live-Fund, s. aliexpress-api.ts getAliOrderTracking()-Kommentar für
// die vollständige Herleitung): der urspruenglich hier genannte Wert "AP00843143208329" ist NICHT
// die Sendungsnummer, sondern AliExpress' eigene interne Sendungs-ID — die echte Zusteller-Nummer
// (DHL) ist ueber die bisher getesteten AliExpress-Open-API-Methoden NICHT abrufbar. Der Schalter
// unten bleibt deshalb auf `false`, bis eine echte Quelle gefunden ist (s. Kommentar dort).
//
// Root Cause (Aufgabe 3, im Code geprüft): PATCH /order-notes/:ebayOrderId (index.ts) macht bei
// gespeicherter trackingNumber bereits zwei Dinge automatisch:
//   1. shippedAt wird lokal gesetzt, wenn noch nicht vorhanden (P-100) — reine Eigen-Datumsspalte,
//      kein eBay-Kontakt.
//   2. NUR wenn trackingNumber UND carrier GEMEINSAM übergeben werden, wird zusätzlich
//      createShippingFulfillment() (ebay.ts) aufgerufen — das ist eBays Sell-Fulfillment-API
//      POST /order/{orderId}/shipping_fulfillment und markiert die Bestellung auf eBay-Seite
//      tatsächlich als VERSENDET (per Doku-Recherche bestätigt, nicht nur eine Notiz).
//
// Abweichung von der wörtlichen Vorgabe, offengelegt statt still entschieden (Grundgesetz Regel 6):
// Aufgabe 2 wünscht "genau so, als hätte der Nutzer sie von Hand eingegeben, damit die bestehende
// eBay-Übermittlung unverändert greift" — das würde bei gemeinsam bekanntem carrier auch
// createShippingFulfillment auslösen. Das widerspricht der STRIKTEN GRENZE "Die eBay-Bestellung
// wird NICHT automatisch als 'verschickt' markiert." Die strengere Vorgabe gewinnt: dieser Cron
// schreibt AUSSCHLIESSLICH trackingNumber (+ das bereits bestehende shippedAt-Nebenverhalten aus
// P-100), NIEMALS carrier — createShippingFulfillment wird dadurch nie ausgelöst. Die Sendungsnummer
// ist im Bestellungen-Tab sofort sichtbar; das tatsächliche "an eBay übermitteln" (Carrier ergänzen)
// bleibt bewusst ein manueller Schritt des Nutzers, exakt wie heute.
//
// Aufgabe 4 (eBay-Eigennotiz mit der Sendungsnummer) bewusst NICHT umgesetzt: die einzig
// plausible eBay-API dafür ist die legacy Trading-API SetUserNotes (OrderLineItemID + NoteText,
// laut Doku-Recherche privat/nur für den Verkäufer sichtbar). eBays eigene Dokumentation
// unterscheidet aber ausdrücklich zwischen der modernen Sell-Fulfillment-lineItemId und der
// klassischen OrderLineItemID (separater "legacyReference"-Container nötig, um zwischen beiden zu
// übersetzen) — beide Formate sind NICHT bestätigt austauschbar. Ohne eBay-Zugangsdaten in dieser
// Sandbox (401 invalid_client, wie bereits in PR #97 dokumentiert) ist das nicht live testbar.
// Statt eine möglicherweise falsch adressierte Notiz zu riskieren, wird das hier ausdrücklich
// offengelassen (Aufgabe 4 erlaubt es ausdrücklich nur — "darf", kein "muss").
//
// P2 TEIL 2 (2026-09-14): Quelle komplett umgestellt — AliExpress-API (aliexpress-api.ts
// getAliOrderTracking()) durch die AliExpress-Logistik-Mails ersetzt (gmail.ts
// searchRecentPackageStatusEmails()/parsePackageStatusEmail()). Grund: PR #102 hat belegt, dass
// die echte Zusteller-Nummer über die API nicht abrufbar ist, wohl aber per Mail (Betreff "Package
// <Nummer>: <Status>", Bestellzuordnung über den o_ids=-Parameter im rohen HTML-Body). Statt pro
// Bestellung EINEN API-Call zu machen, läuft jetzt EINE Gmail-Suche für den ganzen Lauf (kein
// Rate-Limiting/Pause zwischen Bestellungen mehr nötig — SYNC_PAUSE_MS entfällt ersatzlos), deren
// Treffer zu einer Map AliExpress-Bestellnr. → Zusteller-Nummer zusammengefasst werden. Der
// atomare Doppelschreib-Schutz aus der P2-Korrektur (writeTrackingNumberToDb() unten) ist
// unverändert geblieben.

import { eq, and, isNotNull, or, isNull } from 'drizzle-orm';
import { searchRecentPackageStatusEmails, type PackageStatusEmailMatch } from './gmail';

// SCHALTER — bleibt auf `false`, bis der Trockenlauf gegen die echte DB UND das echte
// Gmail-Postfach die erwarteten Zusteller-Nummern belegt (Auftrag P2 Teil 2, strikte Grenze).
// In dieser Sandbox nicht möglich: kein GOOGLE_GMAIL_CLIENT_ID/_SECRET in .env (anders als
// TURSO_DATABASE_URL/TURSO_AUTH_TOKEN, die vorhanden sind) — `getGmailAccessToken()` schlägt mit
// `[Gmail] Token-Refresh fehlgeschlagen: 400 {"error":"invalid_request","error_description":
// "Could not determine client ID from request."}` fehl (echte Fehlermeldung aus einem echten
// Laufversuch, s. PR-Beschreibung). scripts/inspect-package-status-emails.ts steht bereit und
// läuft NUR LESEND, sobald Gmail-Zugangsdaten verfügbar sind (lokal mit echten Credentials, oder
// als einmaliger Render-Shell-Task in der Produktionsumgebung, die Gmail bereits nutzt).
export const ALIEXPRESS_TRACKING_SYNC_ENABLED = false;

const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000; // alle 4 Stunden (Vorschlag aus dem Auftrag)

// P2 Teil 2, Aufgabe 4: mindestens 90 Tage — PR #102 hat gezeigt, dass eine Bestellung 41 Tage
// alt sein kann, ohne dass die Sendungsnummer eingetragen wurde; ein kürzeres Fenster hätte deren
// Mail (wie schon das 30-Tage-Fenster von searchRecentDeliveryEmails() bei derselben Bestellung,
// s. PR #102-Zusatzbefund) strukturell verpasst.
const MAIL_SEARCH_WINDOW_DAYS = 90;

export interface TrackingSyncOrder {
  ebayOrderId: string;
  aliexpressOrderId: string | null;
  trackingNumber: string | null;
}

export interface TrackingSyncRow {
  ebayOrderId: string;
  aliexpressOrderId: string;
  trackingFound: boolean;
  trackingNumber: string | null;
  written: boolean;
  error?: string;
}

export interface TrackingSyncSummary {
  checked: number;
  found: number;
  written: number;
  errors: number;
  rows: TrackingSyncRow[];
}

// Lädt Bestellungen mit AliExpress-Nr. ohne Sendungsnummer aus der echten DB — dynamischer Import
// (wie index.ts /products/check-all-prices), damit das reine Import DIESES Moduls (z.B. in Tests
// ohne TURSO_DATABASE_URL) nicht sofort fehlschlägt; der DB-Zugriff passiert erst beim Aufruf.
async function loadTargetsFromDb(): Promise<TrackingSyncOrder[]> {
  const { db } = await import('../db/index');
  const schema = await import('../db/schema');
  return db.select({
    ebayOrderId: schema.orderNotes.ebayOrderId,
    aliexpressOrderId: schema.orderNotes.aliexpressOrderId,
    trackingNumber: schema.orderNotes.trackingNumber,
  }).from(schema.orderNotes).where(and(
    isNotNull(schema.orderNotes.aliexpressOrderId),
    or(isNull(schema.orderNotes.trackingNumber), eq(schema.orderNotes.trackingNumber, ''))
  ));
}

// Schreibt NUR trackingNumber (+ shippedAt, P-100) — siehe Root-Cause-/Abweichungs-Kommentar oben,
// warum hier bewusst kein carrier gesetzt wird.
//
// P2-Aufgabe 5 (Doppelschreib-Schutz): loadTargetsFromDb() filtert zwar schon beim Laden auf
// "keine Sendungsnummer vorhanden", aber zwischen dem Laden (Start des Laufs) und diesem Schreiben
// (nach Rate-Limit-Pausen, s. syncTrackingNumbers()) könnte theoretisch jemand die Nummer manuell
// im Bestellungen-Tab eingetragen haben — reines Überschreiben nach ebayOrderId würde das dann
// klammheimlich zurücksetzen. Deshalb hier dieselbe Leer/NULL-Bedingung zusätzlich ATOMAR in der
// WHERE-Klausel dieses Updates, nicht nur beim Laden: das Update greift nur, wenn die Spalte zum
// Zeitpunkt des Schreibens IMMER NOCH leer ist. trackingEbaySubmitted ist dafür NICHT die richtige
// Bedingung (s. PR-Beschreibung) — dieses Flag beschreibt nur, ob eine BEREITS gespeicherte Nummer
// erfolgreich an eBay übermittelt wurde, nicht ob gerade JETZT schon eine Nummer dasteht.
async function writeTrackingNumberToDb(ebayOrderId: string, trackingNumber: string): Promise<void> {
  const { db } = await import('../db/index');
  const schema = await import('../db/schema');
  const now = new Date().toISOString();
  await db.update(schema.orderNotes).set({
    trackingNumber,
    shippedAt: now,
    updatedAt: now,
  }).where(and(
    eq(schema.orderNotes.ebayOrderId, ebayOrderId),
    or(isNull(schema.orderNotes.trackingNumber), eq(schema.orderNotes.trackingNumber, ''))
  ));
}

// Fasst mehrere Mail-Treffer zu einer Map AliExpress-Bestellnr. → Zusteller-Nummer zusammen. Eine
// Bestellung kann mehrere Status-Mails bekommen ("at customs", "has cleared customs", "in your
// country/region", …) — die tragen für dieselbe physische Sendung dieselbe Zusteller-Nummer, daher
// wird pro Bestellung nur EIN Wert übernommen (der erste gefundene). Falls zwei Mails für
// dieselbe Bestellung WIDERSPRÜCHLICHE Nummern liefern (sollte bei derselben Sendung nicht
// vorkommen), wird das als Warnung geloggt und der zuerst gefundene Wert behalten, statt
// stillschweigend zu überschreiben.
function buildOrderIdToTrackingMap(matches: PackageStatusEmailMatch[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of matches) {
    const existing = map.get(m.aliexpressOrderId);
    if (existing === undefined) {
      map.set(m.aliexpressOrderId, m.trackingNumber);
    } else if (existing !== m.trackingNumber) {
      console.warn(`[TrackingSync] AliExpress ${m.aliexpressOrderId}: widersprüchliche Zusteller-Nummern in verschiedenen Mails gefunden (${existing} vs. ${m.trackingNumber}) — behalte ${existing}`);
    }
  }
  return map;
}

// Reine Orchestrierungs-Funktion, DI-testbar wie runAvailabilityCheck()/repairVariantPricesForProduct()
// (siehe price-monitor.ts) — orders/matches/writeFn als Parameter, damit Tests ohne echten DB-/
// Gmail-Zugriff laufen. dryRun=true (Aufgabe 6, Teil 1) führt die Zuordnung aus, schreibt aber
// nichts (auch writeFn wird dann nicht aufgerufen).
export async function syncTrackingNumbers(options: {
  orders?: TrackingSyncOrder[];
  matches?: PackageStatusEmailMatch[]; // Test-Override — überspringt den echten Gmail-Aufruf komplett
  searchFn?: typeof searchRecentPackageStatusEmails; // Test-Override für den Fehlerpfad (z.B. rejectet)
  searchDays?: number;
  writeFn?: (ebayOrderId: string, trackingNumber: string) => Promise<void>;
  dryRun?: boolean;
} = {}): Promise<TrackingSyncSummary> {
  const {
    writeFn = writeTrackingNumberToDb,
    searchFn = searchRecentPackageStatusEmails,
    dryRun = false,
    searchDays = MAIL_SEARCH_WINDOW_DAYS,
  } = options;

  const orders = options.orders ?? await loadTargetsFromDb();
  const targets = orders.filter(o => o.aliexpressOrderId?.trim() && !o.trackingNumber?.trim());
  console.log(`[TrackingSync] ${targets.length} Bestellungen mit AliExpress-Nr. ohne Sendungsnummer`);

  if (targets.length === 0) {
    return { checked: 0, found: 0, written: 0, errors: 0, rows: [] };
  }

  let matches: PackageStatusEmailMatch[];
  try {
    matches = options.matches ?? await searchFn(searchDays);
  } catch (e) {
    console.error('[TrackingSync] Gmail-Suche fehlgeschlagen — Abbruch, nichts geprüft:', e);
    return { checked: 0, found: 0, written: 0, errors: 0, rows: [] };
  }
  const trackingByOrderId = buildOrderIdToTrackingMap(matches);

  const rows: TrackingSyncRow[] = [];
  let found = 0, written = 0, errors = 0;

  for (const order of targets) {
    const aliId = order.aliexpressOrderId!.trim();
    try {
      const trackingNumber = trackingByOrderId.get(aliId) ?? null;
      const trackingFound = trackingNumber !== null;
      if (trackingFound) found++;

      let didWrite = false;
      if (trackingFound && !dryRun) {
        await writeFn(order.ebayOrderId, trackingNumber!);
        didWrite = true;
        written++;
      }

      rows.push({ ebayOrderId: order.ebayOrderId, aliexpressOrderId: aliId, trackingFound, trackingNumber, written: didWrite });
      console.log(`[TrackingSync] eBay=${order.ebayOrderId} AliExpress=${aliId} tracking=${trackingFound ? `ja (${trackingNumber})` : 'nein (keine passende Mail im Suchfenster gefunden)'} übernommen=${didWrite ? 'ja' : (dryRun ? 'nein (Dry-Run)' : 'nein')}`);
    } catch (e) {
      errors++;
      rows.push({ ebayOrderId: order.ebayOrderId, aliexpressOrderId: aliId, trackingFound: false, trackingNumber: null, written: false, error: String(e) });
      console.error(`[TrackingSync] eBay=${order.ebayOrderId} AliExpress=${aliId}: Fehler — übersprungen, weiter mit nächster Bestellung`, e);
    }
  }

  console.log(`[TrackingSync] Fertig — geprüft: ${targets.length}, Sendungsnummer gefunden: ${found}, übernommen: ${written}, Fehler: ${errors}`);
  return { checked: targets.length, found, written, errors, rows };
}

export function startTrackingSyncCron(): void {
  if (!ALIEXPRESS_TRACKING_SYNC_ENABLED) {
    console.log('[TrackingSync] Scheduler NICHT gestartet — ALIEXPRESS_TRACKING_SYNC_ENABLED=false (Schalter steht bewusst aus, siehe tracking-sync.ts)');
    return;
  }
  setTimeout(async () => {
    await syncTrackingNumbers().catch(e => console.error('[TrackingSync] Startup-Lauf fehlgeschlagen:', e));
  }, 3 * 60 * 1000); // 3 Min nach Start

  setInterval(async () => {
    await syncTrackingNumbers().catch(e => console.error('[TrackingSync] Interval-Lauf fehlgeschlagen:', e));
  }, SYNC_INTERVAL_MS);

  console.log(`[TrackingSync] Scheduler aktiv — alle ${SYNC_INTERVAL_MS / 3600000}h`);
}
