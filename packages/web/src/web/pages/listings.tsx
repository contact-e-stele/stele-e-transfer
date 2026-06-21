/**
 * Listings-Tab — alle eBay Listings direkt von eBay + App-DB Match
 */
import { useState, useEffect, useCallback } from "react";
import {
  ShoppingCart, RefreshCw, Loader, CheckCircle, XCircle,
  ExternalLink, Package, TrendingUp, StopCircle, Link2, Link2Off,
  Search, Filter, Edit2, Check, X,
} from "lucide-react";

interface EbayListing {
  itemId: string;
  title: string;
  currentPrice: number;
  currency: string;
  quantity: number;
  quantitySold: number;
  imageUrl: string | null;
  viewItemUrl: string;
  listingType: string;
  startTime: string;
  endTime: string;
  appProduct: {
    id: number;
    ebayListingId: string;
    buyPrice: number | null;
    sellPrice: number | null;
    asin: string;
    sourceUrl: string | null;
    generatedTitle: string;
  } | null;
}

type FilterMode = "all" | "linked" | "unlinked";

export default function Listings() {
  const [listings, setListings] = useState<EbayListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  // Preis-Editing
  const [editingPrice, setEditingPrice] = useState<string | null>(null); // itemId
  const [priceInput, setPriceInput] = useState("");
  const [priceSaving, setPriceSaving] = useState<string | null>(null);
  const [priceResult, setPriceResult] = useState<Record<string, { ok?: boolean; err?: string }>>({});

  // Ending
  const [endingId, setEndingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ebay/listings");
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? `Fehler ${res.status}`);
      }
      const data = await res.json() as { listings: EbayListing[]; total: number };
      setListings(data.listings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ladefehler");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePriceEdit = (listing: EbayListing) => {
    setEditingPrice(listing.itemId);
    setPriceInput(listing.currentPrice.toFixed(2));
    setPriceResult(r => ({ ...r, [listing.itemId]: {} }));
  };

  const handlePriceSave = async (itemId: string) => {
    const price = parseFloat(priceInput.replace(",", "."));
    if (!price || price <= 0) return;
    setPriceSaving(itemId);
    try {
      const res = await fetch(`/api/ebay/listings/${itemId}/price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ price }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setPriceResult(r => ({ ...r, [itemId]: { ok: true } }));
        setListings(prev => prev.map(l => l.itemId === itemId ? { ...l, currentPrice: price } : l));
      } else {
        setPriceResult(r => ({ ...r, [itemId]: { err: data.error ?? "Fehler" } }));
      }
    } catch (e) {
      setPriceResult(r => ({ ...r, [itemId]: { err: String(e) } }));
    } finally {
      setPriceSaving(null);
      setEditingPrice(null);
    }
  };

  const handleEnd = async (itemId: string) => {
    if (!confirm("eBay Listing wirklich beenden?")) return;
    setEndingId(itemId);
    try {
      const res = await fetch(`/api/ebay/listings/${itemId}`, { method: "DELETE" });
      const data = await res.json() as { ok?: boolean; warning?: string; error?: string };
      if (data.ok || data.warning) {
        setListings(prev => prev.filter(l => l.itemId !== itemId));
      } else {
        alert(data.error ?? "Fehler beim Beenden");
      }
    } finally {
      setEndingId(null);
    }
  };

  // Filter + Suche
  const filtered = listings.filter(l => {
    if (filter === "linked" && !l.appProduct) return false;
    if (filter === "unlinked" && l.appProduct) return false;
    if (search) {
      const q = search.toLowerCase();
      return l.title.toLowerCase().includes(q) || l.itemId.includes(q);
    }
    return true;
  });

  const linked = listings.filter(l => l.appProduct).length;
  const unlinked = listings.filter(l => !l.appProduct).length;

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#FFD700", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShoppingCart size={22} color="#0F172A" />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", margin: 0 }}>eBay Listings</h1>
              <p style={{ fontSize: 12, color: "#64748B", margin: 0 }}>{listings.length} Listings · {linked} verknüpft · {unlinked} nicht verknüpft</p>
            </div>
          </div>
          <button onClick={load} disabled={loading} style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 10,
            padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#475569",
            cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
          }}>
            <RefreshCw size={14} style={loading ? { animation: "spin 1s linear infinite" } : {}} />
            Laden
          </button>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
          {[
            { label: "Gesamt", value: listings.length, color: "#8B5CF6", bg: "#F5F3FF", icon: <Package size={16} color="#8B5CF6" /> },
            { label: "Verknüpft", value: linked, color: "#16A34A", bg: "#F0FDF4", icon: <Link2 size={16} color="#16A34A" /> },
            { label: "Ohne App", value: unlinked, color: "#F59E0B", bg: "#FFFBEB", icon: <Link2Off size={16} color="#F59E0B" /> },
            { label: "Verkäufe", value: listings.reduce((a, l) => a + l.quantitySold, 0), color: "#0EA5E9", bg: "#F0F9FF", icon: <TrendingUp size={16} color="#0EA5E9" /> },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Suche + Filter */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search size={14} color="#94A3B8" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Titel oder Item-ID suchen…"
              style={{
                width: "100%", padding: "10px 12px 10px 34px", fontSize: 13,
                border: "1.5px solid #E2E8F0", borderRadius: 10, outline: "none",
                fontFamily: "inherit", boxSizing: "border-box", color: "#0F172A", background: "#fff",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {(["all", "linked", "unlinked"] as FilterMode[]).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "8px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                border: "1.5px solid " + (filter === f ? "#FFD700" : "#E2E8F0"),
                background: filter === f ? "#FFF8DC" : "#fff",
                color: filter === f ? "#92400E" : "#64748B",
                cursor: "pointer", fontFamily: "inherit",
              }}>
                {f === "all" ? "Alle" : f === "linked" ? "Verknüpft" : "Ohne App"}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ background: "#FEF2F2", borderRadius: 12, padding: "14px 18px", marginBottom: 16, color: "#DC2626", fontSize: 13, fontWeight: 600 }}>
            ✗ {error}
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: 64 }}>
            <Loader size={32} style={{ animation: "spin 1s linear infinite", margin: "0 auto 12px" }} color="#FFD700" />
            <div style={{ color: "#94A3B8", fontSize: 13 }}>eBay Listings werden geladen…</div>
          </div>
        )}

        {/* Listings */}
        {!loading && filtered.map(listing => {
          const isLinked = !!listing.appProduct;
          const margin = isLinked && listing.appProduct!.buyPrice
            ? ((listing.currentPrice - listing.appProduct!.buyPrice) / listing.currentPrice * 100)
            : null;
          const isEditing = editingPrice === listing.itemId;
          const pRes = priceResult[listing.itemId];

          return (
            <div key={listing.itemId} style={{
              background: "#fff", borderRadius: 16, padding: 16,
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 10,
              borderLeft: `4px solid ${isLinked ? "#22C55E" : "#F59E0B"}`,
            }}>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                {/* Bild */}
                {listing.imageUrl ? (
                  <img src={listing.imageUrl} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
                ) : (
                  <div style={{ width: 56, height: 56, borderRadius: 8, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Package size={20} color="#CBD5E1" />
                  </div>
                )}

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", lineHeight: 1.4, marginBottom: 4 }}>
                    {listing.title.length > 80 ? listing.title.slice(0, 80) + "…" : listing.title}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {/* Preis */}
                    {isEditing ? (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <input
                          type="number" step="0.01" value={priceInput}
                          onChange={e => setPriceInput(e.target.value)}
                          autoFocus
                          style={{
                            width: 80, padding: "4px 8px", fontSize: 13, fontWeight: 700,
                            border: "2px solid #FFD700", borderRadius: 6, outline: "none",
                            fontFamily: "inherit", color: "#0F172A",
                          }}
                        />
                        <span style={{ fontSize: 12, color: "#64748B" }}>€</span>
                        <button onClick={() => handlePriceSave(listing.itemId)} disabled={priceSaving === listing.itemId} style={{
                          padding: "4px 8px", borderRadius: 6, border: "none",
                          background: "#22C55E", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center",
                        }}>
                          {priceSaving === listing.itemId ? <Loader size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={12} />}
                        </button>
                        <button onClick={() => setEditingPrice(null)} style={{
                          padding: "4px 8px", borderRadius: 6, border: "none",
                          background: "#F1F5F9", color: "#64748B", cursor: "pointer",
                        }}>
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => handlePriceEdit(listing)} style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        background: "none", border: "none", cursor: "pointer", padding: 0,
                      }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: "#1D4ED8" }}>
                          {listing.currentPrice.toFixed(2)} €
                        </span>
                        <Edit2 size={11} color="#94A3B8" />
                      </button>
                    )}

                    {/* EK + Marge wenn verknüpft */}
                    {isLinked && listing.appProduct!.buyPrice && (
                      <>
                        <span style={{ fontSize: 11, color: "#64748B" }}>EK: {listing.appProduct!.buyPrice.toFixed(2)} €</span>
                        {margin !== null && (
                          <span style={{
                            fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 2,
                            color: margin > 15 ? "#16A34A" : margin > 5 ? "#F59E0B" : "#DC2626",
                          }}>
                            <TrendingUp size={10} /> {margin.toFixed(1)}%
                          </span>
                        )}
                      </>
                    )}

                    {/* Verkäufe */}
                    {listing.quantitySold > 0 && (
                      <span style={{ fontSize: 11, color: "#0EA5E9", fontWeight: 600 }}>
                        {listing.quantitySold}× verkauft
                      </span>
                    )}

                    {/* Verknüpfungs-Badge */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 6,
                      background: isLinked ? "#F0FDF4" : "#FFFBEB",
                      color: isLinked ? "#16A34A" : "#D97706",
                      display: "inline-flex", alignItems: "center", gap: 3,
                    }}>
                      {isLinked ? <><Link2 size={9} /> In App</> : <><Link2Off size={9} /> Nicht verknüpft</>}
                    </span>
                  </div>

                  {/* Item ID */}
                  <div style={{ fontSize: 10, color: "#CBD5E1", marginTop: 4 }}>ID: {listing.itemId}</div>

                  {/* Preis-Ergebnis */}
                  {pRes?.ok && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "#16A34A", fontWeight: 600 }}>✓ Preis aktualisiert</div>
                  )}
                  {pRes?.err && (
                    <div style={{ marginTop: 6, fontSize: 11, color: "#DC2626", fontWeight: 600 }}>✗ {pRes.err}</div>
                  )}
                </div>

                {/* Aktionen */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                  <a href={listing.viewItemUrl} target="_blank" rel="noopener noreferrer" style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "6px 10px", borderRadius: 8, background: "#FFD700", color: "#0F172A",
                    fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: "inherit",
                  }}>
                    <ExternalLink size={10} /> eBay
                  </a>
                  <button
                    onClick={() => handleEnd(listing.itemId)}
                    disabled={endingId === listing.itemId}
                    title="Listing beenden"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8,
                      background: "#FFF7ED", border: "1.5px solid #FDE68A",
                      color: "#92400E", fontSize: 11, fontWeight: 700,
                      cursor: endingId === listing.itemId ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {endingId === listing.itemId
                      ? <Loader size={10} style={{ animation: "spin 1s linear infinite" }} />
                      : <StopCircle size={10} />}
                    Ende
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {!loading && filtered.length === 0 && !error && (
          <div style={{ background: "#fff", borderRadius: 20, padding: "48px 24px", textAlign: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <ShoppingCart size={48} color="#E2E8F0" style={{ margin: "0 auto 16px" }} />
            <p style={{ color: "#94A3B8", fontSize: 14, margin: 0 }}>
              {search ? "Keine Treffer" : "Keine aktiven eBay Listings gefunden"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
