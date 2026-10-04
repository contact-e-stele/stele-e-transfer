// A-016: aus produkte.tsx herausgezogen (reiner Extract, Grundgesetz Regel 8) — Produkte-Tab UND Listings-Tab zeigen
// dieselbe Anzeige: "Ziel <Stufe> · Erwartet <echter Gewinn beim gesetzten VK nach Formel v2>" je Produkt und je Variante
// (gelb: Erwartet < Ziel, rot: Erwartet < Boden) plus die Stufen-Knöpfe A–D. Die Gewinn-Zeilen kommen aus
// shared/target-margin-bulk.ts (productProfitRows). Die Stufenwahl ändert NUR targetMarginEur in der App (PATCH
// /api/products/:id) und schreibt nichts an eBay.
import { useState } from "react";
import { MARGIN_TIERS } from "../../shared/constants";
import { evaluateTargetDisplay } from "../../shared/pricing";
import { productProfitRows, productTarget, type ProfitProduct } from "../../shared/target-margin-bulk";

export const TARGET_LEVEL_STYLE = {
  ok: { bg: "#F0FDF4", color: "#16A34A" },
  yellow: { bg: "#FEF9C3", color: "#A16207" },
  red: { bg: "#FEF2F2", color: "#DC2626" },
} as const;

export function TargetBadge({ product, onChange }: { product: ProfitProduct; onChange: (targetMarginEur: number) => void }) {
  const [saving, setSaving] = useState(false);
  const target = productTarget(product);
  const { rows, isVariant } = productProfitRows(product);

  const worst = rows.length > 0 ? Math.min(...rows.map(r => r.profit)) : null;
  const display = worst != null ? evaluateTargetDisplay(target, worst) : null;
  const style = display ? TARGET_LEVEL_STYLE[display.level] : null;
  const fmt = (n: number) => n.toFixed(2).replace(".", ",");
  const knownTier = MARGIN_TIERS.some(t => Math.abs(t.targetEur - target) < 0.005);

  const select = async (t: number) => {
    if (saving || Math.abs(t - target) < 0.005) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ targetMarginEur: t }),
      });
      if (res.ok) onChange(t);
    } finally { setSaving(false); }
  };

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
            disabled={saving}
            onClick={() => select(t.targetEur)}
            title={`Stufe ${t.label}: Ziel ${fmt(t.targetEur)} €, Boden ${fmt(t.floorEur)} €`}
            style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6, cursor: saving ? "wait" : "pointer", fontFamily: "inherit",
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
