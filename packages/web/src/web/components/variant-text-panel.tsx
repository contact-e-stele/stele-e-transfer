// OFFEN 023: Werkzeug "Varianten-Texte prüfen" im Produkte-Tab. Zeigt je ausgewähltem Produkt Original → deutscher Vorschlag
// (shared/variant-text-de.ts, nur lesen). "Übernehmen" speichert NUR in der App (variants + displayValues, bei gelisteten Produkten
// mit SKU-Anker). Ein "an eBay senden" gibt es bewusst nicht: eBay erlaubt das Umbenennen von Variantenwerten in laufenden
// Angeboten nicht (s. PR OFFEN 023). Kein window.confirm — Bestätigung über den zweiten Knopf in der Seite.
import { useEffect, useState } from "react";
import { findDuplicateValues } from "../../shared/variant-text-de";

type Group = { name: string; values: string[] };
interface TextValue { original: string; value: string; changed: boolean; unknownWords: string[] }
interface Preview {
  productId: number; listed: boolean; expectedVariants: string | null;
  groups: Array<{ name: TextValue; values: TextValue[] }>;
  anyChange: boolean; unknownWords: string[]; duplicates: string[]; applyError: string | null;
  skuPreview: Array<{ skuBefore: string; skuAfter: string | null; skuIdBefore: string | null; skuIdAfter: string | null }>;
  ebaySend: { built: boolean; note: string };
  error?: string;
}
interface Row { id: number; preview?: Preview; edit?: Group[]; error?: string; confirm?: boolean; busy?: boolean; result?: { ok: boolean; text: string } }

const btn = { fontSize: 12, padding: "5px 10px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 } as const;
const inp = { fontSize: 12, padding: "3px 6px", border: "1px solid #CBD5E1", borderRadius: 6, fontFamily: "inherit", minWidth: 140 } as const;

export function VariantTextPanel({ ids, name, onClose, onSaved }: { ids: number[]; name: (id: number) => string; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[]>(ids.map(id => ({ id })));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Row[] = ids.map(id => ({ id }));
      for (let i = 0; i < ids.length; i++) {
        try {
          const r = await fetch(`/api/products/${ids[i]}/variant-texts`, { credentials: "include" });
          const d = await r.json().catch(() => ({})) as Preview;
          out[i] = r.ok ? { id: ids[i], preview: d, edit: d.groups.map(g => ({ name: g.name.value, values: g.values.map(v => v.value) })) } : { id: ids[i], error: d.error ?? `HTTP ${r.status}` };
        } catch (e) { out[i] = { id: ids[i], error: String(e) }; }
        if (cancelled) return;
        setRows([...out]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [ids.join(",")]);

  const update = (id: number, fn: (r: Row) => Row) => setRows(prev => prev.map(r => (r.id === id ? fn(r) : r)));
  const setName = (id: number, gi: number, v: string) => update(id, r => ({ ...r, confirm: false, edit: r.edit?.map((g, i) => (i === gi ? { ...g, name: v } : g)) }));
  const setValue = (id: number, gi: number, vi: number, v: string) => update(id, r => ({ ...r, confirm: false, edit: r.edit?.map((g, i) => (i === gi ? { ...g, values: g.values.map((x, j) => (j === vi ? v : x)) } : g)) }));

  const apply = async (row: Row) => {
    if (!row.preview || !row.edit) return;
    update(row.id, r => ({ ...r, busy: true }));
    try {
      const r = await fetch(`/api/products/${row.id}/variant-texts`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true, groups: row.edit, expectedVariants: row.preview.expectedVariants ?? "" }),
      });
      const d = await r.json().catch(() => ({})) as { written?: boolean; error?: string; pinned?: Array<{ sku: string }>; ebayNote?: string | null };
      const text = r.ok && d.written
        ? `in der App gespeichert${d.pinned && d.pinned.length > 0 ? ` — ${d.pinned.length} eBay-SKU(s) festgehalten, bleiben gleich` : ""}${d.ebayNote ? `. ${d.ebayNote}` : ""}`
        : String(d.error ?? `HTTP ${r.status}`);
      update(row.id, x => ({ ...x, busy: false, confirm: false, result: { ok: !!(r.ok && d.written), text } }));
      if (r.ok && d.written) onSaved();
    } catch (e) {
      update(row.id, x => ({ ...x, busy: false, result: { ok: false, text: String(e) } }));
    }
  };

  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 10, border: "1.5px solid #CBD5E1", background: "#fff" }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Varianten-Texte prüfen (Original → Deutsch) {loading && <span style={{ color: "#64748B", fontWeight: 400 }}>lädt …</span>}</div>
      <div style={{ color: "#64748B", marginBottom: 6 }}>Nur lesen, bis „Übernehmen“. Gespeichert wird nur in der App — an eBay wird nichts gesendet.</div>
      {rows.map(row => {
        const p = row.preview;
        if (!p) return <div key={row.id} style={{ color: row.error ? "#DC2626" : "#64748B" }}>stele-{row.id} {name(row.id)}: {row.error ?? "wartet …"}</div>;
        if (p.groups.length === 0) return <div key={row.id} style={{ color: "#64748B" }}>stele-{row.id} {name(row.id)}: keine Varianten</div>;
        const edit = row.edit ?? [];
        const dups = findDuplicateValues(edit);
        const empty = edit.some(g => !g.name.trim() || g.values.some(v => !v.trim()));
        const dirty = JSON.stringify(edit) !== JSON.stringify(p.groups.map(g => ({ name: g.name.original, values: g.values.map(v => v.original) })));
        const canApply = dirty && dups.length === 0 && !empty && !row.busy && !row.result?.ok;
        return (
          <div key={row.id} style={{ borderTop: "1px solid #E2E8F0", paddingTop: 6, marginTop: 6 }}>
            <div style={{ fontWeight: 700 }}>stele-{row.id} {name(row.id)} {p.listed && <span style={{ color: "#B45309" }}>(bei eBay gelistet)</span>}</div>
            {p.groups.map((g, gi) => (
              <div key={gi} style={{ margin: "4px 0 4px 8px" }}>
                <div>Gruppe: <span style={{ color: "#64748B" }}>{g.name.original}</span> → <input style={inp} value={edit[gi]?.name ?? ""} onChange={e => setName(row.id, gi, e.target.value)} />
                  {g.name.unknownWords.length > 0 && <span style={{ color: "#B45309" }}> unbekannt: {g.name.unknownWords.join(", ")}</span>}</div>
                {g.values.map((v, vi) => (
                  <div key={vi} style={{ marginLeft: 12 }}>
                    <span style={{ color: "#64748B" }}>{v.original}</span> → <input style={inp} value={edit[gi]?.values[vi] ?? ""} onChange={e => setValue(row.id, gi, vi, e.target.value)} />
                    {v.unknownWords.length > 0 && <span style={{ color: "#B45309" }}> unbekannt: {v.unknownWords.join(", ")}</span>}
                  </div>
                ))}
              </div>
            ))}
            {dups.length > 0 && <div style={{ color: "#DC2626" }}>Doppelte Werte — so nicht speicherbar: {dups.join("; ")}</div>}
            {p.listed && p.skuPreview.length > 0 && (
              <div style={{ color: "#475569" }}>eBay-SKU bleibt: {p.skuPreview.map(s => s.skuBefore).join(", ")}</div>
            )}
            {p.listed && <div style={{ color: "#B45309" }}>{p.ebaySend.note}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              {!row.confirm && <button style={{ ...btn, opacity: canApply ? 1 : 0.5 }} disabled={!canApply} onClick={() => update(row.id, r => ({ ...r, confirm: true }))}>Übernehmen (nur App)</button>}
              {row.confirm && (
                <>
                  <button style={{ ...btn, background: "#16A34A", color: "#fff", border: "none" }} disabled={row.busy} onClick={() => apply(row)}>Ja, in der App speichern</button>
                  <button style={btn} disabled={row.busy} onClick={() => update(row.id, r => ({ ...r, confirm: false }))}>Abbrechen</button>
                </>
              )}
              <button style={{ ...btn, opacity: 0.5, cursor: "not-allowed" }} disabled title={p.ebaySend.note}>an eBay senden (nicht möglich)</button>
            </div>
            {row.result && <div style={{ color: row.result.ok ? "#16A34A" : "#DC2626" }}>{row.result.text}</div>}
          </div>
        );
      })}
      <button style={{ ...btn, marginTop: 8 }} onClick={onClose}>Schließen</button>
    </div>
  );
}
