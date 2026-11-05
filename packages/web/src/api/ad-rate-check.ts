// K-017 Punkt 5: täglicher Abgleich App-adRate ↔ eBay-Kampagne (nur lesen bei eBay). Ergebnis in app_settings 'ad_rate_check'.
import { eq } from 'drizzle-orm';
import { AD_RATE_CHECK_KEY, summarizeAdRateCheck, failedAdRateCheck, type AdRateCheckReport } from '../shared/ad-rate-check';

const AD_RATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export async function runAdRateCheck(): Promise<AdRateCheckReport> {
  const { db } = await import('../db/index');
  const schema = await import('../db/schema');
  const at = new Date().toISOString();
  let report: AdRateCheckReport;
  try {
    const p = schema.products;
    const products = await db.select({ id: p.id, ebayListingId: p.ebayListingId, adRate: p.adRate }).from(p).where(eq(p.ebayStatus, 'listed')).all();
    const { fetchPromotionStatus } = await import('./ebay');
    const { compareAdRates } = await import('../shared/promoted-status');
    const { promo } = await fetchPromotionStatus();
    report = summarizeAdRateCheck(compareAdRates(products, promo), at);
  } catch (e) {
    report = failedAdRateCheck(String(e).slice(0, 300), at);
  }
  const value = JSON.stringify(report);
  await db.insert(schema.appSettings).values({ key: AD_RATE_CHECK_KEY, value, updatedAt: at })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: at } });
  console.log(`[AdRateCheck] ${report.ok ? `${report.geprueft} geprüft, ${report.abweichend.length} abweichend` : `FEHLER ${report.error}`}`);
  return report;
}

export function startAdRateCheckCron() {
  // 7 Min nach Start (versetzt zu Preis-Cron 2 Min und Verfügbarkeit 5 Min), danach täglich.
  setTimeout(() => { runAdRateCheck().catch(e => console.error('[AdRateCheck] Start-Lauf:', e)); }, 7 * 60 * 1000);
  setInterval(() => { runAdRateCheck().catch(e => console.error('[AdRateCheck] Lauf:', e)); }, AD_RATE_CHECK_INTERVAL_MS);
  console.log('[AdRateCheck] Scheduler aktiv — täglich, erster Lauf in 7 Min');
}
