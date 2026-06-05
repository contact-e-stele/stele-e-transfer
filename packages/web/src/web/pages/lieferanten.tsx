/**
 * Lieferanten-Tab — AliExpress URL scrapen → Produkt importieren
 * Ersetzt AutoDS komplett für den Import-Schritt
 */
import { useState } from "react";
import {
  FileText, Copy, Check, Loader, AlertCircle,
  RefreshCw, ShoppingCart, Package, Link, ChevronLeft,
  TrendingDown, Save, Eye, EyeOff,
} from "lucide-react";
import { normalizeShippingText } from "../lib/text-helpers";

interface ScrapedProduct {
  title: string;
  images: string[];
  price: string;
  description: string;
  specs: Record<string, string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function decodeEntities(str: string): string {
  return str
    .replace(/&uuml;/g, "ü").replace(/&Uuml;/g, "Ü")
    .replace(/&auml;/g, "ä").replace(/&Auml;/g, "Ä")
    .replace(/&ouml;/g, "ö").replace(/&Ouml;/g, "Ö")
    .replace(/&szlig;/g, "ß")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&[a-zA-Z]+;/g, "");
}

function cleanText(text: string): string {
  return text
    .replace(/([a-zäöüß]{4,})([A-ZÄÖÜ])/g, "$1 $2")
    .replace(/\b(.{10,40}?)\s+\1\b/gi, "$1")
    .trim();
}

function buildTitle(rawTitle: string): string {
  let title = decodeEntities(rawTitle)
    .replace(/\[.*?\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (title.length > 80) title = title.slice(0, 77) + "...";
  return title;
}

function buildHTML(product: ScrapedProduct): string {
  const lines: string[] = [];
  const { description, specs } = product;

  const specEntries = Object.entries(specs);
  if (specEntries.length > 0) {
    lines.push("<ul>");
    for (const [k, v] of specEntries.slice(0, 10)) {
      const key = cleanText(decodeEntities(k));
      const val = normalizeShippingText(cleanText(decodeEntities(v)));
      if (key && val) lines.push(`<li><strong>【${key}】</strong> ${val}</li>`);
    }
    lines.push("</ul>");
  }

  if (description && description.length > 20) {
    const cleaned = normalizeShippingText(cleanText(decodeEntities(description)));
    for (const para of cleaned.split(/\n{2,}/).slice(0, 3)) {
      const p = para.trim();
      if (p.length > 20) lines.push(`<p>${p}</p>`);
    }
  } else if (specEntries.length === 0) {
    lines.push(`<p>${normalizeShippingText(decodeEntities(product.title).trim())}</p>`);
  }

  return lines.join("\n");
}

function parsePrice(raw: string): number {
  if (!raw) return 0;
  const m = raw.match(/([\d]+[.,][\d]{2})/);
  if (!m) return 0;
  return parseFloat(m[1].replace(",", "."));
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Lieferanten() {
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"url" | "manual">("url");

  // Manual
  const [manualTitle, setManualTitle] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  const [product, setProduct] = useState<ScrapedProduct | null>(null);
  const [result, setResult] = useState<{ title: string; html: string } | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  const [copiedTitle, setCopiedTitle] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);

  const [ebayPrice, setEbayPrice] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayResult, setEbayResult] = useState<{ listingId?: string; error?: string } | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveResult, setSaveResult] = useState<{ id?: number; error?: string } | null>(null);

  // ─── Marge berechnen ──────────────────────────────────────────────────────
  const einkauf = parseFloat(buyPrice.replace(",", ".")) || parsePrice(product?.price ?? "");
  const verkauf = parseFloat(ebayPrice.replace(",", ".")) || 0;
  const ebayFee = verkauf * 0.13 + 0.35; // ~13% + 0.35€
  const gewinn = verkauf - einkauf - ebayFee;
  const margePercent = verkauf > 0 ? (gewinn / verkauf) * 100 : 0;

  // ─── Scrape ───────────────────────────────────────────────────────────────
  const handleScrape = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setLoading(true);
    setError("");
    setProduct(null);
    setResult(null);
    setEbayResult(null);
    setSaveResult(null);
    setSelectedImage(0);
    try {
      const res = await fetch("/api/aliexpress/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json() as ScrapedProduct & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
      setProduct(data);
      setResult({ title: buildTitle(data.title), html: buildHTML(data) });
      // Preis vorausfüllen
      const p = parsePrice(data.price);
      if (p > 0) setBuyPrice(p.toFixed(2));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Netzwerkfehler");
    } finally {
      setLoading(false);
    }
  };

  const handleManual = () => {
    if (!manualTitle.trim()) return;
    const fp: ScrapedProduct = { title: manualTitle.trim(), images: [], price: manualPrice.trim(), description: manualDesc.trim(), specs: {} };
    setProduct(fp);
    setResult({ title: buildTitle(fp.title), html: buildHTML(fp) });
    const p = parsePrice(fp.price);
    if (p > 0) setBuyPrice(p.toFixed(2));
  };

  // ─── Speichern in DB ──────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!result || !product) return;
    setSaveLoading(true);
    setSaveResult(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: `ali_${Date.now()}`,
          amazonUrl: urlInput || "manual",
          sourceUrl: urlInput || "manual",
          title: product.title,
          generatedTitle: result.title,
          htmlDescription: result.html,
          bullets: Object.entries(product.specs).map(([k, v]) => `${k}: ${v}`),
          variants: [],
          description: product.description,
          images: product.images,
          buyPrice: einkauf || null,
          sellPrice: verkauf || null,
        }),
      });
      const data = await res.json() as { id?: number; error?: string };
      setSaveResult(data);
    } catch (e) {
      setSaveResult({ error: e instanceof Error ? e.message : "Fehler" });
    } finally {
      setSaveLoading(false);
    }
  };

  // ─── eBay listen ──────────────────────────────────────────────────────────
  const handleEbayList = async () => {
    if (!result || !product) return;
    const price = parseFloat(ebayPrice.replace(",", "."));
    if (!price || price <= 0) return;
    setEbayLoading(true);
    setEbayResult(null);
    try {
      const res = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: `ali_${Date.now()}`,
          title: result.title,
          description: result.html,
          price,
          quantity: 10,
          imageUrls: product.images.slice(0, 3),
        }),
      });
      const data = await res.json() as { listingId?: string; error?: string };
      setEbayResult(data);
    } catch (e) {
      setEbayResult({ error: e instanceof Error ? e.message : "Fehler" });
    } finally {
      setEbayLoading(false);
    }
  };

  const copy = (text: string, setCopied: (v: boolean) => void) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const charCount = result?.title.length ?? 0;
  const charColor = charCount > 80 ? "#DC2626" : charCount > 70 ? "#F59E0B" : "#16a34a";

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "13px 16px", fontSize: 14, fontWeight: 500,
    border: "2px solid #E2E8F0", borderRadius: 12, outline: "none",
    fontFamily: "inherit", boxSizing: "border-box",
    color: "#0F172A", background: "#F8FAFC",
  };

  const reset = () => {
    setProduct(null); setResult(null); setEbayResult(null);
    setSaveResult(null); setUrlInput(""); setManualTitle("");
    setManualDesc(""); setManualPrice(""); setBuyPrice(""); setEbayPrice("");
    setShowPreview(false);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: 16, background: "#FF6B00",
            marginBottom: 12, boxShadow: "0 4px 14px rgba(255,107,0,0.35)",
          }}>
            <Package size={28} color="white" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", margin: 0 }}>Lieferanten Import</h1>
          <p style={{ color: "#64748B", marginTop: 4, fontSize: 13 }}>AliExpress URL → Titel + Beschreibung generieren</p>
        </div>

        {/* Mode Tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          {(["url", "manual"] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              flex: 1, padding: "10px 0", borderRadius: 12, border: "none",
              background: mode === m ? "#FF6B00" : "#fff",
              color: mode === m ? "#fff" : "#64748B",
              fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
              boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
            }}>
              {m === "url" ? "🔗 AliExpress URL" : "✏️ Manuell"}
            </button>
          ))}
        </div>

        {/* URL Input */}
        {mode === "url" && !result && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748B", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              AliExpress Produkt-URL
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ position: "relative", flex: 1 }}>
                <Link size={16} color="#94A3B8" style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                <input
                  type="url"
                  placeholder="https://www.aliexpress.com/item/..."
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleScrape()}
                  style={{ ...inputStyle, paddingLeft: 38 }}
                />
              </div>
              <button
                onClick={handleScrape}
                disabled={loading || !urlInput.trim()}
                style={{
                  padding: "13px 18px", borderRadius: 12, border: "none",
                  background: loading || !urlInput.trim() ? "#FDD0A8" : "#FF6B00",
                  color: "#fff", fontWeight: 700, fontSize: 14,
                  cursor: loading || !urlInput.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
                  whiteSpace: "nowrap",
                }}
              >
                {loading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <FileText size={16} />}
                {loading ? "Lädt…" : "Scrapen"}
              </button>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 11, color: "#94A3B8" }}>
              ⚠️ Nur EU-Lager-Produkte (DE/AT/CH) für schnelle Lieferzeiten
            </p>
          </div>
        )}

        {/* Manual Input */}
        {mode === "manual" && !result && (
          <div style={{ background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Produkttitel
                </label>
                <input type="text" placeholder="z.B. Staubsauger Roboter 4000Pa..." value={manualTitle} onChange={e => setManualTitle(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Einkaufspreis (optional)
                </label>
                <input type="text" placeholder="z.B. 12.99" value={manualPrice} onChange={e => setManualPrice(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Beschreibung / Features
                </label>
                <textarea placeholder="Features, Spezifikationen..." value={manualDesc} onChange={e => setManualDesc(e.target.value)} rows={5} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.6 }} />
              </div>
              <button onClick={handleManual} disabled={!manualTitle.trim()} style={{
                padding: "13px 18px", borderRadius: 12, border: "none",
                background: !manualTitle.trim() ? "#FDD0A8" : "#FF6B00",
                color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: !manualTitle.trim() ? "not-allowed" : "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                <FileText size={16} /> HTML generieren
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 14, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 10 }}>
            <AlertCircle size={18} color="#DC2626" style={{ flexShrink: 0 }} />
            <p style={{ margin: 0, color: "#DC2626", fontSize: 13, fontWeight: 600 }}>{error}</p>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <Loader size={32} color="#FF6B00" style={{ animation: "spin 1s linear infinite" }} />
            <p style={{ marginTop: 12, color: "#64748B", fontSize: 14 }}>AliExpress wird gescrapt…</p>
          </div>
        )}

        {/* Results */}
        {result && product && !loading && (
          <>
            <button onClick={reset} style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "none", border: "none", color: "#64748B",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit", marginBottom: 14, padding: 0,
            }}>
              <ChevronLeft size={16} /> Neue URL eingeben
            </button>

            {/* Produktbild */}
            {product.images.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: 14 }}>
                <img src={product.images[selectedImage]} alt="" style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 10, background: "#F8FAFC" }} />
                {product.images.length > 1 && (
                  <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
                    {product.images.map((img, i) => (
                      <img key={i} src={img} alt="" onClick={() => setSelectedImage(i)} style={{
                        width: 48, height: 48, borderRadius: 8, objectFit: "cover",
                        cursor: "pointer", flexShrink: 0,
                        border: i === selectedImage ? "2px solid #FF6B00" : "2px solid transparent",
                        opacity: i === selectedImage ? 1 : 0.6,
                      }} />
                    ))}
                  </div>
                )}
                {product.price && <p style={{ margin: "12px 0 0", fontSize: 16, fontWeight: 700, color: "#FF6B00" }}>{product.price}</p>}
              </div>
            )}

            {/* Titel */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>eBay Titel</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: charColor }}>{charCount}/80</span>
              </div>
              <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "12px 14px", fontSize: 14, color: "#0F172A", border: "1.5px solid #E2E8F0", marginBottom: 10, fontWeight: 500, lineHeight: 1.5 }}>
                {result.title}
              </div>
              <button onClick={() => copy(result.title, setCopiedTitle)} style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, padding: "11px 0", borderRadius: 10, border: "none",
                background: copiedTitle ? "#22C55E" : "#FF6B00", color: "#fff",
                fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
              }}>
                {copiedTitle ? <Check size={16} /> : <Copy size={16} />}
                {copiedTitle ? "Kopiert!" : "Titel kopieren"}
              </button>
            </div>

            {/* HTML */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>HTML Beschreibung</span>
                <button onClick={() => setShowPreview(v => !v)} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "#F1F5F9", border: "none", borderRadius: 8,
                  padding: "5px 10px", fontSize: 11, fontWeight: 600,
                  color: "#475569", cursor: "pointer", fontFamily: "inherit",
                }}>
                  {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
                  {showPreview ? "Code" : "Vorschau"}
                </button>
              </div>
              {showPreview ? (
                <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.8, marginBottom: 10 }} dangerouslySetInnerHTML={{ __html: result.html }} />
              ) : (
                <div style={{
                  background: "#0F172A", borderRadius: 12, padding: 16, fontSize: 12,
                  color: "#94A3B8", fontFamily: "monospace", marginBottom: 10,
                  overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
                  maxHeight: 260, overflowY: "auto",
                }}>
                  {result.html}
                </div>
              )}
              <button onClick={() => copy(result.html, setCopiedHtml)} style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, padding: "11px 0", borderRadius: 10, border: "none",
                background: copiedHtml ? "#22C55E" : "#0F172A", color: "#fff",
                fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
              }}>
                {copiedHtml ? <Check size={16} /> : <Copy size={16} />}
                {copiedHtml ? "Kopiert!" : "HTML kopieren"}
              </button>
            </div>

            {/* Preiskalkulation */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#F0FDF4", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <TrendingDown size={18} color="#16A34A" />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Preiskalkulation</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4, textTransform: "uppercase" }}>Einkauf (€)</label>
                  <input type="number" step="0.01" placeholder="0.00" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} style={{
                    width: "100%", padding: "10px 12px", fontSize: 14, fontWeight: 600,
                    border: "2px solid #E2E8F0", borderRadius: 10, outline: "none",
                    fontFamily: "inherit", boxSizing: "border-box", color: "#0F172A",
                  }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4, textTransform: "uppercase" }}>Verkauf eBay (€)</label>
                  <input type="number" step="0.01" placeholder="0.00" value={ebayPrice} onChange={e => setEbayPrice(e.target.value)} style={{
                    width: "100%", padding: "10px 12px", fontSize: 14, fontWeight: 600,
                    border: "2px solid #E2E8F0", borderRadius: 10, outline: "none",
                    fontFamily: "inherit", boxSizing: "border-box", color: "#0F172A",
                  }} />
                </div>
              </div>
              {verkauf > 0 && (
                <div style={{
                  background: gewinn >= 0 ? "#F0FDF4" : "#FEF2F2",
                  borderRadius: 12, padding: "14px 16px",
                  border: `1.5px solid ${gewinn >= 0 ? "#BBF7D0" : "#FECACA"}`,
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
                    {[
                      { label: "eBay Gebühr", value: `−${ebayFee.toFixed(2)} €`, color: "#64748B" },
                      { label: "Gewinn", value: `${gewinn >= 0 ? "+" : ""}${gewinn.toFixed(2)} €`, color: gewinn >= 0 ? "#16A34A" : "#DC2626" },
                      { label: "Marge", value: `${margePercent.toFixed(1)}%`, color: margePercent >= 15 ? "#16A34A" : margePercent >= 5 ? "#F59E0B" : "#DC2626" },
                    ].map(s => (
                      <div key={s.label}>
                        <div style={{ fontSize: 15, fontWeight: 800, color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: 10, color: "#94A3B8", fontWeight: 600 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Speichern */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <button onClick={handleSave} disabled={saveLoading} style={{
                padding: "13px 0", borderRadius: 12, border: "none",
                background: saveResult?.id ? "#22C55E" : saveLoading ? "#E2E8F0" : "#0F172A",
                color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: saveLoading ? "not-allowed" : "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                {saveLoading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={16} />}
                {saveResult?.id ? "Gespeichert ✓" : "In DB speichern"}
              </button>
              <button onClick={handleScrape} disabled={!urlInput.trim() || loading} style={{
                padding: "13px 0", borderRadius: 12, border: "1.5px solid #E2E8F0",
                background: "#fff", color: "#475569", fontWeight: 700, fontSize: 14,
                cursor: !urlInput.trim() ? "not-allowed" : "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                <RefreshCw size={16} /> Neu scrapen
              </button>
            </div>

            {saveResult?.error && (
              <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
                <p style={{ margin: 0, color: "#DC2626", fontSize: 13, fontWeight: 600 }}>Fehler: {saveResult.error}</p>
              </div>
            )}

            {/* eBay Listen */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FFD700", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ShoppingCart size={18} color="#0F172A" />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Direkt auf eBay listen</span>
              </div>
              <button
                onClick={handleEbayList}
                disabled={ebayLoading || !ebayPrice || parseFloat(ebayPrice) <= 0}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 12, border: "none",
                  background: ebayLoading || !ebayPrice ? "#FDE68A" : "#FFD700",
                  color: "#0F172A", fontWeight: 700, fontSize: 14,
                  cursor: ebayLoading || !ebayPrice ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {ebayLoading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <ShoppingCart size={16} />}
                {ebayLoading ? "Wird gelistet…" : `Auf eBay listen${ebayPrice ? ` (${ebayPrice} €)` : ""}`}
              </button>
              {ebayResult && (
                <div style={{
                  marginTop: 14, padding: "12px 16px", borderRadius: 10,
                  background: ebayResult.listingId ? "#F0FDF4" : "#FEF2F2",
                  border: `1.5px solid ${ebayResult.listingId ? "#BBF7D0" : "#FECACA"}`,
                }}>
                  {ebayResult.listingId
                    ? <p style={{ margin: 0, color: "#15803D", fontWeight: 600, fontSize: 13 }}>✓ Gelistet! ID: <span style={{ fontFamily: "monospace" }}>{ebayResult.listingId}</span></p>
                    : <p style={{ margin: 0, color: "#DC2626", fontWeight: 600, fontSize: 13 }}>✗ {ebayResult.error}</p>
                  }
                </div>
              )}
            </div>
          </>
        )}

        <p style={{ textAlign: "center", color: "#CBD5E1", fontSize: 12, marginTop: 8, marginBottom: 8 }}>
          Stele E-Transfer · Lieferanten Import
        </p>
      </div>
    </div>
  );
}
