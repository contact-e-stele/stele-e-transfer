// PLAN 7 Punkt 6 (Kalkulator 08.11.2026 20:25 + 09.11.2026 06:50): Varianten, die bei eBay NICHT angeboten werden (stele-234 GRAY/green,
// stele-235 Orange 10PCS/3PCS — bei eBay nur 234 BROWN und 235 ORANGE-5PCS), wurden in der Gewinn-Anzeige des Produkte-Tabs mitgezählt:
// das Gewinn-Kärtchen rechnete mit products.buyPrice/sellPrice (Produkt-EK kann der EK einer nicht angebotenen Variante sein) und zeigte
// "Gewinn unter 1,00 €" (gelb) bzw. Verlust (rot), obwohl jede angebotene Variante darüber liegt. Kein echter Verlust.
//
// REINE Funktion, keine eigene Regel (Grundgesetz 8): "angeboten" und der Gewinn je Variante kommen aus productProfitRows →
// classifyListedVariants (K-014 Schritt 2, PR #236: Eintrag passt auf eine Kombination aus product.variants, entryMatchesCombo — dieselbe
// Zuordnung wie Listing und Preis-Update) und Formel v2. Nur Anzeige: keine Preisformel, nichts an eBay, nichts in die DB.
import { MIN_PROFIT_FLOOR_EUR } from './constants';
import { cardMarginDisplay, type MarginDisplay } from './margin-display';
import { productProfitRows, type ExcludedVariant, type ProfitProduct, type ProfitRow } from './target-margin-bulk';

export interface OfferedProfitSummary {
  isVariant: boolean;
  /** bei eBay angebotene Varianten mit eigenem VK (Einzelartikel: eine Zeile) — nur diese zählen */
  counted: ProfitRow[];
  /** davon Gewinn unter 1,00 € (MIN_PROFIT_FLOOR_EUR) — die einzige Zahl für "Gewinn unter 1,00 €" */
  belowOne: ProfitRow[];
  /** nicht bei eBay angeboten — neutral anzeigen ("nicht bei eBay"), zählen nie */
  notOffered: ExcludedVariant[];
  /** angeboten, aber ohne eigenen VK / Dublette mit altem VK (K-014) — zählen ebenfalls nicht */
  otherExcluded: ExcludedVariant[];
  /** Gewinn-Kärtchen = schlechteste zählende Zeile (wie "Erwartet" und die Listings-Karte); null = nichts Zählendes, keine Zahl raten */
  card: MarginDisplay | null;
}

export function offeredProfitSummary(p: ProfitProduct): OfferedProfitSummary {
  const { rows, isVariant, excluded } = productProfitRows(p);
  return {
    isVariant,
    counted: rows,
    belowOne: rows.filter(r => r.profit < MIN_PROFIT_FLOOR_EUR - 1e-9),
    notOffered: excluded.filter(x => x.reason === 'nicht bei eBay'),
    otherExcluded: excluded.filter(x => x.reason !== 'nicht bei eBay'),
    card: cardMarginDisplay(p),
  };
}

/** Text für das neutrale Kärtchen, z. B. "2 nicht bei eBay"; null = keine nicht angebotenen Varianten. */
export function notOfferedLabel(s: Pick<OfferedProfitSummary, 'notOffered'>): string | null {
  return s.notOffered.length > 0 ? `${s.notOffered.length} nicht bei eBay` : null;
}
