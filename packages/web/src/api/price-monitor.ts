// Automatische Preisüberwachung — alle 8 Stunden (P-23: Ressourcenverbrauch reduziert)
// Prüft AliExpress-Preise, passt eBay-Preise an, speichert Historie

import { db } from '../db/index';
import * as schema from '../db/schema';
import { scrapeAliExpressUrl, checkSourceAvailability, type ScrapedProduct } from './aliexpress';
import { getAliProductByApi, getAliAccessToken, ensureFreshAliToken, type AliProductData } from './aliexpress-api';
import { getAccessToken, hasVariations, getInventoryItemGroupSkus, setInventoryItemQuantity, slugify, resolveVariantQuantity, NON_VARIATION_ASPECTS, endListing } from './ebay';
import { eq, isNotNull, and } from 'drizzle-orm';
import { CHINA_ZOLL_EUR, MAX_PRICE_DECREASE_PERCENT } from '../shared/constants';
import { computeMinSellPrice, applyDecreaseCap, isChinaShipping, DEFAULT_PRICING_CONFIG, AUTO_PRICE_WRITE_ENABLED } from '../shared/pricing';
import { Sentry } from '../instrument';

// P-27/P-28-Konsolidierung (2026-09-08), Teil 2A+2B (2026-09-10): die eigentliche Formel lebt
// ausschließlich in shared/pricing.ts (Backend UND Frontend brauchen sie). Re-Export hier, damit
// bestehende Importe (`from './price-monitor'`) im ganzen Backend unverändert weiterfunktionieren.
export { isChinaShipping, computeMinSellPrice, applyDecreaseCap, DEFAULT_PRICING_CONFIG, AUTO_PRICE_WRITE_ENABLED };

const CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 Stunden (P-23)
const ALERT_THRESHOLD = 0.50;    // Alert wenn Preisänderung > 0,50€

function parsePrice(raw: string): number {
  // Handle formats: "9.99 €", "9,99 €", "EUR 9.99", "9.99"
  const m = raw.match(/(\d+)[,.](\d{1,2})/);
  if (!m) return 0;
  return parseFloat(`${m[1]}.${m[2]}`);
}

const EBAY_API_BASE = 'https://api.ebay.com';

// ─── P-27/P-28: Varianten-fähige Preisprüfung ─────────────────────────────────

export interface VariantPriceRow {
  skuId: string;
  attrs: Record<string, string>;
  buyPrice: number;
  correctSellPrice: number;
}

// Liest die gespeicherten (oder frisch übergebenen) Varianten-Einkaufspreise eines Produkts
// und berechnet für JEDE Variante einzeln den nach aktueller Formel korrekten Verkaufspreis —
// unabhängig davon, ob sich der Einkaufspreis geändert hat (erkennt so auch reine
// Formel-/Konstanten-Änderungen wie die China-Zoll-Einführung, P-89).
export function computeVariantPriceRows(
  variantPricesJson: string | null,
  shippingCost: number | null,
  shipsFrom: string | null,
  adRate: number | null,
  targetMarginEur?: number | null // Teil 2C: product.targetMarginEur — null/undefined → globaler Fallback
): VariantPriceRow[] {
  let raw: Array<{ skuId: string; attrs?: Record<string, string>; price: number }> = [];
  try { raw = variantPricesJson ? JSON.parse(variantPricesJson) : []; } catch { return []; }
  const versand = shippingCost ?? 0;
  const isChina = isChinaShipping(shipsFrom);
  const rate = adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
  const margin = targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur;
  return raw
    .filter(v => typeof v.price === 'number' && v.price > 0)
    .map(v => ({
      skuId: v.skuId,
      attrs: v.attrs ?? {},
      buyPrice: v.price,
      correctSellPrice: computeMinSellPrice({
        buyPrice: v.price, supplierShipping: versand,
        isChinaOrigin: isChina, customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
        ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
        vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: rate,
        targetMarginEur: margin, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur,
        rounding: 'nearest95',
      }).minSellPrice,
    }));
}

// Sicherer EINHEITSPREIS, falls für eine Varianten-Gruppe nur ein einzelner Preis gesetzt
// werden kann/soll: das Maximum aller Varianten-Mindestpreise — NICHT das Minimum. Ein
// Einheitspreis unterhalb des teuersten Varianten-Mindestpreises würde genau DIESE Variante
// mit Verlust verkaufen (Lektion aus der manuellen id=75-Korrektur, wo "niedrigster Preis"
// fälschlich als "sicher" bezeichnet wurde).
export function safeUniformVariantPrice(rows: VariantPriceRow[]): number | null {
  if (rows.length === 0) return null;
  return Math.max(...rows.map(r => r.correctSellPrice));
}

// P-27/P-28-Fix (2026-09-08, Live-Fund stele-138): computeVariantPriceRows() berechnet für JEDE
// Variante bereits den korrekten Einzelpreis — vorher wurde trotzdem nur safeUniformVariantPrice()
// (das Maximum aller Zeilen) an JEDE echte eBay-Varianten-SKU geschrieben ("EUR 20,95-EUR 20,95"
// statt drei unterschiedlicher Preise). Diese Funktion schreibt jeder echten SKU ihren EIGENEN
// Preis. Matching exakt wie beim Bestands-Sync oben (`stele-${productId}-${slugify(attrs)}`) und
// bei der Listing-Erstellung (ebay.ts) — gegen die ECHTEN eBay-SKUs (getInventoryItemGroupSkus),
// kein Raten. Für eine reale SKU, der keine Zeile eindeutig zugeordnet werden kann, greift
// safeUniformVariantPrice() als Fallback NUR für GENAU diese eine SKU (nicht für alle).
// Baut die eBay-Varianten-SKU für eine Variante — dieselbe Regel, nach der ebay.ts die SKUs beim
// Listing-Erstellen vergibt (`stele-{id}-{slugify(attrs)}`).
//
// P-27/P-28-Fix (2026-09-09, Live-Fund Produkte 71/77/92/95): attrs kann Felder wie "Ships From"
// enthalten, die NIE Teil der echten eBay-SKU sind (ebay.ts baut Varianten-SKUs nur aus den echten
// Varianten-GRUPPEN, nicht aus Zusatzfeldern wie Ships From). Ohne diesen Filter verlängert sich
// die erwartete SKU um ein Segment (z.B. "-CHINA-MAINLAND"), das real nicht existiert → kein Match
// → der Preis bleibt für die betroffene(n) Variante(n) unverändert. NON_VARIATION_ASPECTS ist
// dieselbe Liste, die ebay.ts beim Listing-Erstellen für Item-Aspekte nutzt — eine Quelle, kein
// Duplikat.
//
// Teil 3 (2026-09-13): aus updateEbayVariantPricesIndividually() herausgezogen (reiner Extract,
// identische Logik), damit das Berichts-Skript für den Varianten-Preisplan gegen GENAU dieselbe
// SKU-Zuordnung läuft wie der spätere Schreibvorgang, statt sie ein zweites Mal nachzubauen.
export function buildVariantSku(productId: number, attrs: Record<string, string> | undefined): string {
  const relevant = Object.fromEntries(
    Object.entries(attrs ?? {}).filter(([k]) => !NON_VARIATION_ASPECTS.has(k))
  );
  const suffix = Object.values(relevant).map(slugify).filter(Boolean).join('-');
  return `stele-${productId}-${suffix}`;
}

export async function updateEbayVariantPricesIndividually(
  productId: number,
  rows: VariantPriceRow[]
): Promise<{ ok: boolean; updatedCount: number }> {
  if (rows.length === 0) return { ok: false, updatedCount: 0 };
  try {
    const token = await getAccessToken();
    const groupSku = `stele-${productId}-GROUP`;
    const realSkus = await getInventoryItemGroupSkus(groupSku, token);
    if (realSkus.length === 0) return { ok: false, updatedCount: 0 };

    const rowBySku = new Map<string, VariantPriceRow>();
    for (const row of rows) {
      rowBySku.set(buildVariantSku(productId, row.attrs), row);
    }
    const fallbackPrice = safeUniformVariantPrice(rows);

    let updatedCount = 0;
    for (const sku of realSkus) {
      const row = rowBySku.get(sku);
      const price = row ? row.correctSellPrice : fallbackPrice;
      if (price == null) continue;
      const ok = await updateOfferPriceBySku(sku, price, token);
      if (ok) {
        updatedCount++;
        console.log(`[PriceMonitor] ${productId}: Variante ${sku} → ${price.toFixed(2)}€${row ? '' : ' (kein Zeilen-Match — sicherer Einheitspreis als Fallback für nur diese SKU)'}`);
      } else {
        console.warn(`[PriceMonitor] ${productId}: Preis für ${sku} konnte nicht auf ${price.toFixed(2)}€ gesetzt werden`);
      }
    }
    return { ok: updatedCount > 0, updatedCount };
  } catch (e) {
    console.warn(`[PriceMonitor] ${productId}: updateEbayVariantPricesIndividually fehlgeschlagen:`, e);
    return { ok: false, updatedCount: 0 };
  }
}

// P-27/P-28 PR 3 (2026-09-09): Pro-Produkt-Reparaturschritt für /ebay/listings/repair-variant-prices
// — bewusst OHNE jede Preis-Diff-Schwelle (anders als recalculate-preview/-apply), da der Zweck
// genau ist, bereits live falsch bepreiste Listings zu reparieren, die wegen unverändertem
// Einkaufspreis nie in der normalen Vorschau auftauchen würden. `updateFn` als DI-Parameter,
// damit dieser Aufruf in Tests ohne echten eBay-Zugriff geprüft werden kann.
export async function repairVariantPricesForProduct(
  product: { id: number; variantPrices: string | null; shippingCost: number | null; shipsFrom: string | null; adRate: number | null; targetMarginEur?: number | null },
  updateFn: typeof updateEbayVariantPricesIndividually = updateEbayVariantPricesIndividually
): Promise<{ ok: boolean; updatedSkuCount: number; error?: string }> {
  const rows = computeVariantPriceRows(product.variantPrices, product.shippingCost, product.shipsFrom, product.adRate, product.targetMarginEur);
  if (rows.length === 0) return { ok: false, updatedSkuCount: 0, error: 'Keine Varianten-Einkaufspreise vorhanden' };
  const { ok, updatedCount } = await updateFn(product.id, rows);
  return { ok, updatedSkuCount: updatedCount };
}

// P-27/P-28 PR 5 (2026-09-09, Live-Fund): PR 4s "N Produkte pro Batch" reichte nicht — ein
// einzelnes Produkt mit vielen Varianten (Live-Fund: Produkt mit 11 Varianten) kann die
// Batch-Laufzeit unabhängig von der Produktzahl sprengen (5 Produkte, davon eines mit 11
// Varianten = 15 SKU-Updates in einem Request, 39s reine Verarbeitungszeit → Render-
// Verbindungs-Timeout trotz serverseitig gesunder Verarbeitung). Jetzt varianten-/SKU-basiert:
// Produkte werden in eine Charge gepackt, bis die SUMME ihrer Varianten `maxVariantsPerBatch`
// erreicht/überschreitet. Ein einzelnes Produkt, das allein schon über dem Limit liegt, bildet
// notfalls seine eigene (größere) Charge — lieber ein längerer Einzel-Request als ein Batch
// mehrerer Produkte, der das Zeitbudget trotzdem sprengt. Reine Chunking-Arithmetik, keine
// Preis-Logik — nimmt die Varianten-Anzahl pro Produkt als vorberechnetes Array entgegen, damit
// sie isoliert ohne DB-/eBay-Zugriff testbar bleibt.
export function computeRepairBatchRange(
  variantCounts: number[], offset: number, maxVariantsPerBatch: number
): { start: number; end: number; done: boolean } {
  const total = variantCounts.length;
  const start = Math.max(0, Math.min(offset, total));
  if (start >= total) return { start: total, end: total, done: true };

  let end = start;
  let sum = 0;
  while (end < total) {
    const weight = Math.max(1, variantCounts[end]);
    if (end > start && sum + weight > maxVariantsPerBatch) break;
    sum += weight;
    end++;
    if (sum >= maxVariantsPerBatch) break;
  }
  return { start, end, done: end >= total };
}

// Holt das Offer zu einer EXAKTEN SKU und setzt dessen Preis (Inventory API).
// eBays "sku"-Query-Parameter bei GET /offer ist ein exakter Match — kein Präfix-/Wildcard-Filter.
export async function updateOfferPriceBySku(sku: string, newPrice: number, token: string): Promise<boolean> {
  const res = await fetch(
    `${EBAY_API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&marketplace_id=EBAY_DE`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) return false;
  const data = await res.json() as { offers?: Array<{ offerId: string; sku: string }> };
  const offers = data.offers ?? [];
  if (offers.length === 0) return false;

  let anyOk = false;
  for (const offer of offers) {
    const patchRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${offer.offerId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Language': 'de-DE',
      },
      body: JSON.stringify({
        sku: offer.sku,
        marketplaceId: 'EBAY_DE',
        pricingSummary: {
          price: { value: newPrice.toFixed(2), currency: 'EUR' },
        },
      }),
    });
    if (patchRes.ok || patchRes.status === 204) anyOk = true;
  }
  return anyOk;
}

// eBay Preis über Inventory API updaten (für neue Listings die über Inventory API erstellt wurden)
// Sucht Offer per SKU und updated pricingSummary
export async function updateEbayPriceInventory(productId: number, newPrice: number): Promise<boolean> {
  try {
    const token = await getAccessToken();
    const sku = `stele-${productId}`;

    // 1. Einzelartikel-Listing: SKU direkt versuchen
    if (await updateOfferPriceBySku(sku, newPrice, token)) {
      console.log(`[PriceMonitor] ✅ Inventory API: ${sku} → ${newPrice.toFixed(2)}€`);
      return true;
    }

    // 2. Varianten-Listing: echte Varianten-SKUs aus der Inventory-Item-Group lesen statt zu
    // erraten/per Präfix zu suchen — ein früherer Versuch mit "sku=stele-{id}-" (Präfix) lieferte
    // wegen des exakten Match-Verhaltens der eBay-API IMMER 0 Treffer und schlug damit für jedes
    // Varianten-Produkt still fehl (Ursache für die von der Preiskorrektur ausgeschlossenen
    // Varianten-Artikel).
    const groupSku = `${sku}-GROUP`;
    const variantSkus = await getInventoryItemGroupSkus(groupSku, token);
    if (variantSkus.length > 0) {
      let anyOk = false;
      for (const varSku of variantSkus) {
        if (await updateOfferPriceBySku(varSku, newPrice, token)) anyOk = true;
      }
      if (anyOk) {
        console.log(`[PriceMonitor] ✅ Inventory API (Varianten): ${groupSku} → ${newPrice.toFixed(2)}€ (${variantSkus.length} SKUs)`);
        return true;
      }
    }

    return false;
  } catch (e) {
    console.warn(`[PriceMonitor] Inventory API Update fehlgeschlagen für stele-${productId}:`, e);
    return false;
  }
}

// eBay Listing-Preis über Trading API aktualisieren (Fallback für ältere Listings)
export async function updateEbayPriceTrading(itemId: string, newPrice: number): Promise<{ ok: boolean; error?: string }> {
  try {
    // P-14: ReviseInventoryStatus kennt nur Item-Level-Preise und schlägt bei
    // Variations-Listings garantiert fehl — vorher per GetItem prüfen und den
    // aussichtslosen Request gar nicht erst versuchen.
    if (await hasVariations(itemId)) {
      const msg = 'Hat Varianten auf eBay-Seite — automatische Preisänderung über diesen Weg nicht unterstützt';
      console.warn(`[PriceMonitor] ${itemId}: ${msg}`);
      return { ok: false, error: msg };
    }

    const token = await getAccessToken();
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <InventoryStatus>
    <ItemID>${itemId}</ItemID>
    <StartPrice>${newPrice.toFixed(2)}</StartPrice>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;

    const res = await fetch('https://api.ebay.com/ws/api.dll', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml',
        'X-EBAY-API-SITEID': '77',
        'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
        'X-EBAY-API-CALL-NAME': 'ReviseInventoryStatus',
        'X-EBAY-API-APP-NAME': process.env.EBAY_CLIENT_ID ?? '',
      },
      body: xml,
    });

    const text = await res.text();
    if (text.includes('<Ack>Failure</Ack>')) {
      const errMsg = text.match(/<LongMessage>([^<]*)<\/LongMessage>/)?.[1] ?? 'Unbekannter Fehler';
      console.warn(`[PriceMonitor] Trading API Fehler für ${itemId}: ${errMsg}`);
      return { ok: false, error: errMsg };
    }
    return { ok: true };
  } catch (e) {
    console.warn(`[PriceMonitor] Trading API fehlgeschlagen für ${itemId}:`, e);
    return { ok: false, error: String(e) };
  }
}

// P-27/P-28 PR 6, Teil B (2026-09-09): AliExpress-Quellartikel eindeutig nicht mehr verfügbar
// (404 oder bestätigter "nicht verfügbar"-Text, siehe classifySourceUnavailability() in
// aliexpress.ts) — Produkt-Status setzen UND eine ggf. aktive eBay-Anzeige beenden, damit keine
// Bestellungen für nicht mehr lieferbare Ware hereinkommen. DI-testbar (endListingFn) wie
// repairVariantPricesForProduct().
export async function markProductSourceUnavailable(
  product: { id: number; ebayListingId: string | null; ebayStatus: string | null },
  reason: string,
  endListingFn: (itemId: string, token: string) => Promise<{ ok: boolean; error?: string }> = endListing,
): Promise<{ ok: boolean; ebayEnded: boolean; error?: string }> {
  let ebayEnded = false;
  let endError: string | undefined;

  if (product.ebayListingId && product.ebayStatus === 'listed') {
    try {
      const token = await getAccessToken();
      const { ok, error } = await endListingFn(product.ebayListingId, token);
      ebayEnded = ok;
      endError = error;
      if (!ok) {
        console.warn(`[PriceMonitor] ${product.id}: eBay-Anzeige ${product.ebayListingId} konnte nicht automatisch beendet werden: ${error}`);
      }
    } catch (e) {
      endError = String(e);
      console.warn(`[PriceMonitor] ${product.id}: Fehler beim automatischen Beenden der eBay-Anzeige:`, e);
    }
  }

  await db.update(schema.products).set({
    ebayStatus: 'unavailable',
    ebayError: reason,
    ebayListingId: ebayEnded ? null : product.ebayListingId,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.products.id, product.id));

  console.log(`[PriceMonitor] ${product.id}: als "AliExpress nicht verfügbar" markiert (${reason})${ebayEnded ? ' — eBay-Anzeige beendet' : ''}`);
  return { ok: true, ebayEnded, error: endError };
}

const AVAILABILITY_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // täglich
const AVAILABILITY_CHECK_PAUSE_MS = 1500; // Rate-Limiting/Pause zwischen AliExpress-Abrufen

type AvailabilityCheckProduct = { id: number; sourceUrl: string | null; ebayListingId: string | null; ebayStatus: string | null };

// Schritt 2 (P-27/P-28 PR 6, 2026-09-09): täglicher Cron, der für jedes aktuell auf eBay
// gelistete Produkt prüft, ob der AliExpress-Quellartikel noch verfügbar ist — unabhängig vom
// bestehenden 8h-Preis-Cron (der checkOne() nutzt classifySourceUnavailability() nur als
// Nebeneffekt, WENN das reguläre Scraping bereits fehlgeschlagen ist; dieser Cron prüft aktiv
// und gezielt JEDES gelistete Produkt). Nutzt bei Nichtverfügbarkeit die bestehende
// markProductSourceUnavailable()-Logik wieder — keine eigene Beenden-/DB-Logik. DI-testbar
// (products/checkFn/markUnavailableFn/pauseMs) wie repairVariantPricesForProduct() — die
// Default-Werte greifen nur in echtem Betrieb, Tests übergeben eine Mock-Liste + Mock-Funktionen
// und brauchen dadurch keinen echten DB-/Netzwerkzugriff.
export async function runAvailabilityCheck(options: {
  products?: AvailabilityCheckProduct[];
  checkFn?: (url: string) => Promise<{ unavailable: boolean; reason?: string }>;
  markUnavailableFn?: typeof markProductSourceUnavailable;
  pauseMs?: number;
} = {}): Promise<{ checked: number; markedUnavailable: number; errors: number }> {
  const {
    products = await db.select().from(schema.products).where(eq(schema.products.ebayStatus, 'listed')),
    checkFn = checkSourceAvailability,
    markUnavailableFn = markProductSourceUnavailable,
    pauseMs = AVAILABILITY_CHECK_PAUSE_MS,
  } = options;

  console.log(`[AvailabilityCheck] Starte AliExpress-Verfügbarkeits-Prüfung für ${products.length} gelistete Produkte...`);
  let checked = 0, markedUnavailable = 0, errors = 0;

  for (const product of products) {
    const url = product.sourceUrl;
    if (!url || !url.includes('aliexpress')) continue;
    checked++;
    try {
      const { unavailable, reason } = await checkFn(url);
      if (unavailable) {
        console.log(`[AvailabilityCheck] ${product.id}: Quelle nicht mehr verfügbar (${reason})`);
        await markUnavailableFn(product, reason ?? 'AliExpress-Quellartikel nicht mehr verfügbar');
        markedUnavailable++;
      }
    } catch (e) {
      console.warn(`[AvailabilityCheck] ${product.id}: Prüfung fehlgeschlagen:`, e);
      errors++;
    }
    if (pauseMs > 0) await new Promise(r => setTimeout(r, pauseMs));
  }

  console.log(`[AvailabilityCheck] Fertig — geprüft: ${checked}, als nicht verfügbar markiert: ${markedUnavailable}, Fehler: ${errors}`);
  return { checked, markedUnavailable, errors };
}

export function startAvailabilityCheckCron() {
  // 5 Min nach Start (versetzt zum bestehenden Preis-Cron, der bei 2 Min läuft)
  setTimeout(async () => {
    await runAvailabilityCheck().catch(e => console.error('[AvailabilityCheck] Startup check error:', e));
  }, 5 * 60 * 1000);

  setInterval(async () => {
    await runAvailabilityCheck().catch(e => console.error('[AvailabilityCheck] Interval error:', e));
  }, AVAILABILITY_CHECK_INTERVAL_MS);

  console.log('[AvailabilityCheck] Scheduler aktiv — täglich, erster Check in 5 Min');
}

export async function runPriceCheck(): Promise<{ checked: number; updated: number; ebayUpdated: number; errors: number; stockUpdated: number }> {
  console.log('[PriceMonitor] Starte Preisüberwachung...');

  let checked = 0, updated = 0, ebayUpdated = 0, errors = 0, stockUpdated = 0;

  // Alle Produkte mit AliExpress-URL und buyPrice holen
  const products = await db.select().from(schema.products)
    .where(and(
      isNotNull(schema.products.sourceUrl),
      isNotNull(schema.products.buyPrice)
    ));

  console.log(`[PriceMonitor] ${products.length} Produkte zu prüfen`);

  // Hilfsfunktion: ein Produkt prüfen
  async function checkOne(product: typeof products[0]): Promise<void> {
    const url = product.sourceUrl;
    if (!url || !url.includes('aliexpress')) return;

    let calculatedSellPrice: number | undefined;

    try {
      checked++;

      // Root-Cause-Fix (Bestands-Untersuchung stele-136): DS-API zuerst versuchen — liefert
      // sku_available_stock zuverlässig pro Variante (siehe aliexpress-api.ts), während der
      // HTML-Scraper das nur teilweise/inkonsistent tut. Gleiches Muster wie bereits in
      // /aliexpress/scrape und /products/check-all-prices (index.ts) — hier nachgezogen, damit
      // auch der automatische 8h-Hintergrund-Job zuverlässig Bestand bekommt.
      let data: ScrapedProduct | AliProductData | null = null;
      const productIdMatch = url.match(/\/item\/(\d+)\.html/) || url.match(/[?&]id=(\d+)/);
      const aliProductId = productIdMatch?.[1];
      if (aliProductId) {
        try {
          await ensureFreshAliToken();
          const accessToken = await getAliAccessToken();
          if (accessToken) data = await getAliProductByApi(aliProductId, accessToken);
        } catch { /* ignore, fällt auf Scraper zurück */ }
      }
      if (!data) {
        try { data = await scrapeAliExpressUrl(url); } catch { /* ignore */ }
        if (!data) {
          // Einmal retry
          try { data = await scrapeAliExpressUrl(url); } catch { /* ignore */ }
        }
      }
      if (!data) {
        errors++;
        // Teil B (2026-09-09): erst NACHDEM die komplette bestehende Scrape-Fallback-Kette
        // (DS-API + Scraper + Retry) bereits vollständig fehlgeschlagen ist — als letzter,
        // zusätzlicher Schritt prüfen, ob der Quellartikel eindeutig (404 / bestätigter
        // "nicht verfügbar"-Text) nicht mehr existiert, statt nur transient nicht erreichbar zu
        // sein. Bewusst konservativ: normale Scraping-Fehler/Timeouts lösen NICHTS aus (siehe
        // classifySourceUnavailability() in aliexpress.ts) — kein False-Positive-Risiko für
        // laufende Anzeigen.
        try {
          const { unavailable, reason } = await checkSourceAvailability(url);
          if (unavailable) {
            console.log(`[PriceMonitor] ${product.id}: Quellartikel nicht mehr verfügbar (${reason})`);
            await markProductSourceUnavailable(product, reason ?? 'AliExpress-Quellartikel nicht mehr verfügbar');
          }
        } catch (e) {
          console.warn(`[PriceMonitor] ${product.id}: Verfügbarkeits-Check fehlgeschlagen:`, e);
        }
        return;
      }

      // China-Versand: Zollgebühr +3€ addieren (ab 01.07.2026), NICHT überspringen
      const isChina = isChinaShipping(data.shipsFrom);
      const versand = product.shippingCost ?? 0;
      // P-27/P-28-Konsolidierung (2026-09-08): adRate-Default vereinheitlicht auf 5 (= DB-Default,
      // schema.ts `ad_rate.default(5)`, bereits von computeVariantPriceRows() genutzt) — vorher
      // rechnete dieser Zweig bei NULL-adRate mit 0, computeVariantPriceRows() mit 5, also mit
      // unterschiedlichen Gebührensätzen für dasselbe Produkt je nachdem, ob es Varianten hat.
      const adRate = product.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
      if (isChina) {
        console.log(`[PriceMonitor] ${product.id}: shipsFrom=China — Zollgebühr +${CHINA_ZOLL_EUR}€ wird addiert`);
      }

      if (!data.price) { errors++; return; }

      const newBuyPrice = parsePrice(data.price);
      if (!newBuyPrice || newBuyPrice <= 0) { errors++; return; }

      const oldBuyPrice = product.buyPrice ?? 0;
      const buyPriceDiff = Math.abs(newBuyPrice - oldBuyPrice);
      if (buyPriceDiff > 0.01) {
        await db.insert(schema.priceHistory).values({ productId: product.id, price: newBuyPrice, source: 'aliexpress' });
      }

      // P-27/P-28: der Soll-Preis wird bei JEDEM Lauf aus dem aktuellen Einkaufspreis neu
      // berechnet und mit dem gespeicherten Ist-Preis verglichen — nicht mehr nur ausgelöst,
      // wenn sich der AliExpress-Preis geändert hat. So werden auch reine Formel-/Konstanten-
      // Änderungen (z.B. die China-Zoll-Einführung) erkannt, selbst wenn der Einkaufspreis
      // seither stabil war (genau das führte bei 19 Produkten zu nie korrigierten Preisen).
      let variantCount = 0;
      try { variantCount = product.variantPrices ? (JSON.parse(product.variantPrices) as unknown[]).length : 0; } catch { /* ignore */ }
      let variantGroupCount = 0;
      try { variantGroupCount = product.variants ? (JSON.parse(product.variants) as unknown[]).length : 0; } catch { /* ignore */ }
      const hasVariants = variantCount > 1 || variantGroupCount > 0;

      if (hasVariants) {
        // P-13/P-14 galt bisher als Ausschluss für Varianten-Produkte — jetzt werden sie
        // geprüft, aber NIE automatisch an eBay gepusht (Sicherheitsprinzip, Anforderung 4):
        // frische Varianten-Einkaufspreise werden gespeichert und ein Alert-Flag gesetzt,
        // die eigentliche Preisänderung läuft ausschließlich über die vom Menschen bestätigte
        // Vorschau im Listings-Tab ("Preise neu berechnen").
        const freshVariantPricesJson = data.variantPrices.length > 0
          ? JSON.stringify(data.variantPrices.map(v => ({ skuId: v.skuId, attrs: v.attrs, price: v.price, stock: v.stock })))
          : product.variantPrices;

        // P-93: Verfügbarkeits-Sync — die eBay-Inventory-Item-Menge für GENAU die passende
        // Variante nach dem echten AliExpress-Bestand setzen. Reine Tatsachen-Synchronisation
        // (kein Preis-/Gewinn-Ermessen), daher anders als bei Preisänderungen OHNE Bestätigungs-
        // Vorschau. Nur bei eindeutigem Match gegen die ECHTEN eBay-SKUs
        // (getInventoryItemGroupSkus) — kein Raten.
        //
        // P-108-Korrektur (Live-Fund 2026-09-06, stele-151-GROUP): lief bisher NUR bei stock=0
        // (Ausverkauf) — alle anderen Varianten wurden nie erneut angefasst. Da
        // resolveVariantQuantity() beim Erst-Listing bis zu diesem Fix den echten Bestand
        // unverändert 1:1 übernahm (statt auf max. 3 zu deckeln, siehe ebay.ts), blieben bereits
        // gelistete Varianten mit z.B. 137 Stück dauerhaft auf diesem Wert stehen — der laufende
        // Sync korrigierte das nie zurück. Jetzt: JEDE Variante mit bekanntem Bestand wird bei
        // jedem Lauf auf resolveVariantQuantity(stock, ...) (= MIN(Bestand, 3), 0 bleibt 0)
        // gesetzt — heilt bereits betroffene Live-Listings automatisch innerhalb eines
        // Cron-Durchlaufs, ohne dass die eigentliche Korrektur einen DB-Wert braucht.
        if (product.ebayListingId && product.ebayStatus === 'listed') {
          const knownStock = data.variantPrices.filter(v => typeof v.stock === 'number');
          if (knownStock.length > 0) {
            try {
              const token = await getAccessToken();
              const groupSku = `stele-${product.id}-GROUP`;
              const realSkus = await getInventoryItemGroupSkus(groupSku, token);
              for (const v of knownStock) {
                const suffix = Object.values(v.attrs ?? {}).map(slugify).filter(Boolean).join('-');
                const candidateSku = `stele-${product.id}-${suffix}`;
                if (!realSkus.includes(candidateSku)) continue; // kein eindeutiger Match — nichts unternehmen
                const targetQuantity = resolveVariantQuantity(v.stock, 0);
                const ok = await setInventoryItemQuantity(candidateSku, targetQuantity, token);
                if (ok) {
                  stockUpdated++;
                  console.log(`[PriceMonitor] ${product.id}: Variante ${candidateSku} (echter Bestand ${v.stock}) — eBay-Menge auf ${targetQuantity} gesetzt`);
                } else {
                  console.warn(`[PriceMonitor] ${product.id}: Menge für ${candidateSku} konnte nicht auf ${targetQuantity} gesetzt werden`);
                }
              }
            } catch (e) {
              console.warn(`[PriceMonitor] ${product.id}: Verfügbarkeits-Sync fehlgeschlagen:`, e);
            }
          }
        }

        const rows = computeVariantPriceRows(freshVariantPricesJson, versand, data.shipsFrom ?? product.shipsFrom, adRate, product.targetMarginEur);
        const safePrice = safeUniformVariantPrice(rows);
        const deviates = safePrice != null && (product.sellPrice == null || Math.abs(safePrice - product.sellPrice) >= ALERT_THRESHOLD);

        if (deviates || buyPriceDiff > 0.01) {
          console.log(`[PriceMonitor] ${product.id} "${product.title?.slice(0, 40)}" (Varianten): gespeicherter VK=${product.sellPrice ?? '–'} vs. sicherer Soll-VK=${safePrice ?? '–'}${deviates ? ' ⚠️ Abweichung' : ''}`);
          await db.update(schema.products).set({
            buyPrice: newBuyPrice,
            variantPrices: freshVariantPricesJson,
            lastPriceCheck: new Date().toISOString(),
            priceChanged: deviates,
            updatedAt: new Date().toISOString(),
          }).where(eq(schema.products.id, product.id));
          updated++;
        } else {
          await db.update(schema.products).set({
            lastPriceCheck: new Date().toISOString(),
            priceChanged: false,
            updatedAt: new Date().toISOString(),
          }).where(eq(schema.products.id, product.id));
        }
        return;
      }

      const rawNewSellPrice = computeMinSellPrice({
        buyPrice: newBuyPrice, supplierShipping: versand,
        isChinaOrigin: isChina, customsFlat: DEFAULT_PRICING_CONFIG.chinaCustomsFlatEur,
        ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
        vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
        targetMarginEur: product.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur,
        rounding: 'nearest95',
      }).minSellPrice;
      // Teil 2D ("Senkungsbremse"): computeMinSellPrice() liefert eine Untergrenze, keinen
      // Zielpreis — ohne Deckel würde dieser komplett unbeaufsichtigte 8h-Cron ein laufendes
      // Angebot in einem Lauf bis auf die Untergrenze herunterziehen. Anheben bleibt uneingeschränkt.
      const { price: newSellPrice, wasCapped } = applyDecreaseCap(product.sellPrice, rawNewSellPrice, MAX_PRICE_DECREASE_PERCENT);
      calculatedSellPrice = newSellPrice;
      const isAlert = product.sellPrice == null || Math.abs(newSellPrice - product.sellPrice) >= ALERT_THRESHOLD;

      if (isAlert || buyPriceDiff > 0.01) {
        console.log(`[PriceMonitor] ${product.id} "${product.title?.slice(0, 40)}": ${oldBuyPrice.toFixed(2)}→${newBuyPrice.toFixed(2)}€, VK ${product.sellPrice ?? '–'}→${newSellPrice.toFixed(2)}€${isAlert ? ' ⚠️' : ''}${wasCapped ? ` (Senkungsbremse: unabgedeckelt wären ${rawNewSellPrice.toFixed(2)}€ herausgekommen, max. ${MAX_PRICE_DECREASE_PERCENT}% Absenkung pro Lauf)` : ''}${AUTO_PRICE_WRITE_ENABLED ? '' : ' (AUTO_PRICE_WRITE_ENABLED=false — nur beobachtet, nicht geschrieben)'}`);

        // Teil 2B SICHERHEITSKRITISCH: die neuen Gebühren-Konstanten (15%/0,30€) sind noch nicht
        // gegen einen vollen Preiszyklus bestätigt — solange AUTO_PRICE_WRITE_ENABLED false ist,
        // bleibt der bisherige sellPrice unangetastet und es wird NICHTS an eBay gepusht. buyPrice/
        // priceChanged werden weiterhin geschrieben (reine Tatsachen-Synchronisation/Anzeige-Flag,
        // kein mit der neuen Formel berechneter Verkaufspreis).
        await db.update(schema.products).set({
          buyPrice: newBuyPrice,
          ...(AUTO_PRICE_WRITE_ENABLED ? { sellPrice: newSellPrice } : {}),
          lastPriceCheck: new Date().toISOString(),
          priceChanged: isAlert,
          updatedAt: new Date().toISOString()
        }).where(eq(schema.products.id, product.id));
        updated++;

        // eBay Listing Preis automatisch aktualisieren (falls verknüpft) — nur Nicht-Varianten-
        // Produkte, unverändertes bestehendes Verhalten (kein neuer automatischer Write hier).
        // Teil 2B: hinter AUTO_PRICE_WRITE_ENABLED stillgelegt, s.o.
        if (AUTO_PRICE_WRITE_ENABLED && product.ebayListingId && product.ebayStatus === 'listed') {
          console.log(`[PriceMonitor] ${product.id}: eBay Listing ${product.ebayListingId} — aktualisiere auf ${newSellPrice.toFixed(2)}€`);
          // Erst Inventory API versuchen (neue Listings), dann Trading API als Fallback
          let ok = await updateEbayPriceInventory(product.id, newSellPrice);
          if (!ok) {
            console.log(`[PriceMonitor] ${product.id}: Inventory API fehlgeschlagen, versuche Trading API...`);
            ok = (await updateEbayPriceTrading(product.ebayListingId, newSellPrice)).ok;
          }
          if (ok) {
            ebayUpdated++;
            console.log(`[PriceMonitor] ✅ eBay ${product.ebayListingId}: ${newSellPrice.toFixed(2)}€`);
          }
        }
      } else {
        await db.update(schema.products).set({
          buyPrice: newBuyPrice,
          lastPriceCheck: new Date().toISOString(),
          priceChanged: false,
          updatedAt: new Date().toISOString()
        }).where(eq(schema.products.id, product.id));
      }
    } catch (e) {
      console.error(`[PriceMonitor] Fehler bei ${product.id}:`, e);
      Sentry.captureException(e, {
        contexts: {
          price_calculation: {
            productId: product.id,
            calculatedPrice: calculatedSellPrice ?? null,
          },
        },
      });
      errors++;
    }
  }

  // Parallel mit max 3 gleichzeitigen Scrapes (Render hat begrenzte Ressourcen)
  const CONCURRENCY = 3;
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(p => checkOne(p)));
  }

  console.log(`[PriceMonitor] Fertig — geprüft: ${checked}, aktualisiert: ${updated}, eBay-Updates: ${ebayUpdated}, Fehler: ${errors}, Varianten auf Menge 0 gesetzt: ${stockUpdated}`);
  return { checked, updated, ebayUpdated, errors, stockUpdated };
}

export function startPriceMonitor() {
  // Direkt nach Start einmal prüfen (nach 2 Min Delay)
  setTimeout(async () => {
    await runPriceCheck().catch(e => console.error('[PriceMonitor] Startup check error:', e));
  }, 2 * 60 * 1000);

  // Dann alle 8 Stunden
  setInterval(async () => {
    await runPriceCheck().catch(e => console.error('[PriceMonitor] Interval error:', e));
  }, CHECK_INTERVAL_MS);

  console.log('[PriceMonitor] Scheduler aktiv — alle 8 Stunden, erster Check in 2 Min');
}
