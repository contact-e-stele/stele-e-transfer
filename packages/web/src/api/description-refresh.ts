// Paket 4 (2026-08-31) / eBay-Verstoßserie 2026-09-28: eine einzige Rechenstelle für den
// Beschreibungs-Nachzieh-Weg — von der bestehenden Einzel-Route
// (POST /ebay/products/:productId/refresh-description) UND der Stapel-Route
// (POST /ebay/descriptions/refresh-batch) genutzt. Kein zweiter Weg, keine Kopie
// (GRUNDGESETZ Regel 8) — beide Routen rufen ausschließlich refreshOneProductDescription() auf.
//
// Seit der eBay-Verstoßserie 2026-09-28 (6 gesperrte Live-Angebote: eigene Kontaktadresse in
// Impressum/AGB-Tabs, fremde GPSR-Lieferanten-Kontakte, 2-12 auf ae01.alicdn.com hotgelinkte
// Varianten-Bilder in ALTEN, nie aufgefrischten Beschreibungen) reicht bloßes Patchen der
// gespeicherten Beschreibung (alter Stand: nur GPSR-Tab neutralisieren) nicht mehr aus — eine
// stale gespeicherte Beschreibung kann all das bereits enthalten haben, von VOR diesem Fix.
// Stattdessen wird die Beschreibung über buildProductDescriptionForEbay() aus den AKTUELLEN
// Produktfeldern (Titel, Specs, Varianten, ...) komplett NEU aufgebaut — derselbe Weg wie beim
// Erst-Listing (/ebay/list, GRUNDGESETZ Regel 8) — das behebt nebenbei auch eine veraltete
// englische Beschreibungsüberschrift (SOLL f), da diese aus dem aktuellen generatedTitle kommt.
//
// Reine, injizierbare Logik (GRUNDGESETZ Regel 2) — ohne echte DB/eBay-Zugriffe testbar.

import { buildProductDescriptionForEbay, type ProductDescriptionFields } from './ebay-description-builder';
import { findDescriptionComplianceViolations, summarizeDescriptionViolations, type DescriptionComplianceViolation, type DescriptionViolationSummary } from '../shared/description-compliance';

export const MAX_DESCRIPTION_REFRESH_BATCH = 10;

/** Harte Obergrenze je Aufruf. Reine Funktion, damit die Route sie 1:1 testbar aufruft. */
export function checkBatchSize(productIds: unknown[]): string | null {
  if (productIds.length > MAX_DESCRIPTION_REFRESH_BATCH) {
    return `Höchstens ${MAX_DESCRIPTION_REFRESH_BATCH} Produkte je Aufruf, ${productIds.length} übergeben`;
  }
  return null;
}

export interface DescriptionRefreshProduct extends ProductDescriptionFields {
  id: number;
  ebayListingId: string | null;
  htmlDescription: string | null; // nur noch für den changed-Vergleich (alt vs. neu aufgebaut) genutzt
}

export interface DescriptionRefreshDeps {
  getProduct: (productId: number) => Promise<DescriptionRefreshProduct | undefined>;
  // P71-B Teil 1: productId zusätzlich zu itemId, weil der Inventory-API-Weg (erster Versuch,
  // s. ebay.ts reviseListingDescription()) die SKU aus der Produkt-ID ableitet (`stele-{productId}`)
  // — die eBay-ItemID allein reicht dafür nicht.
  reviseListingContent: (productId: number, itemId: string, input: { htmlDescription: string; title?: string }) => Promise<{ ok: boolean; error?: string }>;
  updateProductDescription: (productId: number, htmlDescription: string) => Promise<void>;
}

export type DescriptionRefreshOutcome =
  | { productId: number; ok: true; dryRun: true; itemId: string; changed: boolean; violationsBefore: DescriptionComplianceViolation[]; violationsAfter: DescriptionComplianceViolation[]; summaryBefore: DescriptionViolationSummary; summaryAfter: DescriptionViolationSummary }
  | { productId: number; ok: true; dryRun: false; itemId: string; violationsBefore: DescriptionComplianceViolation[] }
  | { productId: number; ok: false; httpStatus: 404 | 400 | 422 | 500; error: string; violations?: DescriptionComplianceViolation[]; summaryBefore?: DescriptionViolationSummary; summaryAfter?: DescriptionViolationSummary };

/**
 * Baut (bei confirm:true: lädt hoch) AUSSCHLIESSLICH die Beschreibung EINES Produkts aus dessen
 * aktuellen Feldern neu auf. Preis, Menge, Merkmale, Kategorie und regulatory bleiben unangetastet
 * — reviseListingContent() bekommt hier nie mehr als htmlDescription und den aktuellen Titel.
 */
export async function refreshOneProductDescription(
  productId: number,
  opts: { confirm?: boolean },
  deps: DescriptionRefreshDeps,
): Promise<DescriptionRefreshOutcome> {
  let product: DescriptionRefreshProduct | undefined;
  try {
    product = await deps.getProduct(productId);
  } catch (e) {
    return { productId, ok: false, httpStatus: 500, error: String(e) };
  }
  if (!product) return { productId, ok: false, httpStatus: 404, error: 'Produkt nicht gefunden' };
  if (!product.ebayListingId) return { productId, ok: false, httpStatus: 400, error: 'Produkt hat kein laufendes eBay-Angebot' };

  const before = product.htmlDescription ?? '';
  const violationsBefore = findDescriptionComplianceViolations(before);
  const { html: after, violations: descriptionViolations } = buildProductDescriptionForEbay(product);
  // Code-Review-Fund (eBay-Verstoßserie 2026-09-28): der Titel geht bei confirm:true GENAUSO an
  // eBay (<Title>) wie die Beschreibung, lief aber nicht durch den Validator — ein alter, noch
  // verunreinigter Titel (dieselbe Quelle wie die zu bereinigenden Beschreibungen) hätte die
  // 422-Sperre umgangen. Titel und Beschreibung werden deshalb gemeinsam geprüft.
  const newTitle = (product.generatedTitle ?? product.title).slice(0, 80);
  const violationsAfter = [...descriptionViolations, ...findDescriptionComplianceViolations(newTitle)];

  // P71-B Teil 2: echte Anzahl je Muster (nicht dedupliziert) für die Vorschau im Listings-Tab.
  const summaryBefore = summarizeDescriptionViolations(before);
  const summaryAfter = summarizeDescriptionViolations(`${after}
${newTitle}`);

  if (violationsAfter.length > 0) {
    return {
      productId, ok: false, httpStatus: 422,
      error: 'Nach dem Neuaufbau verstößt der Text noch gegen mindestens eine Dauerregel (E-Mail, Link/Domain, GPSR-Rohtext, Versandangabe) (Beschreibung oder Titel) — nicht hochgeladen',
      violations: violationsAfter, summaryBefore, summaryAfter,
    };
  }

  if (opts.confirm !== true) {
    return { productId, ok: true, dryRun: true, itemId: product.ebayListingId, changed: after !== before, violationsBefore, violationsAfter, summaryBefore, summaryAfter };
  }

  try {
    const result = await deps.reviseListingContent(productId, product.ebayListingId, { htmlDescription: after, title: newTitle });
    if (!result.ok) return { productId, ok: false, httpStatus: 400, error: result.error ?? 'Fehler beim Aktualisieren der Beschreibung' };
    await deps.updateProductDescription(productId, after);
    return { productId, ok: true, dryRun: false, itemId: product.ebayListingId, violationsBefore };
  } catch (e) {
    return { productId, ok: false, httpStatus: 500, error: String(e) };
  }
}

/**
 * Stapel-Verarbeitung: läuft die productIds nacheinander durch dieselbe refreshOneProductDescription()
 * wie die Einzel-Route. Bricht ein Produkt ab (Fehler/Exception), läuft der Rest weiter — der Fehler
 * steht im Wortlaut im jeweiligen Ergebnis-Eintrag. Zwischen zwei eBay-Aufrufen (nur bei confirm:true,
 * echter Trading-API-Call) eine Pause, damit die API nicht gedrosselt wird.
 * Doppelte IDs im Aufruf werden vorher entfernt (Reihenfolge bleibt erhalten) — sonst würde ein
 * doppeltes Produkt zweimal hochgeladen (unnötiger eBay-Traffic, Code-Review-Vorschlag).
 */
export async function refreshDescriptionsBatch(
  productIds: number[],
  opts: { confirm?: boolean },
  deps: DescriptionRefreshDeps,
  sleepMs = 500,
): Promise<{ results: DescriptionRefreshOutcome[] }> {
  const uniqueIds = [...new Set(productIds)];
  const results: DescriptionRefreshOutcome[] = [];
  for (let i = 0; i < uniqueIds.length; i++) {
    const productId = uniqueIds[i];
    try {
      results.push(await refreshOneProductDescription(productId, opts, deps));
    } catch (e) {
      results.push({ productId, ok: false, httpStatus: 500, error: String(e) });
    }
    const isLast = i === uniqueIds.length - 1;
    if (!isLast && opts.confirm === true) {
      await new Promise(r => setTimeout(r, sleepMs));
    }
  }
  return { results };
}
