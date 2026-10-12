// K-005 Punkt 2 (Kalkulator, 11.10.2026): Ist ein Angebot bei eBay wirklich beworben (Promoted Listings, Kosten pro Verkauf)?
// Bisher stand bei allen 67 Produkten adRate 5 in der DB — auch bei Angeboten, die in keiner laufenden Kampagne sind (z.B. stele-97).
// REINE Funktionen (kein DB-, kein eBay-Zugriff): Kampagnen + Anzeigen aus der Sell Marketing API → Anzeigensatz je eBay-Angebot,
// und der Abgleich gegen den gespeicherten products.adRate. Ob der Abgleich in die DB geschrieben wird, entscheidet der Inhaber
// (eigener Knopf/Endpunkt mit confirm) — hier wird nichts geschrieben.
//
// Regeln (aus der eBay-Doku zur Sell Marketing API, getCampaigns / getAds):
//  - nur Kampagnen mit campaignStatus RUNNING zählen (PAUSED/ENDED/SCHEDULED/DRAFT kosten beim Verkauf nichts)
//  - nur fundingModel COST_PER_SALE ergibt einen %-Satz vom Verkaufspreis; COST_PER_CLICK (Advanced) kostet pro Klick und
//    wird als "CPC" gemeldet, nicht in einen %-Satz umgerechnet (nichts geraten)
//  - Anzeigen mit adStatus ACTIVE (fehlt der Status, zählt die Anzeige als aktiv); Satz der Anzeige (bidPercentage),
//    sonst der Kampagnen-Satz (fundingStrategy.bidPercentage, z.B. bei regelbasierten Kampagnen)
//  - steht ein Angebot in mehreren laufenden CPS-Kampagnen, gilt der HÖCHSTE Satz (Gewinn nie zu hoch)

import { DEFAULT_PRICING_CONFIG } from './pricing';

export interface MarketingCampaign {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  fundingModel: string | null;        // COST_PER_SALE | COST_PER_CLICK
  bidPercentage: number | null;       // Kampagnen-Satz (fundingStrategy.bidPercentage), falls vorhanden
}

export interface MarketingAd {
  listingId: string;
  bidPercentage: number | null;
  adStatus: string | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function parseMarketingCampaigns(json: unknown): MarketingCampaign[] {
  const data = json as { campaigns?: Array<Record<string, unknown>> } | null;
  return (data?.campaigns ?? [])
    .filter(c => typeof c.campaignId === 'string' && c.campaignId)
    .map(c => {
      const fs = (c.fundingStrategy ?? {}) as Record<string, unknown>;
      return {
        campaignId: String(c.campaignId),
        campaignName: String(c.campaignName ?? ''),
        campaignStatus: String(c.campaignStatus ?? 'UNBEKANNT'),
        fundingModel: typeof fs.fundingModel === 'string' ? fs.fundingModel : null,
        bidPercentage: num(fs.bidPercentage),
      };
    });
}

export function parseCampaignAds(json: unknown): { ads: MarketingAd[]; next: string | null } {
  const data = json as { ads?: Array<Record<string, unknown>>; next?: string } | null;
  const ads = (data?.ads ?? [])
    .filter(a => a.listingId != null && String(a.listingId) !== '')
    .map(a => ({
      listingId: String(a.listingId),
      bidPercentage: num(a.bidPercentage),
      adStatus: typeof a.adStatus === 'string' ? a.adStatus : null,
    }));
  return { ads, next: typeof data?.next === 'string' && data.next ? data.next : null };
}

export type ListingPromotion =
  | { kind: 'CPS'; ratePercent: number; campaignIds: string[] }
  | { kind: 'CPC'; campaignIds: string[] }
  | { kind: 'NONE' };

export function isRunningCps(c: MarketingCampaign): boolean {
  return c.campaignStatus === 'RUNNING' && c.fundingModel === 'COST_PER_SALE';
}

/** eBay-Angebot (listingId) → tatsächliche Bewerbung. adsByCampaign: Anzeigen je campaignId (nur für laufende Kampagnen nötig). */
export function promotionByListing(
  campaigns: MarketingCampaign[],
  adsByCampaign: Record<string, MarketingAd[]>,
): Map<string, ListingPromotion> {
  const out = new Map<string, ListingPromotion>();
  for (const c of campaigns) {
    if (c.campaignStatus !== 'RUNNING') continue;
    for (const ad of adsByCampaign[c.campaignId] ?? []) {
      if (ad.adStatus && ad.adStatus !== 'ACTIVE') continue;
      const prev = out.get(ad.listingId);
      if (c.fundingModel === 'COST_PER_SALE') {
        const rate = ad.bidPercentage ?? c.bidPercentage;
        if (rate == null) continue; // ohne Satz nichts raten
        if (prev?.kind === 'CPS') {
          out.set(ad.listingId, { kind: 'CPS', ratePercent: Math.max(prev.ratePercent, rate), campaignIds: [...prev.campaignIds, c.campaignId] });
        } else {
          out.set(ad.listingId, { kind: 'CPS', ratePercent: rate, campaignIds: [c.campaignId] });
        }
      } else if (c.fundingModel === 'COST_PER_CLICK' && prev?.kind !== 'CPS') {
        out.set(ad.listingId, { kind: 'CPC', campaignIds: [...(prev?.kind === 'CPC' ? prev.campaignIds : []), c.campaignId] });
      }
    }
  }
  return out;
}

export interface AdRateCheckProduct { id: number; ebayListingId: string | null; adRate: number | null }
export interface AdRateCheckRow {
  productId: number;
  ebayListingId: string;
  storedAdRate: number | null;        // products.adRate (null = Default 5 in der Formel)
  ebayKind: ListingPromotion['kind'];
  ebayAdRate: number | null;          // CPS: Satz; NONE: 0; CPC: null (nicht als %-Satz darstellbar)
  differs: boolean;                   // nur CPS/NONE — CPC wird gemeldet, aber nicht automatisch abgeglichen
}

/** Abgleich gespeicherter adRate ↔ eBay. Produkte ohne eBay-Angebot fehlen. Default 5 (adRate null) zählt wie 5. */
export function compareAdRates(products: AdRateCheckProduct[], promo: Map<string, ListingPromotion>, defaultAdRate: number = DEFAULT_PRICING_CONFIG.defaultAdRatePercent): AdRateCheckRow[] {
  const rows: AdRateCheckRow[] = [];
  for (const p of products) {
    if (!p.ebayListingId) continue;
    const pr = promo.get(p.ebayListingId) ?? { kind: 'NONE' as const };
    const ebayAdRate = pr.kind === 'CPS' ? pr.ratePercent : pr.kind === 'NONE' ? 0 : null;
    const effectiveStored = p.adRate ?? defaultAdRate;
    rows.push({
      productId: p.id, ebayListingId: p.ebayListingId, storedAdRate: p.adRate, ebayKind: pr.kind, ebayAdRate,
      differs: ebayAdRate != null && Math.abs(effectiveStored - ebayAdRate) > 1e-9,
    });
  }
  return rows;
}
