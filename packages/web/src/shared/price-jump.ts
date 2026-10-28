// OFFEN 010 (Aufsicht 28.10.2026, PRIO 1 stele-119): Die Preisprüfung hob 100pcs von 16,45 auf 38,95 € (+137 %) und lud das zu eBay hoch,
// weil die eBay-Variante auf den falschen AliExpress-Eintrag (1000PCs, EK 24,59) zeigte. Schutz: keine automatische Anhebung um mehr als
// 15 % — stattdessen Meldung "PREISSPRUNG <SKU>" im Log, nichts gesendet, nichts gespeichert. REINE Funktionen (Grundgesetz 2).
export const MAX_AUTO_RAISE_PCT = 15;

/** true = Anhebung von oldSell auf newSell ist größer als MAX_AUTO_RAISE_PCT % (ohne bekannten alten Preis: kein Sprung). */
export function isPriceJump(oldSell: number | null | undefined, newSell: number, maxPct = MAX_AUTO_RAISE_PCT): boolean {
  if (oldSell == null || !(oldSell > 0) || !Number.isFinite(newSell)) return false;
  return newSell > oldSell * (1 + maxPct / 100) + 1e-9;
}

export function priceJumpMessage(productId: number, sku: string, oldSell: number, newSell: number): string {
  const pct = ((newSell / oldSell - 1) * 100).toFixed(0);
  return `PREISSPRUNG stele-${productId} ${sku}: ${oldSell.toFixed(2)} → ${newSell.toFixed(2)} € (+${pct} %, Grenze ${MAX_AUTO_RAISE_PCT} %) — NICHT gesendet, bitte prüfen`;
}

// Ausnahmeliste "nie automatisch bei eBay ändern" (app_settings 'auto_price_excluded', KEINE Migration). Gilt bis zur Freigabe ("119 frei").
export const AUTO_PRICE_EXCLUDED_KEY = 'auto_price_excluded';
export interface AutoPriceExclusion { at: string; note: string | null }
export type AutoPriceExclusions = Record<string, AutoPriceExclusion>;

export function parseAutoPriceExclusions(json: string | null | undefined): AutoPriceExclusions {
  if (!json) return {};
  try {
    const raw = JSON.parse(json) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: AutoPriceExclusions = {};
    for (const [pid, v] of Object.entries(raw as Record<string, unknown>)) {
      const x = v as Partial<AutoPriceExclusion> | null;
      if (/^\d+$/.test(pid) && x && typeof x.at === 'string') out[pid] = { at: x.at, note: typeof x.note === 'string' ? x.note : null };
    }
    return out;
  } catch { return {}; }
}
