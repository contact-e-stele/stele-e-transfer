// Design-Sprint S2 "Pflicht-Daten" (Auftrag Aufsicht 043): Block im Produkte-Tab — P1–P7 sichtbar und von Hand änderbar, je Wert Quelle a–d,
// Fundstelle und Wortlaut; GELB-Kennzeichen "Pflicht-Daten fehlen: …". Die Regeln stehen in shared/pflicht-daten.ts — dieselbe reine
// Funktion resolvePflichtDaten() wie Beschreibung v4, eBay-Merkmale und GET …/pflichtdaten-preview (Grundgesetz 8). Hier nur Anzeige + Speichern.
// Vorbelegt werden nur gespeicherte Werte und Vorschläge aus a/b; Altfelder ohne Quelle stehen als Hinweis daneben (sie haben keine Quelle).
import { useMemo, useState } from "react";
import {
  FIELD_LABEL, PFLICHT_SOURCES, PFLICHT_SOURCE_LABEL, PRODUCT_FIELDS, readPflichtDaten, resolvePflichtDaten,
  type PflichtSource, type ProductField, type ResolvedField,
} from "../../shared/pflicht-daten";
import { formatMeasure, MEASURE_KINDS, type MeasureKind } from "../../shared/variant-measure";
import { readVariantDetails } from "../../shared/product-data-patch";
import type { VariantGroup } from "../../shared/variant-resolver";

export interface PflichtDatenFields {
  id: number;
  specs?: string | null;
  variants?: unknown;
  variantPrices?: string | null;
  material?: string | null;
  materialSource?: string | null;
  usePurpose?: string | null;
  usageNote?: string | null;
  variantDetails?: string | null;
  manualAspects?: string | null;
  pflichtDaten?: string | null;
}

const VIOLET = "#96566B";
const inp = { padding: "3px 6px", fontSize: 11, border: "1px solid #CBD5E1", borderRadius: 6, fontFamily: "inherit" } as const;
const KIND_LABEL: Record<MeasureKind, string> = { D: "Ø", L: "L", BTH: "B × T × H", STRETCH: "↔ von–bis", MIXED: "gemischt" };

interface EntryForm { value: string; source: "" | PflichtSource; location: string; wording: string }
interface MeasureForm { kind: MeasureKind; values: string; source: "" | PflichtSource; location: string; wording: string }
const emptyEntry: EntryForm = { value: "", source: "", location: "", wording: "" };

const j = <T,>(s: string | null | undefined, fb: T): T => { try { const v = JSON.parse(s ?? "null"); return (v ?? fb) as T; } catch { return fb; } };
const toForm = (f: ResolvedField | null): EntryForm =>
  f && f.herkunft !== "altfeld" ? { value: f.value, source: f.source ?? "", location: f.location ?? "", wording: f.wording ?? "" } : { ...emptyEntry };
const parseValues = (t: string): number[] => t.split(/[;/\s]+/).map(s => s.trim().replace(",", ".")).filter(Boolean).map(Number);

function inputOf(p: PflichtDatenFields) {
  const vars = Array.isArray(p.variants) ? p.variants : j<unknown[]>(typeof p.variants === "string" ? p.variants : null, []);
  return {
    productId: p.id,
    specs: j<Record<string, string>>(p.specs, {}),
    variants: Array.isArray(vars) && vars.length > 0 && typeof vars[0] === "object" ? vars as VariantGroup[] : [],
    variantPrices: (() => { const v = j<unknown>(p.variantPrices, []); return Array.isArray(v) ? v as Array<{ skuId?: string; attrs?: Record<string, string> }> : []; })(),
    material: p.material, materialSource: j<{ source?: string; location?: string } | null>(p.materialSource, null),
    usePurpose: p.usePurpose, usageNote: p.usageNote, variantDetails: readVariantDetails(p.variantDetails),
    manualAspects: j<Record<string, string> | null>(p.manualAspects, null), pflichtDaten: readPflichtDaten(p.pflichtDaten),
  };
}

function SourceSelect({ value, onChange }: { value: "" | PflichtSource; onChange: (v: "" | PflichtSource) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value as "" | PflichtSource)} style={inp} title="Quelle: a Variantenauswahl · b Spezifikationen · c Bild-/Beschreibungstext · d Größentabelle">
      <option value="">Quelle –</option>
      {PFLICHT_SOURCES.map(s => <option key={s} value={s}>{s} · {PFLICHT_SOURCE_LABEL[s]}</option>)}
    </select>
  );
}

export function PflichtDatenPanel({ product, onSaved }: { product: PflichtDatenFields; onSaved: (patch: { pflichtDaten: string | null }) => void }) {
  const resolved = useMemo(() => resolvePflichtDaten(inputOf(product)), [product]);
  const [fields, setFields] = useState<Record<ProductField, EntryForm>>(() =>
    Object.fromEntries(PRODUCT_FIELDS.map(f => [f, toForm(resolved[f])])) as Record<ProductField, EntryForm>);
  const [colors, setColors] = useState<Record<string, EntryForm>>(() =>
    Object.fromEntries(resolved.units.map(u => [u.key, toForm(resolved.farben[u.key] ?? null)])));
  const [measures, setMeasures] = useState<Record<string, MeasureForm>>(() => Object.fromEntries(resolved.units.map(u => {
    const m = resolved.masse[u.key];
    return [u.key, m && m.herkunft !== "altfeld"
      ? { kind: m.kind, values: m.values.join(" / ").replace(/\./g, ","), source: m.source, location: m.location, wording: m.text ?? "" }
      : { kind: "D" as MeasureKind, values: "", source: "" as const, location: "", wording: "" }];
  })));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState(false);
  const gelb = resolved.ampel.status === "GELB";

  const save = async () => {
    setMsg(null);
    const entry = (e: EntryForm) => (e.value.trim() ? { value: e.value, source: e.source, location: e.location, wording: e.wording } : null);
    const pflichtDaten: Record<string, unknown> = Object.fromEntries(PRODUCT_FIELDS.map(f => [f, entry(fields[f])]));
    // Farbe: ohne eigene Fundstelle-Spalte gilt die Bezeichnung der Quelle als Fundstelle (z. B. "AliExpress-Variantenauswahl").
    pflichtDaten.farben = Object.fromEntries(Object.entries(colors).filter(([, e]) => e.value.trim()).map(([k, e]) => [k, entry({ ...e, location: e.location || (e.source ? PFLICHT_SOURCE_LABEL[e.source] : "") })]));
    pflichtDaten.masse = Object.fromEntries(Object.entries(measures).filter(([, m]) => m.values.trim()).map(([k, m]) => [k, { kind: m.kind, values: parseValues(m.values), source: m.source, location: m.location, ...(m.wording.trim() ? { text: m.wording.trim() } : {}) }]));
    try {
      const r = await fetch(`/api/products/${product.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ pflichtDaten }) });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (r.ok && !d.error) {
        // Gespeicherten Stand neu lesen (nur lesen) — die Vorschau-Route liefert genau das, was v4/Merkmale lesen.
        const pv = await fetch(`/api/products/${product.id}/pflichtdaten-preview`, { credentials: "include" }).then(x => x.json()).catch(() => null) as { gespeichert?: unknown } | null;
        onSaved({ pflichtDaten: pv?.gespeichert ? JSON.stringify(pv.gespeichert) : null });
        setMsg({ ok: true, text: "Gespeichert ✓" });
      } else setMsg({ ok: false, text: d.error || "Speichern fehlgeschlagen" });
    } catch { setMsg({ ok: false, text: "Netzwerkfehler beim Speichern" }); }
  };

  const fieldRow = (f: ProductField, placeholder: string) => {
    const e = fields[f];
    const r = resolved[f];
    const set = (patch: Partial<EntryForm>) => setFields(s => ({ ...s, [f]: { ...s[f], ...patch } }));
    return (
      <tr key={f} style={{ borderTop: "1px solid #E2E8F0" }}>
        <td style={{ padding: "3px 4px", whiteSpace: "nowrap", fontWeight: 600 }}>{FIELD_LABEL[f]}</td>
        <td><input value={e.value} onChange={x => set({ value: x.target.value })} placeholder={placeholder} style={{ ...inp, width: 170 }} /></td>
        <td><SourceSelect value={e.source} onChange={v => set({ source: v })} /></td>
        <td><input value={e.location} onChange={x => set({ location: x.target.value })} placeholder="Fundstelle" style={{ ...inp, width: 120 }} /></td>
        <td><input value={e.wording} onChange={x => set({ wording: x.target.value })} placeholder="Wortlaut der Quelle" style={{ ...inp, width: 140 }} /></td>
        <td style={{ color: r ? "#475569" : VIOLET, fontSize: 10 }}>
          {r ? `${r.herkunft === "vorschlag" ? "Vorschlag" : r.herkunft === "altfeld" ? "Altfeld (ohne Quelle)" : "gespeichert"}: ${r.value}${r.source ? ` · Quelle ${r.source}` : ""}${r.hinweis ? ` · ${r.hinweis}` : ""}` : "leer"}
        </td>
      </tr>
    );
  };

  return (
    <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: `1px solid ${gelb ? "#FDE68A" : "#86EFAC"}`, background: "#F8FAFC", fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => setOpen(o => !o)} style={{ fontWeight: 700, color: "#475569", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit", fontSize: 11 }}>
          {open ? "▾" : "▸"} 📋 Pflicht-Daten (P1–P7)
        </button>
        <span style={{ fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: gelb ? "#FEF9C3" : "#DCFCE7", color: gelb ? "#A16207" : "#166534" }}>
          {gelb ? "GELB" : "GRÜN"}
        </span>
        {gelb && resolved.ampel.text && <span style={{ color: VIOLET, fontWeight: 600 }}>{resolved.ampel.text}</span>}
      </div>
      {open && (
        <>
          <div style={{ marginTop: 6, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ textAlign: "left", color: "#64748B" }}><th style={{ padding: "3px 4px" }}>Feld</th><th>Wert (deutsch)</th><th>Quelle</th><th>Fundstelle</th><th>Wortlaut</th><th>Stand</th></tr></thead>
              <tbody>
                {fieldRow("produktart", "1–3 Wörter, z. B. Frischhaltehaube")}
                {fieldRow("material", "z. B. Kunststoff")}
                {fieldRow("lieferumfang", "z. B. 100 Stück")}
                {fieldRow("anwendung", "ein kurzer Satz")}
                {fieldRow("besonderheit", "z. B. dehnbarer Gummizug")}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 8, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr style={{ textAlign: "left", color: "#64748B" }}><th style={{ padding: "3px 4px" }}>Variante</th><th>P5 Farbe</th><th>Quelle</th><th>Wortlaut</th><th>P3 Art</th><th>Werte (cm)</th><th>Anzeige (D2)</th><th>Quelle</th><th>Fundstelle</th><th>Wortlaut</th></tr></thead>
              <tbody>
                {resolved.units.map(u => {
                  const c = colors[u.key] ?? { ...emptyEntry };
                  const m = measures[u.key];
                  const setC = (patch: Partial<EntryForm>) => setColors(s => ({ ...s, [u.key]: { ...c, ...patch } }));
                  const setM = (patch: Partial<MeasureForm>) => setMeasures(s => ({ ...s, [u.key]: { ...m, ...patch } }));
                  const shown = m.values.trim() ? formatMeasure({ kind: m.kind, values: parseValues(m.values) }) : null;
                  return (
                    <tr key={u.key} style={{ borderTop: "1px solid #E2E8F0" }}>
                      <td style={{ padding: "3px 4px", whiteSpace: "nowrap" }} title={u.key}>{u.label}</td>
                      <td><input value={c.value} onChange={x => setC({ value: x.target.value })} placeholder="z. B. Weiß" style={{ ...inp, width: 80 }} /></td>
                      <td><SourceSelect value={c.source} onChange={v => setC({ source: v })} /></td>
                      <td><input value={c.wording} onChange={x => setC({ wording: x.target.value })} placeholder="Wortlaut" style={{ ...inp, width: 80 }} /></td>
                      <td><select value={m.kind} onChange={x => setM({ kind: x.target.value as MeasureKind })} style={inp}>{MEASURE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></td>
                      <td><input value={m.values} onChange={x => setM({ values: x.target.value })} placeholder="z. B. 14 / 29" style={{ ...inp, width: 80 }} /></td>
                      <td style={{ whiteSpace: "nowrap", fontWeight: 600, color: shown ? "#0F172A" : VIOLET }}>{shown ?? (resolved.masse[u.key] ? `${formatMeasure(resolved.masse[u.key])} (Altfeld)` : "kein Maß")}</td>
                      <td><SourceSelect value={m.source} onChange={v => setM({ source: v })} /></td>
                      <td><input value={m.location} onChange={x => setM({ location: x.target.value })} placeholder="z. B. Galeriebild 4" style={{ ...inp, width: 110 }} /></td>
                      <td><input value={m.wording} onChange={x => setM({ wording: x.target.value })} placeholder="Wortlaut" style={{ ...inp, width: 90 }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {resolved.hinweise.length > 0 && <div style={{ marginTop: 6, color: VIOLET }}>Hinweis: {resolved.hinweise.join(" · ")}</div>}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
            <button onClick={save} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "none", background: "#FFD700", color: "#0F172A", cursor: "pointer", fontFamily: "inherit" }}>Pflicht-Daten speichern</button>
            {msg && <span style={{ fontWeight: 600, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</span>}
            <span style={{ color: "#94A3B8" }}>Nie aus Titel oder Bewertungen. Kein Beleg → Feld leer lassen (GELB). Farbe nur aus der festen Liste.</span>
          </div>
        </>
      )}
    </div>
  );
}
