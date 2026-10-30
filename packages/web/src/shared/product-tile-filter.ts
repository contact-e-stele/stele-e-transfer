// Inhaber 30.10.2026 09:12: Kacheln im Produkte-Tab anklickbar — „Preisalarm 4“ zeigt genau diese 4 Produkte (auch live gelistete).
export type ProductTileFilter = 'listed' | 'error' | 'priceAlert' | 'unavailable' | null;

export function matchesTileFilter(p: { ebayStatus: string | null; priceChanged?: boolean | number | null }, f: ProductTileFilter): boolean {
  switch (f) {
    case 'listed': return p.ebayStatus === 'listed';
    case 'error': return p.ebayStatus === 'error';
    case 'priceAlert': return !!p.priceChanged;
    case 'unavailable': return p.ebayStatus === 'unavailable';
    default: return true;
  }
}
