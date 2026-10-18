// Multi-Rabatt (Beschluss Inhaber 18.10.2026): Regel und gesendete Aktionen in app_settings (KEINE Migration), Senden an eBay
// über die Marketing API (item_promotion, VOLUME_DISCOUNT) — NUR auf Knopfdruck aus dem Listings-Tab. Rechnung: shared/volume-discount.ts.
import { eq } from 'drizzle-orm';
import { parseVolumeDiscountRule, planVolumeDiscount, buildVolumeDiscountPromotion, type VolumeDiscountRule, type VolumeDiscountPlan } from '../shared/volume-discount';
import { productProfitRows, productTarget, type ProfitProduct } from '../shared/target-margin-bulk';
import { profitFloorFor, DEFAULT_PRICING_CONFIG } from '../shared/pricing';
import { activeCheckoutFactor } from '../shared/checkout-factor';
import { earUmlageFor } from '../shared/electric';

const RULE_KEY = 'multi_rabatt_regel';
const PROMO_KEY = 'multi_rabatt_aktionen';

export interface SentPromotion { promotionId: string; listingId: string; percents: { 2: number; 3: number }; sentAt: string; status: string | null }

async function readSetting(key: string): Promise<string | null> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const row = await db.select().from(appSettings).where(eq(appSettings.key, key)).get();
  return row?.value ?? null;
}
async function writeSetting(key: string, value: string): Promise<void> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const now = new Date().toISOString();
  await db.insert(appSettings).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
}

export async function getVolumeDiscountRule(): Promise<VolumeDiscountRule> {
  return parseVolumeDiscountRule(await readSetting(RULE_KEY));
}
export async function setVolumeDiscountRule(rule: VolumeDiscountRule): Promise<void> {
  await writeSetting(RULE_KEY, JSON.stringify(rule));
}

export async function getSentPromotions(): Promise<Record<string, SentPromotion>> {
  try { return JSON.parse((await readSetting(PROMO_KEY)) ?? '{}') ?? {}; } catch { return {}; }
}

type PlanProduct = ProfitProduct & { isElectric?: number | null };

export function planForProduct(p: PlanProduct, rule: VolumeDiscountRule): VolumeDiscountPlan {
  const { rows } = productProfitRows(p);
  return planVolumeDiscount({
    rule,
    variants: rows.filter(r => typeof r.buyPrice === 'number').map(r => ({
      label: r.label, skuId: r.skuId, sellPrice: r.sellPrice, buyPrice: r.buyPrice!, isChinaOrigin: r.isChinaOrigin !== false,
    })),
    adRatePercent: p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent,
    floorEur: profitFloorFor(productTarget(p)),
    checkoutFactor: activeCheckoutFactor(p.aliCheckoutFactor, p.aliCheckoutFactorAt),
    earUmlageEur: earUmlageFor({ isElectric: p.isElectric ?? null }),
  });
}

async function loadProduct(id: number) {
  const { db } = await import('../db/index');
  const { products } = await import('../db/schema');
  return db.select().from(products).where(eq(products.id, id)).get();
}

export async function previewMultiRabatt(productId: number) {
  const p = await loadProduct(productId);
  if (!p) return null;
  const [rule, sent] = await Promise.all([getVolumeDiscountRule(), getSentPromotions()]);
  return { productId, listingId: p.ebayListingId ?? null, rule, plan: planForProduct(p as PlanProduct, rule), sent: sent[String(productId)] ?? null };
}

/**
 * Sendet den Multi-Rabatt für EIN Angebot. `expected` = die Prozent, die der Inhaber in der Vorschau gesehen hat; weicht die
 * Neuberechnung ab (Preis inzwischen geändert), wird NICHT gesendet. Vorhandene Aktion → updateItemPromotion, sonst create.
 * Danach getItemPromotion lesen und die Stufen vergleichen (Live-Prüfung).
 */
export async function sendMultiRabatt(productId: number, expected: { 2: number; 3: number }) {
  const prev = await previewMultiRabatt(productId);
  if (!prev) return { ok: false as const, status: 404, error: 'Produkt nicht gefunden' };
  if (!prev.listingId) return { ok: false as const, status: 400, error: 'Produkt ist nicht bei eBay gelistet' };
  if (!prev.plan.ok || !prev.plan.percents) return { ok: false as const, status: 400, error: prev.plan.error ?? 'Multi-Rabatt nicht möglich' };
  if (prev.plan.percents[2] !== expected[2] || prev.plan.percents[3] !== expected[3]) {
    return { ok: false as const, status: 409, error: `Vorschau veraltet: jetzt ${prev.plan.percents[2]} % / ${prev.plan.percents[3]} % statt ${expected[2]} % / ${expected[3]} % — bitte Vorschau neu laden.` };
  }
  const { getMarketingAccessToken, EBAY_API_BASE_URL } = await import('./ebay');
  const token = await getMarketingAccessToken();
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Content-Language': 'de-DE' };
  const start = new Date(Date.now() + 5 * 60_000);
  const end = new Date(start.getTime() + 365 * 24 * 3600_000); // 1 Jahr; danach neu senden (Anzeige im Listings-Tab)
  const body = buildVolumeDiscountPromotion({ listingId: prev.listingId, productLabel: `stele-${productId}`, percents: prev.plan.percents, start, end });
  const existing = prev.sent;
  const url = existing ? `${EBAY_API_BASE_URL}/sell/marketing/v1/item_promotion/${encodeURIComponent(existing.promotionId)}` : `${EBAY_API_BASE_URL}/sell/marketing/v1/item_promotion`;
  const res = await fetch(url, { method: existing ? 'PUT' : 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, status: 502, error: `eBay ${existing ? 'updateItemPromotion' : 'createItemPromotion'} ${res.status}: ${text.slice(0, 800)}` };
  let promotionId = existing?.promotionId ?? null;
  if (!promotionId) {
    const loc = res.headers.get('location') ?? '';
    promotionId = loc.split('/').filter(Boolean).pop() ?? null;
    if (!promotionId) { try { promotionId = (JSON.parse(text) as { promotionId?: string }).promotionId ?? null; } catch { /* leer */ } }
  }
  if (!promotionId) return { ok: false as const, status: 502, error: `eBay hat angenommen (${res.status}), aber keine Aktions-ID geliefert — bitte im Verkäufer-Cockpit prüfen.` };
  // Live-Prüfung: Aktion zurücklesen.
  const check = await fetch(`${EBAY_API_BASE_URL}/sell/marketing/v1/item_promotion/${encodeURIComponent(promotionId)}`, { headers });
  const checkJson = check.ok ? await check.json() as { promotionStatus?: string; discountRules?: Array<{ discountSpecification?: { minQuantity?: number }; discountBenefit?: { percentageOffOrder?: string } }> } : null;
  const live = (q: number) => Number(checkJson?.discountRules?.find(r => r.discountSpecification?.minQuantity === q)?.discountBenefit?.percentageOffOrder);
  const verified = !!checkJson && live(2) === prev.plan.percents[2] && live(3) === prev.plan.percents[3];
  const all = await getSentPromotions();
  all[String(productId)] = { promotionId, listingId: prev.listingId, percents: prev.plan.percents, sentAt: new Date().toISOString(), status: checkJson?.promotionStatus ?? null };
  await writeSetting(PROMO_KEY, JSON.stringify(all));
  return { ok: true as const, status: 200, promotionId, verified, promotionStatus: checkJson?.promotionStatus ?? null, percents: prev.plan.percents };
}
