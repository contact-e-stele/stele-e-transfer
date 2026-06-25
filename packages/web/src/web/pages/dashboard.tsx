import { useState, useEffect } from "react";
import { Package, ExternalLink, RefreshCw, ShoppingCart, Clock, CheckCircle, XCircle, Loader, TrendingUp, AlertTriangle } from "lucide-react";
import { safeJson } from "../lib/safeFetch";

interface Product {
  id: number;
  asin: string;
  amazonUrl: string;
  title: string;
  generatedTitle: string;
  htmlDescription: string;
  bullets: string[];
  variants: string[];
  ebayListingId: string | null;
  ebayStatus: string;
  ebayError: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  adRate: number | null;
  priceChanged: boolean;
  lastPriceCheck: string | null;
  createdAt: string;
  updatedAt: string;
}

function StatusBadge({ status, listingId }: { status: string; listingId: string | null }) {
  const styles: Record<string, React.CSSProperties> = {
    none: { background: "#F1F5F9", color: "#64748B" },
    listed: { background: "#F0FDF4", color: "#16A34A" },
    error: { background: "#FEF2F2", color: "#DC2626" },
  };
  const icons: Record<string, React.ReactNode> = {
    none: <Clock size={12} />,
    listed: <CheckCircle size={12} />,
    error: <XCircle size={12} />,
  };
  const labels: Record<string, string> = {
    none: "Nicht gelistet",
    listed: `eBay #${listingId?.slice(0, 8) ?? ""}`,
    error: "Fehler",
  };
  const s = styles[status] ?? styles.none;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700,
      ...s,
    }}>
      {icons[status] ?? icons.none}
      {labels[status] ?? status}
    </span>
  );
}

export default function Dashboard() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [priceCheckLoading, setPriceCheckLoading] = useState(false);
  const [priceCheckResult, setPriceCheckResult] = useState<{ jobId?: string; message?: string; error?: string } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await safeJson<Product[]>("/api/products");
      setProducts(data.reverse()); // Neueste zuerst
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ladefehler");
    } finally {
      setLoading(false);
    }
  };

  const triggerPriceCheck = async () => {
    setPriceCheckLoading(true);
    setPriceCheckResult(null);
    try {
      const res = await fetch("/api/products/check-all-prices", { method: "POST" });
      const data = await res.json() as { jobId?: string; message?: string; error?: string };
      setPriceCheckResult(data);
      // Nach 10 Sek Produkte neu laden (Preise könnten sich geändert haben)
      setTimeout(() => load(), 10000);
    } catch {
      setPriceCheckResult({ error: "Preischeck fehlgeschlagen" });
    } finally {
      setPriceCheckLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12, background: "#0F172A",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Package size={22} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", margin: 0 }}>Produkt-Dashboard</h1>
              <p style={{ fontSize: 12, color: "#64748B", margin: 0 }}>{products.length} gespeicherte Produkte</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={triggerPriceCheck} disabled={priceCheckLoading} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: priceCheckLoading ? "#FEF9C3" : "#FFFBEB", border: "1.5px solid #FCD34D", borderRadius: 10,
              padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#92400E",
              cursor: priceCheckLoading ? "not-allowed" : "pointer", fontFamily: "inherit",
            }}>
              <TrendingUp size={14} style={priceCheckLoading ? { animation: "spin 1s linear infinite" } : {}} />
              {priceCheckLoading ? "Prüft..." : "Preise prüfen"}
            </button>
            <button onClick={load} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 10,
              padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#475569",
              cursor: "pointer", fontFamily: "inherit",
            }}>
              <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : {}} />
              Neu laden
            </button>
          </div>
        </div>

        {/* Stats */}
        {(() => {
          const listed = products.filter(p => p.ebayStatus === "listed");
          const withProfit = listed.filter(p => p.sellPrice && p.buyPrice);
          const totalProfit = withProfit.reduce((sum, p) => {
            const adR = p.adRate ?? 5;
            const profit = p.sellPrice! - p.sellPrice! * (13 + adR) / 100 * 1.19 - 0.45 * 1.19 - p.buyPrice!;
            return sum + profit;
          }, 0);
          const avgProfit = withProfit.length > 0 ? totalProfit / withProfit.length : null;
          const errors = products.filter(p => p.ebayStatus === "error").length;
          const priceAlerts = products.filter(p => p.priceChanged).length;
          return (
            <div style={{ marginBottom: 24 }}>
              {/* Preis-Check Ergebnis */}
              {priceCheckResult && (
                <div style={{
                  background: priceCheckResult.error ? "#FEF2F2" : "#FFFBEB",
                  border: `1.5px solid ${priceCheckResult.error ? "#FECACA" : "#FCD34D"}`,
                  borderRadius: 10, padding: "10px 14px", marginBottom: 12,
                  fontSize: 12, color: priceCheckResult.error ? "#DC2626" : "#92400E", fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <TrendingUp size={14} />
                  {priceCheckResult.error ?? priceCheckResult.message ?? "Preischeck gestartet — Produkte werden aktualisiert"}
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 12 }}>
                {[
                  { label: "Produkte gesamt", value: products.length.toString(), color: "#8B5CF6", bg: "#F5F3FF" },
                  { label: "Auf eBay aktiv", value: listed.length.toString(), color: "#16A34A", bg: "#F0FDF4" },
                  { label: "Preis-Alerts", value: priceAlerts.toString(), color: priceAlerts > 0 ? "#D97706" : "#94A3B8", bg: priceAlerts > 0 ? "#FFFBEB" : "#F8FAFC" },
                  { label: "Fehler", value: errors.toString(), color: errors > 0 ? "#DC2626" : "#94A3B8", bg: errors > 0 ? "#FEF2F2" : "#F8FAFC" },
                ].map(s => (
                  <div key={s.label} style={{
                    background: s.bg, borderRadius: 14, padding: "12px 8px",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.06)", textAlign: "center",
                  }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600 }}>{s.label}</div>
                  </div>
                ))}
              </div>
              {/* Gewinn-Karten */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{
                  background: totalProfit > 0 ? "#F0FDF4" : "#F8FAFC", borderRadius: 14, padding: "14px 12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)", textAlign: "center",
                  border: totalProfit > 0 ? "1.5px solid #BBF7D0" : "1.5px solid #E2E8F0",
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: totalProfit > 0 ? "#16A34A" : "#94A3B8" }}>
                    {withProfit.length > 0 ? `${totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)} €` : "–"}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>Gesamtgewinn ({withProfit.length} Artikel)</div>
                </div>
                <div style={{
                  background: avgProfit !== null && avgProfit >= 1.60 ? "#F0FDF4" : "#F8FAFC", borderRadius: 14, padding: "14px 12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)", textAlign: "center",
                  border: avgProfit !== null && avgProfit >= 1.60 ? "1.5px solid #BBF7D0" : "1.5px solid #E2E8F0",
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: avgProfit !== null && avgProfit >= 1.60 ? "#16A34A" : avgProfit !== null && avgProfit >= 0 ? "#F59E0B" : "#94A3B8" }}>
                    {avgProfit !== null ? `${avgProfit >= 0 ? "+" : ""}${avgProfit.toFixed(2)} €` : "–"}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>Ø Gewinn / Artikel</div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Error */}
        {error && (
          <div style={{
            background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 12,
            padding: "14px 18px", marginBottom: 16, color: "#DC2626", fontSize: 13, fontWeight: 600,
          }}>
            {error} — Turso DB noch nicht konfiguriert?
          </div>
        )}

        {/* Loading */}
        {loading && !error && (
          <div style={{ textAlign: "center", padding: 48, color: "#94A3B8" }}>
            <Loader size={32} style={{ animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
            <p style={{ margin: 0, fontSize: 14 }}>Lade Produkte…</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && products.length === 0 && (
          <div style={{
            background: "#fff", borderRadius: 20, padding: "48px 24px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)", textAlign: "center",
          }}>
            <Package size={48} color="#E2E8F0" style={{ margin: "0 auto 16px" }} />
            <p style={{ color: "#94A3B8", fontSize: 14, margin: 0 }}>Noch keine Produkte gespeichert</p>
            <p style={{ color: "#CBD5E1", fontSize: 12, marginTop: 4 }}>Scrape ein Amazon-Produkt im AutoDS-Tab</p>
          </div>
        )}

        {/* Product List */}
        {!loading && products.map(product => (
          <div key={product.id} style={{
            background: "#fff", borderRadius: 16, padding: 20,
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 12,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", marginBottom: 4, lineHeight: 1.4 }}>
                  {product.generatedTitle}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const, alignItems: "center" }}>
                  <span style={{ fontSize: 11, fontFamily: "monospace", background: "#F1F5F9", padding: "2px 6px", borderRadius: 5, color: "#475569" }}>
                    {product.asin}
                  </span>
                  <StatusBadge status={product.ebayStatus} listingId={product.ebayListingId} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <a
                  href={product.amazonUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "6px 10px", borderRadius: 8,
                    background: "#FF9900", color: "#fff",
                    fontSize: 11, fontWeight: 700, textDecoration: "none",
                    fontFamily: "inherit",
                  }}
                >
                  <ExternalLink size={11} /> Amazon
                </a>
                {product.ebayStatus === "listed" && product.ebayListingId && (
                  <a
                    href={`https://www.ebay.de/itm/${product.ebayListingId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8,
                      background: "#FFD700", color: "#0F172A",
                      fontSize: 11, fontWeight: 700, textDecoration: "none",
                      fontFamily: "inherit",
                    }}
                  >
                    <ShoppingCart size={11} /> eBay
                  </a>
                )}
              </div>
            </div>

            {product.variants.length > 0 && (
              <div style={{ fontSize: 11, color: "#64748B", marginBottom: 6 }}>
                <span style={{ fontWeight: 600 }}>Varianten: </span>
                {product.variants.join(" · ")}
              </div>
            )}

            {/* Preis-Alert */}
            {product.priceChanged && (
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 11, color: "#92400E", background: "#FFFBEB",
                border: "1px solid #FCD34D", padding: "6px 10px", borderRadius: 6, marginTop: 6, fontWeight: 600,
              }}>
                <AlertTriangle size={12} />
                Preisänderung erkannt — EK: {product.buyPrice?.toFixed(2)}€ → VK: {product.sellPrice?.toFixed(2)}€
              </div>
            )}

            {product.ebayError && (
              <div style={{ fontSize: 11, color: "#DC2626", background: "#FEF2F2", padding: "6px 10px", borderRadius: 6, marginTop: 6 }}>
                {product.ebayError.slice(0, 120)}
              </div>
            )}

            <div style={{ fontSize: 10, color: "#CBD5E1", marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap" as const }}>
              <span>Erstellt: {new Date(product.createdAt).toLocaleString("de-DE")}</span>
              {product.lastPriceCheck && (
                <span>Preis geprüft: {new Date(product.lastPriceCheck).toLocaleString("de-DE")}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
