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

import { eq, and, isNotNull, or, isNull } from 'drizzle-orm';
import { ensureFreshAliToken, getAliAccessToken, getAliOrderTracking, type AliOrderTrackingInfo } from './aliexpress-api';

// SCHALTER — P2-KORREKTUR (2026-09-14): bleibt auf `false`. Der ursprüngliche P2-PR hatte ihn
// auf `true` gesetzt, gestützt auf einen NICHT gegengeprüften Treffer (s. Korrektur-Kommentar
// oben) — beim manuellen Gegencheck auf der Sendungsverfolgungs-Seite stellte sich heraus, dass
// die von der API gelieferte "Sendungsnummer" AliExpress' eigene interne ID war (Präfix "AP"),
// nicht die echte Zusteller-Nummer (DHL). getAliOrderTracking() filtert AP-Werte jetzt konsequent
// heraus (isAliInternalLogisticsId(), aliexpress-api.ts) — dadurch liefert die Funktion für jeden
// bisher beobachteten Fall trackingNumber=null, der Cron würde also aktuell NICHTS schreiben.
// Bleibt trotzdem explizit AUS: erst wieder auf `true` setzen, wenn eine echte Quelle für die
// Zusteller-Nummer gefunden UND per Trockenlauf gegen die echte DB bestätigt ist.
export const ALIEXPRESS_TRACKING_SYNC_ENABLED = false;

const SYNC_INTERVAL_MS = 4 * 60 * 60 * 1000; // alle 4 Stunden (Vorschlag aus dem Auftrag)
const SYNC_PAUSE_MS = 1500; // Rate-Limiting zwischen AliExpress-Abrufen, analog runAvailabilityCheck()

export interface TrackingSyncOrder {
  ebayOrderId: string;
  aliexpressOrderId: string | null;
  trackingNumber: string | null;
}

export interface TrackingSyncRow {
  ebayOrderId: string;
  aliexpressOrderId: string;
  orderStatus: string | null;
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

// Reine Orchestrierungs-Funktion, DI-testbar wie runAvailabilityCheck()/repairVariantPricesForProduct()
// (siehe price-monitor.ts) — orders/fetchFn/writeFn/accessToken als Parameter, damit Tests ohne
// echten DB-/AliExpress-Zugriff laufen. dryRun=true (Aufgabe 6) führt den Abruf aus, schreibt aber
// nichts (auch writeFn wird dann nicht aufgerufen).
export async function syncTrackingNumbers(options: {
  orders?: TrackingSyncOrder[];
  fetchFn?: typeof getAliOrderTracking;
  writeFn?: (ebayOrderId: string, trackingNumber: string) => Promise<void>;
  accessToken?: string | null; // explizit übergeben (auch null) überspringt ensureFreshAliToken()/getAliAccessToken() — für Tests
  dryRun?: boolean;
  pauseMs?: number;
} = {}): Promise<TrackingSyncSummary> {
  const {
    fetchFn = getAliOrderTracking,
    writeFn = writeTrackingNumberToDb,
    dryRun = false,
    pauseMs = SYNC_PAUSE_MS,
  } = options;

  const orders = options.orders ?? await loadTargetsFromDb();
  const targets = orders.filter(o => o.aliexpressOrderId?.trim() && !o.trackingNumber?.trim());
  console.log(`[TrackingSync] ${targets.length} Bestellungen mit AliExpress-Nr. ohne Sendungsnummer`);

  let accessToken: string | null;
  if (options.accessToken !== undefined) {
    accessToken = options.accessToken;
  } else {
    await ensureFreshAliToken();
    accessToken = await getAliAccessToken();
  }
  if (!accessToken) {
    console.error('[TrackingSync] Kein AliExpress-Access-Token verfügbar (P-2) — Abbruch, nichts geprüft');
    return { checked: 0, found: 0, written: 0, errors: 0, rows: [] };
  }

  const rows: TrackingSyncRow[] = [];
  let found = 0, written = 0, errors = 0;

  for (const order of targets) {
    const aliId = order.aliexpressOrderId!.trim();
    try {
      const info: AliOrderTrackingInfo | null = await fetchFn(aliId, accessToken);

      if (!info) {
        errors++;
        rows.push({ ebayOrderId: order.ebayOrderId, aliexpressOrderId: aliId, orderStatus: null, trackingFound: false, trackingNumber: null, written: false, error: 'Abruf fehlgeschlagen' });
        console.log(`[TrackingSync] eBay=${order.ebayOrderId} AliExpress=${aliId} status=– tracking=nein übernommen=nein (Abruf fehlgeschlagen — übersprungen)`);
        continue;
      }

      const trackingFound = !!info.trackingNumber;
      if (trackingFound) found++;

      let didWrite = false;
      if (trackingFound && !dryRun) {
        await writeFn(order.ebayOrderId, info.trackingNumber!);
        didWrite = true;
        written++;
      }

      rows.push({ ebayOrderId: order.ebayOrderId, aliexpressOrderId: aliId, orderStatus: info.orderStatus, trackingFound, trackingNumber: info.trackingNumber, written: didWrite });
      // Pflicht-Log (Auftragspunkt 5): eBay-Bestellnr., AliExpress-Bestellnr., gefundener Status, übernommen ja/nein.
      console.log(`[TrackingSync] eBay=${order.ebayOrderId} AliExpress=${aliId} status=${info.orderStatus} tracking=${trackingFound ? `ja (${info.trackingNumber})` : 'nein'} übernommen=${didWrite ? 'ja' : (dryRun ? 'nein (Dry-Run)' : 'nein')}`);
    } catch (e) {
      errors++;
      rows.push({ ebayOrderId: order.ebayOrderId, aliexpressOrderId: aliId, orderStatus: null, trackingFound: false, trackingNumber: null, written: false, error: String(e) });
      console.error(`[TrackingSync] eBay=${order.ebayOrderId} AliExpress=${aliId}: Fehler — übersprungen, weiter mit nächster Bestellung`, e);
    }
    if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
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
