// A-014 Punkt 6: Bericht "alter VK → neuer VK nach Preisformel v2" für alle gelisteten Produkte/Varianten. REINE Funktionen
// (Grundgesetz Regel 2) — das Skript scripts/export-price-formula-v2.ts liest nur die DB und formatiert; es schreibt NICHTS
// (keine Preisänderung, nichts an eBay).
//
// "Gewinn alt (v1)" rechnet die bis A-014 gültige Formel nach (Ware + Produktfeld shippingCost + Zollpauschale 4,00 € bei China)
// — als reine Vergleichsgröße, die App benutzt sie nicht mehr. "Gewinn heute (v2)" ist der echte Gewinn beim heutigen VK nach
// Formel v2. "Gewinn neu (v2)" ist der Gewinn beim neuen VK.
import {
  computeMinSellPrice, profitAtSellPrice, profitFloorFor, evaluateTargetDisplay, isChinaOriginForPricing, resolveShipsFrom,
  parseVariantSellPrices, resolveVariantSellPrice, DEFAULT_PRICING_CONFIG,
} from './pricing';
import { MARGIN_TIERS } from './constants';
import { isVariantProduct } from './variant-product';

export interface ReportProduct {
  id: number;
  variants: unknown;                  // product.variants — für isVariantProduct (A-019)
  title: string;
  ebayStatus: string;
  buyPrice: number | null;
  sellPrice: number | null;
  variantPrices: string | null;       // JSON [{skuId, attrs, price, ebayPrice?}]
  variantSellPrices: string | null;   // JSON {skuId: VK}
  shippingCost: number | null;
  shipsFrom: string | null;
  adRate: number | null;
  targetMarginEur: number | null;
}

export interface PriceReportRow {
  productId: number;
  title: string;
  variantLabel: string;               // '' bei Einzelartikel
  ware: number;
  china: boolean;
  adRatePercent: number;
  targetEur: number;
  tierLabel: string;                  // 'A'–'D', '4,50 (alt)' oder 'andere'
  floorEur: number;
  oldSell: number | null;             // heutiger VK (null = keiner gespeichert)
  oldProfitV1: number | null;         // Gewinn beim heutigen VK nach der bis A-014 gültigen Formel
  profitNowV2: number | null;         // Gewinn beim heutigen VK nach Formel v2
  newSell: number;                    // VK nach Formel v2 (Rundung floor95 mit Boden der Stufe)
  newProfitV2: number;
  deltaSell: number | null;           // newSell − oldSell
  level: 'ok' | 'yellow' | 'red' | null; // Anzeige "Ziel · Erwartet" beim heutigen VK
}

export function tierLabelFor(targetEur: number): string {
  const tier = MARGIN_TIERS.find(t => Math.abs(t.targetEur - targetEur) < 0.005);
  if (tier) return tier.label;
  return Math.abs(targetEur - 4.5) < 0.005 ? '4,50 (alt)' : 'andere';
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Die bis A-014 gültige Formel (nur zum Vergleich): Gewinn = VK − (Ware + shippingCost + Zoll 4,00) − Gebühren.
export function profitOldFormulaV1(sell: number, ware: number, shippingCost: number, china: boolean, adRatePercent: number): number {
  const feeRate = ((DEFAULT_PRICING_CONFIG.ebayFeeRatePercent + adRatePercent) / 100) * DEFAULT_PRICING_CONFIG.vatFactor;
  const fixed = DEFAULT_PRICING_CONFIG.ebayFixedFeeEur * DEFAULT_PRICING_CONFIG.vatFactor;
  return sell - (ware + shippingCost + (china ? 4.00 : 0)) - (sell * feeRate + fixed);
}

export function buildPriceReportRows(products: ReportProduct[]): { rows: PriceReportRow[]; skipped: Array<{ productId: number; reason: string }> } {
  const rows: PriceReportRow[] = [];
  const skipped: Array<{ productId: number; reason: string }> = [];

  for (const p of products) {
    if (p.ebayStatus !== 'listed') continue;
    const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
    const target = p.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur;
    const shippingCost = p.shippingCost ?? 0;

    let entries: Array<{ skuId: string; attrs?: Record<string, string>; price: number; ebayPrice?: number }> = [];
    try { entries = p.variantPrices ? JSON.parse(p.variantPrices) : []; } catch { entries = []; }
    entries = entries.filter(e => typeof e.price === 'number' && e.price > 0);
    const isVariant = isVariantProduct(p.variants, p.variantPrices);

    // K-004 Lücke 2: Herkunft je Variante (Attribut "Ships From" vor Produktfeld, nichts bekannt → vorsichtig China),
    // deshalb wird `china` pro Zeile statt einmal pro Produkt bestimmt.
    const lines: Array<{ label: string; ware: number; oldSell: number | null; attrs?: Record<string, string> }> = [];
    if (isVariant) {
      const stored = parseVariantSellPrices(p.variantSellPrices);
      for (const e of entries) {
        const label = Object.values(e.attrs ?? {}).join(' / ') || `…${e.skuId.slice(-6)}`;
        lines.push({ label, ware: e.price, oldSell: resolveVariantSellPrice(e.skuId, stored, e).sellPrice ?? p.sellPrice, attrs: e.attrs });
      }
    } else if (p.buyPrice != null && p.buyPrice > 0) {
      lines.push({ label: '', ware: p.buyPrice, oldSell: p.sellPrice });
    } else {
      skipped.push({ productId: p.id, reason: 'kein Einkaufspreis' });
      continue;
    }

    for (const line of lines) {
      const china = isChinaOriginForPricing(resolveShipsFrom(p.shipsFrom, line.attrs));
      const common = {
        isChinaOrigin: china, ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent,
        ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur, vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: adRate,
      };
      const newSell = computeMinSellPrice({
        ...common, buyPrice: line.ware, targetMarginEur: target, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur, rounding: 'floor95',
      }).minSellPrice;
      const newProfitV2 = profitAtSellPrice({ ...common, sellPrice: newSell, buyPrice: line.ware });
      const profitNowV2 = line.oldSell != null ? profitAtSellPrice({ ...common, sellPrice: line.oldSell, buyPrice: line.ware }) : null;
      rows.push({
        productId: p.id, title: p.title, variantLabel: line.label, ware: line.ware, china, adRatePercent: adRate,
        targetEur: target, tierLabel: tierLabelFor(target), floorEur: profitFloorFor(target),
        oldSell: line.oldSell,
        oldProfitV1: line.oldSell != null ? profitOldFormulaV1(line.oldSell, line.ware, shippingCost, china, adRate) : null,
        profitNowV2, newSell, newProfitV2,
        deltaSell: line.oldSell != null ? round2(newSell - line.oldSell) : null,
        level: profitNowV2 != null ? evaluateTargetDisplay(target, profitNowV2).level : null,
      });
    }
  }
  return { rows, skipped };
}

const eur = (n: number | null) => (n == null ? '–' : n.toFixed(2).replace('.', ','));

export function renderPriceReportMarkdown(
  rows: PriceReportRow[], skipped: Array<{ productId: number; reason: string }>, generatedAt: string,
): string {
  const lines: string[] = [
    '# Preisformel v2 — Vergleich alter VK → neuer VK (A-014, NUR LESEN, keine Preisänderung)',
    '',
    `Lauf: ${generatedAt}`,
    '',
    'Formel v2: K = Ware + Versand (1,99 € nur bei China und Ware < 10 €) + Einfuhrabgaben (3,57 € bei China; leere Herkunft wird wie China gerechnet); Gewinn = VK × (1 − (15 % + Anzeige) × 1,19) − 0,357 − K;',
    'Rundung ,95 unter dem Rohpreis, bei Gewinn < Boden die nächste ,95 darüber. "neuer VK" ist der Formelpreis je Variante (Varianten-Regel 6c',
    'ist AUS — im Betrieb würde keine Variante allein über die Formel erhöht, außer sie liegt unter dem Boden). "Gewinn alt (v1)" = bis A-014 gültige',
    'Formel (Ware + shippingCost + 4,00 € Zoll bei China) beim heutigen VK; "Gewinn heute (v2)" = echter Gewinn beim heutigen VK nach v2.',
    '"alter VK" = in der DB gespeicherter VK der Variante (variant_sell_prices, sonst alter ebayPrice), sonst der Produkt-VK (sellPrice). Ist je Variante',
    'nichts gespeichert, kann der echte eBay-Preis der Variante abweichen — der Bericht liest nur die DB, nicht eBay.',
    '',
    '| Produkt | Variante | Ware | China | Stufe (Ziel/Boden) | alter VK | neuer VK | Δ VK | Gewinn alt (v1) | Gewinn heute (v2) | Gewinn neu (v2) | Anzeige heute |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const level = r.level === 'red' ? 'ROT (unter Boden)' : r.level === 'yellow' ? 'gelb (unter Ziel)' : r.level === 'ok' ? 'ok' : '–';
    lines.push(
      `| ${r.productId} ${r.title.slice(0, 40).replaceAll('|', '/')} | ${r.variantLabel.replaceAll('|', '/') || '–'} | ${eur(r.ware)} | ${r.china ? 'ja' : 'nein'} | ${r.tierLabel} (${eur(r.targetEur)}/${eur(r.floorEur)}) | ${eur(r.oldSell)} | ${eur(r.newSell)} | ${r.deltaSell == null ? '–' : (r.deltaSell > 0 ? '+' : '') + eur(r.deltaSell)} | ${eur(r.oldProfitV1)} | ${eur(r.profitNowV2)} | ${eur(r.newProfitV2)} | ${level} |`,
    );
  }
  const withOld = rows.filter(r => r.oldSell != null);
  const count = (lv: string) => rows.filter(r => r.level === lv).length;
  const raise = withOld.filter(r => (r.deltaSell ?? 0) > 0).length;
  const lower = withOld.filter(r => (r.deltaSell ?? 0) < 0).length;
  lines.push(
    '',
    `Zeilen: ${rows.length} (Produkte/Varianten); davon mit heutigem VK: ${withOld.length}.`,
    `Anzeige beim heutigen VK: ${count('red')} rot (Gewinn unter Boden), ${count('yellow')} gelb (unter Ziel, über Boden), ${count('ok')} ok.`,
    `Formelpreis über dem heutigen VK: ${raise} Zeilen; darunter: ${lower} Zeilen; gleich: ${withOld.length - raise - lower}.`,
  );
  const legacy = [...new Map(rows.filter(r => Math.abs(r.targetEur - 4.5) < 0.005).map(r => [r.productId, r.title])).entries()];
  lines.push('', '## Bestandsprodukte mit Zielgewinn 4,50 € (NICHT automatisch umgestellt, bleiben bei Boden 2,00 €)');
  lines.push(legacy.length > 0 ? legacy.map(([id, t]) => `- ${id} ${t.slice(0, 60)}`).join('\n') : '- keine');
  const other = [...new Map(rows.filter(r => r.tierLabel === 'andere').map(r => [r.productId, `${r.title.slice(0, 60)} (Ziel ${eur(r.targetEur)} €)`])).entries()];
  lines.push('', '## Produkte mit einem Zielgewinn außerhalb der Stufen A–D und 4,50 (Boden 1,00 €)');
  lines.push(other.length > 0 ? other.map(([id, t]) => `- ${id} ${t}`).join('\n') : '- keine');
  lines.push('', '## Nicht berechenbar');
  lines.push(skipped.length > 0 ? skipped.map(s => `- ${s.productId}: ${s.reason}`).join('\n') : '- keine');
  return lines.join('\n') + '\n';
}
