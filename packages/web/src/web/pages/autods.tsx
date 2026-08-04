import { useState } from "react";
import { FileText, Copy, Check, Loader, AlertCircle, RefreshCw, ShoppingCart, Package, Link, ChevronLeft } from "lucide-react";
import { buildEbayHTML } from "../lib/ebay-description";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScrapedProduct {
  title: string;
  images: string[];
  price: string;
  description: string;
  specs: Record<string, string>;
}

// ─── Text helpers ─────────────────────────────────────────────────────────────
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

function buildTitle(rawTitle: string): string {
  let title = decodeEntities(rawTitle)
    .replace(/\[.*?\]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (title.length > 80) title = title.slice(0, 77) + "...";
  return title;
}

function buildHTML(product: ScrapedProduct): string {
  return buildEbayHTML(product);
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AutoDS() {
  const [urlInput, setUrlInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"url" | "manual">("url");

  // Manual mode
  const [manualTitle, setManualTitle] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  const [product, setProduct] = useState<ScrapedProduct | null>(null);
  const [result, setResult] = useState<{ title: string; html: string } | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);

  const [copiedTitle, setCopiedTitle] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [ebayPrice, setEbayPrice] = useState("");
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayResult, setEbayResult] = useState<{ listingId?: string; error?: string } | null>(null);

  // ─── Manual mode ─────────────────────────────────────────────────────────────
  const handleManual = () => {
    if (!manualTitle.trim()) return;
    const fakeProduct: ScrapedProduct = {
      title: manualTitle.trim(),
      images: [],
      price: manualPrice.trim(),
      description: manualDesc.trim(),
      specs: {},
    };
    setProduct(fakeProduct);
    const title = buildTitle(fakeProduct.title);
    const html = buildHTML(fakeProduct);
    setResult({ title, html });
  };

  // ─── Scrape ──────────────────────────────────────────────────────────────────
  const handleScrape = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setLoading(true);
    setError("");
    setProduct(null);
    setResult(null);
    setEbayResult(null);
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
      const title = buildTitle(data.title);
      const html = buildHTML(data);
      setResult({ title, html });

      // Save to DB
      fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: `ali_${Date.now()}`,
          amazonUrl: url,
          title: data.title,
          generatedTitle: title,
          htmlDescription: html,
          bullets: Object.entries(data.specs).map(([k, v]) => `${k}: ${v}`),
          variants: [],
          description: data.description,
        }),
      }).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Netzwerkfehler");
    } finally {
      setLoading(false);
    }
  };

  // ─── eBay list ───────────────────────────────────────────────────────────────
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
      setEbayResult({ error: e instanceof Error ? e.message : "Unbekannter Fehler" });
    } finally {
      setEbayLoading(false);
    }
  };

  const copyTitle = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.title);
    setCopiedTitle(true);
    setTimeout(() => setCopiedTitle(false), 2000);
  };
  const copyHtml = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.html);
    setCopiedHtml(true);
    setTimeout(() => setCopiedHtml(false), 2000);
  };

  const charCount = result ? result.title.length : 0;
  const charColor = charCount > 80 ? "#DC2626" : charCount > 70 ? "#F59E0B" : "#16a34a";

  const inputStyle = {
    width: "100%", padding: "13px 16px", fontSize: 14, fontWeight: 500,
    border: "2px solid #E2E8F0", borderRadius: 12, outline: "none",
    fontFamily: "inherit", boxSizing: "border-box" as const,
    color: "#0F172A", background: "#F8FAFC",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: 16, background: "#FF6B00",
            marginBottom: 12, boxShadow: "0 4px 14px rgba(255,107,0,0.35)"
          }}>
            <Package size={28} color="white" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", margin: 0 }}>AliExpress Scraper</h1>
          <p style={{ color: "#64748B", marginTop: 4, fontSize: 13 }}>URL eingeben → Titel + HTML-Beschreibung generieren</p>
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
              {m === "url" ? "🔗 URL Scraper" : "✏️ Manuell"}
            </button>
          ))}
        </div>

        {/* URL Input */}
        {mode === "url" && (
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
                whiteSpace: "nowrap" as const,
              }}
            >
              {loading
                ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} />
                : <FileText size={16} />}
              {loading ? "Lädt…" : "Scrapen"}
            </button>
          </div>
          <p style={{ margin: "10px 0 0", fontSize: 11, color: "#94A3B8" }}>
            Tipp: Nur EU-Lager-Produkte (DE/AT/CH etc.) für AutoDS verwenden
          </p>
        </div>
        )}

        {/* Manual Input */}
        {mode === "manual" && !result && (
        <div style={{ background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Produkttitel (Original)
              </label>
              <input
                type="text"
                placeholder="z.B. Staubsauger Roboter 4000Pa mit Wischfunktion..."
                value={manualTitle}
                onChange={e => setManualTitle(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Preis (optional)
              </label>
              <input
                type="text"
                placeholder="z.B. 29.99 €"
                value={manualPrice}
                onChange={e => setManualPrice(e.target.value)}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#64748B", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Beschreibung / Features (optional)
              </label>
              <textarea
                placeholder="Features, Spezifikationen etc. (je Zeile ein Punkt)..."
                value={manualDesc}
                onChange={e => setManualDesc(e.target.value)}
                rows={5}
                style={{ ...inputStyle, resize: "vertical" as const, lineHeight: 1.6 }}
              />
            </div>
            <button
              onClick={handleManual}
              disabled={!manualTitle.trim()}
              style={{
                padding: "13px 18px", borderRadius: 12, border: "none",
                background: !manualTitle.trim() ? "#FDD0A8" : "#FF6B00",
                color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: !manualTitle.trim() ? "not-allowed" : "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              <FileText size={16} />
              HTML generieren
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

        {/* Loading state */}
        {loading && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <Loader size={32} color="#FF6B00" style={{ animation: "spin 1s linear infinite" }} />
            <p style={{ marginTop: 12, color: "#64748B", fontSize: 14 }}>AliExpress wird gescrapt…</p>
          </div>
        )}

        {/* Results */}
        {result && product && !loading && (
          <>
            {/* Reset button */}
            <button
              onClick={() => { setProduct(null); setResult(null); setEbayResult(null); setUrlInput(""); setManualTitle(""); setManualDesc(""); setManualPrice(""); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "none", border: "none", color: "#64748B",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit", marginBottom: 14, padding: 0,
              }}
            >
              <ChevronLeft size={16} /> Neue URL eingeben
            </button>

            {/* Product image gallery */}
            {product.images.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: 14 }}>
                <img
                  src={product.images[selectedImage]}
                  alt=""
                  style={{ width: "100%", maxHeight: 280, objectFit: "contain", borderRadius: 10, background: "#F8FAFC" }}
                />
                {product.images.length > 1 && (
                  <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
                    {product.images.map((img, i) => (
                      <img
                        key={i}
                        src={img}
                        alt=""
                        onClick={() => setSelectedImage(i)}
                        style={{
                          width: 52, height: 52, borderRadius: 8, objectFit: "cover",
                          cursor: "pointer", flexShrink: 0,
                          border: i === selectedImage ? "2px solid #FF6B00" : "2px solid transparent",
                          opacity: i === selectedImage ? 1 : 0.6,
                        }}
                      />
                    ))}
                  </div>
                )}
                {product.price && (
                  <p style={{ margin: "12px 0 0", fontSize: 16, fontWeight: 700, color: "#FF6B00" }}>
                    {product.price}
                  </p>
                )}
              </div>
            )}

            {/* Titel */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Titel</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: charColor }}>{charCount}/80</span>
              </div>
              <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "12px 14px", fontSize: 14, color: "#0F172A", border: "1.5px solid #E2E8F0", marginBottom: 10, fontWeight: 500, lineHeight: 1.5 }}>
                {result.title}
              </div>
              <button
                onClick={copyTitle}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 8, padding: "11px 0", borderRadius: 10, border: "none",
                  background: copiedTitle ? "#22C55E" : "#FF6B00", color: "#fff",
                  fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {copiedTitle ? <Check size={16} /> : <Copy size={16} />}
                {copiedTitle ? "Kopiert!" : "Titel kopieren"}
              </button>
            </div>

            {/* HTML */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>HTML Beschreibung</span>
                <span style={{ fontSize: 11, color: "#94A3B8", background: "#F1F5F9", padding: "3px 8px", borderRadius: 6, fontWeight: 600 }}>AutoDS-Format</span>
              </div>
              <div style={{
                background: "#0F172A", borderRadius: 12, padding: 16, fontSize: 12,
                color: "#94A3B8", fontFamily: "monospace", marginBottom: 10,
                overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
                maxHeight: 300, overflowY: "auto",
              }}>
                {result.html}
              </div>
              <button
                onClick={copyHtml}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 8, padding: "11px 0", borderRadius: 10, border: "none",
                  background: copiedHtml ? "#22C55E" : "#0F172A", color: "#fff",
                  fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {copiedHtml ? <Check size={16} /> : <Copy size={16} />}
                {copiedHtml ? "Kopiert!" : "HTML kopieren"}
              </button>
            </div>

            {/* Vorschau */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Vorschau</span>
                <button
                  onClick={handleScrape}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    background: "#F1F5F9", border: "none", borderRadius: 8,
                    padding: "6px 12px", fontSize: 12, fontWeight: 600,
                    color: "#475569", cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <RefreshCw size={12} /> Neu scrapen
                </button>
              </div>
              <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: result.html }} />
            </div>

            {/* eBay */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FFD700", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ShoppingCart size={18} color="#0F172A" />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Auf eBay listen</span>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#64748B", marginBottom: 4 }}>Verkaufspreis (€)</label>
                  <input
                    type="number" step="0.01" min="0.01" placeholder="19.99"
                    value={ebayPrice}
                    onChange={e => setEbayPrice(e.target.value)}
                    style={{
                      width: "100%", padding: "11px 14px", fontSize: 15, fontWeight: 600,
                      border: "2px solid #E2E8F0", borderRadius: 10, outline: "none",
                      fontFamily: "inherit", boxSizing: "border-box" as const, color: "#0F172A",
                    }}
                  />
                </div>
                <button
                  onClick={handleEbayList}
                  disabled={ebayLoading || !ebayPrice}
                  style={{
                    padding: "11px 20px", borderRadius: 10, border: "none",
                    background: ebayLoading || !ebayPrice ? "#FDE68A" : "#FFD700",
                    color: "#0F172A", fontWeight: 700, fontSize: 14,
                    cursor: ebayLoading || !ebayPrice ? "not-allowed" : "pointer",
                    fontFamily: "inherit", display: "flex", alignItems: "center",
                    gap: 8, whiteSpace: "nowrap" as const,
                  }}
                >
                  {ebayLoading
                    ? <><Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> Lädt…</>
                    : <><ShoppingCart size={16} /> Listen</>
                  }
                </button>
              </div>
              {ebayResult && (
                <div style={{
                  marginTop: 14, padding: "12px 16px", borderRadius: 10,
                  background: ebayResult.listingId ? "#F0FDF4" : "#FEF2F2",
                  border: `1.5px solid ${ebayResult.listingId ? "#BBF7D0" : "#FECACA"}`,
                }}>
                  {ebayResult.listingId
                    ? <p style={{ margin: 0, color: "#15803D", fontWeight: 600, fontSize: 13 }}>✓ Gelistet! ID: <span style={{ fontFamily: "monospace" }}>{ebayResult.listingId}</span></p>
                    : <p style={{ margin: 0, color: "#DC2626", fontWeight: 600, fontSize: 13 }}>✗ Fehler: {ebayResult.error}</p>
                  }
                </div>
              )}
            </div>
          </>
        )}

        <p style={{ textAlign: "center", color: "#CBD5E1", fontSize: 12, marginTop: 24, marginBottom: 8 }}>
          Stele E-Transfer · AliExpress Scraper
        </p>
      </div>
    </div>
  );
}
