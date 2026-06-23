// Automatische Preisüberwachung — alle 6 Stunden
// Prüft AliExpress-Preise, passt eBay-Preise an, speichert Historie

import { db } from '../db/index';
import * as schema from '../db/schema';
import { scrapeAliExpressUrl } from './aliexpress';
import { eq, isNotNull, and } from 'drizzle-orm';

const EBAY_FEE = 0.18;       // 18% eBay Gebühren
const MIN_GEWINN = 1.60;     // Mindestgewinn €
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 Stunden
const ALERT_THRESHOLD = 0.50; // Alert wenn Preisänderung > 0,50€

function calcSellPrice(buyPrice: number): number {
  // sellPrice = (buyPrice + MIN_GEWINN) / (1 - EBAY_FEE)
  return Math.ceil(((buyPrice + MIN_GEWINN) / (1 - EBAY_FEE)) * 100) / 100;
}

function parsePrice(raw: string): number {
  // Handle formats: "9.99 €", "9,99 €", "EUR 9.99", "9.99"
  const m = raw.match(/(\d+)[,.](\d{1,2})/);
  if (!m) return 0;
  return parseFloat(`${m[1]}.${m[2]}`);
}

export async function runPriceCheck(): Promise<{ checked: number; updated: number; errors: number }> {
  console.log('[PriceMonitor] Starte Preisüberwachung...');

  let checked = 0, updated = 0, errors = 0;

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
        // Einmal retry ohne Delay (neues Playwright ist schneller)
        try { data = await scrapeAliExpressUrl(url); } catch { /* ignore */ }
      }
      if (!data) { errors++; return; }

      // China-Versand überspringen — NUR wenn eindeutig China bestätigt
      if (data.shipsFrom?.toLowerCase() === 'china') {
        console.log(`[PriceMonitor] ${product.id}: shipsFrom=China — übersprungen`);
        return;
      }

      if (!data.price) { errors++; return; }

      const newBuyPrice = parsePrice(data.price);
      if (!newBuyPrice || newBuyPrice <= 0) { errors++; return; }

      const oldBuyPrice = product.buyPrice ?? 0;
      const priceDiff = Math.abs(newBuyPrice - oldBuyPrice);
      const priceChanged = priceDiff > 0.01;

      await db.insert(schema.priceHistory).values({ productId: product.id, price: newBuyPrice, source: 'aliexpress' });

      if (priceChanged) {
        const newSellPrice = calcSellPrice(newBuyPrice);
        const isAlert = priceDiff >= ALERT_THRESHOLD;
        console.log(`[PriceMonitor] ${product.id} "${product.title?.slice(0, 40)}": ${oldBuyPrice.toFixed(2)}→${newBuyPrice.toFixed(2)}€${isAlert ? ' ⚠️' : ''}`);
        await db.update(schema.products).set({ buyPrice: newBuyPrice, sellPrice: newSellPrice, lastPriceCheck: new Date().toISOString(), priceChanged: isAlert, updatedAt: new Date().toISOString() }).where(eq(schema.products.id, product.id));
        updated++;
      } else {
        await db.update(schema.products).set({ lastPriceCheck: new Date().toISOString(), priceChanged: false, updatedAt: new Date().toISOString() }).where(eq(schema.products.id, product.id));
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

  console.log(`[PriceMonitor] Fertig — geprüft: ${checked}, aktualisiert: ${updated}, Fehler: ${errors}`);
  return { checked, updated, errors };
}

export function startPriceMonitor() {
  // Direkt nach Start einmal prüfen (nach 2 Min Delay)
  setTimeout(async () => {
    await runPriceCheck().catch(e => console.error('[PriceMonitor] Startup check error:', e));
  }, 2 * 60 * 1000);

  // Dann alle 6 Stunden
  setInterval(async () => {
    await runPriceCheck().catch(e => console.error('[PriceMonitor] Interval error:', e));
  }, CHECK_INTERVAL_MS);

  console.log('[PriceMonitor] Scheduler aktiv — alle 6 Stunden, erster Check in 2 Min');
}
