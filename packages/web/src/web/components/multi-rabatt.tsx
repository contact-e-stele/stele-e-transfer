// Multi-Rabatt (Inhaber 18.10.2026): Kasten mit Prozent, Preis je Stück, Gesamtpreis, Ersparnis und Gewinn je Stufe (2 und 3 Stück).
// Rechnung nur in shared/volume-discount.ts. Senden an eBay NUR über den Knopf (Listings-/Produkte-Tab, nur gelistete Angebote).
import { useEffect, useState } from "react";
import type { VolumeDiscountPlan, VolumeDiscountRule } from "../../shared/volume-discount";

const f = (n: number) => n.toFixed(2).replace(".", ",");

let ruleCache: Promise<VolumeDiscountRule | null> | null = null;
/** Euro-Regel aus den Einstellungen (einmal je Seitenaufruf geladen). */
export function useMultiRabattRule(): VolumeDiscountRule | null {
  const [rule, setRule] = useState<VolumeDiscountRule | null>(null);
  useEffect(() => {
    ruleCache ??= fetch("/api/settings/multi-rabatt").then(r => (r.ok ? r.json() : null)).then(d => (d?.value ?? null) as VolumeDiscountRule | null).catch(() => null);
    let alive = true;
    void ruleCache.then(r => { if (alive) setRule(r); });
    return () => { alive = false; };
  }, []);
  return rule;
}

export function MultiRabattTable({ plan, rule }: { plan: VolumeDiscountPlan; rule: VolumeDiscountRule }) {
  const showLabels = plan.tiers[0]?.rows.length > 1 || !!plan.tiers[0]?.rows[0]?.label;
  return (
    <div style={{ fontSize: 11 }}>
      <div style={{ color: "#64748B", marginBottom: 4 }}>
        Regel: 2 Stück {f(rule.eur2)} € billiger, 3 Stück {f(rule.eur3)} € billiger (höchstens 3 Stück). eBay rechnet in ganzen Prozent, gemessen am höchsten Preis{plan.basePrice != null ? ` (${f(plan.basePrice)} €)` : ""}.
      </div>
      {plan.error && <div style={{ color: "#DC2626", fontWeight: 700, marginBottom: 4 }}>Kein Multi-Rabatt möglich: {plan.error}</div>}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr style={{ color: "#64748B", textAlign: "left" }}>
              <th style={{ padding: "2px 4px" }}>Menge</th>
              {showLabels && <th style={{ padding: "2px 4px" }}>Variante</th>}
              <th style={{ padding: "2px 4px" }}>%</th>
              <th style={{ padding: "2px 4px" }}>je Stück</th>
              <th style={{ padding: "2px 4px" }}>gesamt</th>
              <th style={{ padding: "2px 4px" }}>billiger</th>
              <th style={{ padding: "2px 4px" }}>Gewinn</th>
            </tr>
          </thead>
          <tbody>
            {plan.singleRows.map((r, i) => (
              <tr key={`1-${i}`} style={{ color: "#64748B" }}>
                <td style={{ padding: "2px 4px" }}>{i === 0 ? "1 Stück" : ""}</td>
                {showLabels && <td style={{ padding: "2px 4px" }}>{r.label}</td>}
                <td style={{ padding: "2px 4px" }}>0</td><td /><td /><td />
                <td style={{ padding: "2px 4px" }}>{f(r.profit)} €</td>
              </tr>
            ))}
            {plan.tiers.map(t => t.rows.map((r, i) => (
              <tr key={`${t.qty}-${i}`} style={{ color: r.belowFloor ? "#DC2626" : "#0F172A", borderTop: i === 0 ? "1px solid #E2E8F0" : undefined }}>
                <td style={{ padding: "2px 4px", fontWeight: 700 }}>{i === 0 ? `${t.qty} Stück` : ""}</td>
                {showLabels && <td style={{ padding: "2px 4px" }}>{r.label}</td>}
                <td style={{ padding: "2px 4px", fontWeight: 700 }} title={t.reason ?? undefined}>{i === 0 ? `${t.percent}${t.reason ? " *" : ""}` : ""}</td>
                <td style={{ padding: "2px 4px" }}>{f(r.unitPrice)} €</td>
                <td style={{ padding: "2px 4px" }}>{f(r.total)} €</td>
                <td style={{ padding: "2px 4px" }}>−{f(r.saving)} €</td>
                <td style={{ padding: "2px 4px", fontWeight: 700 }}>{f(r.profit)} €</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      {plan.tiers.filter(t => t.reason).map(t => (
        <div key={t.qty} style={{ color: "#CA8A04", marginTop: 2 }}>* {t.qty} Stück: {t.percent} % statt {t.wantedPercent} % — {t.reason}</div>
      ))}
    </div>
  );
}

type Preview = { listingId: string | null; rule: VolumeDiscountRule; plan: VolumeDiscountPlan; sent: { percents: { 2: number; 3: number }; sentAt: string; status: string | null; promotionId: string } | null };

/** Vorschau je gespeichertem Produkt + Knopf "Multi-Rabatt an eBay senden" (nur gelistete Angebote). */
export function MultiRabattPanel({ productId, isLive }: { productId: number; isLive: boolean }) {
  const [data, setData] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/products/${productId}/multi-rabatt`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ ok: false, text: String(d.error ?? "Vorschau fehlgeschlagen") }); return; }
      setData(d as Preview);
    } finally { setBusy(false); }
  };
  const send = async () => {
    if (!data?.plan.percents) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/products/${productId}/multi-rabatt/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ percents: data.plan.percents }) });
      const d = await r.json().catch(() => ({})) as { ok?: boolean; error?: string; verified?: boolean; promotionStatus?: string | null };
      setMsg(d.ok
        ? { ok: !!d.verified, text: d.verified ? `An eBay gesendet und zurückgelesen (Status ${d.promotionStatus ?? "?"}). eBay zeigt den Rabatt ab Startzeit (≈ 5 Min).` : `Gesendet, aber Rücklesen stimmt nicht überein (Status ${d.promotionStatus ?? "?"}) — bitte im Verkäufer-Cockpit prüfen.` }
        : { ok: false, text: d.error ?? "Senden fehlgeschlagen" });
      if (d.ok) await load();
    } finally { setBusy(false); }
  };
  const btn = { fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, border: "1px solid #E2E8F0", cursor: busy ? "wait" : "pointer", fontFamily: "inherit" } as const;
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" disabled={busy} onClick={load} style={{ ...btn, background: "#fff", color: "#64748B" }} title="Rechnet den Multi-Rabatt — sendet nichts">Multi-Rabatt</button>
        {data?.sent && <span style={{ fontSize: 10, color: "#16A34A" }}>bei eBay: {data.sent.percents[2]} % / {data.sent.percents[3]} % (gesendet {data.sent.sentAt.slice(0, 10)})</span>}
      </div>
      {data && (
        <div style={{ marginTop: 4, padding: 6, border: "1px solid #E2E8F0", borderRadius: 8, background: "#F8FAFC" }}>
          <MultiRabattTable plan={data.plan} rule={data.rule} />
          {isLive && data.listingId && data.plan.ok && (
            <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" disabled={busy} onClick={send} style={{ ...btn, background: "#16A34A", color: "#fff", border: "none" }}>
                {busy ? "Sende …" : `Multi-Rabatt an eBay senden (${data.plan.percents![2]} % / ${data.plan.percents![3]} %)`}
              </button>
              <button type="button" disabled={busy} onClick={() => setData(null)} style={{ ...btn, background: "#fff", color: "#64748B" }}>Schließen</button>
            </div>
          )}
          {!isLive && <div style={{ marginTop: 4, color: "#64748B", fontSize: 10 }}>Senden erst, wenn das Produkt bei eBay gelistet ist (Listings-Tab).</div>}
        </div>
      )}
      {msg && <div style={{ fontSize: 10, marginTop: 2, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</div>}
    </div>
  );
}
