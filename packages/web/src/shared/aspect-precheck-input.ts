// OFFEN 015 Schritt 6 / Inhaber 29.10.2026 19:35 „Extra-Knopf, mach rein“: Pflichtmerkmale schon im Produkte-Tab prüfen.
// EINE Stelle (Grundgesetz 8) für die Eingaben der Pflichtmerkmal-Vorabprüfung — POST /ebay/list und
// GET /products/:id/aspect-precheck lesen sie hier, damit der Knopf genau dasselbe prüft wie das Listen.
export interface AspectPrecheckProduct {
  variants: string | null;
  specs: string | null;
  variantPrices: string | null;
  manualAspects: string | null;
  title: string | null;
  generatedTitle: string | null;
}
export interface AspectPrecheckInput {
  variantGroups: Array<{ name: string; values: string[] }>;
  specs: Record<string, string>;
  variantAttrsList: Array<Record<string, string>>;
  manualAspects: Record<string, string>;
  titleSources: string[];
}

export function parseVariantGroupsForListing(variants: string | null): Array<{ name: string; values: string[] }> {
  try {
    const parsed = JSON.parse(variants ?? '[]');
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] && 'name' in parsed[0]) {
      return parsed as Array<{ name: string; values: string[] }>;
    }
  } catch { /* ignore */ }
  return [];
}
export function parseSpecsForListing(specs: string | null): Record<string, string> {
  try { const p = JSON.parse(specs ?? '{}'); return p && typeof p === 'object' && !Array.isArray(p) ? p as Record<string, string> : {}; } catch { return {}; }
}
export function parseManualAspects(manualAspects: string | null): Record<string, string> {
  try {
    const parsed = manualAspects ? JSON.parse(manualAspects) as Record<string, string> : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
export function titleSourcesFor(p: Pick<AspectPrecheckProduct, 'title' | 'generatedTitle'>): string[] {
  return [p.title, p.generatedTitle].filter((t): t is string => !!t);
}

export function aspectPrecheckInput(p: AspectPrecheckProduct): AspectPrecheckInput {
  let attrs: Array<Record<string, string>> = [];
  try {
    const parsed = JSON.parse(p.variantPrices ?? '[]');
    attrs = Array.isArray(parsed) ? parsed.map((v: { attrs?: Record<string, string> }) => v?.attrs ?? {}) : [];
  } catch { attrs = []; }
  return {
    variantGroups: parseVariantGroupsForListing(p.variants),
    specs: parseSpecsForListing(p.specs),
    variantAttrsList: attrs,
    manualAspects: parseManualAspects(p.manualAspects),
    titleSources: titleSourcesFor(p),
  };
}
