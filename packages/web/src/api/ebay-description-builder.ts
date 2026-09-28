// eBay-Verstoßserie 2026-09-28: EINE gemeinsame Rechenstelle, die aus den gespeicherten
// Produktfeldern (title/generatedTitle/specs/variants/...) die eBay-HTML-Beschreibung frisch
// aufbaut, den GPSR-Tab neutralisiert und gegen den harten Compliance-Validator prüft — genutzt
// von /ebay/list (Erst-Listing, index.ts) UND refreshOneProductDescription() (Nachzieh-Weg für
// laufende Angebote, description-refresh.ts), damit beide exakt dieselbe Ausgabe für dieselben
// Produktfelder erzeugen (GRUNDGESETZ Regel 8). 1:1 aus dem bisherigen /ebay/list-Inline-Code
// extrahiert — inklusive dessen bisherigem Verhalten, kein gpsrRaw an buildEbayHTMLLight
// weiterzugeben (das GPSR-Tab kommt hier nie vor; die GPSR-Pflichtangaben gehen bereits separat
// als strukturierte Offer-Daten an eBay, s. ebay.ts buildRegulatoryBlock).
import { buildEbayHTMLLight, type ScrapedProduct as EbayScrapedProduct } from '../web/lib/ebay-description';
import { neutralizeGpsrTab } from '../shared/gpsr-description';
import { findDescriptionComplianceViolations, type DescriptionComplianceViolation } from '../shared/description-compliance';

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
}

export interface BuiltProductDescription {
  html: string;
  violations: DescriptionComplianceViolation[];
}

export function buildProductDescriptionForEbay(product: ProductDescriptionFields): BuiltProductDescription {
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

  const templateProduct: EbayScrapedProduct = {
    title: product.generatedTitle ?? product.title,
    description: product.generatedDescription ?? product.description ?? '',
    specs: specsParsed,
    variants: variantGroupsParsed,
    skuVariants: skuVariantsParsed.length > 0 ? skuVariantsParsed : undefined,
    setContents: Object.keys(setContentsParsed).length > 0 ? setContentsParsed : undefined,
    bullets: bulletsParsed.length > 0 ? bulletsParsed : undefined,
    images: images.filter(u => u.startsWith('http')).slice(0, 3),
  };

  const html = neutralizeGpsrTab(buildEbayHTMLLight(templateProduct));
  const violations = findDescriptionComplianceViolations(html);
  return { html, violations };
}
