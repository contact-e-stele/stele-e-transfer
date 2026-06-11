/**
 * Listings-Tab — alle eBay Listings verwalten
 * Übersicht, Preise anpassen, Status sehen
 */
import { useState, useEffect } from "react";
import {
  ShoppingCart, RefreshCw, Loader, CheckCircle, XCircle,
  Clock, ExternalLink, Package, TrendingUp, Trash2, StopCircle,
} from "lucide-react";

interface Product {
  id: number;
  asin: string;
  sourceUrl: string;
  amazonUrl: string;
  generatedTitle: string;
  htmlDescription: string;
  images: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  ebayListingId: string | null;
  ebayStatus: string;
  ebayError: string | null;
  createdAt: string;
}

export default function Listings() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [listingLoading, setListingLoading] = useState<number | null>(null);
  const [listingResult, setListingResult] = useState<Record<number, { ok?: string; err?: string }>>({});
  const [priceEdits, setPriceEdits] = useState<Record<number, string>>({});
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);
  const [endLoading, setEndLoading] = useState<number | null>(null);

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

  const handleList = async (product: Product) => {
    const priceStr = priceEdits[product.id] ?? (product.sellPrice?.toFixed(2) ?? "");
    const price = parseFloat(priceStr.replace(",", "."));
    if (!price || price <= 0) {
      setListingResult(r => ({ ...r, [product.id]: { err: "Bitte Verkaufspreis eingeben" } }));
      return;
    }
    setListingLoading(product.id);
    setListingResult(r => ({ ...r, [product.id]: {} }));
    try {
      const images = (() => { try { return JSON.parse(product.images ?? "[]") as string[]; } catch { return []; } })();
      const res = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: product.asin,
          title: product.generatedTitle,
          description: product.htmlDescription,
          price,
          quantity: 10,
          imageUrls: images.slice(0, 3),
        }),
      });
      const data = await res.json() as { listingId?: string; error?: string };
      if (data.listingId) {
        setListingResult(r => ({ ...r, [product.id]: { ok: data.listingId } }));
        load();
      } else {
        setListingResult(r => ({ ...r, [product.id]: { err: data.error ?? "Unbekannter Fehler" } }));
      }
    } catch (e) {
      setListingResult(r => ({ ...r, [product.id]: { err: e instanceof Error ? e.message : "Fehler" } }));
    } finally {
      setListingLoading(null);
    }
  };

  const handleDeleteProduct = async (productId: number) => {
    if (!confirm("Produkt wirklich aus der Datenbank löschen?")) return;
    setDeleteLoading(productId);
    try {
      await fetch(`/api/products/${productId}`, { method: "DELETE" });
      load();
    } finally {
      setDeleteLoading(null);
    }
  };

  const handleEndListing = async (productId: number) => {
    if (!confirm("eBay Listing wirklich beenden?")) return;
    setEndLoading(productId);
    try {
      const res = await fetch(`/api/products/${productId}/ebay-listing`, { method: "DELETE" });
      const data = await res.json() as { ok?: boolean; warning?: string; error?: string };
      if (data.ok || data.warning) load();
      else alert(data.error ?? "Fehler beim Beenden");
    } finally {
      setEndLoading(null);
    }
  };

  const notListed = products.filter(p => p.ebayStatus !== "listed");
  const listed = products.filter(p => p.ebayStatus === "listed");

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#FFD700", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShoppingCart size={22} color="#0F172A" />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", margin: 0 }}>eBay Listings</h1>
              <p style={{ fontSize: 12, color: "#64748B", margin: 0 }}>{listed.length} aktiv · {notListed.length} noch nicht gelistet</p>
            </div>
          </div>
          <button onClick={load} style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 10,
            padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#475569",
            cursor: "pointer", fontFamily: "inherit",
          }}>
            <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : {}} />
            Laden
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 24 }}>
          {[
            { label: "Aktive Listings", value: listed.length, color: "#16A34A", bg: "#F0FDF4", icon: <CheckCircle size={18} color="#16A34A" /> },
            { label: "Ausstehend", value: notListed.length, color: "#F59E0B", bg: "#FFFBEB", icon: <Clock size={18} color="#F59E0B" /> },
            { label: "Gesamt", value: products.length, color: "#8B5CF6", bg: "#F5F3FF", icon: <Package size={18} color="#8B5CF6" /> },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 14, padding: "16px 12px", textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>{s.icon}</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: "#64748B", fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {error && (
          <div style={{ background: "#FEF2F2", borderRadius: 12, padding: "14px 18px", marginBottom: 16, color: "#DC2626", fontSize: 13, fontWeight: 600 }}>
            {error}
          </div>
        )}
        {loading && !error && (
          <div style={{ textAlign: "center", padding: 48 }}>
            <Loader size={32} style={{ animation: "spin 1s linear infinite", margin: "0 auto" }} color="#FFD700" />
          </div>
        )}

        {/* Noch nicht gelistet */}
        {!loading && notListed.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
              Noch nicht gelistet ({notListed.length})
            </div>
            {notListed.map(product => {
              const images = (() => { try { return JSON.parse(product.images ?? "[]") as string[]; } catch { return []; } })();
              const priceVal = priceEdits[product.id] ?? (product.sellPrice?.toFixed(2) ?? "");
              const res = listingResult[product.id];
              return (
                <div key={product.id} style={{
                  background: "#fff", borderRadius: 16, padding: 18,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 12,
                  border: product.ebayStatus === "error" ? "1.5px solid #FECACA" : "1.5px solid transparent",
                }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
                    {images[0] && <img src={images[0]} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", lineHeight: 1.4 }}>{product.generatedTitle}</div>
                      {product.buyPrice && (
                        <div style={{ fontSize: 11, color: "#64748B", marginTop: 4 }}>Einkauf: {product.buyPrice.toFixed(2)} €</div>
                      )}
                      {product.ebayStatus === "error" && product.ebayError && (
                        <div style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>✗ {product.ebayError.slice(0, 80)}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <input
                        type="number" step="0.01" placeholder="VK-Preis (€)"
                        value={priceVal}
                        onChange={e => setPriceEdits(p => ({ ...p, [product.id]: e.target.value }))}
                        style={{
                          width: "100%", padding: "10px 12px", fontSize: 14, fontWeight: 600,
                          border: "2px solid #E2E8F0", borderRadius: 10, outline: "none",
                          fontFamily: "inherit", boxSizing: "border-box", color: "#0F172A",
                        }}
                      />
                    </div>
                    <button
                      onClick={() => handleList(product)}
                      disabled={listingLoading === product.id}
                      style={{
                        padding: "10px 18px", borderRadius: 10, border: "none",
                        background: listingLoading === product.id ? "#FDE68A" : "#FFD700",
                        color: "#0F172A", fontWeight: 700, fontSize: 13,
                        cursor: listingLoading === product.id ? "not-allowed" : "pointer",
                        fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {listingLoading === product.id
                        ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
                        : <ShoppingCart size={14} />}
                      {listingLoading === product.id ? "Lädt…" : "Listen"}
                    </button>
                    <button
                      onClick={() => handleDeleteProduct(product.id)}
                      disabled={deleteLoading === product.id}
                      title="Aus Datenbank löschen"
                      style={{
                        padding: "10px 12px", borderRadius: 10, border: "1.5px solid #FECACA",
                        background: "#FEF2F2", color: "#DC2626", fontWeight: 700, fontSize: 13,
                        cursor: deleteLoading === product.id ? "not-allowed" : "pointer",
                        fontFamily: "inherit", display: "flex", alignItems: "center",
                      }}
                    >
                      {deleteLoading === product.id
                        ? <Loader size={14} style={{ animation: "spin 1s linear infinite" }} />
                        : <Trash2 size={14} />}
                    </button>
                  </div>
                  {res?.ok && (
                    <div style={{ marginTop: 10, padding: "10px 14px", background: "#F0FDF4", borderRadius: 8, fontSize: 12, color: "#16A34A", fontWeight: 600 }}>
                      ✓ Gelistet! ID: {res.ok}
                    </div>
                  )}
                  {res?.err && (
                    <div style={{ marginTop: 10, padding: "10px 14px", background: "#FEF2F2", borderRadius: 8, fontSize: 12, color: "#DC2626", fontWeight: 600 }}>
                      ✗ {res.err}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* Aktive Listings */}
        {!loading && listed.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#16A34A", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10, marginTop: 24 }}>
              Aktive Listings ({listed.length})
            </div>
            {listed.map(product => {
              const images = (() => { try { return JSON.parse(product.images ?? "[]") as string[]; } catch { return []; } })();
              const margin = (product.buyPrice && product.sellPrice)
                ? ((product.sellPrice - product.buyPrice) / product.sellPrice * 100)
                : null;
              return (
                <div key={product.id} style={{
                  background: "#fff", borderRadius: 16, padding: 18,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)", marginBottom: 12,
                  borderLeft: "4px solid #22C55E",
                }}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    {images[0] && <img src={images[0]} alt="" style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", lineHeight: 1.4 }}>{product.generatedTitle}</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                        {product.buyPrice && <span style={{ fontSize: 11, color: "#64748B" }}>EK: {product.buyPrice.toFixed(2)} €</span>}
                        {product.sellPrice && <span style={{ fontSize: 11, color: "#1D4ED8", fontWeight: 700 }}>VK: {product.sellPrice.toFixed(2)} €</span>}
                        {margin !== null && (
                          <span style={{ fontSize: 11, color: margin > 10 ? "#16A34A" : "#F59E0B", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <TrendingUp size={10} /> {margin.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0, flexDirection: "column", alignItems: "flex-end" }}>
                      <a href={`https://www.ebay.de/itm/${product.ebayListingId}`} target="_blank" rel="noopener noreferrer" style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "7px 12px", borderRadius: 8, background: "#FFD700", color: "#0F172A",
                        fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: "inherit",
                      }}>
                        <ExternalLink size={11} /> eBay
                      </a>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => handleEndListing(product.id)}
                          disabled={endLoading === product.id}
                          title="eBay Listing beenden"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "6px 10px", borderRadius: 8,
                            background: endLoading === product.id ? "#FEF9C3" : "#FFFBEB",
                            border: "1.5px solid #FDE68A", color: "#92400E",
                            fontSize: 11, fontWeight: 700, cursor: endLoading === product.id ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {endLoading === product.id
                            ? <Loader size={10} style={{ animation: "spin 1s linear infinite" }} />
                            : <StopCircle size={10} />}
                          Ende
                        </button>
                        <button
                          onClick={() => handleDeleteProduct(product.id)}
                          disabled={deleteLoading === product.id}
                          title="Aus Datenbank löschen"
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 4,
                            padding: "6px 10px", borderRadius: 8,
                            background: deleteLoading === product.id ? "#FEE2E2" : "#FEF2F2",
                            border: "1.5px solid #FECACA", color: "#DC2626",
                            fontSize: 11, fontWeight: 700, cursor: deleteLoading === product.id ? "not-allowed" : "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {deleteLoading === product.id
                            ? <Loader size={10} style={{ animation: "spin 1s linear infinite" }} />
                            : <Trash2 size={10} />}
                          DB
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {!loading && products.length === 0 && !error && (
          <div style={{ background: "#fff", borderRadius: 20, padding: "48px 24px", textAlign: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <ShoppingCart size={48} color="#E2E8F0" style={{ margin: "0 auto 16px" }} />
            <p style={{ color: "#94A3B8", fontSize: 14, margin: 0 }}>Keine Produkte in der DB</p>
            <p style={{ color: "#CBD5E1", fontSize: 12, marginTop: 4 }}>Im Lieferanten-Tab importieren</p>
          </div>
        )}
      </div>
    </div>
  );
}
