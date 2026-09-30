// eBay-Verstoßserie 2026-09-28: EINE gemeinsame Rechenstelle, die aus den gespeicherten
// Produktfeldern (title/generatedTitle/specs/variants/...) die eBay-HTML-Beschreibung frisch
// aufbaut, den GPSR-Tab neutralisiert und gegen den harten Compliance-Validator prüft — genutzt
// von /ebay/list (Erst-Listing, index.ts) UND refreshOneProductDescription() (Nachzieh-Weg für
// laufende Angebote, description-refresh.ts), damit beide exakt dieselbe Ausgabe für dieselben
// Produktfelder erzeugen (GRUNDGESETZ Regel 8). 1:1 aus dem bisherigen /ebay/list-Inline-Code
// extrahiert. P71-C (30.09.2026): gpsrRaw wird an buildEbayHTMLLight weitergegeben, damit der
// Tab "Produktsicherheit" erzeugt wird (Vorgabe Inhaber: 5 Tabs immer). Der Rohtext selbst landet
// nie im HTML — die Vorlage druckt nur GPSR_DESCRIPTION_NOTICE, neutralizeGpsrTab sichert zusätzlich.
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
  gpsrRaw?: string | null;         // nur als Schalter für den Tab Produktsicherheit (Inhalt: GPSR_DESCRIPTION_NOTICE)
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
    gpsrRaw: product.gpsrRaw ?? undefined,
  };

  const html = neutralizeGpsrTab(buildEbayHTMLLight(templateProduct));
  const violations = findDescriptionComplianceViolations(html);
  return { html, violations };
}

// P71-C Teil 2: Beschreibung fürs Erst-Listing (/ebay/list). Eine gespeicherte Vorlage wird nur
// übernommen, wenn sie nach neutralizeGpsrTab keine Dauerregel-Verstöße hat — sonst (z. B. alte
// Vorlage mit E-Mail im Impressum) wird sie aus den aktuellen Produktfeldern neu gebaut. Ein
// Verstoß bleibt nur, wenn auch der Neubau verstößt. Reine Funktion, damit ohne DB testbar.
export function resolveListingDescription(product: ProductDescriptionFields, storedHtml: string | null | undefined): BuiltProductDescription {
  const rawHtml = storedHtml ?? '';
  const isFullTemplate = rawHtml.includes('STELE-E-TRANSFER') && (rawHtml.includes('stet-tabs') || rawHtml.includes('stet-l-tabs'));
  // Tab 5 (Produktsicherheit) gehört immer dazu: eine ältere gespeicherte Vorlage ohne ihn wird neu gebaut.
  const hasTab5 = rawHtml.includes('id="stet-t5"') || rawHtml.includes('id="stet-l5"');
  if (isFullTemplate && hasTab5) {
    const html = neutralizeGpsrTab(rawHtml);
    const violations = findDescriptionComplianceViolations(html);
    if (violations.length === 0) return { html, violations };
  }
  return buildProductDescriptionForEbay(product);
}
