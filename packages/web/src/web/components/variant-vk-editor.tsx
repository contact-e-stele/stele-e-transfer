// 050 P1: Verkaufspreis je Variante im Produkte-Tab von Hand setzen.
// Ablauf: Eingabe → Gewinn live (productProfitRows, dieselbe Rechnung wie „Erwartet“/Preiswächter), Warnung < 0,50 € →
// „Prüfen“ (POST /products/variant-reprice mode:'preview', je Richtung) → „Speichern & an eBay senden“ (mode:'apply', confirm, sendToEbay
// wenn gelistet). Danach wird jeder gesetzte Preis per „Preis halten“ (K-008) als neue Untergrenze gesichert: Auto-Senken und Preisprüfung
// ändern ihn nicht, außer der Gewinn fällt unter 0,90 € (Sicherheitsnetz aus K-008).
import { useMemo, useState } from "react";
import type { ProfitProduct } from "../../shared/target-margin-bulk";
import { parseVkInput, planManualVk, splitByDirection, MANUAL_VK_WARN_PROFIT_EUR } from "../../shared/variant-vk-edit";

type ResultRow = { skuId: string; label: string; neu: number; status: string; grund?: string; hinweis?: string; ergebnis?: string; ebay?: number | null; ebayGleichApp?: boolean };
type RepriceResult = { status: string; rows: ResultRow[]; error?: string };

const eur = (n: number | null | undefined) => (n == null ? "–" : `${n.toFixed(2)} €`);

export function VariantVkEditor({ product, onSaved }: {
  product: ProfitProduct & { id: number; ebayStatus?: string | null };
  onSaved: (patch: { variantSellPrices?: string | null }) => void;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [checked, setChecked] = useState<ResultRow[] | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const edited = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [sku, t] of Object.entries(inputs)) { const v = parseVkInput(t); if (v != null) out[sku] = v; }
    return out;
  }, [inputs]);
  const rows = useMemo(() => planManualVk(product, edited), [product, edited]);
  if (rows.length === 0) return null;
  const invalid = Object.entries(inputs).some(([, t]) => t.trim() !== "" && parseVkInput(t) == null);
  const { up, down } = splitByDirection(rows);
  const changes = Object.keys(up).length + Object.keys(down).length;
  const live = product.ebayStatus === "listed";

  const call = async (direction: "up" | "down", prices: Record<string, number>, mode: "preview" | "apply"): Promise<RepriceResult> => {
    const res = await fetch("/api/products/variant-reprice", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId: product.id, mode, direction, prices, ...(mode === "apply" ? { confirm: true, sendToEbay: live } : {}) }),
    });
    const j = await res.json().catch(() => ({ status: "error", rows: [], error: `HTTP ${res.status}` }));
    return { status: j.status ?? "error", rows: Array.isArray(j.rows) ? j.rows : [], error: j.error };
  };
  const both = async (mode: "preview" | "apply") => {
    const out: RepriceResult[] = [];
    if (Object.keys(up).length) out.push(await call("up", up, mode));
    if (Object.keys(down).length) out.push(await call("down", down, mode));
    return out;
  };

  const pruefen = async () => {
    setBusy(true); setMsg(null);
    try {
      const res = await both("preview");
      const r = res.flatMap(x => x.rows);
      setChecked(r);
      const errors = res.filter(x => x.error).map(x => x.error);
      setMsg(errors.length ? { text: errors.join(" · "), ok: false } : { text: `${r.filter(x => x.status === "ok").length} von ${changes} Preisen erfüllen die Regeln.`, ok: true });
    } finally { setBusy(false); }
  };

  const speichern = async () => {
    setBusy(true); setMsg(null);
    try {
      // „Preis halten“ der geänderten Varianten kurz lösen — sonst lehnt variant-reprice sie als „gehalten“ ab.
      for (const sku of [...Object.keys(up), ...Object.keys(down)]) {
        await fetch("/api/price-holds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product.id, skuId: sku, hold: false }) });
      }
      const res = await both("apply");
      const r = res.flatMap(x => x.rows);
      const gesetzt = r.filter(x => x.ergebnis === "gesetzt");
      // Neue Untergrenze: gesetzte Preise halten (K-008).
      const holdFail: string[] = [];
      for (const x of gesetzt) {
        const h = await fetch("/api/price-holds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: product.id, skuId: x.skuId, hold: true, note: "050 P1: manuell gesetzt (Untergrenze)" }) });
        if (!h.ok) holdFail.push(`${x.label}: ${(await h.json().catch(() => ({}))).error ?? h.status}`);
      }
      setChecked(r);
      const errors = res.filter(x => x.error).map(x => x.error as string);
      const mismatch = gesetzt.filter(x => x.ebayGleichApp === false).map(x => x.label);
      const parts = [`${gesetzt.length} von ${changes} gesetzt${live ? " und an eBay gesendet" : " (nicht gelistet – nur gespeichert)"}`];
      if (mismatch.length) parts.push(`eBay ≠ App bei: ${mismatch.join(", ")}`);
      if (holdFail.length) parts.push(`nicht als Untergrenze gehalten: ${holdFail.join("; ")}`);
      if (errors.length) parts.push(errors.join(" · "));
      setMsg({ text: parts.join(" · "), ok: errors.length === 0 && mismatch.length === 0 && gesetzt.length === changes });
      const fresh = await fetch("/api/products").then(x => x.json()).catch(() => null);
      const list = Array.isArray(fresh) ? fresh : (fresh?.products ?? []);
      const p = list.find((x: { id: number }) => x.id === product.id);
      if (p) onSaved({ variantSellPrices: p.variantSellPrices ?? null });
      if (gesetzt.length === changes) setInputs({});
    } finally { setBusy(false); }
  };

  const checkedBySku = new Map((checked ?? []).map(x => [x.skuId, x]));
  return (
    <div style={{ marginTop: 8, padding: 10, border: "1px solid #E2E8F0", borderRadius: 10, background: "#FFFFFF" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>Verkaufspreis je Variante (von Hand)</div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: "#64748B" }}>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>Variante</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>VK heute</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>VK neu</th>
            <th style={{ textAlign: "right", padding: "4px 6px" }}>Gewinn neu</th>
            <th style={{ textAlign: "left", padding: "4px 6px" }}>Prüfung</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const c = checkedBySku.get(r.skuId);
            return (
              <tr key={r.skuId} style={{ borderTop: "1px solid #F1F5F9" }}>
                <td style={{ padding: "4px 6px" }}>{r.label}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>{eur(r.alt)}</td>
                <td style={{ padding: "4px 6px", textAlign: "right" }}>
                  <input inputMode="decimal" value={inputs[r.skuId] ?? ""} placeholder={r.alt.toFixed(2)}
                    onChange={e => { const v = e.currentTarget.value; setInputs(prev => ({ ...prev, [r.skuId]: v })); setChecked(null); }}
                    style={{ width: 70, textAlign: "right", padding: "3px 5px", border: "1px solid #CBD5E1", borderRadius: 6, fontFamily: "inherit" }} />
                </td>
                <td style={{ padding: "4px 6px", textAlign: "right", fontWeight: 700, color: r.warnung ? "#DC2626" : "#16A34A" }}
                  title={r.warnung ? `Gewinn unter ${MANUAL_VK_WARN_PROFIT_EUR.toFixed(2)} €` : undefined}>
                  {r.gewinnNeu >= 0 ? "+" : ""}{r.gewinnNeu.toFixed(2)} €{r.warnung ? " ⚠" : ""}
                </td>
                <td style={{ padding: "4px 6px", fontSize: 11, color: c ? (c.status === "ok" ? "#16A34A" : "#DC2626") : "#94A3B8" }}>
                  {c ? (c.ergebnis ?? (c.status === "ok" ? "ok" : c.status)) + (c.grund ? ` – ${c.grund}` : "") + (c.hinweis ? ` – ${c.hinweis}` : "") + (c.ebay != null ? ` · eBay ${eur(c.ebay)}` : "") : (r.geaendert ? "noch nicht geprüft" : "")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button disabled={busy || invalid || changes === 0} onClick={pruefen}
          style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#F8FAFC", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          Prüfen
        </button>
        <button disabled={busy || invalid || changes === 0 || !checked} onClick={speichern}
          style={{ padding: "6px 10px", borderRadius: 8, border: "none", background: "#FFD700", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
          {live ? "Speichern & an eBay senden" : "Speichern"} ({changes})
        </button>
        {invalid && <span style={{ fontSize: 11, color: "#DC2626" }}>Preis mit höchstens 2 Nachkommastellen eingeben</span>}
      </div>
      {msg && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</div>}
      <div style={{ marginTop: 4, fontSize: 10, color: "#94A3B8" }}>
        Regeln wie „Auswahl senken/anheben“: Senken höchstens 8 % und Gewinn ≥ max(1,00 €; Ziel), Anheben höchstens 15 %. Gesetzte Preise werden gehalten (Untergrenze).
      </div>
    </div>
  );
}
