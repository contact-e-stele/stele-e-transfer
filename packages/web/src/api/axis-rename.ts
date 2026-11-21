// D4 Schritt A: Achsen-Namen eines Varianten-Angebots bei eBay umbenennen (Inventory-API, nicht Seller Hub – keine Abkopplung).
// Ablauf (3 Phasen, damit die Gruppe nie auf fehlende Item-Merkmale zeigt):
//   1) jedes Varianten-Item: neuen Schlüssel ZUSÄTZLICH setzen (Wert = alter Wert)  2) Gruppe: variesBy auf neue Namen
//   3) jedes Item: alten Schlüssel entfernen. Danach zurücklesen. Ohne confirm: nur Vorschau. Preis, Menge, Offer bleiben unberührt.
import { planGroupAxisRename, renameItemAspects, type GroupDoc, type AspectMap } from '../shared/axis-rename';

export interface AxisRenameRow { schritt: string; ziel: string; ok: boolean; fehler?: string }
export interface AxisRenameResult { productId: number; mode: 'preview' | 'apply'; renames: Array<{ von: string; nach: string }>; rows: AxisRenameRow[]; verified?: boolean; error?: string }

type ItemDoc = Record<string, unknown> & { product?: { aspects?: AspectMap } & Record<string, unknown> };

export async function renameListingAxes(input: {
  productId: number; renames: Record<string, string>; confirm: boolean; token: string; baseUrl: string;
  prepareItem?: (item: Record<string, unknown>) => void; fetchFn?: typeof fetch;
}): Promise<AxisRenameResult> {
  const f = input.fetchFn ?? fetch;
  const h = { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json', 'Content-Language': 'de-DE' };
  const mode = input.confirm ? 'apply' as const : 'preview' as const;
  const groupSku = `stele-${input.productId}-GROUP`;
  const gUrl = `${input.baseUrl}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupSku)}`;
  const iUrl = (s: string) => `${input.baseUrl}/sell/inventory/v1/inventory_item/${encodeURIComponent(s)}`;
  const g = await f(gUrl, { headers: h });
  if (!g.ok) return { productId: input.productId, mode, renames: [], rows: [], error: `Gruppe ${groupSku}: GET ${g.status} (kein Varianten-Angebot?)` };
  const group = await g.json() as GroupDoc;
  const plan = planGroupAxisRename(group, input.renames);
  if (!plan.ok) return { productId: input.productId, mode, renames: [], rows: [], error: plan.error };
  if (plan.renames.length === 0) return { productId: input.productId, mode, renames: [], rows: [], error: 'nichts umzubenennen (Namen schon gleich)' };
  const skus = group.variantSKUs ?? [];
  const rows: AxisRenameRow[] = [];
  if (!input.confirm) {
    rows.push({ schritt: 'vorschau', ziel: groupSku, ok: true }, ...skus.map(s => ({ schritt: 'vorschau', ziel: s, ok: true })));
    return { productId: input.productId, mode, renames: plan.renames, rows };
  }
  const items = new Map<string, ItemDoc>();
  const put = async (url: string, doc: unknown) => { const r = await f(url, { method: 'PUT', headers: h, body: JSON.stringify(doc) }); return r.ok || r.status === 204 ? null : `PUT ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`; };
  // Phase 1
  for (const s of skus) {
    const r = await f(iUrl(s), { headers: h });
    if (!r.ok) { rows.push({ schritt: '1 neu dazu', ziel: s, ok: false, fehler: `GET ${r.status}` }); return { productId: input.productId, mode, renames: plan.renames, rows, error: 'abgebrochen vor der Gruppe – nichts umbenannt' }; }
    const doc = await r.json() as ItemDoc;
    items.set(s, doc);
    const next: ItemDoc = { ...doc, product: { ...(doc.product ?? {}), aspects: renameItemAspects(doc.product?.aspects, plan.renames, true) } };
    input.prepareItem?.(next);
    const e = await put(iUrl(s), next);
    rows.push({ schritt: '1 neu dazu', ziel: s, ok: !e, ...(e ? { fehler: e } : {}) });
    if (e) return { productId: input.productId, mode, renames: plan.renames, rows, error: 'abgebrochen vor der Gruppe – Achsen unverändert (Items haben ggf. zusätzlichen Schlüssel)' };
  }
  // Phase 2
  const ge = await put(gUrl, plan.group);
  rows.push({ schritt: '2 Gruppe', ziel: groupSku, ok: !ge, ...(ge ? { fehler: ge } : {}) });
  if (ge) return { productId: input.productId, mode, renames: plan.renames, rows, error: 'Gruppe abgelehnt – Achsen unverändert' };
  // Phase 3
  for (const s of skus) {
    const doc = items.get(s)!;
    const next: ItemDoc = { ...doc, product: { ...(doc.product ?? {}), aspects: renameItemAspects(doc.product?.aspects, plan.renames, false) } };
    input.prepareItem?.(next);
    const e = await put(iUrl(s), next);
    rows.push({ schritt: '3 alt weg', ziel: s, ok: !e, ...(e ? { fehler: e } : {}) });
  }
  // Rücklesen
  const back = await f(gUrl, { headers: h });
  const bg = back.ok ? await back.json() as GroupDoc : null;
  const backNames = (bg?.variesBy?.specifications ?? []).map(x => String(x.name ?? ''));
  const verified = plan.renames.every(r => backNames.includes(r.nach) && !backNames.includes(r.von));
  return { productId: input.productId, mode, renames: plan.renames, rows, verified };
}
