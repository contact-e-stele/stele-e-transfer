// A-015 (Inhaber-Entscheid D, 04.10.2026): Bereinigung bereits vorhandener Dubletten in products.variantPrices (Live-Fund stele-194:
// dieselbe Größe/Farbe-Kombination mehrfach, weil AliExpress neue skuIds vergeben hat und die Preisprüfung sie angehängt hat).
// REINE Funktion (kein DB-/eBay-Zugriff); das Einmal-Skript scripts/a015-bereinigung-194.ts liest, ruft sie auf und schreibt nur mit
// --apply. Regeln des Inhabers:
//  - je Kombination GENAU ein Eintrag: der ursprüngliche (mit displayValues/ebayPrice/imageUrl) bleibt, übernimmt skuId und Bestand
//    vom FRISCHESTEN Scrape-Eintrag (= der zuletzt angehängte, Reihenfolge im Array = Reihenfolge der Preisprüfungs-Läufe);
//  - Preis: im Zweifel der HÖHERE Einkaufspreis — Maximum über die Scrape-Einträge der Kombination (der veraltete Preis des
//    ursprünglichen Eintrags zählt nicht), damit der Einkauf nie zu niedrig angesetzt wird;
//  - Einträge ohne Gegenstück in product.variants (z. B. neue Farbe "Yellow") werden NICHT zugeordnet, nur aufgelistet und
//    unverändert gelassen;
//  - mehrdeutig (kein oder mehrere ursprüngliche Einträge) → nichts geändert, nur gemeldet.
import { buildCombinations, entryMatchesCombo, type VariantGroup } from './variant-resolver';

export interface DedupeEntry {
  skuId: string;
  attrs: Record<string, string>;
  price: number;
  stock?: number;
  imageUrl?: string;
  displayValues?: Record<string, string>;
  ebayPrice?: number;
}

export interface DedupeChange {
  label: string;                 // z. B. "Size=5m, Color=Pink"
  keeperOldSkuId: string;
  keeperNewSkuId: string;        // skuId des frischesten Scrape-Eintrags
  oldPrice: number;
  newPrice: number;
  oldStock: number | undefined;
  newStock: number | undefined;
  removedSkuIds: string[];       // alle Scrape-Dubletten dieser Kombination (werden entfernt)
  priceNote: string | null;      // gesetzt, wenn der höhere EK statt des Preises des frischesten Eintrags gewählt wurde
}

export interface DedupePlan {
  newEntries: DedupeEntry[];
  changes: DedupeChange[];
  unchangedCombos: number;                              // Kombinationen mit genau einem Eintrag
  orphans: DedupeEntry[];                               // Scrape-Einträge ohne Gegenstück in product.variants — nicht zugeordnet
  ambiguous: Array<{ label: string; reason: string }>;  // Kombinationen, die nicht eindeutig lösbar sind — unverändert
}

// Zuordnung Eintrag → Kombination: EXAKT dieselbe Funktion wie beim Listing (variant-resolver.ts entryMatchesCombo: displayValues
// haben Vorrang, sonst Wertevergleich getrimmt/ohne Groß-/Kleinschreibung, Versand-Attribute ignoriert) — Grundgesetz Regel 8.
const isOriginal = (e: DedupeEntry) => !!e.displayValues || e.ebayPrice != null || !!e.imageUrl;

export function planVariantDedupe(groups: VariantGroup[], entries: DedupeEntry[]): DedupePlan {
  // Ohne Varianten-Gruppen gibt es keine Kombinationen, die sich zuordnen ließen — nichts anfassen.
  if (groups.length === 0) return { newEntries: [...entries], changes: [], unchangedCombos: 0, orphans: [], ambiguous: [] };
  const comboList = buildCombinations(groups);
  const comboOfEntry = new Map<DedupeEntry, number>();
  for (const e of entries) {
    const idx = comboList.findIndex(c => entryMatchesCombo(c, e));
    if (idx >= 0) comboOfEntry.set(e, idx);
  }

  const changes: DedupeChange[] = [];
  const ambiguous: DedupePlan['ambiguous'] = [];
  const removed = new Set<DedupeEntry>();
  const replacement = new Map<DedupeEntry, DedupeEntry>(); // ursprünglicher Eintrag → aktualisierter Eintrag
  let unchangedCombos = 0;

  comboList.forEach((combo, idx) => {
    const label = Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(', ');
    const members = entries.filter(e => comboOfEntry.get(e) === idx);
    if (members.length <= 1) { if (members.length === 1) unchangedCombos++; return; }
    const originals = members.filter(isOriginal);
    if (originals.length !== 1) {
      ambiguous.push({ label, reason: originals.length === 0 ? 'kein ursprünglicher Eintrag (ohne displayValues/ebayPrice/imageUrl) — nichts geändert' : `${originals.length} ursprüngliche Einträge — nichts geändert` });
      return;
    }
    const keeper = originals[0];
    const scraped = members.filter(m => m !== keeper); // alle nicht-ursprünglichen = Scrape-Dubletten, Reihenfolge = Alter
    const freshest = scraped[scraped.length - 1];
    const maxPrice = Math.max(...scraped.map(s => s.price));
    const priceNote = maxPrice > freshest.price + 1e-9
      ? `höherer EK ${maxPrice.toFixed(2)} statt ${freshest.price.toFixed(2)} (frischester Eintrag) gewählt — im Zweifel kein Verlust`
      : null;
    replacement.set(keeper, { ...keeper, skuId: freshest.skuId, price: maxPrice, stock: freshest.stock ?? keeper.stock });
    scraped.forEach(s => removed.add(s));
    changes.push({
      label, keeperOldSkuId: keeper.skuId, keeperNewSkuId: freshest.skuId, oldPrice: keeper.price, newPrice: maxPrice,
      oldStock: keeper.stock, newStock: freshest.stock ?? keeper.stock, removedSkuIds: scraped.map(s => s.skuId), priceNote,
    });
  });

  const orphans = entries.filter(e => !comboOfEntry.has(e) && !isOriginal(e));
  const newEntries = entries.filter(e => !removed.has(e)).map(e => replacement.get(e) ?? e);
  return { newEntries, changes, unchangedCombos, orphans, ambiguous };
}

export function renderDedupeMarkdown(productId: number, plan: DedupePlan, before: number, apply: boolean, generatedAt: string): string {
  const eur = (n: number | undefined) => (n == null ? '–' : n.toFixed(2).replace('.', ','));
  const lines = [
    `# A-015 — Bereinigung variantPrices stele-${productId} (${apply ? 'APPLY — GESCHRIEBEN' : 'TROCKENLAUF — nichts geschrieben'})`,
    '',
    `Lauf: ${generatedAt}`,
    `Einträge vorher: ${before}, nachher: ${plan.newEntries.length}; Kombinationen bereinigt: ${plan.changes.length}, unverändert (1 Eintrag): ${plan.unchangedCombos}, mehrdeutig: ${plan.ambiguous.length}, ohne Gegenstück (nicht zugeordnet): ${plan.orphans.length}.`,
    '',
    '| Kombination | skuId alt → neu | EK alt → neu | Lager alt → neu | entfernte Dubletten | Hinweis |',
    '|---|---|---|---|---|---|',
    ...plan.changes.map(c => `| ${c.label} | ${c.keeperOldSkuId} → ${c.keeperNewSkuId} | ${eur(c.oldPrice)} → ${eur(c.newPrice)} | ${c.oldStock ?? '–'} → ${c.newStock ?? '–'} | ${c.removedSkuIds.join(', ')} | ${c.priceNote ?? ''} |`),
    '',
    '## Ohne Gegenstück in product.variants (NICHT zugeordnet, bleiben unverändert in variantPrices)',
    ...(plan.orphans.length > 0 ? plan.orphans.map(o => `- ${JSON.stringify(o.attrs)} skuId ${o.skuId} EK ${eur(o.price)} Lager ${o.stock ?? '–'}`) : ['- keine']),
    '',
    '## Mehrdeutig (nichts geändert)',
    ...(plan.ambiguous.length > 0 ? plan.ambiguous.map(a => `- ${a.label}: ${a.reason}`) : ['- keine']),
  ];
  return lines.join('\n') + '\n';
}
