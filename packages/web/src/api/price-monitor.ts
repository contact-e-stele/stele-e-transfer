// Automatische Preisüberwachung — alle 8 Stunden (P-23: Ressourcenverbrauch reduziert)
// Prüft AliExpress-Preise, passt eBay-Preise an, speichert Historie

import { db } from '../db/index';
import * as schema from '../db/schema';
import { scrapeAliExpressUrl } from './aliexpress';
import { getAccessToken, hasVariations } from './ebay';
import { eq, isNotNull, and } from 'drizzle-orm';
import { CHINA_ZOLL_EUR, MIN_GEWINN_EUR } from '../shared/constants';

const MIN_GEWINN = MIN_GEWINN_EUR; // Mindestgewinn € (zentral in shared/constants.ts)
const CHECK_INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 Stunden (P-23)
const ALERT_THRESHOLD = 0.50;    // Alert wenn Preisänderung > 0,50€

// Rundet AUFWÄRTS zur nächsten ,95-Endung (P-11). Bewusst kein "nächstgelegen"-Runden:
// calcSellPrice() ist ein Mindestpreis (garantiert MIN_GEWINN) — würde man zur nächstgelegenen
// ,95-Marke runden, könnte der tatsächliche Preis unter den berechneten Mindestpreis fallen
// und die Gewinn-Garantie brechen. Aufrunden ist der einzige Modus, der das nicht tut.
export function roundUpToX95(price: number): number {
  return Math.round((Math.ceil(price - 0.95) + 0.95) * 100) / 100;
}

// Gleiche Formel wie in lieferanten.tsx (Mindestpreis-Button):
// feeRate = (13% eBay + adRate%) × 1.19 MwSt
// sellPrice = (buyPrice + versand + zoll + MIN_GEWINN + 0.45€ Bestellgebühr × 1.19 MwSt) / (1 - feeRate)
export function calcSellPrice(buyPrice: number, versand: number, zoll: number, adRate: number): number {
  const feeRate = (13 + adRate) / 100 * 1.19;
  const minPrice = ((buyPrice + versand + zoll + MIN_GEWINN + 0.45 * 1.19) / (1 - feeRate));
  return roundUpToX95(minPrice);
}

export function isChinaShipping(shipsFrom?: string | null): boolean {
  if (!shipsFrom) return false;
  return shipsFrom.toLowerCase().includes('china');
}

function parsePrice(raw: string): number {
  // Handle formats: "9.99 €", "9,99 €", "EUR 9.99", "9.99"
  const m = raw.match(/(\d+)[,.](\d{1,2})/);
  if (!m) return 0;
  return parseFloat(`${m[1]}.${m[2]}`);
}

const EBAY_API_BASE = 'https://api.ebay.com';

// eBay Preis über Inventory API updaten (für neue Listings die über Inventory API erstellt wurden)
// Sucht Offer per SKU und updated pricingSummary
export async function updateEbayPriceInventory(productId: number, newPrice: number): Promise<boolean> {
  try {
    const token = await getAccessToken();
    const sku = `stele-${productId}`;

    // Varianten-SKU Pattern: stele-{id}-{suffix}
    // Zuerst einfachen SKU probieren, dann mit Varianten-Prefix suchen
    const skusToTry = [sku, `${sku}-GROUP`];

    for (const trysku of skusToTry) {
      const res = await fetch(
        `${EBAY_API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(trysku)}&marketplace_id=EBAY_DE`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (!res.ok) continue;

      const data = await res.json() as { offers?: Array<{ offerId: string; sku: string }> };
      const offers = data.offers ?? [];

      if (offers.length > 0) {
        // Update alle gefundenen Offers (bei Varianten gibt es mehrere)
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

        // Publish ist bei bereits aktiven Listings nicht nötig — Preis-Update ist sofort aktiv
        if (anyOk) {
          console.log(`[PriceMonitor] ✅ Inventory API: ${sku} → ${newPrice.toFixed(2)}€ (${offers.length} Offers)`);
          return true;
        }
      }
    }

    // Varianten: SKU-Pattern stele-{id}-* per Prefix suchen
    const varRes = await fetch(
      `${EBAY_API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku + '-')}&marketplace_id=EBAY_DE&limit=50`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (varRes.ok) {
      const varData = await varRes.json() as { offers?: Array<{ offerId: string; sku: string }> };
      const varOffers = (varData.offers ?? []).filter(o => o.sku.startsWith(sku + '-'));
      if (varOffers.length > 0) {
        let anyOk = false;
        for (const offer of varOffers) {
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
        if (anyOk) {
          console.log(`[PriceMonitor] ✅ Inventory API (Varianten): ${sku}-* → ${newPrice.toFixed(2)}€`);
          return true;
        }
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

export async function runPriceCheck(): Promise<{ checked: number; updated: number; ebayUpdated: number; errors: number }> {
  console.log('[PriceMonitor] Starte Preisüberwachung...');

  let checked = 0, updated = 0, ebayUpdated = 0, errors = 0;

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

    try {
      checked++;

      let data = null;
      try { data = await scrapeAliExpressUrl(url); } catch { /* ignore */ }
      if (!data) {
        // Einmal retry
        try { data = await scrapeAliExpressUrl(url); } catch { /* ignore */ }
      }
      if (!data) { errors++; return; }

      // China-Versand: Zollgebühr +3€ addieren (ab 01.07.2026), NICHT überspringen
      const isChina = isChinaShipping(data.shipsFrom);
      const zoll = isChina ? CHINA_ZOLL_EUR : 0;
      const versand = product.shippingCost ?? 0;
      const adRate = product.adRate ?? 0;
      if (isChina) {
        console.log(`[PriceMonitor] ${product.id}: shipsFrom=China — Zollgebühr +${CHINA_ZOLL_EUR}€ wird addiert`);
      }

      if (!data.price) { errors++; return; }

      const newBuyPrice = parsePrice(data.price);
      if (!newBuyPrice || newBuyPrice <= 0) { errors++; return; }

      const oldBuyPrice = product.buyPrice ?? 0;
      const priceDiff = Math.abs(newBuyPrice - oldBuyPrice);
      const priceChanged = priceDiff > 0.01;

      await db.insert(schema.priceHistory).values({ productId: product.id, price: newBuyPrice, source: 'aliexpress' });

      if (priceChanged) {
        const newSellPrice = calcSellPrice(newBuyPrice, versand, zoll, adRate);
        const isAlert = priceDiff >= ALERT_THRESHOLD;
        console.log(`[PriceMonitor] ${product.id} "${product.title?.slice(0, 40)}": ${oldBuyPrice.toFixed(2)}→${newBuyPrice.toFixed(2)}€${isAlert ? ' ⚠️' : ''}`);

        // DB aktualisieren
        await db.update(schema.products).set({
          buyPrice: newBuyPrice,
          sellPrice: newSellPrice,
          lastPriceCheck: new Date().toISOString(),
          priceChanged: isAlert,
          updatedAt: new Date().toISOString()
        }).where(eq(schema.products.id, product.id));
        updated++;

        // eBay Listing Preis automatisch aktualisieren (falls verknüpft)
        if (product.ebayListingId && product.ebayStatus === 'listed') {
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
          lastPriceCheck: new Date().toISOString(),
          priceChanged: false,
          updatedAt: new Date().toISOString()
        }).where(eq(schema.products.id, product.id));
      }
    } catch (e) {
      console.error(`[PriceMonitor] Fehler bei ${product.id}:`, e);
      errors++;
    }
  }

  // Parallel mit max 3 gleichzeitigen Scrapes (Render hat begrenzte Ressourcen)
  const CONCURRENCY = 3;
  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(p => checkOne(p)));
  }

  console.log(`[PriceMonitor] Fertig — geprüft: ${checked}, aktualisiert: ${updated}, eBay-Updates: ${ebayUpdated}, Fehler: ${errors}`);
  return { checked, updated, ebayUpdated, errors };
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
