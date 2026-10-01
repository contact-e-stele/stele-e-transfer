// P71-D — reine Auswertung der eBay Compliance API (sell/compliance/v1/listing_violation).
// Kein Netzwerk, kein DB-Zugriff: Daten kommen injiziert (scripts/compliance-violations.ts).

/** Produkte, bei denen die Beschreibung schon nachgezogen wurde (P71-C). */
export const NACHGEZOGENE_PRODUKT_IDS = [147, 148, 123, 132, 160, 161, 163, 189] as const;

export interface RawViolation {
  reasonCode?: string;
  message?: string;
  ruleId?: string;
}

export interface RawListingViolation {
  listingId?: string;
  sku?: string;
  complianceType?: string;
  violations?: RawViolation[];
  variations?: { sku?: string; offerId?: string; violations?: RawViolation[] }[];
}

export interface ViolationRow {
  listingId: string;
  sku: string;
  complianceType: string;
  reasonCode: string;
  message: string;
  variantSku: string;
}

export interface AppProductRef {
  id: number;
  title: string;
  ebayListingId: string | null;
}

export interface ListingReportRow {
  listingId: string;
  productId: number | null;
  title: string;
  nachgezogen: boolean;
  violations: ViolationRow[];
}

export function truncate(text: string | undefined, max = 200): string {
  const clean = (text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Flacht die API-Antwort auf eine Zeile je (Angebot, Verstoß[, Variante]) ab. */
export function flattenViolations(items: RawListingViolation[], fallbackType: string): ViolationRow[] {
  const rows: ViolationRow[] = [];
  for (const item of items) {
    const base = {
      listingId: item.listingId ?? '',
      sku: item.sku ?? '',
      complianceType: item.complianceType ?? fallbackType,
    };
    const push = (v: RawViolation, variantSku: string) =>
      rows.push({
        ...base,
        reasonCode: v.reasonCode ?? v.ruleId ?? '',
        message: truncate(v.message),
        variantSku,
      });
    for (const v of item.violations ?? []) push(v, '');
    for (const variation of item.variations ?? []) {
      for (const v of variation.violations ?? []) push(v, variation.sku ?? '');
    }
  }
  return rows;
}

/** Gruppiert nach Angebot und ordnet Produkt-ID/Titel über ebayListingId zu. */
export function groupByListing(
  rows: ViolationRow[],
  products: AppProductRef[],
  nachgezogen: readonly number[] = NACHGEZOGENE_PRODUKT_IDS,
): ListingReportRow[] {
  const byListing = new Map(
    products.filter(p => p.ebayListingId).map(p => [p.ebayListingId as string, p]),
  );
  const groups = new Map<string, ViolationRow[]>();
  for (const row of rows) {
    const list = groups.get(row.listingId) ?? [];
    list.push(row);
    groups.set(row.listingId, list);
  }
  return [...groups.entries()].map(([listingId, violations]) => {
    const product = byListing.get(listingId);
    return {
      listingId,
      productId: product?.id ?? null,
      title: product?.title ?? '',
      nachgezogen: product ? nachgezogen.includes(product.id) : false,
      violations,
    };
  });
}

const cell = (s: string | number | null) =>
  String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

export function formatReport(args: {
  summaryCounts: Record<string, number>;
  listings: ListingReportRow[];
  activeWithoutViolation: { itemId: string; title: string; productId: number | null }[];
  activeTotal: number;
}): string {
  const { summaryCounts, listings, activeWithoutViolation, activeTotal } = args;
  const out: string[] = ['## Summen (listing_violation_summary)', ''];
  const types = Object.keys(summaryCounts);
  if (types.length === 0) out.push('_(keine Verstöße gemeldet)_');
  for (const t of types) out.push(`- ${t}: ${summaryCounts[t]}`);

  out.push('', `## Angebote mit Verstoß (OUTSIDE_EBAY_BUYING_AND_SELLING / HTTPS): ${listings.length}`, '');
  if (listings.length === 0) {
    out.push('_(keine)_');
  } else {
    out.push(
      '| Angebot | Produkt-ID | Titel | nachgezogen | Typ | reasonCode | Variante | Meldung |',
      '|---|---|---|---|---|---|---|---|',
    );
    for (const l of listings) {
      for (const v of l.violations) {
        out.push(
          `| ${cell(l.listingId)} | ${cell(l.productId)} | ${cell(l.title)} | ${l.nachgezogen ? 'ja' : 'nein'} | ${cell(v.complianceType)} | ${cell(v.reasonCode)} | ${cell(v.variantSku)} | ${cell(v.message)} |`,
        );
      }
    }
  }

  out.push('', `## Aktiv ohne Verstoß: ${activeWithoutViolation.length} von ${activeTotal} aktiven Angeboten`, '');
  if (activeWithoutViolation.length === 0) {
    out.push('_(keine)_');
  } else {
    out.push('| Angebot | Produkt-ID | Titel |', '|---|---|---|');
    for (const a of activeWithoutViolation) {
      out.push(`| ${cell(a.itemId)} | ${cell(a.productId)} | ${cell(a.title)} |`);
    }
  }
  return out.join('\n');
}
