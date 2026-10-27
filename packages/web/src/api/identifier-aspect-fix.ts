// EAN-Merkmal eines LIVE-Angebots korrigieren (stele-228): Gruppe und jedes Varianten-Inventory-Item voll lesen, nur ungültige
// EAN/GTIN/UPC/ISBN-Merkmale durch „Nicht zutreffend" ersetzen, voll zurückschreiben (createOrReplace), danach zurücklesen.
// Ohne confirm: nur Vorschau. Logik der Prüfung: shared/identifier-aspect.ts.
import { fixIdentifierAspects, fixMpnAspects } from '../shared/identifier-aspect';
import { isForbiddenMpn } from '../shared/mpn-guard';

type Doc = Record<string, unknown> & { aspects?: Record<string, string[]>; product?: { aspects?: Record<string, string[]> } };

export async function fixListingIdentifierAspects(input: {
  productId: number; token: string; baseUrl: string; confirm: boolean; fetchFn?: typeof fetch; itemSkus: string[];
  sourceUrl?: string | null; // „ja MPN": auch AliExpress-ID als MPN/Herstellernummer ersetzen
  // für Items dieselbe Bereinigung wie Mengen-/Titel-PUT (A-048: BrandMPN 25002, Gewicht 0 25709) — Grundgesetz 8
  prepareItem?: (item: Record<string, unknown>) => void;
}): Promise<{ rows: Array<{ target: string; changed: string[]; written: boolean; error?: string; after?: string[]; afterMpn?: string[] }> }> {
  const f = input.fetchFn ?? fetch;
  const h = { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json', 'Content-Language': 'de-DE' };
  const rows: Array<{ target: string; changed: string[]; written: boolean; error?: string; after?: string[]; afterMpn?: string[] }> = [];
  const groupSku = `stele-${input.productId}-GROUP`;
  // „ja MPN" 27.10.2026: Einzelangebote (keine Gruppe) wurden bisher übersprungen → dann nur das Item stele-<id>.
  const isGroup = input.itemSkus.length > 0;
  const itemSkus = isGroup ? input.itemSkus : [`stele-${input.productId}`];
  const targets: Array<{ target: string; url: string; kind: 'group' | 'item' }> = [
    ...(isGroup ? [{ target: groupSku, url: `${input.baseUrl}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupSku)}`, kind: 'group' as const }] : []),
    ...itemSkus.map(s => ({ target: s, url: `${input.baseUrl}/sell/inventory/v1/inventory_item/${encodeURIComponent(s)}`, kind: 'item' as const })),
  ];
  for (const t of targets) {
    const g = await f(t.url, { headers: h });
    if (!g.ok) { rows.push({ target: t.target, changed: [], written: false, error: `GET ${g.status}` }); continue; }
    const doc = await g.json() as Doc;
    const cur = t.kind === 'group' ? doc.aspects : doc.product?.aspects;
    const idFix = fixIdentifierAspects(cur);
    const mpnFix = fixMpnAspects(idFix.aspects, input.sourceUrl);
    // Item-Feld product.mpn (nicht Merkmal) mit AliExpress-ID zählt ebenfalls; die Bereinigung macht prepareItem (sanitizeItemProductForPut).
    const productMpn = t.kind === 'item' ? (doc.product as { mpn?: unknown } | undefined)?.mpn : undefined;
    const mpnFieldBad = typeof productMpn === 'string' && productMpn.trim() !== '' && isForbiddenMpn(productMpn, input.sourceUrl);
    const fix = { aspects: mpnFix.aspects, changed: [...idFix.changed, ...mpnFix.changed, ...(mpnFieldBad ? [`product.mpn: ${productMpn}`] : [])] };
    if (fix.changed.length === 0 || !input.confirm) { rows.push({ target: t.target, changed: fix.changed, written: false }); continue; }
    if (t.kind === 'group') doc.aspects = fix.aspects;
    else { doc.product = { ...(doc.product ?? {}), aspects: fix.aspects }; input.prepareItem?.(doc); }
    const p = await f(t.url, { method: 'PUT', headers: h, body: JSON.stringify(doc) });
    if (!(p.ok || p.status === 204)) { rows.push({ target: t.target, changed: fix.changed, written: false, error: `PUT ${p.status}: ${(await p.text().catch(() => '')).slice(0, 300)}` }); continue; }
    const back = await f(t.url, { headers: h });
    const bd = back.ok ? await back.json() as Doc : null;
    const ba = t.kind === 'group' ? bd?.aspects : bd?.product?.aspects;
    rows.push({ target: t.target, changed: fix.changed, written: true, after: ba?.EAN ?? [], afterMpn: [...(ba?.MPN ?? []), ...(ba?.Herstellernummer ?? [])] });
  }
  return { rows };
}
