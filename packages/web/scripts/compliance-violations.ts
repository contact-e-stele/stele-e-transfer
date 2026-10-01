// P71-D — Prüfskript Compliance: NUR LESEN. Zeigt, welche aktiven eBay-Angebote eBay als Verstoß
// "OUTSIDE_EBAY_BUYING_AND_SELLING" oder "HTTPS" führt. Kein eBay-Schreib-Call, keine DB-Änderung,
// keine Neu-Autorisierung: bei HTTP-Fehler (z. B. 403 insufficient scope) wird der Fehler
// wörtlich ausgegeben und das Skript beendet sich sauber.
//
// Lokaler Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/compliance-violations.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import { getAccessToken, getAllSellerListings } from '../src/api/ebay';
import {
  flattenViolations, groupByListing, formatReport,
  type RawListingViolation, type ViolationRow,
} from '../src/shared/compliance-violations';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const BASE = 'https://api.ebay.com/sell/compliance/v1';
const COMPLIANCE_TYPES = ['OUTSIDE_EBAY_BUYING_AND_SELLING', 'HTTPS'] as const;

class HttpError extends Error {}

async function getJson(path: string, token: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_DE' },
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(`GET ${path} → HTTP ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

async function fetchViolations(type: string, token: string): Promise<RawListingViolation[]> {
  const all: RawListingViolation[] = [];
  const limit = 200;
  for (let offset = 0; ; offset += limit) {
    const data = await getJson(
      `/listing_violation?compliance_type=${type}&limit=${limit}&offset=${offset}`, token);
    const page: RawListingViolation[] = data.listingViolations ?? [];
    all.push(...page);
    if (page.length < limit || (typeof data.total === 'number' && all.length >= data.total)) break;
  }
  return all;
}

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'compliance-violations.md');

try {
  const token = await getAccessToken();

  const summary = await getJson('/listing_violation_summary', token);
  const summaryCounts: Record<string, number> = {};
  for (const s of summary.violationSummaries ?? []) {
    summaryCounts[s.complianceType] = s.listingCount ?? s.violationCount ?? 0;
  }

  const rows: ViolationRow[] = [];
  for (const type of COMPLIANCE_TYPES) {
    rows.push(...flattenViolations(await fetchViolations(type, token), type));
  }

  const products = await db.select({
    id: schema.products.id,
    title: schema.products.title,
    ebayListingId: schema.products.ebayListingId,
  }).from(schema.products);

  const listings = groupByListing(rows, products);
  const violatingIds = new Set(listings.map(l => l.listingId));
  const byListing = new Map(products.filter(p => p.ebayListingId).map(p => [p.ebayListingId as string, p.id]));
  const active = await getAllSellerListings();
  const activeWithoutViolation = active
    .filter(a => !violatingIds.has(a.itemId))
    .map(a => ({ itemId: a.itemId, title: a.title, productId: byListing.get(a.itemId) ?? null }));

  const report = [
    '# P71-D — Compliance-Verstöße (nur lesend)', '',
    `Lauf: ${new Date().toISOString()}`, '',
    formatReport({ summaryCounts, listings, activeWithoutViolation, activeTotal: active.length }),
  ].join('\n');
  writeFileSync(outPath, report, 'utf-8');
  console.log(report);
} catch (err) {
  // Wörtlich ausgeben, NICHT neu autorisieren.
  console.error(`FEHLER (Abbruch ohne Änderung): ${err instanceof Error ? err.message : String(err)}`);
  process.exit(0);
}
