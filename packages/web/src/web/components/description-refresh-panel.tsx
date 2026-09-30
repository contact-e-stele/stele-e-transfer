/**
 * P71-B Teil 2 — Knopf "Beschreibung nachziehen" je Angebot (Listings-Tab, nur bei gelbem Schild
 * "Fremdkontakt"). Zwei Schritte, immer nur EIN Angebot:
 *   1. Trockenlauf (POST /api/ebay/descriptions/refresh-batch, genau diese productId, OHNE confirm)
 *      → Vorschau mit echten Trefferzahlen vorher/nachher.
 *   2. Erst danach "Jetzt an eBay senden" (derselbe Aufruf mit confirm:true).
 * Es gibt bewusst keinen Sammel-Knopf.
 */
import { useState } from "react";
import { FileEdit, Loader, Send, X } from "lucide-react";
import type { DescriptionViolationSummary } from "../../shared/description-compliance";

// Antwort-Eintrag der Route (Teilmenge von DescriptionRefreshOutcome, description-refresh.ts)
interface RefreshOutcome {
  productId: number;
  ok: boolean;
  dryRun?: boolean;
  changed?: boolean;
  error?: string;
  summaryBefore?: DescriptionViolationSummary;
  summaryAfter?: DescriptionViolationSummary;
}

async function callRefresh(productId: number, confirm: boolean): Promise<RefreshOutcome> {
  const res = await fetch("/api/ebay/descriptions/refresh-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(confirm ? { productIds: [productId], confirm: true } : { productIds: [productId] }),
  });
  const text = await res.text();
  let data: { results?: RefreshOutcome[]; error?: string } = {};
  try { data = JSON.parse(text) as typeof data; } catch { /* Fehlertext unten */ }
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}: ${text.slice(0, 300)}`);
  const outcome = data.results?.[0];
  if (!outcome) throw new Error("Leere Antwort der Route");
  return outcome;
}

function SummaryLine({ label, s }: { label: string; s: DescriptionViolationSummary }) {
  const hosts = s.hosts.length > 0 ? s.hosts.map(h => `${h.host} ×${h.count}`).join(", ") : "keine";
  return (
    <div style={{ marginBottom: 4 }}>
      <strong>{label}:</strong> E-Mails {s.email} · externe Hosts: {hosts} · alicdn-Bilder {s.alicdn}
      {" "}· GPSR-Rohtext {s.gpsr} · Links {s.url} · Domains {s.domain}
    </div>
  );
}

export function DescriptionRefreshPanel({ productId, onSent }: { productId: number; onSent: () => void }) {
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);
  const [preview, setPreview] = useState<RefreshOutcome | null>(null);
  const [error, setError] = useState("");

  const runPreview = async () => {
    setBusy("preview"); setError(""); setPreview(null);
    try {
      const outcome = await callRefresh(productId, false);
      setPreview(outcome);
      if (!outcome.ok) setError(outcome.error ?? "Unbekannter Fehler");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy("send"); setError("");
    try {
      const outcome = await callRefresh(productId, true);
      if (!outcome.ok) { setError(outcome.error ?? "Unbekannter Fehler"); return; }
      setPreview(null);
      onSent(); // gelbes Schild entfernen
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const canSend = preview?.ok === true && preview.dryRun === true;

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={runPreview}
        disabled={busy !== null}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 6,
          border: "1.5px solid #F59E0B", background: "#FFFBEB", color: "#92400E",
          fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer", fontFamily: "inherit",
        }}
      >
        {busy === "preview" ? <Loader size={11} style={{ animation: "spin 1s linear infinite" }} /> : <FileEdit size={11} />}
        Beschreibung nachziehen
      </button>

      {(preview || error) && (
        <div style={{ marginTop: 6, padding: 10, borderRadius: 8, background: "#FFFBEB", border: "1px solid #FDE68A", fontSize: 11, color: "#78350F", lineHeight: 1.5 }}>
          {preview?.summaryBefore && preview.summaryAfter && (
            <>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Vorschau (Trockenlauf — noch nichts an eBay gesendet)</div>
              <SummaryLine label="Vorher" s={preview.summaryBefore} />
              <SummaryLine label="Nachher" s={preview.summaryAfter} />
              {preview.ok && <div style={{ marginBottom: 6 }}><strong>Text ändert sich:</strong> {preview.changed ? "ja" : "nein"}</div>}
            </>
          )}
          {error && (
            <div style={{ color: "#B91C1C", fontWeight: 600, whiteSpace: "pre-wrap", wordBreak: "break-word", marginBottom: 6 }}>{error}</div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            {canSend && (
              <button
                type="button"
                onClick={send}
                disabled={busy !== null}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 6, border: "none",
                  background: "#16A34A", color: "#fff", fontSize: 11, fontWeight: 700, cursor: busy ? "default" : "pointer", fontFamily: "inherit",
                }}
              >
                {busy === "send" ? <Loader size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Send size={11} />}
                Jetzt an eBay senden
              </button>
            )}
            <button
              type="button"
              onClick={() => { setPreview(null); setError(""); }}
              disabled={busy !== null}
              style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "4px 8px", borderRadius: 6, border: "none", background: "#F1F5F9", color: "#64748B", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
            >
              <X size={11} /> Schließen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
