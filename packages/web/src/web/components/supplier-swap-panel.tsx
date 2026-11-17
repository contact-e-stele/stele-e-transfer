// 050 P2: „Lieferant tauschen“ im Produkte-Tab. Neue AliExpress-Nummer → Vorschau (nur lesen) → Varianten zuordnen →
// Tauschen (schreibt nur die App). Das eBay-Angebot bleibt. Varianten ohne Gegenstück → Lager 0; danach „Mengen an eBay“.
import { useState } from "react";

type Opt = { skuId: string; label: string; price: number; stock: number | null };
type Row = { oldSkuId: string; newSkuId: string | null; label: string; ekAlt: number; ekNeu: number | null; lagerNeu: number; vk: number | null; gewinnAlt: number | null; gewinnNeu: number | null };
type Preview = {
  itemId: string; title: string; rating: number | null; reviewCount: number | null; shipsFromAlt: string | null; shipsFromNeu: string | null; gleicheHerkunft: boolean;
  alt: Opt[]; neu: Opt[]; vorschlag: Record<string, string | null>; vorschau: Row[]; fehler: string[];
};

const eur = (n: number | null | undefined) => (n == null ? "–" : `${n.toFixed(2)} €`);
const btn = { padding: "6px 10px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#F8FAFC", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" } as const;

export function SupplierSwapPanel({ product, onSaved }: {
  product: { id: number; aliexpressItemId?: string | null; ebayStatus?: string | null };
  onSaved: (patch: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState("");
  const [busy, setBusy] = useState(false);
  const [pv, setPv] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [done, setDone] = useState(false);

  const laden = async () => {
    setBusy(true); setMsg(null); setPv(null); setRows(null); setDone(false);
    try {
      const r = await fetch(`/api/products/${product.id}/supplier-swap?item=${encodeURIComponent(item.trim())}`);
      const j = await r.json();
      if (!r.ok) { setMsg({ text: j.error ?? `HTTP ${r.status}`, ok: false }); return; }
      setPv(j); setMapping(j.vorschlag ?? {}); setRows(j.vorschau ?? []); setErrors(j.fehler ?? []);
    } finally { setBusy(false); }
  };
  const post = async (mode: "preview" | "apply") => {
    if (!pv) return null;
    const r = await fetch(`/api/products/${product.id}/supplier-swap`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: pv.itemId, mapping, mode, ...(mode === "apply" ? { confirm: true } : {}) }),
    });
    return { ok: r.ok, j: await r.json().catch(() => ({ error: `HTTP ${r.status}` })) };
  };
  const neuRechnen = async (next: Record<string, string | null>) => {
    setMapping(next); setBusy(true);
    try {
      const r = await fetch(`/api/products/${product.id}/supplier-swap`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: pv?.itemId, mapping: next, mode: "preview" }),
      });
      const j = await r.json().catch(() => ({}));
      setRows(j.vorschau ?? null); setErrors(j.fehler ?? (j.error ? [j.error] : []));
    } finally { setBusy(false); }
  };
  const tauschen = async () => {
    if (!pv) return;
    if (!window.confirm(`Lieferant von stele-${product.id} auf ${pv.itemId} tauschen? Das eBay-Angebot bleibt; Einkaufspreise und Lager kommen danach vom neuen Angebot.`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await post("apply");
      if (!res?.ok || !res.j.gespeichert) { setMsg({ text: (res?.j.fehler ?? []).join(" · ") || res?.j.error || "nicht gespeichert", ok: false }); return; }
      const ohne: string[] = res.j.ohneGegenstueck ?? [];
      setMsg({ text: `Getauscht: ${res.j.altItemId ?? "–"} → ${res.j.itemId}.${ohne.length ? ` Lager 0: ${ohne.join(", ")}.` : ""}${product.ebayStatus === "listed" ? " Jetzt „Mengen an eBay“ senden." : ""}`, ok: true });
      setDone(true);
      const fresh = await fetch("/api/products").then(x => x.json()).catch(() => null);
      const list = Array.isArray(fresh) ? fresh : (fresh?.products ?? []);
      const p = list.find((x: { id: number }) => x.id === product.id);
      if (p) onSaved({ aliexpressItemId: p.aliexpressItemId, sourceUrl: p.sourceUrl, variantPrices: p.variantPrices, variantSellPrices: p.variantSellPrices, aliCheckoutFactor: p.aliCheckoutFactor });
    } finally { setBusy(false); }
  };
  const mengen = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/products/${product.id}/sync-quantities`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: true }) });
      const j = await r.json().catch(() => ({}));
      setMsg({ text: r.ok ? "Mengen an eBay gesendet." : `Mengen: ${j.error ?? r.status}`, ok: r.ok });
    } finally { setBusy(false); }
  };

  if (!open) return <button style={{ ...btn, marginTop: 8 }} onClick={() => setOpen(true)}>Lieferant tauschen</button>;
  return (
    <div style={{ marginTop: 8, padding: 10, border: "1px solid #E2E8F0", borderRadius: 10, background: "#FFFFFF" }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Lieferant tauschen (heute: {product.aliexpressItemId ?? "–"})</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input value={item} onChange={e => setItem(e.currentTarget.value)} placeholder="AliExpress-Nummer oder Link"
          style={{ flex: 1, minWidth: 180, padding: "5px 8px", border: "1px solid #CBD5E1", borderRadius: 6, fontFamily: "inherit", fontSize: 12 }} />
        <button style={btn} disabled={busy || !item.trim()} onClick={laden}>Vorschau laden</button>
      </div>
      {pv && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ color: "#475569" }}>{pv.title}{pv.rating != null ? ` · ${pv.rating} ★` : ""}{pv.reviewCount != null ? ` (${pv.reviewCount})` : ""}</div>
          {!pv.gleicheHerkunft && <div style={{ color: "#DC2626", fontWeight: 700 }}>Andere Herkunft: {pv.shipsFromAlt ?? "China"} → {pv.shipsFromNeu ?? "China"} — Tausch hier gesperrt.</div>}
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 6 }}>
            <thead><tr style={{ color: "#64748B" }}>
              <th style={{ textAlign: "left", padding: 4 }}>Variante (eBay)</th><th style={{ textAlign: "left", padding: 4 }}>neue Variante</th>
              <th style={{ textAlign: "right", padding: 4 }}>EK alt → neu</th><th style={{ textAlign: "right", padding: 4 }}>Lager</th>
              <th style={{ textAlign: "right", padding: 4 }}>VK</th><th style={{ textAlign: "right", padding: 4 }}>Gewinn alt → neu</th>
            </tr></thead>
            <tbody>
              {(rows ?? []).map(r => (
                <tr key={r.oldSkuId} style={{ borderTop: "1px solid #F1F5F9" }}>
                  <td style={{ padding: 4 }}>{r.label}</td>
                  <td style={{ padding: 4 }}>
                    <select value={mapping[r.oldSkuId] ?? ""} disabled={busy || done}
                      onChange={e => neuRechnen({ ...mapping, [r.oldSkuId]: e.currentTarget.value || null })}
                      style={{ maxWidth: 200, fontFamily: "inherit", fontSize: 12 }}>
                      <option value="">— kein Gegenstück (Lager 0) —</option>
                      {pv.neu.map(n => <option key={n.skuId} value={n.skuId}>{n.label} · {eur(n.price)} · Lager {n.stock ?? "–"}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: 4, textAlign: "right" }}>{eur(r.ekAlt)} → {eur(r.ekNeu)}</td>
                  <td style={{ padding: 4, textAlign: "right", color: r.lagerNeu === 0 ? "#DC2626" : undefined }}>{r.lagerNeu}</td>
                  <td style={{ padding: 4, textAlign: "right" }}>{eur(r.vk)}</td>
                  <td style={{ padding: 4, textAlign: "right", fontWeight: 700, color: r.gewinnNeu == null ? "#94A3B8" : r.gewinnNeu < 1 ? "#DC2626" : "#16A34A" }}>
                    {eur(r.gewinnAlt)} → {eur(r.gewinnNeu)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {errors.length > 0 && <div style={{ color: "#DC2626", marginTop: 4 }}>{errors.join(" · ")}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button style={{ ...btn, background: "#FFD700", border: "none" }} disabled={busy || done || errors.length > 0 || !pv.gleicheHerkunft} onClick={tauschen}>Lieferant tauschen</button>
            {done && product.ebayStatus === "listed" && <button style={btn} disabled={busy} onClick={mengen}>Mengen an eBay</button>}
          </div>
          <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>Gewinn „neu“ ohne Kassen-Faktor (der gilt nur für den alten Lieferanten). Verkaufspreise bleiben; eBay-Angebot bleibt.</div>
        </div>
      )}
      {msg && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</div>}
    </div>
  );
}
