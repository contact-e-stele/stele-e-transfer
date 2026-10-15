// K-011: eBay-Preise je Angebot prüfen (Käuferpreis ↔ Angebotsdaten ↔ App), Warnung "eBay-Preise uneinheitlich" + Sperre anzeigen,
// "Angebotsdaten an Käuferpreis angleichen" (nur auf Klick, mit Vorschau) und "App-Preise aus eBay übernehmen" (nur App-Datenbank).
import { useState, useSyncExternalStore } from "react";
import type { PriceLocks } from "../../shared/ebay-buyer-price";

let locks: PriceLocks = {};
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
function loadLocks(force = false) {
  if (inflight && !force) return inflight;
  inflight = fetch("/api/ebay-price-locks").then(r => (r.ok ? r.json() : null))
    .then((d: { locks?: PriceLocks } | null) => { locks = d?.locks ?? {}; loaded = true; for (const l of listeners) l(); })
    .catch(() => { loaded = true; });
  return inflight;
}
function useLocks(): PriceLocks {
  return useSyncExternalStore(l => { listeners.add(l); if (!loaded) void loadLocks(); return () => listeners.delete(l); }, () => locks);
}

interface Row { sku: string; label: string; ebayPrice: number | null; offerPrice?: number | null; appPrice: number | null; error?: string }
const f = (n: number | null | undefined) => (n == null ? "–" : n.toFixed(2).replace(".", ","));
const btn = (bg: string, color: string) => ({ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, border: "1px solid #E2E8F0", background: bg, color, cursor: "pointer", fontFamily: "inherit" } as const);

export function EbayPriceCheck({ productId, onAppPricesChanged }: { productId: number; onAppPricesChanged?: () => void }) {
  const all = useLocks();
  const lock = all[String(productId)];
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [alignPreview, setAlignPreview] = useState<Array<{ sku: string; buyerPrice: number; offerPrice: number | null }> | null>(null);

  const call = async (url: string, body: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: r.ok, data: await r.json().catch(() => ({})) as Record<string, unknown> };
  };
  const check = async () => {
    setBusy(true); setMsg(null);
    try {
      const { ok, data } = await call(`/api/products/${productId}/sell-prices-from-ebay`, {});
      if (!ok) { setMsg({ ok: false, text: String(data.error ?? "Prüfen fehlgeschlagen") }); return; }
      setRows((data.rows as Row[]) ?? []);
      setMsg({ ok: !data.locked, text: data.locked ? "eBay-Preise uneinheitlich — Preis-Sendungen für dieses Angebot gesperrt" : "Käuferpreis und Angebotsdaten stimmen überein" });
      await loadLocks(true);
    } finally { setBusy(false); }
  };
  const previewAlign = async () => {
    setBusy(true); setMsg(null);
    try {
      const { ok, data } = await call(`/api/products/${productId}/align-offers-to-buyer-price`, {});
      if (!ok) { setMsg({ ok: false, text: String(data.error ?? "Vorschau fehlgeschlagen") }); return; }
      setAlignPreview((data.willAlign as Array<{ sku: string; buyerPrice: number; offerPrice: number | null }>) ?? []);
    } finally { setBusy(false); }
  };
  const doAlign = async () => {
    setBusy(true); setMsg(null);
    try {
      const { ok, data } = await call(`/api/products/${productId}/align-offers-to-buyer-price`, { confirm: true });
      setAlignPreview(null);
      setMsg(ok && !data.locked ? { ok: true, text: "Angebotsdaten angeglichen — beide Preise gleich, Sperre aufgehoben" } : { ok: false, text: String(data.error ?? "Noch nicht gleich — Sperre bleibt") });
      await loadLocks(true);
    } finally { setBusy(false); }
  };
  const takeOver = async () => {
    setBusy(true); setMsg(null);
    try {
      const { ok, data } = await call(`/api/products/${productId}/sell-prices-from-ebay`, { apply: true, confirm: true });
      const changed = (data.changed as Array<unknown> | undefined)?.length ?? 0;
      setMsg(ok ? { ok: true, text: `App-Preise aus eBay-Käuferpreis übernommen (${changed} geändert, nichts an eBay gesendet)` } : { ok: false, text: String(data.error ?? "Übernehmen fehlgeschlagen") });
      if (ok) onAppPricesChanged?.();
    } finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {lock && (
          <span title={lock.rows.map(r => `${r.label || r.sku}: Käufer ${f(r.buyerPrice)} · Angebotsdaten ${f(r.offerPrice)}`).join("\n")}
            style={{ fontSize: 11, background: "#FEF2F2", color: "#B91C1C", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>
            ⚠ eBay-Preise uneinheitlich — Senden gesperrt
          </span>
        )}
        <button type="button" disabled={busy} onClick={check} style={btn("#fff", "#64748B")} title="Liest bei eBay Käuferpreis und Angebotsdaten je Variante (nur lesen)">eBay-Preise prüfen</button>
        {lock && <button type="button" disabled={busy} onClick={previewAlign} style={btn("#FFFBEB", "#92400E")}>Angleichen (Vorschau)</button>}
        {rows && <button type="button" disabled={busy} onClick={takeOver} style={btn("#F0FDF4", "#16A34A")} title="Setzt nur die App-Preise auf den eBay-Käuferpreis — sendet nichts an eBay">App-Preise übernehmen</button>}
      </div>
      {msg && <div style={{ fontSize: 11, fontWeight: 600, color: msg.ok ? "#16A34A" : "#DC2626", marginTop: 2 }}>{msg.text}</div>}
      {rows && rows.length > 0 && (
        <table style={{ fontSize: 10, marginTop: 2, borderCollapse: "collapse" }}>
          <thead><tr style={{ color: "#64748B", textAlign: "right" }}><th style={{ textAlign: "left" }}>Variante</th><th>Käufer</th><th>Angebotsdaten</th><th>App</th></tr></thead>
          <tbody>{rows.map((r, i) => {
            const bad = r.ebayPrice != null && r.offerPrice != null && Math.abs(r.ebayPrice - r.offerPrice) > 0.01;
            return <tr key={i} style={{ textAlign: "right", color: bad ? "#B91C1C" : "#0F172A" }}>
              <td style={{ textAlign: "left", paddingRight: 6 }}>{r.label || r.sku}</td><td>{f(r.ebayPrice)}</td><td>{f(r.offerPrice)}</td><td>{f(r.appPrice)}</td></tr>;
          })}</tbody>
        </table>
      )}
      {alignPreview && (
        <div style={{ marginTop: 4, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "6px 8px", fontSize: 11 }}>
          {alignPreview.length === 0 ? "Nichts anzugleichen." : <>
            {alignPreview.map((r, i) => <div key={i}>{r.sku}: Angebotsdaten {f(r.offerPrice)} → <strong>{f(r.buyerPrice)}</strong> (= Käuferpreis, für Käufer keine Änderung)</div>)}
            <button type="button" disabled={busy} onClick={doAlign} style={{ ...btn("#16A34A", "#fff"), marginTop: 4, border: "none" }}>Angebotsdaten jetzt angleichen</button>
          </>}
          <button type="button" disabled={busy} onClick={() => setAlignPreview(null)} style={{ ...btn("#fff", "#64748B"), marginLeft: 6 }}>Abbrechen</button>
        </div>
      )}
    </div>
  );
}
