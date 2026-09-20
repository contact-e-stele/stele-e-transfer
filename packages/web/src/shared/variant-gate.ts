// P-85 Schritt 2c (20.09.2026): Listing-Gate für die Varianten-Zuordnung als reine Funktion.
// Nur Kombinationsfehler aus resolveVariantEntries() (fehlender Treffer, mehrdeutig, keine skuId,
// kein EK) blockieren. Verwaiste variantPrices-Einträge sind Warnungen — sie werden bei der
// Zuordnung ohnehin nicht verwendet (Beispiel stele-97: 4/4 Kombinationen eindeutig, 1 verwaister
// Eintrag). Kein Zuordnungs-/Preis-Code hier, nur die Einordnung block vs. warn.
import {
  resolveVariantEntries,
  findOrphanedVariantEntries,
  type VariantGroup,
  type VariantPriceEntry,
} from './variant-resolver';

export interface VariantGateResult {
  /** Klartext-Fehler, wenn das Listing blockiert werden muss — sonst null. */
  blockError: string | null;
  /** Verwaiste Einträge, ein Text je Eintrag (ohne "Hinweis: "-Prefix). */
  warnings: string[];
}

export function evaluateVariantGate(
  productId: number,
  variants: VariantGroup[],
  variantPrices: VariantPriceEntry[],
): VariantGateResult {
  const combinationErrors = resolveVariantEntries(productId, variants, variantPrices)
    .filter(r => r.error)
    .map(r => r.error!);
  const warnings = findOrphanedVariantEntries(productId, variants, variantPrices);

  if (combinationErrors.length === 0) return { blockError: null, warnings };

  const hints = warnings.map(w => `\nHinweis: ${w}`).join('');
  return {
    blockError: `Varianten-Zuordnung fehlgeschlagen: ${combinationErrors.join(' | ')} — bitte Varianten/Preise im Produkte-Tab prüfen.${hints}`,
    warnings,
  };
}
