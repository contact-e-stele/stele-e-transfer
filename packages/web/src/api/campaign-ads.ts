// OFFEN 018 / ENTSCHEIDUNG 018: Angebote je Anzeige mit festem Satz in die laufende Kosten-pro-Verkauf-Kampagne (Marketing API).
import { EBAY_API_BASE_URL, fetchPromotionStatus, getMarketingAccessToken } from './ebay';
import { bulkAdRequests, parseBulkAdResponse, pickCpsCampaign, type BulkAdResult } from '../shared/campaign-ads';

export interface CampaignAdsResult { ok: boolean; campaignId: string | null; results: BulkAdResult[]; error?: string }

async function postBulk(path: string, body: unknown, token: string): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${EBAY_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, json, text };
}

/** Legt je Angebot eine Anzeige mit `percent` an; existiert sie schon, wird nur der Satz auf `percent` gesetzt. */
export async function sendCampaignAds(listingIds: string[], percent: number, campaignId?: string | null): Promise<CampaignAdsResult> {
  if (listingIds.length === 0) return { ok: true, campaignId: null, results: [] };
  const { campaigns } = await fetchPromotionStatus();
  const pick = pickCpsCampaign(campaigns, campaignId);
  if (!pick.ok) return { ok: false, campaignId: null, results: [], error: pick.error };
  const cid = pick.campaign.campaignId;
  const token = await getMarketingAccessToken();
  const body = bulkAdRequests(listingIds, percent);
  const created = await postBulk(`/sell/marketing/v1/ad_campaign/${encodeURIComponent(cid)}/bulk_create_ads_by_listing_id`, body, token);
  let results = parseBulkAdResponse(created.json);
  if (results.length === 0) {
    return { ok: false, campaignId: cid, results: [], error: `bulk_create_ads ${created.status}: ${created.text.slice(0, 300)}` };
  }
  const existing = results.filter(r => r.alreadyExists).map(r => r.listingId);
  if (existing.length > 0) {
    const upd = await postBulk(`/sell/marketing/v1/ad_campaign/${encodeURIComponent(cid)}/bulk_update_ads_bid_by_listing_id`, bulkAdRequests(existing, percent), token);
    const updRes = new Map(parseBulkAdResponse(upd.json).map(r => [r.listingId, r]));
    results = results.map(r => r.alreadyExists ? (updRes.get(r.listingId) ?? { ...r, error: `bulk_update ${upd.status}: ${upd.text.slice(0, 200)}` }) : r);
  }
  for (const r of results) console.log(`[Kampagne] ${cid} ${r.listingId} ${percent} %: ${r.ok ? 'ok' : `FEHLER ${r.error}`}`);
  return { ok: results.every(r => r.ok), campaignId: cid, results };
}

const RETRY_MINUTES = [5, 10, 20, 40];
const isNotYetKnown = (e: string | null) => /invalid|ungültig|not found|35048|38227/i.test(e ?? '');

/** Nach dem ERSTEN Listen: mit dem App-Satz in die Kampagne. Neue Angebote kennt die Marketing API oft erst nach Minuten → Nachholen. */
export async function sendCampaignAdForNewListing(productId: number, listingId: string, percent: number, attempt = 0): Promise<CampaignAdsResult | null> {
  if (!(percent > 0)) return null;
  try {
    const r = await sendCampaignAds([listingId], percent);
    const err = r.results[0]?.error ?? r.error ?? null;
    if (!r.ok && isNotYetKnown(err) && attempt < RETRY_MINUTES.length) {
      const wait = RETRY_MINUTES[attempt] - (attempt === 0 ? 0 : RETRY_MINUTES[attempt - 1]);
      console.warn(`[Kampagne] stele-${productId}: noch nicht aufgenommen (${err}) — neuer Versuch in ${wait} Min.`);
      setTimeout(() => { void sendCampaignAdForNewListing(productId, listingId, percent, attempt + 1); }, wait * 60_000);
    }
    return r;
  } catch (e) {
    console.warn(`[Kampagne] stele-${productId}: Fehler ${String(e)}`);
    return { ok: false, campaignId: null, results: [], error: String(e) };
  }
}

/**
 * OFFEN 024 NACHTRAG: Angebote aus ALLEN laufenden Kampagnen nehmen, in denen sie beworben sind (bulk_delete_ads_by_listing_id),
 * danach bei eBay neu ablesen. ok je Angebot nur, wenn es danach in keiner laufenden Kampagne mehr aktiv ist.
 */
export async function removeCampaignAds(listingIds: string[]): Promise<{ ok: boolean; results: Array<{ listingId: string; ok: boolean; error: string | null }> }> {
  const { bulkDeleteAdRequests } = await import('../shared/campaign-ads');
  if (listingIds.length === 0) return { ok: true, results: [] };
  const before = await fetchPromotionStatus();
  const byCampaign = new Map<string, string[]>();
  for (const id of listingIds) for (const cid of before.promo.get(id)?.campaignIds ?? []) byCampaign.set(cid, [...(byCampaign.get(cid) ?? []), id]);
  const token = await getMarketingAccessToken();
  const errors = new Map<string, string>();
  for (const [cid, ids] of byCampaign) {
    const r = await postBulk(`/sell/marketing/v1/ad_campaign/${encodeURIComponent(cid)}/bulk_delete_ads_by_listing_id`, bulkDeleteAdRequests(ids), token);
    const parsed = parseBulkAdResponse(r.json);
    if (parsed.length === 0) for (const id of ids) errors.set(id, `bulk_delete_ads ${r.status}: ${r.text.slice(0, 200)}`);
    for (const p of parsed) if (!p.ok && p.error) errors.set(p.listingId, p.error);
  }
  const after = await fetchPromotionStatus();
  const results = listingIds.map(listingId => {
    const still = after.promo.get(listingId);
    const ok = !still;
    const error = ok ? null : (errors.get(listingId) ?? `bei eBay weiterhin beworben (${still?.campaignIds.join(', ')})`);
    console.log(`[Kampagne] ${listingId} entfernen: ${ok ? 'ok, nicht mehr beworben' : `FEHLER ${error}`}`);
    return { listingId, ok, error };
  });
  return { ok: results.every(r => r.ok), results };
}
