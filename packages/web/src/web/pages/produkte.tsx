/**
 * Produkte-Tab — eigene Produktdatenbank
 * Zeigt alle importierten Produkte, Preisänderungen, eBay-Status
 */
import { useState, useEffect } from "react";
import {
  Package, ExternalLink, RefreshCw, ShoppingCart,
  Clock, CheckCircle, XCircle, Loader, TrendingUp,
  TrendingDown, AlertTriangle, Search, Trash2,
} from "lucide-react";

interface Product {
  id: number;
  asin: string;
  sourceUrl: string;
  amazonUrl: string;
  title: string;
  generatedTitle: string;
  htmlDescription: string;
  bullets: string[];
  variants: string[];
  images: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  lastPriceCheck: string | null;
  priceChanged: boolean;
  ebayListingId: string | null;
  ebayStatus: string;
  ebayError: string | null;
  createdAt: string;
  updatedAt: string;
}

function StatusBadge({ status, listingId }: { status: string; listingId: string | null }) {
  const map: Record<string, { bg: string; color: string; icon: React.ReactNode; label: string }> = {
    none: { bg: "#F1F5F9", color: "#64748B", icon: <Clock size={11} />, label: "Nicht gelistet" },
    listed: { bg: "#F0FDF4", color: "#16A34A", icon: <CheckCircle size={11} />, label: `eBay #${listingId?.slice(0, 8) ?? ""}` },
    error: { bg: "#FEF2F2", color: "#DC2626", icon: <XCircle size={11} />, label: "Fehler" },
  };
  const s = map[status] ?? map.none;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color }}>
      {s.icon} {s.label}
    </span>
  );
}

function PriceBadge({ buy, sell }: { buy: number | null; sell: number | null }) {
  if (!buy && !sell) return null;
  const margin = (buy && sell) ? ((sell - buy) / sell * 100) : null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
      {buy && <span style={{ fontSize: 11, background: "#FEF3C7", color: "#92400E", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>EK: {buy.toFixed(2)} €</span>}
      {sell && <span style={{ fontSize: 11, background: "#DBEAFE", color: "#1D4ED8", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>VK: {sell.toFixed(2)} €</span>}
      {margin !== null && (
        <span style={{ fontSize: 11, background: margin > 15 ? "#F0FDF4" : margin > 5 ? "#FEF9C3" : "#FEF2F2", color: margin > 15 ? "#16A34A" : margin > 5 ? "#CA8A04" : "#DC2626", padding: "2px 8px", borderRadius: 6, fontWeight: 700 }}>
          {margin > 15 ? <TrendingUp size={10} /> : <TrendingDown size={10} />} {margin.toFixed(1)}%
        </span>
      )}
    </div>
  );
}

export default function Produkte() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [checkingPrice, setCheckingPrice] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      const data = await res.json() as Product[];
      setProducts(data.reverse());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ladefehler");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Preis aktualisieren (scrape erneut)
  const checkPrice = async (product: Product) => {
    const url = product.sourceUrl || product.amazonUrl;
    if (!url || url === "manual") return;
    setCheckingPrice(product.id);
    try {
      const res = await fetch("/api/aliexpress/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json() as { price?: string; error?: string };
      if (data.price) {
        const newPrice = parseFloat(data.price.replace(/[^0-9.]/g, ""));
        if (!isNaN(newPrice) && newPrice > 0) {
          await fetch(`/api/products/${product.id}/price`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ buyPrice: newPrice }),
          });
          load();
        }
      }
    } catch { /* ignore */ } finally {
      setCheckingPrice(null);
    }
  };

  const filtered = products.filter(p =>
    !search || p.generatedTitle.toLowerCase().includes(search.toLowerCase()) || p.title.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: products.length,
    listed: products.filter(p => p.ebayStatus === "listed").length,
    errors: products.filter(p => p.ebayStatus === "error").length,
    priceAlerts: products.filter(p => p.priceChanged).length,
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#8B5CF6", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Package size={22} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", margin: 0 }}>Produkt-Datenbank</h1>
              <p style={{ fontSize: 12, color: "#64748B", margin: 0 }}>{products.length} Produkte gespeichert</p>
            </div>
          </div>
          <button onClick={load} style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 10,
            padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#475569",
            cursor: "pointer", fontFamily: "inherit",
          }}>
            <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : {}} />
            Aktualisieren
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Gesamt", value: stats.total, color: "#8B5CF6", bg: "#F5F3FF" },
            { label: "eBay aktiv", value: stats.listed, color: "#16A34A", bg: "#F0FDF4" },
            { label: "Fehler", value: stats.errors, color: "#DC2626", bg: "#FEF2F2" },
            { label: "Preisalarm", value: stats.priceAlerts, color: "#F59E0B", bg: "#FFFBEB" },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 14, padding: "14px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Suche */}
        <div style={{ position: "relative", marginBottom: 16 }}>
          <Search size={16} color="#94A3B8" style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)" }} />
          <input
            type="text"
            placeholder="Produkte suchen…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: "100%", padding: "12px 16px 12px 40px", fontSize: 14,
              border: "2px solid #E2E8F0", borderRadius: 12, outline: "none",
              fontFamily: "inherit", boxSizing: "border-box", color: "#0F172A",
              background: "#fff",
            }}
          />
        </div>

        {/* Fehler */}
        {error && (
          <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 12, padding: "14px 18px", marginBottom: 16, color: "#DC2626", fontSize: 13, fontWeight: 600 }}>
            {error} — Turso DB konfiguriert?
          </div>
        )}

        {/* Loading */}
        {loading && !error && (
          <div style={{ textAlign: "center", padding: 48, color: "#94A3B8" }}>
            <Loader size={32} style={{ animation: "spin 1s linear infinite", margin: "0 auto 12px" }} />
            <p style={{ margin: 0, fontSize: 14 }}>Lade Produkte…</p>
          </div>
        )}

        {/* Leer */}
        {!loading && !error && products.length === 0 && (
          <div style={{ background: "#fff", borderRadius: 20, padding: "48px 24px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", textAlign: "center" }}>
            <Package size={48} color="#E2E8F0" style={{ margin: "0 auto 16px" }} />
            <p style={{ color: "#94A3B8", fontSize: 14, margin: 0 }}>Noch keine Produkte</p>
            <p style={{ color: "#CBD5E1", fontSize: 12, marginTop: 4 }}>Im Lieferanten-Tab importieren</p>
          </div>
        )}

        {/* Produkt-Karten */}
        {!loading && filtered.map(product => {
          const images = (() => { try { return JSON.parse(product.images ?? "[]") as string[]; } catch { return []; } })();
          const thumb = images[0];
          return (
            <div key={product.id} style={{
              background: "#fff", borderRadius: 16, padding: 18,
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 12,
              border: product.priceChanged ? "1.5px solid #FCD34D" : "1.5px solid transparent",
            }}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                {/* Thumbnail */}
                {thumb && (
                  <img src={thumb} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", flexShrink: 0, background: "#F8FAFC" }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", lineHeight: 1.4, marginBottom: 6 }}>
                    {product.generatedTitle}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 10, fontFamily: "monospace", background: "#F1F5F9", padding: "2px 6px", borderRadius: 5, color: "#475569" }}>
                      {product.asin}
                    </span>
                    <StatusBadge status={product.ebayStatus} listingId={product.ebayListingId} />
                    {product.priceChanged && (
                      <span style={{ fontSize: 11, background: "#FFFBEB", color: "#92400E", padding: "2px 8px", borderRadius: 6, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle size={10} /> Preisänderung
                      </span>
                    )}
                  </div>
                  <PriceBadge buy={product.buyPrice} sell={product.sellPrice} />
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
                {(product.sourceUrl || product.amazonUrl) && (product.sourceUrl || product.amazonUrl) !== "manual" && (
                  <>
                    <a href={product.sourceUrl || product.amazonUrl} target="_blank" rel="noopener noreferrer" style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8, background: "#FF6B00", color: "#fff",
                      fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: "inherit",
                    }}>
                      <ExternalLink size={11} /> AliExpress
                    </a>
                    <button onClick={() => checkPrice(product)} disabled={checkingPrice === product.id} style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8, background: "#F1F5F9", color: "#475569",
                      fontSize: 11, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit",
                    }}>
                      {checkingPrice === product.id
                        ? <Loader size={11} style={{ animation: "spin 1s linear infinite" }} />
                        : <RefreshCw size={11} />}
                      Preis prüfen
                    </button>
                  </>
                )}
                {product.ebayStatus === "listed" && product.ebayListingId && (
                  <a href={`https://www.ebay.de/itm/${product.ebayListingId}`} target="_blank" rel="noopener noreferrer" style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "6px 10px", borderRadius: 8, background: "#FFD700", color: "#0F172A",
                    fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: "inherit",
                  }}>
                    <ShoppingCart size={11} /> eBay
                  </a>
                )}
              </div>

              {product.ebayError && (
                <div style={{ fontSize: 11, color: "#DC2626", background: "#FEF2F2", padding: "6px 10px", borderRadius: 6, marginTop: 8 }}>
                  {product.ebayError.slice(0, 120)}
                </div>
              )}

              {product.lastPriceCheck && (
                <div style={{ fontSize: 10, color: "#CBD5E1", marginTop: 8 }}>
                  Letzte Preisprüfung: {new Date(product.lastPriceCheck).toLocaleString("de-DE")}
                  {" · "}Erstellt: {new Date(product.createdAt).toLocaleString("de-DE")}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
