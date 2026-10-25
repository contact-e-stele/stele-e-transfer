// "Gleiche Ware günstiger?" — Bildsuche über aliexpress.ds.image.searchV2.
// NUR Anzeige: ändert weder Import-Daten noch Preise noch eBay; kein Auto-Ersatz.
import { useState } from "react";
import { safeJson } from "../lib/safeFetch";

interface Hit {
  id: string; title: string; image: string; price: number;
  shipFrom: string; isEU: boolean; rating: number; sold: number; url: string;
}
interface Resp { status: "ok" | "no_token" | "api_error"; results: Hit[]; total: number; message?: string }

const eur = (n: number) => n.toFixed(2).replace(".", ",");

export function BildsucheCard({ imageUrl, currentPrice }: { imageUrl: string | undefined; currentPrice: number | null }) {
  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<Resp | null>(null);
  const [err, setErr] = useState("");

  if (!imageUrl) return null;

  const search = async () => {
    setLoading(true); setErr(""); setResp(null);
    try {
      setResp(await safeJson<Resp>(`/api/aliexpress/image-search?imageUrl=${encodeURIComponent(imageUrl)}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Gleiche Ware günstiger?</div>
          <div style={{ fontSize: 11, color: "#64748B" }}>Bildsuche bei AliExpress — nur Anzeige, ändert nichts am Import.</div>
        </div>
        <button onClick={search} disabled={loading}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #C9A227", background: "#0f0f0f", color: "#C9A227", fontSize: 12, fontWeight: 700, cursor: loading ? "wait" : "pointer" }}>
          {loading ? "Suche läuft…" : "Suchen"}
        </button>
      </div>

      {err && <p style={{ margin: "10px 0 0", fontSize: 12, color: "#DC2626" }}>{err}</p>}
      {resp && resp.status !== "ok" && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#DC2626" }}>
          {resp.status === "no_token" ? "Kein AliExpress-Token vorhanden." : `AliExpress-Fehler: ${resp.message ?? "unbekannt"}`}
        </p>
      )}
      {resp?.status === "ok" && resp.results.length === 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 12, color: "#64748B" }}>Keine ähnlichen Treffer gefunden.</p>
      )}
      {resp?.status === "ok" && resp.results.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p style={{ margin: "0 0 8px", fontSize: 11, color: "#64748B" }}>
            Günstigste zuerst{currentPrice ? ` · aktuelles Produkt: ${eur(currentPrice)} €` : ""}. Ähnlichkeit ist nicht garantiert — bitte vor einem Wechsel prüfen.
          </p>
          {resp.results.map(h => (
            <a key={h.id} href={h.url} target="_blank" rel="noreferrer"
              style={{ display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid #F1F5F9", textDecoration: "none", color: "inherit" }}>
              <div style={{ width: 56, height: 56, borderRadius: 8, overflow: "hidden", background: "#F1F5F9", flexShrink: 0 }}>
                {h.image && <img src={h.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{h.title || "Kein Titel"}</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 2, fontSize: 11, color: "#64748B" }}>
                  <strong style={{ fontSize: 13, color: currentPrice && h.price > 0 && h.price < currentPrice ? "#16A34A" : "#7C3AED" }}>{h.price > 0 ? `${eur(h.price)} €` : "–"}</strong>
                  {h.rating > 0 && <span>{h.rating.toFixed(1).replace(".", ",")} %</span>}
                  {h.sold > 0 && <span>{h.sold.toLocaleString("de-DE")}× verkauft</span>}
                  <span style={{ fontWeight: 700, color: h.isEU ? "#16A34A" : "#C2410C" }}>{h.isEU ? "EU" : h.shipFrom === "?" ? "Versand ?" : h.shipFrom}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
