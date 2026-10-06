// A-045 (Beschreibung v2, Schritt 1): Block "Produktdaten (Beschreibung v2)" im Produkte-Tab — Material + Quelle, Verwendung, Einsatzzweck und je Variante
// deutscher Anzeigename, Stückzahl, Maß (Art + Werte), Quelle a–d, Fundstelle. Die Regeln (Anzeige D2, Ampel R8, Validierung) stehen in shared/ — dieselben
// reinen Funktionen wie im Server; hier nur Anzeige und Speichern. Die Beschreibung selbst (ebay-description-builder.ts) wird in diesem Schritt NICHT geändert.
import { useMemo, useState } from "react";
import { formatMeasure, measureAmpel, MEASURE_KINDS, MEASURE_SOURCES, type MeasureKind, type MeasureSource, type VariantDetails } from "../../shared/variant-measure";
import { readVariantDetails } from "../../shared/product-data-patch";

export interface ProductDataFields {
  id: number;
  material?: string | null;
  usageNote?: string | null;
  usePurpose?: string | null;
  materialSource?: string | null;
  variantDetails?: string | null;
  variantPrices?: string | null; // JSON [{skuId, attrs, ...}] — Quelle der Varianten-SKUs
}

const KIND_LABEL: Record<MeasureKind, string> = { D: "Ø Durchmesser", L: "L Länge", BTH: "B × T × H", STRETCH: "↔ dehnbar von–bis", MIXED: "gemischt Ø a / b / c" };
const VIOLET = "#96566B"; // nur in der App für fehlende Werte (Design-Vorgabe v2.3)
const input = { padding: "3px 6px", fontSize: 11, border: "1px solid #CBD5E1", borderRadius: 6, fontFamily: "inherit" } as const;

interface Row { skuId: string; label: string; name: string; pieces: string; kind: MeasureKind; values: string; source: "" | MeasureSource; location: string; converted: boolean }

function parseValues(text: string): number[] {
  return text.split(/[;/\s]+/).map(s => s.trim().replace(",", ".")).filter(Boolean).map(Number);
}

function skusOf(variantPrices: string | null | undefined): Array<{ skuId: string; label: string }> {
  try {
    const vp = JSON.parse(variantPrices ?? "[]") as Array<{ skuId?: string; attrs?: Record<string, string> }>;
    return vp.filter(v => v.skuId).map(v => ({
      skuId: v.skuId as string,
      label: Object.entries(v.attrs ?? {}).filter(([k]) => !["ships from", "ships_from", "versandland"].includes(k.toLowerCase())).map(([, val]) => val).join(" / ") || (v.skuId as string),
    }));
  } catch { return []; }
}

export function ProductDataPanel({ product, onSaved }: { product: ProductDataFields; onSaved: (patch: Partial<ProductDataFields>) => void }) {
  const skus = useMemo(() => {
    const list = skusOf(product.variantPrices);
    return list.length > 0 ? list : [{ skuId: `stele-${product.id}`, label: "Einzelartikel" }];
  }, [product.variantPrices, product.id]);
  const stored = useMemo(() => readVariantDetails(product.variantDetails), [product.variantDetails]);
  const [material, setMaterial] = useState(product.material ?? "");
  const [usageNote, setUsageNote] = useState(product.usageNote ?? "");
  const [usePurpose, setUsePurpose] = useState(product.usePurpose ?? "");
  const matSrc0 = (() => { try { return product.materialSource ? JSON.parse(product.materialSource) as { source?: MeasureSource; location?: string } : {}; } catch { return {}; } })();
  const [matSource, setMatSource] = useState<"" | MeasureSource>(matSrc0.source ?? "");
  const [matLocation, setMatLocation] = useState(matSrc0.location ?? "");
  const [rows, setRows] = useState<Row[]>(() => skus.map(s => {
    const d = stored?.[s.skuId];
    return {
      skuId: s.skuId, label: s.label, name: d?.displayNameDe ?? "", pieces: d ? String(d.pieces) : "", kind: d?.measure?.kind ?? "D",
      values: d?.measure ? d.measure.values.join(" / ").replace(/\./g, ",") : "", source: d?.measure?.source ?? "", location: d?.measure?.location ?? "", converted: !!d?.measure?.converted,
    };
  }));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const setRow = (i: number, patch: Partial<Row>) => setRows(r => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // Aufbau aus dem Formular: nur Zeilen mit Name; Maß nur wenn Werte vorhanden
  const built = useMemo(() => {
    const details: Record<string, unknown> = {};
    for (const r of rows) {
      const vals = parseValues(r.values);
      const hasMeasure = r.values.trim() !== "";
      if (!r.name.trim() && !hasMeasure) continue;
      details[r.skuId] = {
        displayNameDe: r.name.trim() || r.label, pieces: Number(r.pieces) || 1,
        ...(hasMeasure ? { measure: { kind: r.kind, values: vals, source: r.source, location: r.location, ...(r.converted ? { converted: true } : {}) } } : {}),
      };
    }
    return details;
  }, [rows]);
  const ampel = measureAmpel(built as unknown as VariantDetails, skus.map(s => s.skuId));

  const save = async () => {
    setMsg(null);
    try {
      const r = await fetch(`/api/products/${product.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          material: material || null, usageNote: usageNote || null, usePurpose: usePurpose || null,
          materialSource: material && matSource ? { source: matSource, location: matLocation } : null,
          variantDetails: Object.keys(built).length > 0 ? built : null,
        }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        setMsg({ ok: true, text: "Gespeichert ✓" });
        onSaved({
          material: material || null, usageNote: usageNote || null, usePurpose: usePurpose || null,
          materialSource: material && matSource ? JSON.stringify({ source: matSource, location: matLocation }) : null,
          variantDetails: Object.keys(built).length > 0 ? JSON.stringify(built) : null,
        });
      } else setMsg({ ok: false, text: d.error || "Speichern fehlgeschlagen" });
    } catch { setMsg({ ok: false, text: "Netzwerkfehler beim Speichern" }); }
  };

  const green = ampel.status === "GRUEN";
  return (
    <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: `1px solid ${green ? "#86EFAC" : "#E2E8F0"}`, background: "#F8FAFC", fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: "#475569" }}>📐 Produktdaten (Beschreibung v2)</span>
        <span title="Ampel R8: GRÜN nur, wenn jede Variante ein Maß mit Quelle a–d und Fundstelle hat" style={{ fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: green ? "#DCFCE7" : "#FEF9C3", color: green ? "#166534" : "#A16207" }}>
          R8 {green ? "GRÜN" : "GELB"}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 6, marginTop: 6 }}>
        <label>Material <input value={material} onChange={e => setMaterial(e.target.value)} style={{ ...input, width: "100%" }} /></label>
        <label>Verwendung <input value={usageNote} onChange={e => setUsageNote(e.target.value)} placeholder="einmalig oder mehrfach verwendbar" style={{ ...input, width: "100%" }} /></label>
        <label>Einsatzzweck <input value={usePurpose} onChange={e => setUsePurpose(e.target.value)} placeholder="z. B. Frischhaltehaube, auch als Duschhaube nutzbar" style={{ ...input, width: "100%" }} /></label>
        <div>Quelle Material{" "}
          <select value={matSource} onChange={e => setMatSource(e.target.value as "" | MeasureSource)} style={input}><option value="">–</option>{MEASURE_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}</select>{" "}
          <input value={matLocation} onChange={e => setMatLocation(e.target.value)} placeholder="Fundstelle" style={{ ...input, width: 120 }} />
        </div>
      </div>
      <div style={{ marginTop: 8, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748B" }}>
              <th style={{ padding: "3px 4px" }}>Variante</th><th>Anzeigename (DE)</th><th>Stück</th><th>Art</th><th>Werte (cm)</th><th>Anzeige</th><th>Quelle</th><th>Fundstelle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const shown = r.values.trim() ? formatMeasure({ kind: r.kind, values: parseValues(r.values) }) : null;
              const miss = ampel.missing.find(m => m.skuId === r.skuId);
              return (
                <tr key={r.skuId} style={{ borderTop: "1px solid #E2E8F0" }}>
                  <td style={{ padding: "3px 4px", whiteSpace: "nowrap" }} title={r.skuId}>{r.label}</td>
                  <td><input value={r.name} onChange={e => setRow(i, { name: e.target.value })} style={{ ...input, width: 140 }} /></td>
                  <td><input value={r.pieces} onChange={e => setRow(i, { pieces: e.target.value })} inputMode="numeric" style={{ ...input, width: 44 }} /></td>
                  <td><select value={r.kind} onChange={e => setRow(i, { kind: e.target.value as MeasureKind })} style={input}>{MEASURE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></td>
                  <td><input value={r.values} onChange={e => setRow(i, { values: e.target.value })} placeholder="z. B. 10 / 37" style={{ ...input, width: 100 }} /></td>
                  <td style={{ whiteSpace: "nowrap", fontWeight: 600, color: shown ? "#0F172A" : VIOLET }}>{shown ?? (miss ? miss.reason : "kein Maß gefunden")}</td>
                  <td><select value={r.source} onChange={e => setRow(i, { source: e.target.value as "" | MeasureSource })} style={input}><option value="">–</option>{MEASURE_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}</select></td>
                  <td><input value={r.location} onChange={e => setRow(i, { location: e.target.value })} placeholder="z. B. Galeriebild 4" style={{ ...input, width: 130 }} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!green && ampel.missing.length > 0 && (
        <div style={{ marginTop: 6, color: VIOLET, fontWeight: 600 }}>
          Fehlt: {ampel.missing.map(m => `${m.skuId} (${m.reason})`).join("; ")}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
        <button onClick={save} style={{ padding: "5px 12px", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "none", background: "#FFD700", color: "#0F172A", cursor: "pointer", fontFamily: "inherit" }}>Speichern</button>
        {msg && <span style={{ fontWeight: 600, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</span>}
        <span style={{ color: "#94A3B8" }}>Quelle d gilt nur, wenn der Buchstabe genau so in der Variantenauswahl steht (hier nicht prüfbar → GELB).</span>
      </div>
    </div>
  );
}
