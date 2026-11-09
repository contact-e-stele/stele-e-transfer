// AUFTRAG Kalkulator an 7 App – 162/208 (09.11.2026 07:00): Ablauf "Käuferpreis auf Angebotsdaten heben". Entscheidung rein in
// shared/kaeuferpreis-heben.ts; eBay/DB nur über deps (Grundgesetz 2 — mit Mocks testbar, wie auto-align.ts).
// Vorschau: lesen + planen, nichts schreiben. Senden: nur mit confirm (geprüft im Endpoint), je SKU mit Status 'heben' Trading-Revise,
// danach frisch zurücklesen; NUR bestätigte SKUs (Käuferpreis == gesendeter Preis) werden in der App gespeichert; Sperre nur aufgehoben,
// wenn danach alle Zeilen gleich sind — sonst bleibt sie (mit dem neuen Stand).
import {
  planBuyerPriceRaise, skipLogLine, compareRaiseExpected, evaluateRaiseReadback,
  type RaiseBuyerInputRow, type RaiseBuyerAction,
} from '../shared/kaeuferpreis-heben';

export interface RaiseBuyerDeps {
  readRows: () => Promise<RaiseBuyerInputRow[]>;
  revise: (sku: string | null, price: number) => Promise<{ ok: boolean; error?: string }>;
  // Nur bestätigte Preise (skuId → Käuferpreis; Einzelartikel skuId null). Der Aufrufer MERGT gegen den frischen DB-Stand.
  store: (confirmed: Array<{ skuId: string | null; price: number }>) => Promise<void>;
  setLock: (still: Array<{ sku: string; label: string; buyerPrice: number; offerPrice: number }> | null) => Promise<void>;
  log: (m: string) => void;
}

export async function previewBuyerPriceRaise(productId: number, deps: Pick<RaiseBuyerDeps, 'readRows' | 'log'>) {
  const plan = planBuyerPriceRaise(await deps.readRows());
  for (const a of plan.actions) if (a.status === 'uebersprungen') deps.log(`${skipLogLine(productId, a)} (Vorschau)`);
  return plan;
}

export type RaiseBuyerOutcome =
  | { status: 'abgelehnt'; error: string; actions: RaiseBuyerAction[] }
  | { status: 'nichts'; actions: RaiseBuyerAction[] }
  | {
      status: 'gesendet';
      actions: RaiseBuyerAction[];
      results: Array<{ sku: string; skuId: string | null; to: number; ok: boolean; error?: string }>;
      confirmed: Array<{ sku: string; skuId: string | null; price: number }>;
      notConfirmed: Array<{ sku: string; reason: string }>;
      locked: boolean;
    };

export async function runBuyerPriceRaise(productId: number, deps: RaiseBuyerDeps, expected?: Record<string, number>): Promise<RaiseBuyerOutcome> {
  const plan = planBuyerPriceRaise(await deps.readRows());
  for (const a of plan.actions) if (a.status === 'uebersprungen') deps.log(skipLogLine(productId, a));
  const drift = compareRaiseExpected(plan.actions, expected);
  if (drift) { deps.log(`[Käuferpreis heben] stele-${productId}: ${drift}`); return { status: 'abgelehnt', error: drift, actions: plan.actions }; }
  const todo = plan.actions.filter(a => a.status === 'heben' && a.to != null);
  if (todo.length === 0) { deps.log(`[Käuferpreis heben] stele-${productId}: nichts zu heben — nichts gesendet, Sperre unverändert`); return { status: 'nichts', actions: plan.actions }; }

  const results: Array<{ sku: string; skuId: string | null; to: number; ok: boolean; error?: string }> = [];
  for (const a of todo) {
    const to = a.to as number;
    const res = await deps.revise(a.skuId == null ? null : a.sku, to);
    results.push({ sku: a.sku, skuId: a.skuId, to, ok: res.ok, error: res.error });
    deps.log(`[Käuferpreis heben] stele-${productId} ${a.sku}: Käuferpreis ${a.buyerPrice} → ${to} (= Angebotsdaten = Zielpreis) ${res.ok ? 'gesendet' : 'FEHLER ' + (res.error ?? '')}`);
  }

  const after = await deps.readRows();
  const ev = evaluateRaiseReadback(results, after);
  for (const n of ev.notConfirmed) deps.log(`[Käuferpreis heben] stele-${productId} ${n.sku}: NICHT bestätigt — ${n.reason} (App-Preis unverändert)`);
  if (ev.confirmed.length > 0) {
    await deps.store(ev.confirmed.map(c => ({ skuId: c.skuId, price: c.price })));
    deps.log(`[Käuferpreis heben] stele-${productId}: App-Preis gespeichert für ${ev.confirmed.map(c => `${c.sku}=${c.price}`).join(', ')}`);
  }
  if (ev.liftLock) {
    await deps.setLock(null);
    deps.log(`[Käuferpreis heben] stele-${productId}: Käuferpreis = Angebotsdaten bei allen Varianten — K-011-Sperre aufgehoben`);
  } else {
    await deps.setLock(ev.stillMismatched.filter(r => r.buyerPrice != null && r.offerPrice != null)
      .map(r => ({ sku: r.sku, label: after.find(x => x.sku === r.sku)?.label || r.sku, buyerPrice: r.buyerPrice as number, offerPrice: r.offerPrice as number })));
    deps.log(`[Käuferpreis heben] stele-${productId}: noch ${ev.stillMismatched.length} abweichend/unlesbar — Sperre bleibt`);
  }
  return { status: 'gesendet', actions: plan.actions, results, confirmed: ev.confirmed, notConfirmed: ev.notConfirmed, locked: !ev.liftLock };
}
