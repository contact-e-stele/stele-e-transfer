// Inhaber 24.10.2026 (Chat): "wieso werden nicht alle angeglichen mit einer Taste, die immer wieder für die Zukunft eingestellt ist".
// K-011-Sperre (eBay-Käuferpreis ≠ Angebotsdaten) entsteht fast immer, wenn ein Preis von Hand bei eBay ANGEHOBEN wurde (Live-Fund 24.10.:
// 119, 220, 224, 225 — Käufer 23,45/23,95/26,95 gegenüber Angebotsdaten 19,95/21,45/25,95). Dann blockierte die Sperre jede weitere
// Anhebung und die App rechnete mit zu niedrigen Preisen.
// Automatik (nur NACH OBEN): liegt bei JEDER abweichenden Variante der Käuferpreis ÜBER den Angebotsdaten, werden die Angebotsdaten auf
// den Käuferpreis gesetzt (für Käufer ändert sich nichts) und danach zurückgelesen; stimmen dann alle → Sperre aufheben.
// Liegt auch nur eine Variante mit dem Käuferpreis UNTER den Angebotsdaten → NICHTS automatisch (das könnte eine Senkung festschreiben),
// Sperre bleibt, Meldung im Log. Reine Entscheidung in planAutoAlign (testbar), eBay/DB nur über deps.
import { PRICE_MISMATCH_TOLERANCE_EUR } from '../shared/ebay-buyer-price';

export interface AlignRow { sku: string; buyerPrice: number; offerPrice: number | null }

export function planAutoAlign(rows: AlignRow[]): { action: 'none' | 'align' | 'blocked'; todo: AlignRow[]; reason?: string } {
  const unreadable = rows.filter(r => r.offerPrice == null);
  if (unreadable.length > 0) return { action: 'blocked', todo: [], reason: `Angebotsdaten nicht lesbar: ${unreadable.map(r => r.sku).join(', ')}` };
  const diff = rows.filter(r => Math.abs(r.buyerPrice - (r.offerPrice as number)) > PRICE_MISMATCH_TOLERANCE_EUR + 1e-9);
  if (diff.length === 0) return { action: 'none', todo: [] };
  const lower = diff.filter(r => r.buyerPrice < (r.offerPrice as number));
  if (lower.length > 0) {
    return { action: 'blocked', todo: [], reason: `Käuferpreis NIEDRIGER als Angebotsdaten (${lower.map(r => `${r.sku} ${r.buyerPrice} < ${r.offerPrice}`).join(', ')}) — nicht automatisch, bitte von Hand prüfen` };
  }
  return { action: 'align', todo: diff };
}

export interface AutoAlignDeps {
  readRows: () => Promise<AlignRow[]>;
  writeOffer: (sku: string, price: number) => Promise<{ ok: boolean; error?: string }>;
  setLock: (rows: AlignRow[] | null) => Promise<void>;
  adoptAppPrices: () => Promise<void>;
  log: (m: string) => void;
}

export async function autoAlignUpward(productId: number, deps: AutoAlignDeps): Promise<'none' | 'aligned' | 'blocked' | 'partial'> {
  const before = await deps.readRows();
  const plan = planAutoAlign(before);
  if (plan.action === 'blocked') { deps.log(`[K-011 auto] stele-${productId}: ${plan.reason}`); return 'blocked'; }
  if (plan.action === 'none') { await deps.setLock(null); await deps.adoptAppPrices(); return 'none'; }
  for (const r of plan.todo) {
    const res = await deps.writeOffer(r.sku, r.buyerPrice);
    deps.log(`[K-011 auto] stele-${productId} ${r.sku}: Angebotsdaten ${r.offerPrice} → ${r.buyerPrice} (höherer Käuferpreis) ${res.ok ? 'OK' : 'FEHLER ' + (res.error ?? '')}`);
  }
  const after = await deps.readRows();
  const still = planAutoAlign(after);
  if (still.action === 'none') {
    await deps.setLock(null);
    await deps.adoptAppPrices();
    deps.log(`[K-011 auto] stele-${productId}: angeglichen, Sperre aufgehoben, App-Preise aus eBay übernommen`);
    return 'aligned';
  }
  await deps.setLock(after);
  deps.log(`[K-011 auto] stele-${productId}: nach dem Angleichen weiter abweichend — Sperre bleibt`);
  return 'partial';
}
