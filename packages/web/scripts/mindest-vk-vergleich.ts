// Bündel A+B zu PR #304 (09.11.2026) — Vorher/Nachher-Liste Mindest-VK je gelisteter Variante. NUR LESEND: liest eine JSON-Datei,
// schreibt nichts (keine DB, kein eBay). Rechnung: buildFixgebuehrVorschau (src/shared/fixgebuehr-vorschau.ts, reine Funktion, getestet):
//   ALT = Stand main vor PR #304: Provision 15 % + Fix 0,30 € (EBAY_FIXED_FEE_SCHEDULE_ALT über den fixedFeeSchedule-Override)
//   NEU = Provision je eBay-Kategorie (ebayFeeRatePercentFor) + Fix 0,35 € (Bestellwert ≤ 10 €) / 0,45 €
//   beide × 1,19, Formel v2 (Rundung floor95, Stufe des Produkts, Kassen-Faktor ≤ 14 Tage, EAR-Umlage, S 1,19 bei China-Herkunft).
// Zeilen = je Produkt mit ebayStatus 'listed' die bei eBay angebotenen Varianten mit eigenem VK bzw. der Einzelartikel (productProfitRows).
//
// EINGABE: JSON-Liste, z. B. direkt die Antwort von GET /api/products (im Browser: `copy(await (await fetch('/api/products')).json())`).
// Je Produkt genügen diese Felder (echte Feldnamen aus /api/products):
//   id                   Produktnummer (stele-<id>)
//   ebayStatus           nur 'listed' wird verglichen
//   ebayCategory         eBay-Kategorie-ID → Satz (fehlt/unbekannt → 15 %)
//   shipsFrom            Herkunft (leer = China); je Variante zählt "Ships From" in variantPrices[].attrs
//   adRate               Anzeigen-Satz in % (null → 5)
//   targetMarginEur      Zielgewinn/Stufe (null → 2,00)
//   sellPrice            VK (Einzelartikel)
//   buyPrice             EK (Einzelartikel)
//   variants             Varianten-Gruppen (Liste oder JSON-Text) — welche Varianten bei eBay angeboten sind
//   variantPrices        JSON-Text [{skuId, attrs, price}] — EK je Variante
//   variantSellPrices    JSON-Text {skuId: VK} — VK je Variante
//   aliCheckoutFactor, aliCheckoutFactorAt   Kassen-Faktor (optional, null = ohne)
//   isElectric           Elektro → EAR-Umlage (optional)
// (generatedTitle/title werden für die Anzeige genommen, wenn vorhanden.) Alle anderen Felder werden ignoriert.
// Beispiel: scripts/beispiele/mindest-vk-vergleich.beispiel.json
//
// AUFRUF (aus packages/web/): bun scripts/mindest-vk-vergleich.ts <pfad/zur/datei.json> [--csv]
import { readFileSync } from 'fs';
import { buildFixgebuehrVorschau, vorschauProductsFromApi } from '../src/shared/fixgebuehr-vorschau';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) {
  console.error('Aufruf: bun scripts/mindest-vk-vergleich.ts <datei.json> [--csv]');
  process.exit(1);
}
const v = buildFixgebuehrVorschau(vorschauProductsFromApi(JSON.parse(readFileSync(file, 'utf8'))));
const de = (n: number) => n.toFixed(2).replace('.', ',');
const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '±') + de(Math.abs(n));
const header = ['Produkt', 'Variante/SKU', 'Kategorie', 'Satz', 'VK heute', 'Mindest-VK ALT', 'Mindest-VK NEU', 'Differenz', 'VK < NEU'];
const lines = v.rows.map(r => [
  `stele-${r.productId}`, r.skuId ? `${r.variant} (${r.skuId})` : '(Einzelartikel)', r.ebayCategory ?? '–', `${r.ratePercentNew} %`,
  de(r.currentSellPrice), de(r.minSellOld), de(r.minSellNew), sign(r.deltaMinSell), r.currentBelowNewMin ? 'JA' : '',
]);
if (args.includes('--csv')) {
  for (const l of [header, ...lines]) console.log(l.map(c => `"${c.replace(/"/g, '""')}"`).join(';'));
} else {
  console.log(`| ${header.join(' | ')} |`);
  console.log(`|${header.map(() => '---').join('|')}|`);
  for (const l of lines) console.log(`| ${l.join(' | ')} |`);
  const s = v.summary;
  console.log(`\n${s.products} gelistete Produkte, ${s.rows} Zeilen · Mindest-VK höher: ${s.minSellRaised} · niedriger: ${s.minSellLowered} · gleich: ${s.minSellUnchanged} · VK heute unter NEU: ${s.currentBelowNewMin}`);
}
