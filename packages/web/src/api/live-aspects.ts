// C2 (Inhaber 25.10.2026 "Punkt C ja": Merkmale in die Live-Angebote auf Knopfdruck). Gleiches Vorgehen wie der EAN-Fix
// (identifier-aspect-fix.ts): Gruppe bzw. Inventory-Item VOLL lesen, nur FEHLENDE Merkmale aus products.specs ergänzen
// (geprüfter Abgleich shared/spec-aspects.ts), voll zurückschreiben, zurücklesen. Vorhandene Merkmale werden nie geändert.
// Kein Preis, keine Menge, kein Offer. Ohne confirm: nur Vorschau.
import { matchSpecsToCategoryAspects, type CategoryAspectDef } from '../shared/spec-aspects';

type Doc = Record<string, unknown> & {
  aspects?: Record<string, string[]>;
  product?: { aspects?: Record<string, string[]> };
  variesBy?: { specifications?: Array<{ name?: string }> };
};

export interface LiveAspectRow { target: string; added: Record<string, string>; written: boolean; error?: string; verified?: boolean }

/** Rein: welche Merkmale fehlen und werden ergänzt (Variations-Merkmale und vorhandene bleiben unberührt). */
export function aspectAdditions(current: Record<string, string[]> | undefined, specs: Record<string, string>, category: CategoryAspectDef[], variesBy: string[] = []): Record<string, string> {
  const have = Object.entries(current ?? {}).filter(([, v]) => Array.isArray(v) && v.some(x => String(x).trim())).map(([k]) => k);
  return matchSpecsToCategoryAspects(specs, category, [...have, ...variesBy]).aspects;
}

export async function applySpecAspectsToListing(input: {
  productId: number; specs: Record<string, string>; token: string; baseUrl: string; confirm: boolean;
  itemSkus: string[];                                       // Varianten-SKUs der Gruppe; leer = Einzelangebot stele-<id>
  getCategoryAspects: (categoryId: string) => Promise<CategoryAspectDef[] | null>;
  prepareItem?: (item: Record<string, unknown>) => void;    // gleiche Bereinigung wie andere Item-PUTs (BrandMPN, Gewicht 0)
  fetchFn?: typeof fetch;
}): Promise<{ categoryId: string | null; rows: LiveAspectRow[]; error?: string }> {
  const f = input.fetchFn ?? fetch;
  const h = { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json', 'Content-Language': 'de-DE' };
  const isGroup = input.itemSkus.length > 0;
  const groupSku = `stele-${input.productId}-GROUP`;
  const itemSkus = isGroup ? input.itemSkus : [`stele-${input.productId}`];

  // Kategorie aus dem Offer der ersten SKU
  const o = await f(`${input.baseUrl}/sell/inventory/v1/offer?sku=${encodeURIComponent(itemSkus[0])}&marketplace_id=EBAY_DE`, { headers: h });
  const oj = o.ok ? await o.json() as { offers?: Array<{ categoryId?: string }> } : null;
  const categoryId = oj?.offers?.find(x => x.categoryId)?.categoryId ?? null;
  if (!categoryId) return { categoryId: null, rows: [], error: `Kategorie nicht lesbar (Offer GET ${o.status})` };
  const category = await input.getCategoryAspects(categoryId);
  if (!category) return { categoryId, rows: [], error: `Merkmal-Liste der Kategorie ${categoryId} nicht abrufbar` };

  const targets: Array<{ target: string; url: string; kind: 'group' | 'item' }> = [
    ...(isGroup ? [{ target: groupSku, url: `${input.baseUrl}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupSku)}`, kind: 'group' as const }] : []),
    ...itemSkus.map(s => ({ target: s, url: `${input.baseUrl}/sell/inventory/v1/inventory_item/${encodeURIComponent(s)}`, kind: 'item' as const })),
  ];
  const rows: LiveAspectRow[] = [];
  let variesBy: string[] = [];
  for (const t of targets) {
    const g = await f(t.url, { headers: h });
    if (!g.ok) { rows.push({ target: t.target, added: {}, written: false, error: `GET ${g.status}` }); if (t.kind === 'group') break; continue; }
    const doc = await g.json() as Doc;
    if (t.kind === 'group') variesBy = (doc.variesBy?.specifications ?? []).map(s => s.name ?? '').filter(Boolean);
    const cur = t.kind === 'group' ? doc.aspects : doc.product?.aspects;
    const added = aspectAdditions(cur, input.specs, category, variesBy);
    if (Object.keys(added).length === 0 || !input.confirm) { rows.push({ target: t.target, added, written: false }); continue; }
    const merged = { ...(cur ?? {}), ...Object.fromEntries(Object.entries(added).map(([k, v]) => [k, [v]])) };
    if (t.kind === 'group') doc.aspects = merged;
    else { doc.product = { ...(doc.product ?? {}), aspects: merged }; input.prepareItem?.(doc); }
    const p = await f(t.url, { method: 'PUT', headers: h, body: JSON.stringify(doc) });
    if (!(p.ok || p.status === 204)) { rows.push({ target: t.target, added, written: false, error: `PUT ${p.status}: ${(await p.text().catch(() => '')).slice(0, 300)}` }); if (t.kind === 'group') break; continue; }
    const back = await f(t.url, { headers: h });
    const bd = back.ok ? await back.json() as Doc : null;
    const ba = (t.kind === 'group' ? bd?.aspects : bd?.product?.aspects) ?? {};
    rows.push({ target: t.target, added, written: true, verified: Object.entries(added).every(([k, v]) => ba[k]?.includes(v)) });
  }
  return { categoryId, rows };
}
