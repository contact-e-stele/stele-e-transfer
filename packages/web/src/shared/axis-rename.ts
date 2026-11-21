// D4 Schritt A (ENTSCHEIDUNG INHABER 21.11.2026 11:16 Y, AUFSICHT 12:10 Punkt 3): Achsen-NAMEN der Varianten bei eBay umbenennen
// (z. B. „Number of Pcs“ → „Menge“, „Varianten“ → „Farbe“). WERTE bleiben unverändert (Werte mit Verkäufen darf eBay nicht ändern).
// Reine Planung (Grundgesetz 2): aus Gruppe + Items die neuen Dokumente bauen, Konflikte erkennen. Kein Netz.

export type AspectMap = Record<string, string[]>;
export interface GroupDoc { aspects?: AspectMap; variantSKUs?: string[]; variesBy?: { aspectsImageVariesBy?: string[]; specifications?: Array<{ name?: string; values?: string[] }> }; [k: string]: unknown }

export interface AxisRenamePlan { ok: boolean; error?: string; renames: Array<{ von: string; nach: string }>; group?: GroupDoc }

const norm = (s: string) => s.trim().toLowerCase();

/** Neue Gruppe mit umbenannten Achsen. Fehler: Achse unbekannt, Zielname schon Achse oder Artikelmerkmal (eBay 25013), leerer Name. */
export function planGroupAxisRename(group: GroupDoc, renames: Record<string, string>): AxisRenamePlan {
  const specs = group.variesBy?.specifications ?? [];
  const names = specs.map(s => String(s.name ?? ''));
  const out: Array<{ von: string; nach: string }> = [];
  for (const [vonRaw, nachRaw] of Object.entries(renames)) {
    const von = names.find(n => norm(n) === norm(vonRaw));
    const nach = String(nachRaw ?? '').trim();
    if (!von) return { ok: false, renames: [], error: `Achse „${vonRaw}“ gibt es nicht (vorhanden: ${names.join(', ') || '–'})` };
    if (!nach) return { ok: false, renames: [], error: `neuer Name für „${von}“ ist leer` };
    if (von === nach) continue;
    if (names.some(n => n !== von && norm(n) === norm(nach))) return { ok: false, renames: [], error: `„${nach}“ ist schon eine andere Achse` };
    if (Object.keys(group.aspects ?? {}).some(k => norm(k) === norm(nach))) return { ok: false, renames: [], error: `„${nach}“ ist schon Artikelmerkmal der Gruppe (eBay 25013) – erst dort entfernen` };
    out.push({ von, nach });
  }
  if (out.length === 0) return { ok: true, renames: [], group };
  const map = new Map(out.map(r => [r.von, r.nach]));
  const g: GroupDoc = structuredClone(group);
  g.variesBy = {
    ...(g.variesBy ?? {}),
    specifications: specs.map(s => ({ ...s, name: map.get(String(s.name ?? '')) ?? s.name })),
    aspectsImageVariesBy: (g.variesBy?.aspectsImageVariesBy ?? []).map(n => map.get(n) ?? n),
  };
  return { ok: true, renames: out, group: g };
}

/** Item-Merkmale: alter Schlüssel → neuer Schlüssel. keepOld=true (Phase 1) lässt den alten zusätzlich stehen. Werte unverändert. */
export function renameItemAspects(aspects: AspectMap | undefined, renames: Array<{ von: string; nach: string }>, keepOld: boolean): AspectMap {
  const out: AspectMap = { ...(aspects ?? {}) };
  for (const { von, nach } of renames) {
    const key = Object.keys(out).find(k => norm(k) === norm(von));
    if (!key) continue;
    out[nach] = out[key];
    if (!keepOld && key !== nach) delete out[key];
  }
  return out;
}
