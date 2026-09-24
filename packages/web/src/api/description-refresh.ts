// Paket 4: eine einzige Rechenstelle für den Beschreibungs-Nachzieh-Weg — von der bestehenden
// Einzel-Route (POST /ebay/products/:productId/refresh-description, Paket 3) UND der neuen
// Stapel-Route (POST /ebay/descriptions/refresh-batch) genutzt. Kein zweiter Weg, keine Kopie
// (GRUNDGESETZ Regel 8) — beide Routen rufen ausschließlich refreshOneProductDescription() auf,
// inklusive derselben 422-Sperre (bleibt nach der Bereinigung eine fremde E-Mail-Adresse im Text,
// wird NICHT hochgeladen).
//
// Reine, injizierbare Logik (GRUNDGESETZ Regel 2) — ohne echte DB/eBay-Zugriffe testbar.

import { neutralizeGpsrTab, findForeignEmails } from '../shared/gpsr-description';

export const MAX_DESCRIPTION_REFRESH_BATCH = 10;

/** Harte Obergrenze je Aufruf. Reine Funktion, damit die Route sie 1:1 testbar aufruft. */
export function checkBatchSize(productIds: unknown[]): string | null {
  if (productIds.length > MAX_DESCRIPTION_REFRESH_BATCH) {
    return `Höchstens ${MAX_DESCRIPTION_REFRESH_BATCH} Produkte je Aufruf, ${productIds.length} übergeben`;
  }
  return null;
}

export interface DescriptionRefreshProduct {
  id: number;
  ebayListingId: string | null;
  htmlDescription: string | null;
}

export interface DescriptionRefreshDeps {
  getProduct: (productId: number) => Promise<DescriptionRefreshProduct | undefined>;
  reviseListingContent: (itemId: string, input: { htmlDescription: string }) => Promise<{ ok: boolean; error?: string }>;
  updateProductDescription: (productId: number, htmlDescription: string) => Promise<void>;
}

export type DescriptionRefreshOutcome =
  | { productId: number; ok: true; dryRun: true; itemId: string; changed: boolean; foreignEmailsBefore: string[]; foreignEmailsAfter: string[] }
  | { productId: number; ok: true; dryRun: false; itemId: string; foreignEmailsBefore: string[] }
  | { productId: number; ok: false; httpStatus: 404 | 400 | 422 | 500; error: string; foreignEmails?: string[] };

/**
 * Bereinigt und lädt (bei confirm:true) AUSSCHLIESSLICH die Beschreibung EINES Produkts hoch.
 * Preis, Menge, Titel, Merkmale, Kategorie und regulatory bleiben unangetastet — reviseListingContent()
 * bekommt hier nie ein `title`.
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
  if (!before) return { productId, ok: false, httpStatus: 400, error: 'Keine gespeicherte Beschreibung vorhanden' };

  const after = neutralizeGpsrTab(before);
  const foreignBefore = findForeignEmails(before);
  const foreignAfter = findForeignEmails(after);
  if (foreignAfter.length > 0) {
    return {
      productId, ok: false, httpStatus: 422,
      error: 'Nach der Bereinigung steht noch mindestens eine fremde E-Mail-Adresse im Text — nicht hochgeladen',
      foreignEmails: foreignAfter,
    };
  }

  if (opts.confirm !== true) {
    return { productId, ok: true, dryRun: true, itemId: product.ebayListingId, changed: after !== before, foreignEmailsBefore: foreignBefore, foreignEmailsAfter: foreignAfter };
  }

  try {
    const result = await deps.reviseListingContent(product.ebayListingId, { htmlDescription: after });
    if (!result.ok) return { productId, ok: false, httpStatus: 400, error: result.error ?? 'Fehler bei ReviseFixedPriceItem' };
    await deps.updateProductDescription(productId, after);
    return { productId, ok: true, dryRun: false, itemId: product.ebayListingId, foreignEmailsBefore: foreignBefore };
  } catch (e) {
    return { productId, ok: false, httpStatus: 500, error: String(e) };
  }
}

/**
 * Stapel-Verarbeitung: läuft die productIds nacheinander durch dieselbe refreshOneProductDescription()
 * wie die Einzel-Route. Bricht ein Produkt ab (Fehler/Exception), läuft der Rest weiter — der Fehler
 * steht im Wortlaut im jeweiligen Ergebnis-Eintrag. Zwischen zwei eBay-Aufrufen (nur bei confirm:true,
 * echter Trading-API-Call) eine Pause, damit die API nicht gedrosselt wird.
 */
export async function refreshDescriptionsBatch(
  productIds: number[],
  opts: { confirm?: boolean },
  deps: DescriptionRefreshDeps,
  sleepMs = 500,
): Promise<{ results: DescriptionRefreshOutcome[] }> {
  const results: DescriptionRefreshOutcome[] = [];
  for (let i = 0; i < productIds.length; i++) {
    const productId = productIds[i];
    try {
      results.push(await refreshOneProductDescription(productId, opts, deps));
    } catch (e) {
      results.push({ productId, ok: false, httpStatus: 500, error: String(e) });
    }
    const isLast = i === productIds.length - 1;
    if (!isLast && opts.confirm === true) {
      await new Promise(r => setTimeout(r, sleepMs));
    }
  }
  return { results };
}
