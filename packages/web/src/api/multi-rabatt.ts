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
  // Aktion gehört zu einem ANDEREN (z.B. beendeten) Angebot → neue Aktion anlegen statt die alte umzuschreiben (stele-228, 19.10.2026).
  const existing = reusablePromotion(prev.sent, prev.listingId);
  const url = existing ? `${EBAY_API_BASE_URL}/sell/marketing/v1/item_promotion/${encodeURIComponent(existing.promotionId)}` : `${EBAY_API_BASE_URL}/sell/marketing/v1/item_promotion`;
  // eBay 38260 (Live 25.10.2026, 15 Angebote): eine LAUFENDE Aktion darf ihr Startdatum nicht ändern → bei Update Start, Ende
  // und Status der bestehenden Aktion übernehmen, nur die Stufen neu (keepRunningPromotionDates).
  let sendBody: Record<string, unknown> = body;
  if (existing) {
    const cur = await fetch(url, { headers });
    if (cur.ok) sendBody = keepRunningPromotionDates(body, await cur.json() as Record<string, unknown>);
  }
  const res = await fetch(url, { method: existing ? 'PUT' : 'POST', headers, body: JSON.stringify(sendBody) });
  const text = await res.text();
  let promotionId = existing?.promotionId ?? null;
  let trace: string[] | undefined;
  if (!res.ok && existing && /\b38232\b/.test(text)) {
    // eBay 38232 (Live 25.10.2026 16:20, stele-220): "You cannot update the promotion discount for an active promotion."
    const r = await replaceActivePromotion({ base: EBAY_API_BASE_URL, headers, oldId: existing.promotionId, body, fetchFn: fetch });
    trace = r.trace;
    console.log(`[Multi-Rabatt] stele-${productId}: aktive Aktion ersetzen → ${r.ok ? 'ok' : 'FEHLER'} | ${r.trace.join(' | ')}`);
    if (!r.ok || !r.promotionId) return { ok: false as const, status: 502, error: `eBay: laufende Aktion nicht änderbar (38232), Ersetzen gescheitert: ${r.error ?? ''} | Schritte: ${r.trace.join(' | ')}` };
    promotionId = r.promotionId;
  } else if (!res.ok) {
    return { ok: false as const, status: 502, error: `eBay ${existing ? 'updateItemPromotion' : 'createItemPromotion'} ${res.status}: ${text.slice(0, 800)}` };
  }
  if (!promotionId && res.ok) {
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
  return { ok: true as const, status: 200, promotionId, verified, promotionStatus: checkJson?.promotionStatus ?? null, percents: prev.plan.percents, ...(trace ? { trace } : {}) };
}

/** Vorhandene Aktion nur weiterverwenden, wenn sie zu genau diesem Angebot gehört. */
export function reusablePromotion<T extends { listingId: string }>(sent: T | null | undefined, listingId: string): T | null {
  return sent && sent.listingId === listingId ? sent : null;
}

/**
 * eBay-Fehler 38227 "The listing ID is invalid": die Marketing API kennt ein gerade erst eingestelltes Angebot noch nicht
 * (gemessen 19.10.2026: stele-232/228 direkt nach dem Listen 38227, stele-232 gut 10 Min später angenommen).
 */
export function isListingNotYetKnown(error: string | null | undefined): boolean {
  return !!error && /\b38227\b/.test(error);
}
/** Nachhol-Versuche nach dem Listen (Minuten ab Listen). */
export const MULTI_RABATT_RETRY_MINUTES = [5, 10, 20, 40] as const;

function scheduleMultiRabattRetry(productId: number, attempt: number) {
  if (attempt >= MULTI_RABATT_RETRY_MINUTES.length) {
    console.warn(`[Multi-Rabatt] stele-${productId}: nach ${MULTI_RABATT_RETRY_MINUTES.length} Nachhol-Versuchen nicht gesendet — Knopf im Listings-Tab nutzen.`);
    return;
  }
  const waitMin = MULTI_RABATT_RETRY_MINUTES[attempt] - (attempt === 0 ? 0 : MULTI_RABATT_RETRY_MINUTES[attempt - 1]);
  setTimeout(async () => {
    try {
      const prev = await previewMultiRabatt(productId);
      if (!prev?.plan.ok || !prev.plan.percents) { console.warn(`[Multi-Rabatt] stele-${productId}: Nachholen abgebrochen — ${prev?.plan.error ?? 'Vorschau nicht möglich'}`); return; }
      if (prev.sent && prev.sent.listingId === prev.listingId) return; // inzwischen per Knopf gesendet
      const r = await sendMultiRabatt(productId, prev.plan.percents);
      console.log(`[Multi-Rabatt] stele-${productId}: Nachhol-Versuch ${attempt + 1} ${r.ok ? `gesendet ${r.percents[2]} %/${r.percents[3]} %, geprüft=${r.verified}` : `NICHT gesendet: ${r.error}`}`);
      if (!r.ok && isListingNotYetKnown(r.error)) scheduleMultiRabattRetry(productId, attempt + 1);
    } catch (e) { console.warn(`[Multi-Rabatt] stele-${productId}: Nachhol-Versuch ${attempt + 1} Fehler: ${String(e)}`); }
  }, waitMin * 60_000);
}

/**
 * Inhaber 18.10.2026 22:48 ("Multi-Rabatt muss bei neuen Angeboten automatisch rein, als Gesetz überall"): nach dem ERSTEN
 * erfolgreichen Listen den Multi-Rabatt mit der aktuellen Vorschau senden. Fehler brechen das Listen nie ab — Ergebnis nur
 * zurückgeben/loggen; der Knopf im Listings-Tab bleibt der Nachhol-Weg.
 */
export async function sendMultiRabattForNewListing(productId: number) {
  try {
    const prev = await previewMultiRabatt(productId);
    if (!prev?.plan.ok || !prev.plan.percents) {
      const r = { ok: false as const, status: 400, error: prev?.plan.error ?? 'Vorschau nicht möglich' };
      console.warn(`[Multi-Rabatt] stele-${productId}: nach dem Listen NICHT gesendet — ${r.error}`);
      return r;
    }
    const r = await sendMultiRabatt(productId, prev.plan.percents);
    console.log(`[Multi-Rabatt] stele-${productId}: nach dem Listen ${r.ok ? `gesendet ${r.percents[2]} %/${r.percents[3]} %, geprüft=${r.verified}` : `NICHT gesendet: ${r.error}`}`);
    if (!r.ok && isListingNotYetKnown(r.error)) {
      scheduleMultiRabattRetry(productId, 0);
      return { ...r, retryScheduled: true as const, retryMinutes: [...MULTI_RABATT_RETRY_MINUTES] };
    }
    return r;
  } catch (e) {
    console.warn(`[Multi-Rabatt] stele-${productId}: nach dem Listen Fehler: ${String(e)}`);
    return { ok: false as const, status: 500, error: String(e) };
  }
}

/**
 * Inhaber 25.10.2026 ("Multi-Rabatt attraktiver", Regel 6 €/11 €): nach einer Regeländerung ALLE gelisteten Angebote neu senden.
 * Trockenlauf (Standard) zeigt je Angebot: neue Prozent, bisher gesendete Prozent, ob gesendet würde. apply:true sendet höchstens
 * `limit` Angebote je Aufruf (Render-Zeitlimit) über dieselbe sendMultiRabatt() wie der Knopf — nur Angebote, deren Prozent sich
 * ändern oder die noch keine Aktion haben. Nicht sendbare Angebote (z. B. Sperre "je Stück weniger als Einzelkauf") werden nur
 * gemeldet; eine dort noch laufende alte Aktion bleibt bestehen und wird als Hinweis ausgegeben.
 */
export const MULTI_RABATT_SEND_ALL_MAX = 15;

export interface SendAllRow {
  productId: number; listingId: string | null;
  neu: { 2: number; 3: number } | null; bisher: { 2: number; 3: number } | null;
  aktion: 'senden' | 'unverändert' | 'nicht sendbar'; grund?: string;
  ergebnis?: string;
}

export function classifySendAll(rows: Array<{ productId: number; listingId: string | null; plan: VolumeDiscountPlan; sent: SentPromotion | null }>): SendAllRow[] {
  return rows.map(r => {
    const bisher = r.sent && r.sent.listingId === r.listingId ? r.sent.percents : null;
    if (!r.plan.ok || !r.plan.percents) {
      return { productId: r.productId, listingId: r.listingId, neu: null, bisher, aktion: 'nicht sendbar' as const,
        grund: (r.plan.error ?? 'nicht berechenbar') + (bisher ? ` | ACHTUNG: alte Aktion ${bisher[2]} %/${bisher[3]} % läuft weiter` : '') };
    }
    const same = !!bisher && bisher[2] === r.plan.percents[2] && bisher[3] === r.plan.percents[3];
    return { productId: r.productId, listingId: r.listingId, neu: r.plan.percents, bisher, aktion: same ? 'unverändert' as const : 'senden' as const };
  });
}

export async function sendAllMultiRabatt(opts: { apply?: boolean; limit?: number }) {
  const { db } = await import('../db/index');
  const { products } = await import('../db/schema');
  const all = (await db.select().from(products)).filter(p => !!p.ebayListingId).sort((a, b) => a.id - b.id);
  const [rule, sent] = await Promise.all([getVolumeDiscountRule(), getSentPromotions()]);
  const rows = classifySendAll(all.map(p => ({ productId: p.id, listingId: p.ebayListingId ?? null, plan: planForProduct(p as PlanProduct, rule), sent: sent[String(p.id)] ?? null })));
  const todo = rows.filter(r => r.aktion === 'senden');
  if (opts.apply !== true) return { dryRun: true, rule, rows, zuSenden: todo.length };
  const limit = Math.min(Math.max(1, Math.floor(opts.limit ?? MULTI_RABATT_SEND_ALL_MAX)), MULTI_RABATT_SEND_ALL_MAX);
  for (const [i, r] of todo.slice(0, limit).entries()) {
    if (i > 0) await new Promise(res => setTimeout(res, 800));
    try {
      const s = await sendMultiRabatt(r.productId, r.neu!);
      r.ergebnis = s.ok ? `gesendet ${s.percents[2]} %/${s.percents[3]} %, geprüft=${s.verified}` : `NICHT gesendet: ${s.error}`;
    } catch (e) { r.ergebnis = `Fehler: ${String(e).slice(0, 300)}`; }
    console.log(`[Multi-Rabatt alle] stele-${r.productId}: ${r.ergebnis}`);
  }
  return { dryRun: false, rule, rows, zuSenden: todo.length, gesendetInDiesemAufruf: Math.min(limit, todo.length), rest: Math.max(0, todo.length - limit) };
}

/**
 * eBay 38260 "To update the start date of a promotion, the promotion must be in draft or scheduled state": beim Update einer
 * bestehenden Aktion Start/Ende von eBay übernehmen, Status SCHEDULED (eBay-Vorgabe für Update einer laufenden Aktion), nur Stufen/Name/Angebot neu.
 * Ist die bestehende Aktion schon beendet/gelöscht oder fehlt das Startdatum → neuer Körper unverändert.
 */
export function keepRunningPromotionDates<T extends Record<string, unknown>>(next: T, current: Record<string, unknown>): T {
  const status = typeof current.promotionStatus === 'string' ? current.promotionStatus : null;
  if (!status || !['RUNNING', 'PAUSED', 'SCHEDULED', 'DRAFT'].includes(status) || typeof current.startDate !== 'string') return next;
  // eBay-Doku ItemPromotion.promotionStatus: "you must set this value to SCHEDULED when you update a RUNNING discount" (Live-Fund
  // 25.10.2026 15:46: RUNNING → 38240 "Invalid input for the 'promotionStatus' field"). Status bleibt daher aus `next` (SCHEDULED).
  const out: Record<string, unknown> = { ...next, startDate: current.startDate };
  if (typeof current.endDate === 'string') out.endDate = current.endDate;
  return out as T;
}

/**
 * eBay 38232: die Stufen einer AKTIVEN Aktion sind nicht änderbar. Sicherer Ablauf (jeder Schritt protokolliert):
 * 1) alte Aktion pausieren → 2) Update erneut versuchen (pausiert = nicht aktiv) → bei Erfolg wieder fortsetzen.
 * 3) Sonst NEUE Aktion anlegen (Start +5 Min) → bei Erfolg alte (pausierte) löschen. 4) Scheitert auch das → alte wieder fortsetzen
 * (Rückfall: es läuft wieder genau die alte Aktion). Die alte wird nie gelöscht, bevor die neue angelegt ist.
 */
export async function replaceActivePromotion(a: { base: string; headers: Record<string, string>; oldId: string; body: Record<string, unknown>; fetchFn: typeof fetch }):
  Promise<{ ok: boolean; promotionId?: string; trace: string[]; error?: string }> {
  const f = a.fetchFn; const trace: string[] = [];
  const oldUrl = `${a.base}/sell/marketing/v1/item_promotion/${encodeURIComponent(a.oldId)}`;
  const short = async (r: Response) => (await r.text().catch(() => '')).slice(0, 200);
  const pause = await f(`${a.base}/sell/marketing/v1/promotion/${encodeURIComponent(a.oldId)}/pause`, { method: 'POST', headers: a.headers });
  trace.push(`pause ${pause.status}${pause.ok ? '' : ' ' + await short(pause)}`);
  const resume = async () => { const r = await f(`${a.base}/sell/marketing/v1/promotion/${encodeURIComponent(a.oldId)}/resume`, { method: 'POST', headers: a.headers }); trace.push(`resume ${r.status}${r.ok ? '' : ' ' + await short(r)}`); };
  // Ohne Pause keine zweite Aktion anlegen (sonst liefen zwei Mengenrabatte gleichzeitig) → abbrechen, alte läuft unverändert.
  if (!pause.ok) return { ok: false, trace, error: `pausePromotion ${pause.status}` };
  {
    const cur = await f(oldUrl, { headers: a.headers });
    const curJson = cur.ok ? await cur.json() as Record<string, unknown> : {};
    const put = await f(oldUrl, { method: 'PUT', headers: a.headers, body: JSON.stringify(keepRunningPromotionDates(a.body, curJson)) });
    trace.push(`update(pausiert) ${put.status}${put.ok ? '' : ' ' + await short(put)}`);
    if (put.ok) { await resume(); return { ok: true, promotionId: a.oldId, trace }; }
  }
  const post = await f(`${a.base}/sell/marketing/v1/item_promotion`, { method: 'POST', headers: a.headers, body: JSON.stringify(a.body) });
  const postText = await post.text().catch(() => '');
  trace.push(`neu ${post.status}${post.ok ? '' : ' ' + postText.slice(0, 200)}`);
  if (!post.ok) { await resume(); return { ok: false, trace, error: `createItemPromotion ${post.status}` }; }
  let newId = (post.headers.get('location') ?? '').split('/').filter(Boolean).pop() ?? null;
  if (!newId) { try { newId = (JSON.parse(postText) as { promotionId?: string }).promotionId ?? null; } catch { /* leer */ } }
  const del = await f(oldUrl, { method: 'DELETE', headers: a.headers });
  trace.push(`alte löschen ${del.status}${del.ok || del.status === 204 ? '' : ' ' + await short(del)}`);
  return newId ? { ok: true, promotionId: newId, trace } : { ok: false, trace, error: 'neue Aktion ohne ID' };
}
