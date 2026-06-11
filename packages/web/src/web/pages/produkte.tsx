/**
 * Produkte-Tab — eigene Produktdatenbank
 * Zeigt alle importierten Produkte, Preisänderungen, eBay-Status
 */
import { useState, useEffect } from "react";
import {
  Package, ExternalLink, RefreshCw, ShoppingCart,
  Clock, CheckCircle, XCircle, Loader, TrendingUp,
  TrendingDown, AlertTriangle, Search, Trash2, Layers, Plus, X, Eye,
} from "lucide-react";

interface VariantGroup {
  name: string;
  values: string[];
}

interface Product {
  id: number;
  asin: string;
  sourceUrl: string;
  amazonUrl: string;
  title: string;
  generatedTitle: string;
  htmlDescription: string;
  bullets: string[];
  variants: string[] | VariantGroup[];
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
  // Gleiche Formel wie Preise-Tab: 18% × 1.19 MwSt + 0.45€ × 1.19
  const ebayFee = sell ? sell * (0.18 * 1.19) + (0.45 * 1.19) : 0;
  const margin = (buy && sell) ? ((sell - buy - ebayFee) / sell * 100) : null;
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

// Hilfsfunktion: Varianten aus DB-Format lesen (entweder alt: string[] oder neu: VariantGroup[])
function parseVariants(raw: string[] | VariantGroup[]): VariantGroup[] {
  if (!raw || raw.length === 0) return [];
  if (typeof raw[0] === "object" && "name" in raw[0]) {
    return raw as VariantGroup[];
  }
  return [];
}

interface VariantenModalProps {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}

function VariantenModal({ product, onClose, onSaved }: VariantenModalProps) {
  const [groups, setGroups] = useState<VariantGroup[]>(() => parseVariants(product.variants));
  const [newGroupName, setNewGroupName] = useState("");
  const [newValues, setNewValues] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    setGroups(g => [...g, { name, values: [] }]);
    setNewGroupName("");
  };

  const removeGroup = (idx: number) => {
    setGroups(g => g.filter((_, i) => i !== idx));
  };

  const addValue = (groupIdx: number) => {
    const val = (newValues[groupIdx] ?? "").trim();
    if (!val) return;
    setGroups(g => g.map((group, i) =>
      i === groupIdx ? { ...group, values: [...group.values, val] } : group
    ));
    setNewValues(v => ({ ...v, [groupIdx]: "" }));
  };

  const removeValue = (groupIdx: number, valIdx: number) => {
    setGroups(g => g.map((group, i) =>
      i === groupIdx ? { ...group, values: group.values.filter((_, j) => j !== valIdx) } : group
    ));
  };

  const save = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`/api/products/${product.id}/variants`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variants: groups }),
      });
      if (res.ok) {
        setSaveMsg("Gespeichert!");
        onSaved();
        setTimeout(onClose, 800);
      } else {
        setSaveMsg("Fehler beim Speichern");
      }
    } catch {
      setSaveMsg("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  };

  const totalCombos = groups.reduce((acc, g) => acc * (g.values.length || 1), 1);
  const hasRealVariants = groups.some(g => g.values.length > 0);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 20, padding: 24, maxWidth: 480, width: "100%",
        maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0F172A" }}>Varianten bearbeiten</h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748B" }}>{product.generatedTitle.slice(0, 50)}…</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Info */}
        <div style={{ background: "#EFF6FF", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#1D4ED8" }}>
          Füge Varianten-Gruppen hinzu (z.B. "Farbe", "Größe") und trage die möglichen Werte ein.
          {hasRealVariants && <><br /><strong>{totalCombos} Kombinationen</strong> → wird als eBay Variation Listing gelistet.</>}
        </div>

        {/* Gruppen */}
        {groups.map((group, gi) => (
          <div key={gi} style={{ border: "1.5px solid #E2E8F0", borderRadius: 12, padding: 14, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14, color: "#0F172A" }}>{group.name}</span>
              <button onClick={() => removeGroup(gi)} style={{ background: "#FEF2F2", border: "none", borderRadius: 6, padding: "3px 8px", color: "#DC2626", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Gruppe löschen
              </button>
            </div>

            {/* Werte */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {group.values.map((val, vi) => (
                <span key={vi} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  background: "#F5F3FF", color: "#7C3AED", padding: "4px 10px",
                  borderRadius: 20, fontSize: 12, fontWeight: 700,
                }}>
                  {val}
                  <button onClick={() => removeValue(gi, vi)} style={{ background: "none", border: "none", cursor: "pointer", color: "#A78BFA", padding: 0, display: "flex", alignItems: "center" }}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              {group.values.length === 0 && (
                <span style={{ fontSize: 11, color: "#CBD5E1" }}>Noch keine Werte</span>
              )}
            </div>

            {/* Wert hinzufügen */}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="Wert eingeben (z.B. Rot)"
                value={newValues[gi] ?? ""}
                onChange={e => setNewValues(v => ({ ...v, [gi]: e.target.value }))}
                onKeyDown={e => e.key === "Enter" && addValue(gi)}
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: 8,
                  border: "2px solid #E2E8F0", fontSize: 12, fontFamily: "inherit", outline: "none",
                }}
              />
              <button onClick={() => addValue(gi)} style={{
                padding: "6px 12px", borderRadius: 8, background: "#7C3AED", color: "#fff",
                border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                <Plus size={12} /> Hinzufügen
              </button>
            </div>
          </div>
        ))}

        {/* Neue Gruppe */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Gruppe hinzufügen (z.B. Farbe, Größe)"
            value={newGroupName}
            onChange={e => setNewGroupName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && addGroup()}
            style={{
              flex: 1, padding: "8px 12px", borderRadius: 10,
              border: "2px dashed #C4B5FD", fontSize: 13, fontFamily: "inherit", outline: "none",
              color: "#7C3AED", background: "#FAFAFE",
            }}
          />
          <button onClick={addGroup} style={{
            padding: "8px 14px", borderRadius: 10, background: "#F5F3FF", color: "#7C3AED",
            border: "2px dashed #C4B5FD", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <Plus size={13} /> Gruppe
          </button>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          {saveMsg && (
            <span style={{ fontSize: 12, fontWeight: 700, color: saveMsg.includes("Fehler") || saveMsg.includes("Netzwerk") ? "#DC2626" : "#16A34A" }}>
              {saveMsg}
            </span>
          )}
          <button onClick={onClose} style={{
            padding: "8px 16px", borderRadius: 10, background: "#F1F5F9", color: "#64748B",
            border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>
            Abbrechen
          </button>
          <button onClick={save} disabled={saving} style={{
            padding: "8px 20px", borderRadius: 10, background: "#7C3AED", color: "#fff",
            border: "none", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            {saving ? <Loader size={13} style={{ animation: "spin 1s linear infinite" }} /> : null}
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Produkte() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [checkingPrice, setCheckingPrice] = useState<number | null>(null);
  const [listingProduct, setListingProduct] = useState<number | null>(null);
  const [listingResult, setListingResult] = useState<{ id: number; success: boolean; msg: string } | null>(null);
  const [locationMsg, setLocationMsg] = useState("");
  const [editingPrice, setEditingPrice] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [editingTitle, setEditingTitle] = useState<number | null>(null);
  const [titleInput, setTitleInput] = useState("");
  const [variantenModal, setVariantenModal] = useState<Product | null>(null);
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);

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

  const saveTitle = async (productId: number) => {
    const t = titleInput.trim();
    if (!t) return;
    await fetch(`/api/products/${productId}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generatedTitle: t.slice(0, 80) }),
    });
    setEditingTitle(null);
    setTitleInput("");
    load();
  };

  const saveSellPrice = async (productId: number) => {
    const price = parseFloat(priceInput.replace(",", "."));
    if (isNaN(price) || price <= 0) return;
    await fetch(`/api/products/${productId}/sellprice`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sellPrice: price }),
    });
    setEditingPrice(null);
    setPriceInput("");
    load();
  };

  const deleteProduct = async (product: Product) => {
    if (!confirm(`"${product.generatedTitle.slice(0, 50)}…" aus DB löschen?`)) return;
    await fetch(`/api/products/${product.id}`, { method: "DELETE" });
    load();
  };

  const endEbayListing = async (product: Product) => {
    if (!confirm(`eBay Listing #${product.ebayListingId} beenden?`)) return;
    const res = await fetch(`/api/products/${product.id}/ebay-listing`, { method: "DELETE" });
    const data = await res.json() as { ok?: boolean; error?: string };
    if (data.ok) {
      setListingResult({ id: product.id, success: true, msg: "eBay Listing beendet" });
    } else {
      setListingResult({ id: product.id, success: false, msg: data.error ?? "Fehler" });
    }
    load();
  };

  const listOnEbay = async (product: Product) => {
    setListingProduct(product.id);
    setListingResult(null);
    try {
      const res = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id }),
      });
      const data = await res.json() as { listingId?: string; success?: boolean; error?: string };
      if (data.success && data.listingId) {
        setListingResult({ id: product.id, success: true, msg: `eBay Listing erstellt: #${data.listingId}` });
        load();
      } else {
        setListingResult({ id: product.id, success: false, msg: data.error ?? "Unbekannter Fehler" });
        load();
      }
    } catch (e) {
      setListingResult({ id: product.id, success: false, msg: e instanceof Error ? e.message : "Netzwerkfehler" });
    } finally {
      setListingProduct(null);
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
      {variantenModal && (
        <VariantenModal
          product={variantenModal}
          onClose={() => setVariantenModal(null)}
          onSaved={load}
        />
      )}

      {/* Beschreibungs-Preview Modal */}
      {previewProduct && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16,
        }} onClick={() => setPreviewProduct(null)}>
          <div style={{
            background: "#fff", borderRadius: 16, width: "100%", maxWidth: 800,
            maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, background: "#fff", zIndex: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>eBay Beschreibungs-Vorschau</span>
              <button onClick={() => setPreviewProduct(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 8, display: "flex" }}>
                <X size={18} color="#94A3B8" />
              </button>
            </div>
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 12 }}>So wird die Beschreibung im eBay Listing angezeigt:</div>
              <div dangerouslySetInnerHTML={{ __html: previewProduct.htmlDescription }} />
            </div>
          </div>
        </div>
      )}
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
          <button onClick={async () => {
            setLocationMsg("...");
            const res = await fetch("/api/ebay/setup-location", { method: "POST" });
            const d = await res.json() as { ok?: boolean; status?: string; error?: string };
            setLocationMsg(d.error ?? (d.status === "already_exists" ? "✓ Location existiert bereits" : "✓ Location angelegt"));
            setTimeout(() => setLocationMsg(""), 4000);
          }} style={{
            background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 10,
            padding: "8px 14px", fontSize: 12, fontWeight: 600, color: "#1D4ED8",
            cursor: "pointer", fontFamily: "inherit",
          }}>
            eBay Location Setup
          </button>
        </div>
        {locationMsg && <div style={{ marginBottom: 12, padding: "8px 14px", borderRadius: 8, background: "#F0FDF4", color: "#15803D", fontSize: 13, fontWeight: 600 }}>{locationMsg}</div>}

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
                  {editingTitle === product.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                      <input
                        type="text"
                        maxLength={80}
                        value={titleInput}
                        onChange={e => setTitleInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveTitle(product.id); if (e.key === "Escape") setEditingTitle(null); }}
                        autoFocus
                        style={{ flex: 1, padding: "5px 10px", borderRadius: 8, border: "2px solid #F59E0B", fontSize: 13, fontFamily: "inherit", outline: "none" }}
                      />
                      <button onClick={() => saveTitle(product.id)} style={{ padding: "5px 10px", borderRadius: 8, background: "#F59E0B", color: "#fff", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>✓</button>
                      <button onClick={() => setEditingTitle(null)} style={{ padding: "5px 8px", borderRadius: 8, background: "#F1F5F9", color: "#64748B", border: "none", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>✕</button>
                    </div>
                  ) : (
                    <div
                      onClick={() => { setEditingTitle(product.id); setTitleInput(product.generatedTitle); }}
                      title="Klicken zum Bearbeiten"
                      style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", lineHeight: 1.4, marginBottom: 6, cursor: "pointer", borderRadius: 6, padding: "2px 4px", margin: "-2px -4px 4px", transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#FEF9C3")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      {product.generatedTitle}
                    </div>
                  )}
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
                  {/* VK Preis setzen */}
                  {editingPrice === product.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="VK Preis z.B. 19.99"
                        value={priceInput}
                        onChange={e => setPriceInput(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && saveSellPrice(product.id)}
                        autoFocus
                        style={{ width: 140, padding: "5px 10px", borderRadius: 8, border: "2px solid #8B5CF6", fontSize: 13, fontFamily: "inherit", outline: "none" }}
                      />
                      <button onClick={() => saveSellPrice(product.id)} style={{ padding: "5px 12px", borderRadius: 8, background: "#8B5CF6", color: "#fff", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                        Speichern
                      </button>
                      <button onClick={() => setEditingPrice(null)} style={{ padding: "5px 10px", borderRadius: 8, background: "#F1F5F9", color: "#64748B", border: "none", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingPrice(product.id); setPriceInput(product.sellPrice?.toFixed(2) ?? ""); }} style={{ marginTop: 6, padding: "3px 10px", borderRadius: 6, background: "#F5F3FF", color: "#8B5CF6", border: "1px solid #DDD6FE", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                      {product.sellPrice ? "VK ändern" : "VK Preis setzen"}
                    </button>
                  )}
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
                {product.ebayStatus !== "listed" && (
                  <button
                    onClick={() => listOnEbay(product)}
                    disabled={listingProduct === product.id}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 12px", borderRadius: 8,
                      background: listingProduct === product.id ? "#E2E8F0" : "#FFD700",
                      color: "#0F172A", fontSize: 11, fontWeight: 700,
                      border: "none", cursor: listingProduct === product.id ? "not-allowed" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {listingProduct === product.id
                      ? <><Loader size={11} style={{ animation: "spin 1s linear infinite" }} /> Wird gelistet…</>
                      : <><ShoppingCart size={11} /> Bei eBay listen</>
                    }
                  </button>
                )}
                {product.ebayStatus === "listed" && product.ebayListingId && (
                  <>
                    <a href={`https://www.ebay.de/itm/${product.ebayListingId}`} target="_blank" rel="noopener noreferrer" style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8, background: "#FFD700", color: "#0F172A",
                      fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: "inherit",
                    }}>
                      <ShoppingCart size={11} /> eBay ansehen
                    </a>
                    <button onClick={() => endEbayListing(product)} style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8, background: "#FEF2F2", color: "#DC2626",
                      fontSize: 11, fontWeight: 700, border: "1px solid #FECACA", cursor: "pointer", fontFamily: "inherit",
                    }}>
                      <XCircle size={11} /> Listing beenden
                    </button>
                  </>
                )}
                {/* Beschreibung Preview */}
                <button onClick={() => setPreviewProduct(product)} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "6px 10px", borderRadius: 8, background: "#F0FDF4", color: "#16A34A",
                  fontSize: 11, fontWeight: 700, border: "1px solid #BBF7D0", cursor: "pointer", fontFamily: "inherit",
                }}>
                  <Eye size={11} /> Vorschau
                </button>

                {/* Varianten */}
                <button onClick={() => setVariantenModal(product)} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "6px 10px", borderRadius: 8, background: "#F5F3FF", color: "#7C3AED",
                  fontSize: 11, fontWeight: 700, border: "1px solid #DDD6FE", cursor: "pointer", fontFamily: "inherit",
                }}>
                  <Layers size={11} />
                  {parseVariants(product.variants).length > 0
                    ? `Varianten (${parseVariants(product.variants).length})`
                    : "Varianten"
                  }
                </button>

                {/* Produkt löschen */}
                <button onClick={() => deleteProduct(product)} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "6px 10px", borderRadius: 8, background: "#FEF2F2", color: "#DC2626",
                  fontSize: 11, fontWeight: 700, border: "1px solid #FECACA", cursor: "pointer", fontFamily: "inherit",
                }}>
                  <Trash2 size={11} /> Löschen
                </button>
              </div>

              {listingResult?.id === product.id && (
                <div style={{
                  fontSize: 11, padding: "6px 10px", borderRadius: 6, marginTop: 8, fontWeight: 600,
                  background: listingResult.success ? "#F0FDF4" : "#FEF2F2",
                  color: listingResult.success ? "#16A34A" : "#DC2626",
                }}>
                  {listingResult.msg}
                </div>
              )}
              {product.ebayError && !listingResult && (
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
