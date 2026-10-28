// OFFEN 010 Schritt 2 (stele-119): Eintrag skuId 12000050569622129 trug in der App den Namen "100pcs", laut AliExpress (DS-API und Seite,
// skuAttr "14:193#1000PCs") ist es "1000PCs". Die Preisprüfung aktualisiert EK je skuId, die NAMEN (attrs) aber nie — ein falscher Name
// bleibt sonst für immer und lenkt eBay-Varianten auf den falschen Einkaufspreis. REINE Funktion: Namen je skuId mit AliExpress vergleichen.
export interface AttrsEntry { skuId?: string; attrs?: Record<string, string>; displayValues?: unknown }
export interface AttrsChange { skuId: string; before: Record<string, string>; after: Record<string, string> }
export interface AttrsSyncPlan { changes: AttrsChange[]; skipped: Array<{ skuId: string; reason: string }>; notOnAli: string[] }

const norm = (a: Record<string, string> | undefined) => JSON.stringify(Object.entries(a ?? {}).map(([k, v]) => [k.trim(), String(v).trim()]).sort());

export function planAliAttrsSync(stored: AttrsEntry[], fresh: Array<{ skuId?: string; attrs?: Record<string, string> }>): AttrsSyncPlan {
  const bySku = new Map(fresh.filter(f => f.skuId).map(f => [String(f.skuId), f.attrs ?? {}]));
  const plan: AttrsSyncPlan = { changes: [], skipped: [], notOnAli: [] };
  for (const e of stored) {
    if (!e.skuId) continue;
    const ali = bySku.get(String(e.skuId));
    if (!ali) { plan.notOnAli.push(String(e.skuId)); continue; }
    if (norm(e.attrs) === norm(ali)) continue;
    // Einträge mit Anzeige-Zuordnung (Umbenennung im Import, P-85) nicht anfassen — dort ist der App-Name gewollt anders.
    if (e.displayValues && typeof e.displayValues === 'object' && Object.keys(e.displayValues as object).length > 0) {
      plan.skipped.push({ skuId: String(e.skuId), reason: 'Anzeige-Zuordnung (displayValues) gesetzt — bewusst umbenannt' });
      continue;
    }
    plan.changes.push({ skuId: String(e.skuId), before: { ...(e.attrs ?? {}) }, after: { ...ali } });
  }
  return plan;
}

export function applyAliAttrsSync<T extends AttrsEntry>(stored: T[], plan: AttrsSyncPlan): T[] {
  const m = new Map(plan.changes.map(c => [c.skuId, c.after]));
  return stored.map(e => (e.skuId && m.has(String(e.skuId)) ? { ...e, attrs: { ...m.get(String(e.skuId))! } } : e));
}
