// K-004 (08.10.2026) — Wirkungs-Bericht zu den vier Lücken, NUR LESEND.
//
// Zweck: zeigen, WELCHE Produkte sich durch K-004 rechnerisch verändern, bevor irgendetwas
// gesendet wird. Drei der vier Lücken verschieben Kosten und damit den Mindestpreis:
//   Lücke 2 — leere/unbekannte Herkunft wird jetzt vorsichtig wie China gerechnet (+3,57 €
//             Einfuhrabgaben, ggf. +1,99 € Versand) → Mindestpreis STEIGT.
//   Lücke 2b — ist die Herkunft nur im Varianten-Attribut "Ships From" hinterlegt (z.B. Produkt 95:
//             Produktfeld leer, Variante "Germany"), wird sie jetzt gelesen → EU → Kosten SINKEN.
//   Lücke 3 — EU-Lager ohne AliExpress-Versand (bisher wurden 1,99 € auch dort angesetzt)
//             → Kosten sinken um 1,99 €, Mindestpreis SINKT.
// Die Spalte "Richtung" sagt pro Variante, in welche Richtung es geht.
//
// WICHTIG für die Entscheidung: der unbeaufsichtigte Automatikpfad (price-monitor.ts checkOne(),
// index.ts check-all-prices) darf ausschließlich ANHEBEN (applyRaiseOnly). Alles, was hier in der
// Spalte Richtung "teurer" steht UND live gelistet ist, kann beim nächsten Preisprüfungs-Lauf
// automatisch angehoben werden. Genau diese Liste gehört vor dem Merge angesehen.
//
// Es wird NICHTS geschrieben: keine DB-Änderung, kein eBay-Call (auch kein lesender).
//
// Aufruf (aus packages/web/): bun --env-file=../../.env scripts/k004-herkunft-wirkung.ts

import { db } from '../src/db/index';
import * as schema from '../src/db/schema';
import {
  computeAliCosts, computeMinSellPrice, isChinaShipping, isChinaOriginForPricing, resolveShipsFrom,
  profitAtSellPrice, profitFloorFor, parseVariantSellPrices, resolveVariantSellPrice, DEFAULT_PRICING_CONFIG,
} from '../src/shared/pricing';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const FEES = {
  ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent,
  ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
  vatFactor: DEFAULT_PRICING_CONFIG.vatFactor,
};

// ALTE Rechnung (vor K-004), hier bewusst nachgebaut, damit der Vergleich möglich ist:
// Herkunft = wörtliche Feld-Prüfung des PRODUKTfelds (leer → EU), Versand unabhängig von der Herkunft.
const altKosten = (ware: number, productShipsFrom: string | null) => {
  const china = isChinaShipping(productShipsFrom);
  const versand = ware < 10 ? 1.99 : 0;
  return ware + versand + (china ? 3.57 : 0);
};

console.error('Lade alle Produkte…');
const products = await db.select().from(schema.products).all();
console.error(`${products.length} Produkte.`);

const lines: string[] = [
  'Produkt,Titel,eBay_Status,SKU_Variante,Variante,Ware,Herkunft_Produktfeld,Herkunft_Variante,Herkunft_wirksam_NEU,Kosten_ALT,Kosten_NEU,Diff_Kosten,Mindestpreis_ALT,Mindestpreis_NEU,Diff_Preis,heutiger_VK,Gewinn_heute_NEU,Boden,Richtung,Anhebung_faellig_NEU',
];
const csv = (s: string) => `"${String(s ?? '').replace(/"/g, '""')}"`;
// Deutsches Dezimalkomma MUSS in Anführungszeichen stehen, sonst zerlegt es die CSV-Spalten
// (beim ersten echten Lauf dieses Skripts genau so aufgefallen).
const eur = (n: number | null) => (n == null ? '' : `"${n.toFixed(2).replace('.', ',')}"`);

let anhebungFaellig = 0;
let teurer = 0;
let billiger = 0;
let unveraendert = 0;
let ohneEk = 0;

for (const p of products) {
  const target = p.targetMarginEur ?? DEFAULT_PRICING_CONFIG.targetMarginEur;
  const adRate = p.adRate ?? DEFAULT_PRICING_CONFIG.defaultAdRatePercent;
  const floor = profitFloorFor(target);

  let entries: Array<{ skuId: string; attrs?: Record<string, string>; price?: number; ebayPrice?: number }> = [];
  try { entries = p.variantPrices ? JSON.parse(p.variantPrices) : []; } catch { entries = []; }

  type Zeile = { skuId: string; label: string; ware: number; attrs?: Record<string, string>; vk: number | null };
  const zeilen: Zeile[] = [];
  if (entries.length > 0) {
    const stored = parseVariantSellPrices(p.variantSellPrices);
    for (const e of entries) {
      if (typeof e.price !== 'number' || e.price <= 0) continue;
      zeilen.push({
        skuId: e.skuId, label: Object.values(e.attrs ?? {}).join(' / '), ware: e.price, attrs: e.attrs,
        vk: resolveVariantSellPrice(e.skuId, stored, e).sellPrice ?? p.sellPrice,
      });
    }
  } else if (p.buyPrice != null && p.buyPrice > 0) {
    zeilen.push({ skuId: '', label: '', ware: p.buyPrice, vk: p.sellPrice });
  }

  if (zeilen.length === 0) {
    // Grundgesetz Regel 4: keine Zahl erfinden — die Lücke wird ausgewiesen.
    ohneEk++;
    lines.push([
      p.id, csv(p.generatedTitle ?? ''), csv(p.ebayStatus ?? ''), '', '', '',
      csv(p.shipsFrom ?? ''), '', '', '', '', '', '', '', '', eur(p.sellPrice), '', eur(floor),
      csv('kein Einkaufspreis — nicht berechenbar'), csv('unbekannt'),
    ].join(','));
    continue;
  }

  for (const z of zeilen) {
    const herkunftVariante = resolveShipsFrom(null, z.attrs);
    const wirksam = resolveShipsFrom(p.shipsFrom, z.attrs);
    const chinaNeu = isChinaOriginForPricing(wirksam);

    const kostenAlt = altKosten(z.ware, p.shipsFrom);
    const kostenNeu = computeAliCosts(z.ware, chinaNeu).totalCost;

    const preisNeu = computeMinSellPrice({
      buyPrice: z.ware, isChinaOrigin: chinaNeu, ...FEES, adRatePercent: adRate,
      targetMarginEur: target, safetyBufferEur: 0, rounding: 'floor95',
    }).minSellPrice;
    // ALTEN Mindestpreis über dieselbe Funktion, aber mit den alten Kosten: dafür wird die
    // Kostendifferenz als Ware-Aufschlag durchgereicht (gleiche Formel, nur anderes K) —
    // kein zweiter Formel-Nachbau (Grundgesetz Regel 8).
    const preisAlt = computeMinSellPrice({
      buyPrice: z.ware + (kostenAlt - kostenNeu), isChinaOrigin: chinaNeu, ...FEES, adRatePercent: adRate,
      targetMarginEur: target, safetyBufferEur: 0, rounding: 'floor95',
    }).minSellPrice;

    const gewinnHeute = z.vk != null
      ? profitAtSellPrice({ sellPrice: z.vk, buyPrice: z.ware, isChinaOrigin: chinaNeu, ...FEES, adRatePercent: adRate })
      : null;

    const diffKosten = Math.round((kostenNeu - kostenAlt) * 100) / 100;
    const richtung = diffKosten > 0.005 ? 'teurer (kann automatisch angehoben werden)'
      : diffKosten < -0.005 ? 'billiger' : 'unverändert';
    if (gewinnHeute != null && gewinnHeute < floor - 1e-9) anhebungFaellig++;
    if (diffKosten > 0.005) teurer++;
    else if (diffKosten < -0.005) billiger++;
    else unveraendert++;

    lines.push([
      p.id, csv(p.generatedTitle ?? ''), csv(p.ebayStatus ?? ''), csv(z.skuId), csv(z.label), eur(z.ware),
      csv(p.shipsFrom ?? ''), csv(herkunftVariante ?? ''), csv(wirksam ?? '(unbekannt → wie China)'),
      eur(kostenAlt), eur(kostenNeu), eur(diffKosten),
      eur(preisAlt), eur(preisNeu), eur(Math.round((preisNeu - preisAlt) * 100) / 100),
      eur(z.vk), eur(gewinnHeute), eur(floor), csv(richtung),
      // Entscheidend für den Automatikpfad: angehoben wird NUR, wenn der Gewinn beim heutigen VK
      // unter den Boden der Stufe fällt. "teurer" allein löst keine Anhebung aus.
      csv(gewinnHeute == null ? 'unbekannt' : gewinnHeute < floor - 1e-9 ? 'JA' : 'nein'),
    ].join(','));
  }
}

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const out = resolve(outDir, 'k004-herkunft-wirkung.csv');
writeFileSync(out, lines.join('\n') + '\n', 'utf8');

console.error('');
console.error(`Zeilen: ${lines.length - 1}`);
console.error(`  teurer (Mindestpreis steigt):  ${teurer}`);
console.error(`  billiger (Mindestpreis sinkt): ${billiger}`);
console.error(`  unverändert:                   ${unveraendert}`);
console.error(`  ohne Einkaufspreis:            ${ohneEk}`);
console.error(`  davon Anhebung faellig (Gewinn heute < Boden): ${anhebungFaellig}`);
console.error(`Datei: ${out}`);
console.error('Es wurde nichts geschrieben und kein eBay-Call ausgelöst.');
