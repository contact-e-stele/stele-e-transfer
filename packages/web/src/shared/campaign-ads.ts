// OFFEN 018 / ENTSCHEIDUNG 018 (Inhaber 30.10.2026 05:57 „W5“): Angebote mit 5 % je Anzeige in die eBay-Kampagne (Marketing API),
// weil der Trading-Weg (ReviseFixedPriceItem AdvancedMarketing) bei Inventory-API-Angeboten scheitert. Reine Funktionen.
import type { MarketingCampaign } from './promoted-status';

/** Die eine laufende Kosten-pro-Verkauf-Kampagne (bzw. die angegebene). Mehrdeutig/keine → Fehlertext. */
export function pickCpsCampaign(campaigns: MarketingCampaign[], wantedId?: string | null): { ok: true; campaign: MarketingCampaign } | { ok: false; error: string } {
  if (wantedId) {
    const c = campaigns.find(x => x.campaignId === wantedId);
    if (!c) return { ok: false, error: `Kampagne ${wantedId} nicht gefunden` };
    if (c.campaignStatus !== 'RUNNING' || c.fundingModel !== 'COST_PER_SALE') return { ok: false, error: `Kampagne ${wantedId} ist nicht RUNNING/COST_PER_SALE (${c.campaignStatus}/${c.fundingModel})` };
    return { ok: true, campaign: c };
  }
  const running = campaigns.filter(c => c.campaignStatus === 'RUNNING' && c.fundingModel === 'COST_PER_SALE');
  if (running.length === 1) return { ok: true, campaign: running[0] };
  return { ok: false, error: running.length === 0 ? 'Keine laufende Kampagne (Kosten pro Verkauf)' : `Mehrere laufende Kampagnen (${running.map(c => c.campaignId).join(', ')}) — campaignId angeben` };
}

/** eBay erwartet bidPercentage als Text mit einer Nachkommastelle, 2,0–100,0. */
export function bidText(percent: number): string {
  if (!Number.isFinite(percent) || percent < 2 || percent > 100) throw new Error(`Anzeigensatz ${percent} % ungültig (2–100)`);
  return (Math.round(percent * 10) / 10).toFixed(1);
}

export function bulkAdRequests(listingIds: string[], percent: number): { requests: Array<{ listingId: string; bidPercentage: string }> } {
  const bid = bidText(percent);
  return { requests: [...new Set(listingIds)].map(listingId => ({ listingId, bidPercentage: bid })) };
}

export interface BulkAdResult { listingId: string; ok: boolean; alreadyExists: boolean; error: string | null }

/** Antwort von bulk_create_ads_by_listing_id / bulk_update_ads_bid_by_listing_id je Angebot auswerten. */
export function parseBulkAdResponse(json: unknown): BulkAdResult[] {
  const rows = ((json as { responses?: Array<Record<string, unknown>> } | null)?.responses ?? []);
  return rows.map(r => {
    const errs = Array.isArray(r.errors) ? r.errors as Array<Record<string, unknown>> : [];
    const status = typeof r.statusCode === 'number' ? r.statusCode : 0;
    const msg = errs.map(e => `${e.errorId ?? ''} ${e.message ?? ''}`.trim()).join(' · ') || null;
    const alreadyExists = errs.some(e => /already|bereits|exist/i.test(String(e.message ?? '')) || e.errorId === 35036 || e.errorId === 35045);
    return { listingId: String(r.listingId ?? ''), ok: errs.length === 0 && status >= 200 && status < 300, alreadyExists, error: msg };
  });
}
