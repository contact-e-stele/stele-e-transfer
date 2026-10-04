// Produkte-Tab UND Listings-Tab zeigen dieselbe Anzeige: "Ziel <Stufe> · Erwartet <echter Gewinn beim gesetzten VK nach Formel v2>"
// je Produkt und je Variante (gelb: Erwartet < Ziel, rot: Erwartet < Boden) plus die Stufen-Knöpfe A–D. Gewinn-Zeilen aus
// shared/target-margin-bulk.ts (productProfitRows).
//
// A-017: Ein Stufenwechsel zieht die Verkaufspreise mit (POST /api/products/tier-reprice, Formel v2, EINE Rechenstelle):
//  - nicht live gelistet: neue VK je Variante (variant_sell_prices) bzw. sellPrice werden sofort in der App gespeichert.
//  - live gelistet: zuerst nur eine VORSCHAU (alt → neu, Gewinn alt/neu). Gesendet wird erst auf den Knopf "Preise an eBay senden"
//    (Senken eingeschlossen) — kein automatisches Senden. Alternativ "Nur Ziel setzen" (keine Preise), oder Abbrechen.
import { useState } from "react";
import { MARGIN_TIERS } from "../../shared/constants";
import { evaluateTargetDisplay } from "../../shared/pricing";
import { productProfitRows, productTarget, type ProfitProduct } from "../../shared/target-margin-bulk";
import { expectedFromPlan, type TierPlan } from "../../shared/tier-reprice";

export const TARGET_LEVEL_STYLE = {
  ok: { bg: "#F0FDF4", color: "#16A34A" },
  yellow: { bg: "#FEF9C3", color: "#A16207" },
  red: { bg: "#FEF2F2", color: "#DC2626" },
} as const;

export interface TierPatch { variantSellPrices?: string; sellPrice?: number }

export interface RepriceResult {
  productId: number; title?: string; isLive?: boolean; status: "preview" | "stored" | "sent" | "send_failed" | "sent_not_stored" | "error" | "rejected" | "not_found";
  plan?: TierPlan; error?: string; sentCount?: number; stored?: { targetMarginEur: number } & TierPatch;
}

// Ein Aufruf = max. 10 Produkte (Server-Grenze). Der Listings-Tab teilt größere Mengen selbst in Chargen.
export async function postTierReprice(body: Record<string, unknown>): Promise<{ results?: RepriceResult[]; error?: string }> {
  try {
    const res = await fetch("/api/products/tier-reprice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json() as { results?: RepriceResult[]; error?: string };
    if (!res.ok || !data.results) return { error: data.error ?? "Stufenwechsel fehlgeschlagen" };
    return { results: data.results };
  } catch (e) { return { error: String(e) }; }
}

async function callTierReprice(body: Record<string, unknown>): Promise<{ result?: RepriceResult; error?: string }> {
  const r = await postTierReprice(body);
  if (!r.results?.[0]) return { error: r.error ?? "Stufenwechsel fehlgeschlagen" };
  return { result: r.results[0] };
}

const fmt = (n: number) => n.toFixed(2).replace(".", ",");

export function TargetBadge({ product, isLive, onChange }: {
  product: ProfitProduct;
  isLive: boolean;                       // live bei eBay gelistet → Vorschau + ausdrücklicher Sendeknopf
  onChange: (targetMarginEur: number, patch?: TierPatch) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ tier: number; plan: TierPlan } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const target = productTarget(product);
  const { rows, isVariant } = productProfitRows(product);

  const worst = rows.length > 0 ? Math.min(...rows.map(r => r.profit)) : null;
  const display = worst != null ? evaluateTargetDisplay(target, worst) : null;
  const style = display ? TARGET_LEVEL_STYLE[display.level] : null;
  const knownTier = MARGIN_TIERS.some(t => Math.abs(t.targetEur - target) < 0.005);

  const setTargetOnly = async (t: number) => {
    const res = await fetch(`/api/products/${product.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetMarginEur: t }),
    });
    if (!res.ok) { setMsg({ ok: false, text: "Ziel konnte nicht gespeichert werden" }); return false; }
    onChange(t);
    return true;
  };

  const choose = async (t: number) => {
    if (busy || Math.abs(t - target) < 0.005) return;
    setBusy(true); setMsg(null); setPending(null);
    try {
      const prev = await callTierReprice({ productIds: [product.id], targetMarginEur: t, mode: "preview" });
      const plan = prev.result?.plan;
      if (!plan) { setMsg({ ok: false, text: prev.error ?? "Keine Vorschau möglich" }); return; }
      if (!isLive) {
        // Nicht live: neue Preise sofort in der App speichern (kein eBay-Aufruf).
        const r = await callTierReprice({ productIds: [product.id], targetMarginEur: t, mode: "apply", confirm: true, sendToEbay: false });
        if (r.result?.status !== "stored" || !r.result.stored) { setMsg({ ok: false, text: r.result?.error ?? r.error ?? "Preise konnten nicht gespeichert werden" }); return; }
        const { variantSellPrices, sellPrice } = r.result.stored;
        onChange(t, { variantSellPrices, sellPrice });
        setMsg({ ok: true, text: `Stufe gesetzt, ${plan.rows.length} ${plan.isVariant ? "Varianten-" : ""}Preis(e) nach Formel v2 neu berechnet.` });
        return;
      }
      if (plan.changedCount === 0) {
        if (await setTargetOnly(t)) setMsg({ ok: true, text: "Stufe gesetzt — die Preise bleiben unverändert (schon passend)." });
        return;
      }
      setPending({ tier: t, plan }); // live + Preisänderung: Vorschau, Senden nur auf Knopfdruck
    } finally { setBusy(false); }
  };

  const sendToEbay = async () => {
    if (!pending || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await callTierReprice({ productIds: [product.id], targetMarginEur: pending.tier, mode: "apply", confirm: true, sendToEbay: true,
        expected: { [String(product.id)]: expectedFromPlan(pending.plan) }, // nur senden, was in der Vorschau bestätigt wurde
      });
      const res = r.result;
      if (res?.status === "sent" && res.stored) {
        onChange(pending.tier, { variantSellPrices: res.stored.variantSellPrices, sellPrice: res.stored.sellPrice });
        setMsg({ ok: true, text: `Stufe gesetzt, ${res.sentCount ?? 0} Preis(e) an eBay gesendet.` });
        setPending(null);
      } else {
        setMsg({ ok: false, text: res?.error ?? r.error ?? "Senden fehlgeschlagen" });
      }
    } finally { setBusy(false); }
  };

  const onlyTarget = async () => {
    if (!pending || busy) return;
    setBusy(true); setMsg(null);
    try {
      if (await setTargetOnly(pending.tier)) { setMsg({ ok: true, text: "Nur das Ziel gesetzt — Preise unverändert (Anzeige kann rot/gelb sein)." }); setPending(null); }
    } finally { setBusy(false); }
  };

  const pendingTier = pending ? MARGIN_TIERS.find(t => Math.abs(t.targetEur - pending.tier) < 0.005) : null;

  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {display && style && (
          <span
            title={`Boden dieser Stufe: ${fmt(display.floorEur)} € — rot = darunter (Preis anheben), gelb = unter dem Ziel`}
            style={{ fontSize: 11, background: style.bg, color: style.color, padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}
          >
            Ziel {fmt(display.targetEur)} € · Erwartet {fmt(display.expectedEur)} €{isVariant ? " (schlechteste Variante)" : ""}
          </span>
        )}
        {MARGIN_TIERS.map(t => (
          <button
            key={t.label}
            type="button"
            disabled={busy}
            onClick={() => choose(t.targetEur)}
            title={`Stufe ${t.label}: Ziel ${fmt(t.targetEur)} €, Boden ${fmt(t.floorEur)} € — rechnet die Verkaufspreise nach Formel v2 neu${isLive ? " (live: erst Vorschau, Senden nur auf Knopfdruck)" : ""}`}
            style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
              border: Math.abs(t.targetEur - target) < 0.005 ? "1.5px solid #16A34A" : "1px solid #E2E8F0",
              background: Math.abs(t.targetEur - target) < 0.005 ? "#F0FDF4" : "#fff",
              color: Math.abs(t.targetEur - target) < 0.005 ? "#16A34A" : "#64748B",
            }}
          >{t.label}</button>
        ))}
        {!knownTier && (
          <span title="Bestandswert, nicht mehr als Stufe wählbar (bleibt unverändert, bis eine Stufe A–D gewählt wird)" style={{ fontSize: 10, color: "#92400E", fontWeight: 700 }}>
            Ziel {fmt(target)} € (alt)
          </span>
        )}
      </div>

      {msg && <div style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</div>}

      {pending && pendingTier && (
        <div style={{ marginTop: 6, background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px", fontSize: 11, color: "#0F172A" }}>
          <div style={{ fontWeight: 700 }}>
            Stufe {pendingTier.label} (Ziel {fmt(pendingTier.targetEur)} €, Boden {fmt(pendingTier.floorEur)} €): {pending.plan.changedCount} von {pending.plan.rows.length} Preis(en) ändern sich — live bei eBay gelistet.
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto", marginTop: 4 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead><tr style={{ color: "#64748B", textAlign: "right" }}>
                <th style={{ textAlign: "left", fontWeight: 700 }}>{pending.plan.isVariant ? "Variante" : "Artikel"}</th>
                <th style={{ fontWeight: 700 }}>VK alt → neu</th><th style={{ fontWeight: 700 }}>Gewinn alt → neu</th>
              </tr></thead>
              <tbody>
                {pending.plan.rows.map((r, i) => {
                  const lvl = evaluateTargetDisplay(pending.tier, r.newProfit).level;
                  return (
                    <tr key={i} style={{ textAlign: "right" }}>
                      <td style={{ textAlign: "left" }}>{r.label || "—"}</td>
                      <td>{r.oldSell != null ? fmt(r.oldSell) : "–"} → <strong>{fmt(r.newSell)}</strong> €</td>
                      <td style={{ color: TARGET_LEVEL_STYLE[lvl].color }}>{r.oldProfit != null ? fmt(r.oldProfit) : "–"} → <strong>{fmt(r.newProfit)}</strong> €</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 4, color: "#64748B" }}>Es wird nichts gesendet, bis du auf "Preise an eBay senden" klickst. Preise können dabei auch sinken.</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <button type="button" onClick={sendToEbay} disabled={busy}
              style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#16A34A", color: "#fff", fontWeight: 700, fontSize: 11, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
              {busy ? "Sende …" : "Preise an eBay senden"}
            </button>
            <button type="button" onClick={onlyTarget} disabled={busy}
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#fff", color: "#0F172A", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              Nur Ziel setzen (keine Preise)
            </button>
            <button type="button" onClick={() => setPending(null)} disabled={busy}
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {isVariant && rows.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ fontSize: 10, color: "#64748B", cursor: "pointer" }}>je Variante</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
            {rows.map((r, i) => {
              const d = evaluateTargetDisplay(target, r.profit);
              return (
                <span key={i} style={{ fontSize: 10, color: TARGET_LEVEL_STYLE[d.level].color }}>
                  {r.label}: Ziel {fmt(d.targetEur)} · Erwartet {fmt(d.expectedEur)} €
                </span>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}
