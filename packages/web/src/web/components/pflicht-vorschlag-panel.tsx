// 050 P4: Pflicht-Daten-Vorschlag statt Stopp (Produkte-Tab). Gelb = Vorschlag mit Quelle; „Übernehmen“ speichert mit einem Klick.
// Material → pflichtDaten.material mit Quelle e (eBay-Konkurrenzangebote, mind. 2 gleiche Angaben). Hersteller-PLZ → gpsrMfrCity.
// Maße (Inhaber 17.11. 19:39 „ja“): mit Quelle e in pflichtDaten.masse — nur bei EINER Einheit, sonst Hinweis. A-045-variantDetails bleiben a–d.
import { useState } from "react";

type Vorschlag = { feld: "material" | "masse"; wert: string; aspekt: string; quellen: string[] };
type Antwort = { masseSpeicherbar: { key: string; measure: Record<string, unknown> } | null; fehlt: { material: boolean; masse: boolean }; plz: { wert: string; quelle: string; fundstelle: string } | null; vorschlaege: Vorschlag[]; konkurrenz: Array<{ itemId: string; title: string }>; ebayFehler: string | null };

const gelb = { background: "#FEF9C3", border: "1px solid #FDE68A", borderRadius: 8, padding: "6px 8px", marginTop: 6, fontSize: 12 } as const;
const btn = { padding: "4px 8px", borderRadius: 6, border: "none", background: "#FFD700", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit", marginLeft: 6 } as const;

export function PflichtVorschlagPanel({ product, onSaved }: {
  product: { id: number; pflichtDaten?: string | null; gpsrMfrCity?: string | null };
  onSaved: (patch: Record<string, unknown>) => void;
}) {
  const [a, setA] = useState<Antwort | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const laden = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/products/${product.id}/pflicht-vorschlag`);
      const j = await r.json();
      if (!r.ok) setMsg({ text: j.error ?? `HTTP ${r.status}`, ok: false }); else setA(j);
    } finally { setBusy(false); }
  };
  const patch = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/products/${product.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ text: j.error ?? `HTTP ${r.status}`, ok: false }); return; }
      setMsg({ text: done, ok: true });
      onSaved(body.pflichtDaten !== undefined ? { pflichtDaten: JSON.stringify(body.pflichtDaten) } : body);
    } finally { setBusy(false); }
  };
  const materialUebernehmen = (v: Vorschlag) => {
    let stored: Record<string, unknown> = {};
    try { stored = product.pflichtDaten ? JSON.parse(product.pflichtDaten) : {}; } catch { stored = {}; }
    const location = `eBay-Angebote ${v.quellen.join(", ")}`.slice(0, 200);
    return patch({ pflichtDaten: { ...stored, material: { value: v.wert, source: "e", location, wording: `${v.aspekt}: ${v.wert}` } } }, `Material „${v.wert}“ übernommen (Quelle e).`);
  };

  const masseUebernehmen = (m: { key: string; measure: Record<string, unknown> }) => {
    let stored: Record<string, unknown> = {};
    try { stored = product.pflichtDaten ? JSON.parse(product.pflichtDaten) : {}; } catch { stored = {}; }
    const masse = { ...((stored.masse as Record<string, unknown>) ?? {}), [m.key]: m.measure };
    return patch({ pflichtDaten: { ...stored, masse } }, `Maße „${String(m.measure.text ?? "")}“ übernommen (Quelle e).`);
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button onClick={laden} disabled={busy}
        style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#F8FAFC", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
        Vorschläge für fehlende Pflicht-Daten
      </button>
      {a && (
        <div>
          {!a.fehlt.material && !a.fehlt.masse && !a.plz && <div style={{ fontSize: 11, color: "#16A34A", marginTop: 4 }}>Nichts fehlt — kein Vorschlag nötig.</div>}
          {a.plz && (
            <div style={gelb}>
              <b>Hersteller PLZ + Stadt:</b> {a.plz.wert}
              <button style={btn} disabled={busy} onClick={() => patch({ gpsrMfrCity: a.plz!.wert }, `Hersteller „${a.plz!.wert}“ übernommen.`)}>Übernehmen</button>
              <div style={{ fontSize: 10, color: "#92400E" }}>Quelle: {a.plz.quelle} · {a.plz.fundstelle}</div>
            </div>
          )}
          {a.vorschlaege.map(v => (
            <div key={v.feld} style={gelb}>
              <b>{v.feld === "material" ? "Material" : "Maße"}:</b> {v.wert}
              {v.feld === "material"
                ? <button style={btn} disabled={busy} onClick={() => materialUebernehmen(v)}>Übernehmen</button>
                : a.masseSpeicherbar
                  ? <button style={btn} disabled={busy} onClick={() => masseUebernehmen(a.masseSpeicherbar!)}>Übernehmen</button>
                  : <span style={{ fontSize: 10, color: "#92400E", marginLeft: 6 }}>(nur Hinweis — mehrere Varianten oder Maß nicht lesbar; bitte je Variante eintragen)</span>}
              <div style={{ fontSize: 10, color: "#92400E" }}>Quelle: eBay-Merkmal „{v.aspekt}“ in {v.quellen.length} Angeboten: {v.quellen.map(q => <a key={q} href={`https://www.ebay.de/itm/${q}`} target="_blank" rel="noreferrer" style={{ marginRight: 4 }}>{q}</a>)}</div>
            </div>
          ))}
          {(a.fehlt.material || a.fehlt.masse) && a.vorschlaege.length === 0 && (
            <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>
              Kein Vorschlag: in {a.konkurrenz.length} eBay-Angeboten keine Angabe, die mindestens 2× gleich vorkommt.{a.ebayFehler ? ` (eBay: ${a.ebayFehler})` : ""}
            </div>
          )}
        </div>
      )}
      {msg && <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</div>}
    </div>
  );
}
