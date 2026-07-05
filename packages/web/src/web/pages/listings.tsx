/**
 * Listings-Tab — alle eBay Listings direkt von eBay + App-DB Match
 */
import { useState, useEffect, useCallback } from "react";
import {
  ShoppingCart, RefreshCw, Loader, CheckCircle, XCircle,
  ExternalLink, Package, TrendingUp, StopCircle, Link2, Link2Off,
  Search, Filter, Edit2, Check, X, Calendar, Clock, Tag, FileEdit, CheckSquare, Square,
} from "lucide-react";
import { buildEbayHTMLLight } from "../lib/ebay-description";

interface EbayListing {
  itemId: string;
  title: string;
  sku: string | null;
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
    adRate: number | null;
    lastPriceCheck: string | null;
  } | null;
}

type FilterMode = "all" | "linked" | "unlinked";

// Datum formatieren: "12.06.2025"
function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Verbleibende Tage bis Ablauf
function daysLeft(iso: string): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

function daysLeftColor(days: number): string {
  if (days <= 3) return "#DC2626";
  if (days <= 7) return "#F59E0B";
  return "#16A34A";
}

// "vor X Tagen" / "vor X Stunden" für Preis-Update-Zeitstempel
function timeAgo(iso: string | null): string {
  if (!iso) return "nie geprüft";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "nie geprüft";
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffH < 1) return "gerade eben";
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "vor 1 Tag";
  return `vor ${diffD} Tagen`;
}

function priceCheckColor(iso: string | null): string {
  if (!iso) return "#94A3B8";
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "#94A3B8";
  const diffDays = (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > 14) return "#DC2626";
  if (diffDays > 7) return "#F59E0B";
  return "#16A34A";
}

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

  // adRate inline edit per listing (keyed by appProduct.id)
  const [adRateValues, setAdRateValues] = useState<Record<number, number>>({});
  const [adRateSaving, setAdRateSaving] = useState<number | null>(null);
  const [adRateResult, setAdRateResult] = useState<Record<number, { ok?: boolean; err?: string }>>({});

  const handleAdRateChange = async (productId: number, newRate: number) => {
    setAdRateValues(prev => ({ ...prev, [productId]: newRate }));
    setAdRateSaving(productId);
    setAdRateResult(r => ({ ...r, [productId]: {} }));
    try {
      const res = await fetch(`/api/products/${productId}/adRate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adRate: newRate }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setAdRateResult(r => ({ ...r, [productId]: { ok: true } }));
        setListings(prev => prev.map(l =>
          l.appProduct?.id === productId
            ? { ...l, appProduct: { ...l.appProduct!, adRate: newRate } }
            : l
        ));
      } else {
        setAdRateResult(r => ({ ...r, [productId]: { err: data.error ?? "Fehler" } }));
      }
    } catch (e) {
      setAdRateResult(r => ({ ...r, [productId]: { err: String(e) } }));
    } finally {
      setAdRateSaving(null);
    }
  };

  // Erweiterte Filter
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [minSold, setMinSold] = useState("");
  const [maxSold, setMaxSold] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [sortBy, setSortBy] = useState<"default" | "sold_desc" | "sold_asc" | "price_desc" | "price_asc" | "end_asc" | "sku_asc" | "price_check_asc">("default");
  const [expiryFilter, setExpiryFilter] = useState<"all" | "3days" | "7days" | "30days">("all");

  // ─── Bearbeiten-Modal (Titel + Beschreibung, live auf eBay) ───────────────
  const [editListing, setEditListing] = useState<EbayListing | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBullets, setEditBullets] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveMsg, setEditSaveMsg] = useState("");

  // ─── Mehrfachauswahl + Massenaktionen ──────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | "price" | "adrate" | "category" | "end">(null);
  const [bulkPriceMode, setBulkPriceMode] = useState<"percent" | "fixed" | "set">("percent");
  const [bulkPriceValue, setBulkPriceValue] = useState("");
  const [bulkAdRate, setBulkAdRate] = useState(5);
  const [bulkCategoryId, setBulkCategoryId] = useState("");
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResults, setBulkResults] = useState<Array<{ itemId: string; ok: boolean; error?: string; oldPrice?: number; newPrice?: number }>>([]);

  const toggleSelect = (itemId: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000); // 2 Min Timeout
      let res: Response;
      try {
        res = await fetch(`/api/ebay/listings${forceRefresh ? "?refresh=1" : ""}`, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) {
        let errMsg = `Fehler ${res.status}`;
        try { const d = await res.json() as { error?: string }; errMsg = d.error ?? errMsg; } catch { /* ignore */ }
        throw new Error(errMsg);
      }
      let text = "";
      try {
        text = await res.text();
        const data = JSON.parse(text) as { listings: EbayListing[]; total: number };
        setListings(data.listings);
      } catch {
        console.error("JSON parse error, raw:", text.slice(0, 200));
        throw new Error("Antwort konnte nicht gelesen werden — bitte nochmal laden");
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setError("Timeout — eBay braucht zu lange, bitte nochmal versuchen");
      } else {
        setError(e instanceof Error ? e.message : "Ladefehler");
      }
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

  // ─── Bearbeiten-Modal öffnen/speichern ─────────────────────────────────────
  const openEdit = (listing: EbayListing) => {
    setEditListing(listing);
    setEditTitle(listing.appProduct?.generatedTitle || listing.title);
    setEditBullets("");
    setEditSaveMsg("");
  };

  const handleEditSave = async () => {
    if (!editListing) return;
    setEditSaving(true);
    setEditSaveMsg("");
    try {
      const bullets = editBullets.split("\n").map(s => s.trim()).filter(Boolean);
      const html = bullets.length > 0
        ? buildEbayHTMLLight({ title: editTitle, bullets })
        : undefined;
      const res = await fetch(`/api/ebay/listings/${editListing.itemId}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: editTitle, ...(html ? { htmlDescription: html } : {}) }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (data.ok) {
        setListings(prev => prev.map(l => l.itemId === editListing.itemId ? { ...l, title: editTitle } : l));
        setEditSaveMsg("✓ Auf eBay aktualisiert");
      } else {
        setEditSaveMsg("✗ Fehler: " + (data.error ?? "unbekannt"));
      }
    } catch (e) {
      setEditSaveMsg("✗ Fehler: " + String(e));
    } finally {
      setEditSaving(false);
    }
  };

  // ─── Massenaktionen ausführen ──────────────────────────────────────────────
  const runBulk = async (endpoint: string, body: Record<string, unknown>) => {
    setBulkRunning(true);
    setBulkResults([]);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: Array.from(selected), ...body }),
      });
      const data = await res.json() as { results?: Array<{ itemId: string; ok: boolean; error?: string; oldPrice?: number; newPrice?: number }>; error?: string };
      if (data.results) {
        setBulkResults(data.results);
        // Erfolgreiche Beendigungen aus Liste entfernen
        if (endpoint.endsWith("/end")) {
          const endedIds = new Set(data.results.filter(r => r.ok).map(r => r.itemId));
          setListings(prev => prev.filter(l => !endedIds.has(l.itemId)));
        }
        // Erfolgreiche Preisänderungen live in Liste übernehmen
        if (endpoint.endsWith("/price")) {
          const priceMap = new Map(data.results.filter(r => r.ok && r.newPrice).map(r => [r.itemId, r.newPrice!]));
          setListings(prev => prev.map(l => priceMap.has(l.itemId) ? { ...l, currentPrice: priceMap.get(l.itemId)! } : l));
        }
      } else {
        alert(data.error ?? "Fehler bei Massenaktion");
      }
    } catch (e) {
      alert("Fehler: " + String(e));
    } finally {
      setBulkRunning(false);
    }
  };

  const handleBulkEnd = () => {
    if (!confirm(`${selected.size} Listings wirklich beenden?`)) return;
    runBulk("/api/ebay/listings/bulk/end", {});
  };
  const handleBulkAdRate = () => runBulk("/api/ebay/listings/bulk/adrate", { ratePercent: bulkAdRate });
  const handleBulkCategory = () => {
    if (!bulkCategoryId.trim()) return;
    runBulk("/api/ebay/listings/bulk/category", { categoryId: bulkCategoryId.trim() });
  };
  const handleBulkPrice = () => {
    const value = parseFloat(bulkPriceValue.replace(",", "."));
    if (isNaN(value)) return;
    runBulk("/api/ebay/listings/bulk/price", { mode: bulkPriceMode, value });
  };

  // Filter + Suche
  const filtered = listings
    .filter(l => {
      if (filter === "linked" && !l.appProduct) return false;
      if (filter === "unlinked" && l.appProduct) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!l.title.toLowerCase().includes(q) && !l.itemId.includes(q) && !(l.sku ?? "").toLowerCase().includes(q)) return false;
      }
      if (minSold !== "" && l.quantitySold < parseInt(minSold)) return false;
      if (maxSold !== "" && l.quantitySold > parseInt(maxSold)) return false;
      if (minPrice !== "" && l.currentPrice < parseFloat(minPrice.replace(",", "."))) return false;
      if (maxPrice !== "" && l.currentPrice > parseFloat(maxPrice.replace(",", "."))) return false;
      if (expiryFilter !== "all" && l.endTime) {
        const left = daysLeft(l.endTime);
        if (left === null) return true;
        if (expiryFilter === "3days" && left > 3) return false;
        if (expiryFilter === "7days" && left > 7) return false;
        if (expiryFilter === "30days" && left > 30) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "sold_desc") return b.quantitySold - a.quantitySold;
      if (sortBy === "sold_asc") return a.quantitySold - b.quantitySold;
      if (sortBy === "price_desc") return b.currentPrice - a.currentPrice;
      if (sortBy === "price_asc") return a.currentPrice - b.currentPrice;
      if (sortBy === "end_asc") {
        const da = a.endTime ? new Date(a.endTime).getTime() : Infinity;
        const db_ = b.endTime ? new Date(b.endTime).getTime() : Infinity;
        return da - db_;
      }
      if (sortBy === "sku_asc") return (a.sku ?? "").localeCompare(b.sku ?? "");
      if (sortBy === "price_check_asc") {
        const ta = a.appProduct?.lastPriceCheck ? new Date(a.appProduct.lastPriceCheck.replace(" ", "T") + "Z").getTime() : -Infinity;
        const tb = b.appProduct?.lastPriceCheck ? new Date(b.appProduct.lastPriceCheck.replace(" ", "T") + "Z").getTime() : -Infinity;
        return ta - tb; // älteste zuerst
      }
      return 0;
    });

  const linked = listings.filter(l => l.appProduct).length;
  const unlinked = listings.filter(l => !l.appProduct).length;

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      {/* Bearbeiten-Modal — Titel + Bullets, sofort live auf eBay */}
      {editListing && (() => {
        const bullets = editBullets.split("\n").map(s => s.trim()).filter(Boolean);
        let liveHtml = "";
        try { liveHtml = bullets.length > 0 ? buildEbayHTMLLight({ title: editTitle, bullets }) : ""; } catch { /* ignore */ }
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={() => setEditListing(null)}>
            <div style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 780, maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }} onClick={e => e.stopPropagation()}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, background: "#fff", zIndex: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Listing bearbeiten — live auf eBay</span>
                <button onClick={() => setEditListing(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 8, display: "flex" }}>
                  <X size={18} color="#94A3B8" />
                </button>
              </div>
              <div style={{ padding: "16px 20px" }}>
                <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 12 }}>Item-ID: {editListing.itemId}{editListing.sku ? ` · SKU: ${editListing.sku}` : ""}</div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>EBAY TITEL (max. 80 Zeichen)</label>
                  <input value={editTitle} onChange={e => setEditTitle(e.target.value)} maxLength={80} style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1",
                    fontSize: 13, fontFamily: "inherit", color: "#0F172A", background: "#fff", boxSizing: "border-box",
                  }} />
                  <div style={{ fontSize: 10, color: editTitle.length > 75 ? "#DC2626" : "#94A3B8", textAlign: "right", marginTop: 2 }}>{editTitle.length}/80</div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>BULLET-POINTS (eine pro Zeile — leer lassen, um Beschreibung unverändert zu lassen)</label>
                  <textarea value={editBullets} onChange={e => setEditBullets(e.target.value)} rows={6} style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1",
                    fontSize: 12, fontFamily: "inherit", color: "#0F172A", background: "#fff", resize: "vertical", boxSizing: "border-box", lineHeight: 1.6,
                  }} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <button onClick={handleEditSave} disabled={editSaving} style={{
                    padding: "8px 20px", borderRadius: 8, background: "#16A34A", color: "#fff",
                    fontSize: 13, fontWeight: 700, border: "none", cursor: editSaving ? "wait" : "pointer",
                    fontFamily: "inherit", opacity: editSaving ? 0.7 : 1,
                  }}>
                    {editSaving ? "Speichert…" : "Auf eBay speichern"}
                  </button>
                  {editSaveMsg && (
                    <span style={{ fontSize: 12, color: editSaveMsg.startsWith("✓") ? "#16A34A" : "#DC2626", fontWeight: 600 }}>{editSaveMsg}</span>
                  )}
                </div>
                {liveHtml && (
                  <div>
                    <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 8 }}>Live-Vorschau (Beschreibung wird bei Speichern übernommen):</div>
                    <div dangerouslySetInnerHTML={{ __html: liveHtml }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

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
          <button onClick={() => load(true)} disabled={loading} style={{
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

        {/* Preis-Check Übersicht — ältester Stand + Anzahl überfällig */}
        {(() => {
          const withCheck = listings.filter(l => l.appProduct?.lastPriceCheck);
          const overdue = listings.filter(l => {
            const iso = l.appProduct?.lastPriceCheck;
            if (!iso) return true; // nie geprüft = überfällig
            const diffDays = (Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime()) / (1000 * 60 * 60 * 24);
            return diffDays > 14;
          });
          const oldest = withCheck.length > 0
            ? withCheck.reduce((a, b) => new Date(a.appProduct!.lastPriceCheck!.replace(" ", "T") + "Z") < new Date(b.appProduct!.lastPriceCheck!.replace(" ", "T") + "Z") ? a : b)
            : null;
          if (listings.length === 0) return null;
          return (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8,
              background: overdue.length > 0 ? "#FFFBEB" : "#F0FDF4",
              border: "1.5px solid " + (overdue.length > 0 ? "#FDE68A" : "#BBF7D0"),
              borderRadius: 12, padding: "10px 14px", marginBottom: 16, fontSize: 12,
            }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: overdue.length > 0 ? "#92400E" : "#16A34A", fontWeight: 700 }}>
                <RefreshCw size={13} />
                {overdue.length > 0
                  ? `${overdue.length} Listings seit über 14 Tagen nicht preisgeprüft`
                  : "Alle Listings kürzlich preisgeprüft"}
              </span>
              {oldest && (
                <span style={{ color: "#64748B", fontSize: 11 }}>
                  Ältester Stand: {timeAgo(oldest.appProduct!.lastPriceCheck)} ({oldest.title.slice(0, 40)}{oldest.title.length > 40 ? "…" : ""})
                </span>
              )}
            </div>
          );
        })()}

        {/* Suche + Filter */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search size={14} color="#94A3B8" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Titel, Item-ID oder SKU suchen…"
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
            <button onClick={() => setShowAdvanced(v => !v)} style={{
              padding: "8px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600,
              border: "1.5px solid " + (showAdvanced ? "#6366F1" : "#E2E8F0"),
              background: showAdvanced ? "#EEF2FF" : "#fff",
              color: showAdvanced ? "#4338CA" : "#64748B",
              cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 4,
            }}>
              <Filter size={12} /> Filter
            </button>
          </div>
        </div>

        {/* Erweiterte Filter Panel */}
        {showAdvanced && (
          <div style={{ background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              {/* Verkäufe */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Verkäufe</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" placeholder="Min" value={minSold} onChange={e => setMinSold(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
                  <span style={{ color: "#CBD5E1", fontSize: 11 }}>–</span>
                  <input type="number" placeholder="Max" value={maxSold} onChange={e => setMaxSold(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
                </div>
              </div>
              {/* Preis */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Preis (€)</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="number" placeholder="Min" value={minPrice} onChange={e => setMinPrice(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
                  <span style={{ color: "#CBD5E1", fontSize: 11 }}>–</span>
                  <input type="number" placeholder="Max" value={maxPrice} onChange={e => setMaxPrice(e.target.value)}
                    style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
                </div>
              </div>
              {/* Ablauf */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Läuft ab in</div>
                <select value={expiryFilter} onChange={e => setExpiryFilter(e.target.value as typeof expiryFilter)}
                  style={{ width: "100%", padding: "7px 10px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, outline: "none", fontFamily: "inherit", background: "#fff", color: "#0F172A" }}>
                  <option value="all">Alle</option>
                  <option value="3days">≤ 3 Tage</option>
                  <option value="7days">≤ 7 Tage</option>
                  <option value="30days">≤ 30 Tage</option>
                </select>
              </div>
            </div>
            {/* Sortierung */}
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Sortierung</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {([
                  ["default", "Standard"],
                  ["sold_desc", "Meistverkauft"],
                  ["sold_asc", "Wenigst verkauft"],
                  ["price_desc", "Preis ↓"],
                  ["price_asc", "Preis ↑"],
                  ["end_asc", "Läuft bald ab"],
                  ["sku_asc", "Nach SKU"],
                  ["price_check_asc", "Preis zuletzt geprüft (älteste zuerst)"],
                ] as [string, string][]).map(([val, label]) => (
                  <button key={val} onClick={() => setSortBy(val as typeof sortBy)} style={{
                    padding: "5px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600,
                    border: "1.5px solid " + (sortBy === val ? "#FFD700" : "#E2E8F0"),
                    background: sortBy === val ? "#FFF8DC" : "#F8FAFC",
                    color: sortBy === val ? "#92400E" : "#64748B",
                    cursor: "pointer", fontFamily: "inherit",
                  }}>{label}</button>
                ))}
              </div>
            </div>
            {/* Reset */}
            <button onClick={() => { setMinSold(""); setMaxSold(""); setMinPrice(""); setMaxPrice(""); setSortBy("default"); setExpiryFilter("all"); }}
              style={{ marginTop: 10, fontSize: 11, color: "#DC2626", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontWeight: 600 }}>
              ✕ Filter zurücksetzen
            </button>
          </div>
        )}

        {/* Ergebnisse Info */}
        {filtered.length !== listings.length && (
          <div style={{ fontSize: 12, color: "#64748B", marginBottom: 8 }}>
            {filtered.length} von {listings.length} Listings
          </div>
        )}

        {/* Mehrfachauswahl-Leiste */}
        {!loading && filtered.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <button
              onClick={() => {
                const allIds = filtered.map(l => l.itemId);
                const allSelected = allIds.every(id => selected.has(id));
                setSelected(allSelected ? new Set() : new Set(allIds));
              }}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#475569", fontFamily: "inherit" }}
            >
              {filtered.length > 0 && filtered.every(l => selected.has(l.itemId))
                ? <CheckSquare size={15} color="#6366F1" />
                : <Square size={15} color="#94A3B8" />}
              {selected.size > 0 ? `${selected.size} ausgewählt` : "Alle auswählen"}
            </button>
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#DC2626", fontFamily: "inherit", fontWeight: 600 }}>
                ✕ Auswahl aufheben
              </button>
            )}
          </div>
        )}

        {/* Bulk-Aktionsleiste */}
        {selected.size > 0 && (
          <div style={{ background: "#EEF2FF", border: "1.5px solid #C7D2FE", borderRadius: 12, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: bulkAction ? 10 : 0 }}>
              {([
                ["end", "Beenden"],
                ["adrate", "Anzeige-Rate"],
                ["category", "Kategorie"],
                ["price", "Preis"],
              ] as [typeof bulkAction, string][]).map(([val, label]) => (
                <button key={val} onClick={() => { setBulkAction(bulkAction === val ? null : val); setBulkResults([]); }} style={{
                  padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                  border: "1.5px solid " + (bulkAction === val ? "#6366F1" : "#C7D2FE"),
                  background: bulkAction === val ? "#6366F1" : "#fff",
                  color: bulkAction === val ? "#fff" : "#4338CA",
                  cursor: "pointer", fontFamily: "inherit",
                }}>{label}</button>
              ))}
            </div>

            {bulkAction === "end" && (
              <button onClick={handleBulkEnd} disabled={bulkRunning} style={{
                padding: "8px 16px", borderRadius: 8, border: "none", background: "#DC2626", color: "#fff",
                fontSize: 12, fontWeight: 700, cursor: bulkRunning ? "not-allowed" : "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {bulkRunning && <Loader size={12} style={{ animation: "spin 1s linear infinite" }} />}
                {selected.size} Listings jetzt beenden
              </button>
            )}

            {bulkAction === "adrate" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <select value={bulkAdRate} onChange={e => setBulkAdRate(parseFloat(e.target.value))} style={{
                  padding: "7px 10px", fontSize: 12, border: "1.5px solid #C7D2FE", borderRadius: 8, outline: "none", fontFamily: "inherit", background: "#fff", color: "#0F172A",
                }}>
                  {[2, 3, 5, 8, 10].map(r => <option key={r} value={r}>{r}%</option>)}
                </select>
                <button onClick={handleBulkAdRate} disabled={bulkRunning} style={{
                  padding: "8px 16px", borderRadius: 8, border: "none", background: "#6366F1", color: "#fff",
                  fontSize: 12, fontWeight: 700, cursor: bulkRunning ? "not-allowed" : "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {bulkRunning && <Loader size={12} style={{ animation: "spin 1s linear infinite" }} />}
                  Für {selected.size} Listings setzen
                </button>
              </div>
            )}

            {bulkAction === "category" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input value={bulkCategoryId} onChange={e => setBulkCategoryId(e.target.value)} placeholder="eBay Kat-ID (z.B. 79720)" style={{
                  padding: "7px 10px", fontSize: 12, border: "1.5px solid #C7D2FE", borderRadius: 8, outline: "none", fontFamily: "inherit", width: 180,
                }} />
                <button onClick={handleBulkCategory} disabled={bulkRunning || !bulkCategoryId.trim()} style={{
                  padding: "8px 16px", borderRadius: 8, border: "none", background: "#6366F1", color: "#fff",
                  fontSize: 12, fontWeight: 700, cursor: (bulkRunning || !bulkCategoryId.trim()) ? "not-allowed" : "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {bulkRunning && <Loader size={12} style={{ animation: "spin 1s linear infinite" }} />}
                  Für {selected.size} Listings setzen
                </button>
              </div>
            )}

            {bulkAction === "price" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <select value={bulkPriceMode} onChange={e => setBulkPriceMode(e.target.value as typeof bulkPriceMode)} style={{
                  padding: "7px 10px", fontSize: 12, border: "1.5px solid #C7D2FE", borderRadius: 8, outline: "none", fontFamily: "inherit", background: "#fff", color: "#0F172A",
                }}>
                  <option value="percent">Prozent ändern (+/-)</option>
                  <option value="fixed">Betrag ändern (+/- €)</option>
                  <option value="set">Fest auf Betrag setzen (€)</option>
                </select>
                <input value={bulkPriceValue} onChange={e => setBulkPriceValue(e.target.value)} placeholder={bulkPriceMode === "percent" ? "z.B. -10 oder 5" : "z.B. -1.50 oder 9.99"} style={{
                  padding: "7px 10px", fontSize: 12, border: "1.5px solid #C7D2FE", borderRadius: 8, outline: "none", fontFamily: "inherit", width: 160,
                }} />
                <button onClick={handleBulkPrice} disabled={bulkRunning || !bulkPriceValue.trim()} style={{
                  padding: "8px 16px", borderRadius: 8, border: "none", background: "#6366F1", color: "#fff",
                  fontSize: 12, fontWeight: 700, cursor: (bulkRunning || !bulkPriceValue.trim()) ? "not-allowed" : "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", gap: 6,
                }}>
                  {bulkRunning && <Loader size={12} style={{ animation: "spin 1s linear infinite" }} />}
                  Für {selected.size} Listings anwenden
                </button>
              </div>
            )}

            {bulkResults.length > 0 && (
              <div style={{ marginTop: 10, maxHeight: 160, overflow: "auto", background: "#fff", borderRadius: 8, padding: 8 }}>
                {bulkResults.map(r => (
                  <div key={r.itemId} style={{ fontSize: 11, padding: "3px 0", color: r.ok ? "#16A34A" : "#DC2626", display: "flex", gap: 6 }}>
                    {r.ok ? <CheckCircle size={11} /> : <XCircle size={11} />}
                    {r.itemId}{r.ok && r.newPrice ? ` — ${r.oldPrice?.toFixed(2)}€ → ${r.newPrice.toFixed(2)}€` : ""}{!r.ok && r.error ? `: ${r.error}` : ""}
                  </div>
                ))}
                <div style={{ fontSize: 11, fontWeight: 700, marginTop: 6, color: "#475569" }}>
                  {bulkResults.filter(r => r.ok).length}/{bulkResults.length} erfolgreich
                </div>
              </div>
            )}
          </div>
        )}

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
                {/* Checkbox */}
                <button onClick={() => toggleSelect(listing.itemId)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, marginTop: 2, flexShrink: 0 }}>
                  {selected.has(listing.itemId) ? <CheckSquare size={18} color="#6366F1" /> : <Square size={18} color="#CBD5E1" />}
                </button>

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

                    {/* adRate Badge — nur wenn verknüpft */}
                    {isLinked && (() => {
                      const prodId = listing.appProduct!.id;
                      const currentRate = adRateValues[prodId] ?? listing.appProduct!.adRate ?? 5;
                      const saving = adRateSaving === prodId;
                      const res = adRateResult[prodId];
                      return (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 10, color: "#64748B", fontWeight: 600 }}>Anzeige:</span>
                          <select
                            value={currentRate}
                            disabled={saving}
                            onChange={e => handleAdRateChange(prodId, parseFloat(e.target.value))}
                            style={{
                              fontSize: 11, fontWeight: 700, padding: "2px 6px", borderRadius: 6,
                              border: "1.5px solid " + (res?.ok ? "#22C55E" : res?.err ? "#DC2626" : "#FFD700"),
                              background: res?.ok ? "#F0FDF4" : res?.err ? "#FEF2F2" : "#FFF8DC",
                              color: "#92400E", cursor: saving ? "not-allowed" : "pointer",
                              fontFamily: "inherit", outline: "none",
                            }}
                          >
                            {[2, 3, 5, 8, 10].map(r => (
                              <option key={r} value={r}>{r}%</option>
                            ))}
                          </select>
                          {saving && <Loader size={9} style={{ animation: "spin 1s linear infinite" }} color="#F59E0B" />}
                          {res?.ok && <CheckCircle size={9} color="#22C55E" />}
                        </span>
                      );
                    })()}

                    {/* Verkäufe */}
                    <span style={{
                      fontSize: 11, color: listing.quantitySold > 0 ? "#0EA5E9" : "#CBD5E1", fontWeight: 600,
                      display: "inline-flex", alignItems: "center", gap: 3,
                    }}>
                      <Tag size={10} /> {listing.quantitySold}× verkauft
                    </span>

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

                  {/* Datum-Info Zeile */}
                  {(() => {
                    const left = daysLeft(listing.endTime);
                    return (
                      <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                        {listing.startTime && (
                          <span style={{ fontSize: 10, color: "#94A3B8", display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <Calendar size={9} color="#94A3B8" />
                            Eingestellt: {fmtDate(listing.startTime)}
                          </span>
                        )}
                        {listing.endTime && left !== null && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: daysLeftColor(left), display: "inline-flex", alignItems: "center", gap: 3 }}>
                            <Clock size={9} color={daysLeftColor(left)} />
                            {left === 0
                              ? "Läuft heute ab!"
                              : left === 1
                              ? "Läuft morgen ab"
                              : `Läuft ab: ${fmtDate(listing.endTime)} (${left}T)`}
                          </span>
                        )}
                      </div>
                    );
                  })()}

                  {/* Item ID + SKU */}
                  <div style={{ fontSize: 10, color: "#CBD5E1", marginTop: 4 }}>
                    ID: {listing.itemId}
                    {listing.sku && <span style={{ marginLeft: 10 }}>SKU: <span style={{ color: "#94A3B8", fontWeight: 600 }}>{listing.sku}</span></span>}
                  </div>

                  {/* Preis zuletzt aktualisiert */}
                  <div style={{ fontSize: 10, fontWeight: 600, color: priceCheckColor(listing.appProduct?.lastPriceCheck ?? null), marginTop: 3, display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <RefreshCw size={9} color={priceCheckColor(listing.appProduct?.lastPriceCheck ?? null)} />
                    Preis geprüft: {timeAgo(listing.appProduct?.lastPriceCheck ?? null)}
                  </div>

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
                    onClick={() => openEdit(listing)}
                    title="Titel & Beschreibung bearbeiten"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8,
                      background: "#EEF2FF", border: "1.5px solid #C7D2FE",
                      color: "#4338CA", fontSize: 11, fontWeight: 700,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    <FileEdit size={10} /> Bearb.
                  </button>
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
