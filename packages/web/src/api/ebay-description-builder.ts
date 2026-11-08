// eBay-Verstoßserie 2026-09-28: EINE gemeinsame Rechenstelle, die aus den gespeicherten
// Produktfeldern (title/generatedTitle/specs/variants/...) die eBay-HTML-Beschreibung frisch
// aufbaut, den GPSR-Tab neutralisiert und gegen den harten Compliance-Validator prüft — genutzt
// von /ebay/list (Erst-Listing, index.ts) UND refreshOneProductDescription() (Nachzieh-Weg für
// laufende Angebote, description-refresh.ts), damit beide exakt dieselbe Ausgabe für dieselben
// Produktfelder erzeugen (GRUNDGESETZ Regel 8). 1:1 aus dem bisherigen /ebay/list-Inline-Code
// extrahiert. P71-C (30.09.2026): gpsrRaw wird an buildEbayHTMLLight weitergegeben, damit der
// Tab "Produktsicherheit" erzeugt wird (Vorgabe Inhaber: 5 Tabs immer). Der Rohtext selbst landet
// nie im HTML — die Vorlage druckt nur GPSR_DESCRIPTION_NOTICE, neutralizeGpsrTab sichert zusätzlich.
import { buildEbayHTMLCurrent, activeDescriptionMarker, type ScrapedProduct as EbayScrapedProduct } from '../web/lib/ebay-description';
import { DESCRIPTION_V4_MARKER } from '../shared/description-v4';
import { neutralizeGpsrTab } from '../shared/gpsr-description';
import { findDescriptionComplianceViolations, type DescriptionComplianceViolation } from '../shared/description-compliance';
import { TEXT_VERSION_MARKER, FOOTER_BLOCK_START, FOOTER_BLOCK_END, type ReturnTerms } from '../shared/shipping-return-text';
import type { VariantDetails } from '../shared/variant-measure';
import { listingOrigin, deliveryTimeFor, type DeliveryTimes, type ListingOrigin } from '../shared/listing-origin';

export interface ProductDescriptionFields {
  title: string;
  generatedTitle?: string | null;
  description?: string | null;
  generatedDescription?: string | null;
  specs?: string | null;           // JSON object
  variants?: string | null;        // JSON array
  variantContents?: string | null; // JSON object
  variantPrices?: string | null;   // JSON array
  bullets?: string | null;         // JSON array
  images?: string | null;          // JSON array
  gpsrRaw?: string | null;         // nur als Schalter für den Tab Produktsicherheit (Inhalt: GPSR_DESCRIPTION_NOTICE)
  shipsFrom?: string | null;       // OFFEN 030: Herkunft → Lieferzeit in der Fußzeile
  // Beschreibung v3 (06.11.2026): A-045-Produktdaten + Pflichtmerkmale für Überschrift/Datentabelle
  material?: string | null;
  usageNote?: string | null;
  usePurpose?: string | null;
  variantDetails?: string | null;  // JSON {skuId: {displayNameDe, pieces, measure}}
  manualAspects?: string | null;   // JSON {"Produktart": "…"}
  // Beschreibung v4: Elektro-/Batterie-Hinweis (nur v4 zeigt ihn; v3 ignoriert die Felder)
  isElectric?: number | boolean | null;
  hasBattery?: number | boolean | null;
}

// OFFEN 029/030: was die Beschreibung von außen braucht (eBay-Rücknahme-Richtlinie, Lieferzeiten je Herkunft aus den Einstellungen).
export interface DescriptionContext {
  returnTerms?: ReturnTerms | null;
  deliveryTimes?: DeliveryTimes;
  weeeRegNr?: string | null;       // Beschreibung v4: WEEE-Zeile (nur bei Elektro = ja); v3 ignoriert sie
}

export interface BuiltProductDescription {
  html: string;
  violations: DescriptionComplianceViolation[];
  origin?: ListingOrigin; // OFFEN 030: Herkunft des Angebots (mixed → Listen gesperrt)
}

/** OFFEN 030: Herkunft aus shipsFrom + Varianten-Merkmal "Ships From" (variantPrices[].attrs). */
export function originOfProduct(product: Pick<ProductDescriptionFields, 'shipsFrom' | 'variantPrices'>): ListingOrigin {
  let attrs: Array<Record<string, string> | null> = [];
  try {
    const parsed = JSON.parse(product.variantPrices ?? '[]');
    if (Array.isArray(parsed)) attrs = parsed.map((v: { attrs?: Record<string, string> }) => (v && typeof v.attrs === 'object' ? v.attrs : null));
  } catch { /* ignore */ }
  return listingOrigin(product.shipsFrom, attrs);
}

export function buildProductDescriptionForEbay(product: ProductDescriptionFields, ctx: DescriptionContext = {}): BuiltProductDescription {
  const origin = originOfProduct(product);
  const variantGroupsParsed: Array<{ name: string; values: string[] }> = (() => {
    try {
      const parsed = JSON.parse(product.variants ?? '[]');
      if (Array.isArray(parsed) && parsed.length > 0 && 'name' in parsed[0]) return parsed;
    } catch { /* ignore */ }
    return [];
  })();
  const setContentsParsed: Record<string, string> = (() => {
    try { return JSON.parse(product.variantContents ?? '{}') as Record<string, string>; } catch { return {}; }
  })();
  const skuVariantsParsed: Array<{ name: string; price: number; imageUrl?: string }> = (() => {
    try {
      const parsed = JSON.parse(product.variantPrices ?? '[]');
      if (Array.isArray(parsed)) return parsed.map((v: { sku?: string; name?: string; ebayPrice?: number; price?: number; imageUrl?: string }) => ({
        name: v.sku ?? v.name ?? '',
        price: v.ebayPrice ?? v.price ?? 0,
        imageUrl: v.imageUrl,
      }));
    } catch { /* ignore */ }
    return [];
  })();
  const specsParsed: Record<string, string> = (() => {
    try { return JSON.parse(product.specs ?? '{}') as Record<string, string>; } catch { return {}; }
  })();
  const bulletsParsed: string[] = (() => {
    try { return JSON.parse(product.bullets ?? '[]') as string[]; } catch { return []; }
  })();
  const images: string[] = (() => {
    try { return JSON.parse(product.images ?? '[]') as string[]; } catch { return []; }
  })();
  const parseObj = <T,>(json: string | null | undefined): T | null => {
    try { const v = JSON.parse(json ?? 'null'); return v && typeof v === 'object' && !Array.isArray(v) ? v as T : null; } catch { return null; }
  };

  const templateProduct: EbayScrapedProduct = {
    title: product.generatedTitle ?? product.title,
    description: product.generatedDescription ?? product.description ?? '',
    specs: specsParsed,
    variants: variantGroupsParsed,
    skuVariants: skuVariantsParsed.length > 0 ? skuVariantsParsed : undefined,
    setContents: Object.keys(setContentsParsed).length > 0 ? setContentsParsed : undefined,
    bullets: bulletsParsed.length > 0 ? bulletsParsed : undefined,
    images: images.filter(u => u.startsWith('http')).slice(0, 3),
    gpsrRaw: product.gpsrRaw ?? undefined,
    returnTerms: ctx.returnTerms ?? null,
    deliveryTime: deliveryTimeFor(origin, ctx.deliveryTimes),
    material: product.material ?? null,
    usageNote: product.usageNote ?? null,
    usePurpose: product.usePurpose ?? null,
    variantDetails: parseObj<VariantDetails>(product.variantDetails),
    manualAspects: parseObj<Record<string, string>>(product.manualAspects),
    isElectric: product.isElectric ?? null,
    hasBattery: product.hasBattery ?? null,
    weeeRegNr: ctx.weeeRegNr ?? null,
  };

  // Schalter DESCRIPTION_VERSION (shared/description-v4.ts, Default v3): v3 bzw. v4.
  const html = neutralizeGpsrTab(buildEbayHTMLCurrent(templateProduct));
  const violations = findDescriptionComplianceViolations(html);
  return { html, violations, origin };
}

// P71-C Teil 2: Beschreibung fürs Erst-Listing (/ebay/list). Eine gespeicherte Vorlage wird nur
// übernommen, wenn sie nach neutralizeGpsrTab keine Dauerregel-Verstöße hat — sonst (z. B. alte
// Vorlage mit E-Mail im Impressum) wird sie aus den aktuellen Produktfeldern neu gebaut. Ein
// Verstoß bleibt nur, wenn auch der Neubau verstößt. Reine Funktion, damit ohne DB testbar.
export function resolveListingDescription(product: ProductDescriptionFields, storedHtml: string | null | undefined, ctx: DescriptionContext = {}): BuiltProductDescription {
  const rawHtml = storedHtml ?? '';
  const isFullTemplate = rawHtml.includes('STELE-E-TRANSFER') && (rawHtml.includes('stet-tabs') || rawHtml.includes('stet-l-tabs') || rawHtml.includes(DESCRIPTION_V4_MARKER));
  // Tab 5 (Produktsicherheit) gehört immer dazu: eine ältere gespeicherte Vorlage ohne ihn wird neu gebaut.
  const hasTab5 = rawHtml.includes('id="stet-t5"') || rawHtml.includes('id="stet-l5"') || (rawHtml.includes(DESCRIPTION_V4_MARKER) && rawHtml.includes('<!-- TAB 5: Produktsicherheit (GPSR) -->'));
  // OFFEN 029: gespeicherte Vorlage ohne aktuelle Versand-/Rückgabe-Texte (alt: 3–10 Werktage, DHL, feste Rücksendekosten) → neu bauen.
  // Beschreibung v3 (06.11.2026): gespeicherte Vorlage ohne v3-Merkmal (alter Aufbau) → neu bauen.
  // Beschreibung v4 (08.11.2026): verlangt wird das Merkmal der AKTIVEN Vorlage (Schalter) — gespeicherte v3 bei Schalter v4 → neu bauen.
  const hasCurrentTexts = rawHtml.includes(TEXT_VERSION_MARKER) && rawHtml.includes(activeDescriptionMarker());
  if (isFullTemplate && hasTab5 && hasCurrentTexts) {
    const html = neutralizeGpsrTab(rawHtml);
    const violations = findDescriptionComplianceViolations(html);
    // OFFEN 030: gespeicherte Vorlage nur übernehmen, wenn ihre Lieferzeit zur aktuellen Herkunft passt (sonst neu bauen)
    const fresh = buildProductDescriptionForEbay(product, ctx);
    if (violations.length === 0 && sameFooter(html, fresh.html)) return { html, violations, origin: fresh.origin };
    return fresh;
  }
  return buildProductDescriptionForEbay(product, ctx);
}

function footerOf(html: string): string | null {
  // v3: Fußzeile steht zwischen FOOTER_BLOCK_START/END (Versand · Rückgabe · §19); ältere Vorlagen: eine Zeile.
  const a = html.indexOf(FOOTER_BLOCK_START);
  const b = html.indexOf(FOOTER_BLOCK_END);
  if (a >= 0 && b > a) return html.slice(a, b);
  const m = html.match(/Versand &amp; R&uuml;ckgabe: [^<]*/);
  return m ? m[0] : null;
}
/** Fußzeile (Lieferzeit + Rückgabe) der gespeicherten Vorlage = frisch berechnete? */
function sameFooter(stored: string, fresh: string): boolean {
  return footerOf(stored) !== null && footerOf(stored) === footerOf(fresh);
}
