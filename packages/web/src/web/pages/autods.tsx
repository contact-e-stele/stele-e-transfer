import { useState } from "react";
import { FileText, Search, Copy, Check, Loader, AlertCircle, RefreshCw, ShoppingCart, Package, Star, ChevronLeft } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface AliProduct {
  productId: string;
  title: string;
  price: string;
  imageUrl: string;
  productUrl: string;
  shipFrom: string;
  orders: number;
  rating: string;
}

interface ProductDetail {
  title: string;
  description: string;
  images: string[];
  price: string;
  variants: string[];
  shipFrom: string;
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

function cleanText(text: string): string {
  return text
    .replace(/([a-zäöüß]{4,})([A-ZÄÖÜ])/g, "$1 $2")
    .replace(/\b(.{10,40}?)\s+\1\b/gi, "$1")
    .trim();
}

function extractKeyword(text: string): string {
  const words = text.split(/[\s,–\-:]/);
  const meaningful = words.filter(w => w.length > 3).slice(0, 2);
  return meaningful.join(" ") || words[0] || "Merkmal";
}

function buildTitle(rawTitle: string, variants: string[]): string {
  let title = decodeEntities(rawTitle).replace(/\[.*?\]/g, "").replace(/\s{2,}/g, " ").trim();
  title = title.replace(/^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß&.\-]{1,30}\s+/, "").replace(/^[A-ZÄÖÜ]{2,}\s+/, "").trim();
  if (variants.length > 1) {
    title = title.replace(/,?\s*\d+[xX×]\d+\s*cm\b/gi, "").replace(/,?\s*\d+er\s+Set\b/gi, "").trim();
  }
  if (title.length > 80) title = title.slice(0, 77) + "...";
  return title;
}

function buildHTML(rawTitle: string, bullets: string[], variants: string[], description: string): string {
  const lines: string[] = [];

  if (variants.length > 1) {
    const listStr = variants.map(v => decodeEntities(v)).join(" | ");
    lines.push(`<p><strong>Verfügbare Ausführungen:</strong> ${listStr}</p>`);
  } else if (variants.length === 1) {
    lines.push(`<p><strong>Ausführung:</strong> ${decodeEntities(variants[0])}</p>`);
  }

  if (bullets.length > 0) {
    lines.push("<ul>");
    for (const bullet of bullets.slice(0, 8)) {
      const text = cleanText(decodeEntities(bullet));
      if (text.length > 10) {
        lines.push(`<li><strong>【${extractKeyword(text)}】</strong> ${text}</li>`);
      }
    }
    lines.push("</ul>");
  }

  if (description && description.length > 20) {
    const cleaned = cleanText(decodeEntities(description));
    const paras = cleaned.split(/\n{2,}/);
    for (const para of paras.slice(0, 3)) {
      const p = para.trim();
      if (p.length > 20) lines.push(`<p>${p}</p>`);
    }
  } else if (bullets.length === 0) {
    lines.push(`<p>${decodeEntities(rawTitle).trim()}</p>`);
  }

  return lines.join("\n");
}

// ─── Flag helper ─────────────────────────────────────────────────────────────
function countryFlag(code: string): string {
  const flags: Record<string, string> = {
    DE: "🇩🇪", AT: "🇦🇹", CH: "🇨🇭", FR: "🇫🇷",
    NL: "🇳🇱", PL: "🇵🇱", CZ: "🇨🇿", BE: "🇧🇪", LU: "🇱🇺",
  };
  return flags[code?.toUpperCase()] ?? "🇪🇺";
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AutoDS() {
  const [query, setQuery] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [products, setProducts] = useState<AliProduct[]>([]);
  const [searched, setSearched] = useState(false);

  const [selectedProduct, setSelectedProduct] = useState<AliProduct | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [result, setResult] = useState<{ title: string; html: string; productId: string } | null>(null);

  const [copiedTitle, setCopiedTitle] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [ebayPrice, setEbayPrice] = useState("");
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayResult, setEbayResult] = useState<{ listingId?: string; error?: string } | null>(null);

  // ─── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearchLoading(true);
    setSearchError("");
    setProducts([]);
    setSearched(false);
    setResult(null);
    setSelectedProduct(null);

    try {
      const res = await fetch(`/api/aliexpress/search?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json() as { products?: AliProduct[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
      setProducts(data.products ?? []);
      setSearched(true);
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Netzwerkfehler");
    } finally {
      setSearchLoading(false);
    }
  };

  // ─── Select product ──────────────────────────────────────────────────────────
  const handleSelect = async (product: AliProduct) => {
    setSelectedProduct(product);
    setDetailLoading(true);
    setResult(null);
    setEbayResult(null);

    try {
      const res = await fetch(`/api/aliexpress/product/${product.productId}`);
      const detail = await res.json() as ProductDetail & { error?: string };

      let bullets: string[] = [];
      let variants: string[] = detail.variants ?? [];
      let description = detail.description ?? "";

      // Beschreibung in Bullets aufteilen wenn möglich
      if (description.length > 0) {
        const lines = description.split(/\n|<br\s*\/?>/).map(l => l.replace(/<[^>]*>/g, "").trim()).filter(l => l.length > 15);
        bullets = lines.slice(0, 8);
        description = lines.slice(8).join(" ");
      }

      const title = buildTitle(detail.title || product.title, variants);
      const html = buildHTML(detail.title || product.title, bullets, variants, description);
      setResult({ title, html, productId: product.productId });

      // In DB speichern
      fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: product.productId,
          amazonUrl: product.productUrl,
          title: detail.title || product.title,
          generatedTitle: title,
          htmlDescription: html,
          bullets,
          variants,
          description,
        }),
      }).catch(() => {});
    } catch (e) {
      // Fallback: nur mit Suchergebnis arbeiten
      const title = buildTitle(product.title, []);
      const html = buildHTML(product.title, [], [], "");
      setResult({ title, html, productId: product.productId });
    } finally {
      setDetailLoading(false);
    }
  };

  // ─── eBay list ───────────────────────────────────────────────────────────────
  const handleEbayList = async () => {
    if (!result) return;
    const price = parseFloat(ebayPrice.replace(",", "."));
    if (!price || price <= 0) return;
    setEbayLoading(true);
    setEbayResult(null);
    try {
      const res = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: result.productId,
          title: result.title,
          description: result.html,
          price,
          quantity: 10,
          imageUrls: selectedProduct?.imageUrl ? [selectedProduct.imageUrl] : [],
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

  const copyTitle = () => { if (!result) return; navigator.clipboard.writeText(result.title); setCopiedTitle(true); setTimeout(() => setCopiedTitle(false), 2000); };
  const copyHtml = () => { if (!result) return; navigator.clipboard.writeText(result.html); setCopiedHtml(true); setTimeout(() => setCopiedHtml(false), 2000); };
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
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", margin: 0 }}>AliExpress Produktsuche</h1>
          <p style={{ color: "#64748B", marginTop: 4, fontSize: 13 }}>Nur EU-Lager · DE AT CH FR NL PL CZ BE LU</p>
        </div>

        {/* Suche */}
        <div style={{ background: "#fff", borderRadius: 20, padding: 20, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="z.B. Staubsauger, Kaffeemaschine…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleSearch}
              disabled={searchLoading || !query.trim()}
              style={{
                padding: "13px 18px", borderRadius: 12, border: "none",
                background: searchLoading || !query.trim() ? "#FDD0A8" : "#FF6B00",
                color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: searchLoading || !query.trim() ? "not-allowed" : "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
                whiteSpace: "nowrap" as const,
              }}
            >
              {searchLoading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={16} />}
              {searchLoading ? "" : "Suchen"}
            </button>
          </div>
        </div>

        {/* Search Error */}
        {searchError && (
          <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 14, padding: "14px 18px", marginBottom: 16, display: "flex", gap: 10 }}>
            <AlertCircle size={18} color="#DC2626" style={{ flexShrink: 0 }} />
            <p style={{ margin: 0, color: "#DC2626", fontSize: 13, fontWeight: 600 }}>{searchError}</p>
          </div>
        )}

        {/* Produktliste */}
        {searched && !result && (
          <>
            {products.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "#94A3B8" }}>
                <Package size={40} style={{ opacity: 0.3 }} />
                <p style={{ marginTop: 12, fontWeight: 600 }}>Keine EU-Lager Produkte gefunden</p>
                <p style={{ fontSize: 13 }}>Versuche einen anderen Suchbegriff</p>
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: "#64748B", marginBottom: 12, fontWeight: 600 }}>
                  {products.length} Produkte gefunden — Produkt auswählen:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {products.map(p => (
                    <button
                      key={p.productId}
                      onClick={() => handleSelect(p)}
                      style={{
                        background: "#fff", borderRadius: 16, padding: 14,
                        border: "2px solid #E2E8F0", cursor: "pointer",
                        display: "flex", gap: 12, alignItems: "flex-start",
                        textAlign: "left", fontFamily: "inherit",
                        transition: "border-color 0.2s, box-shadow 0.2s",
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#FF6B00"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 12px rgba(255,107,0,0.12)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#E2E8F0"; (e.currentTarget as HTMLButtonElement).style.boxShadow = "none"; }}
                    >
                      {p.imageUrl && (
                        <img src={p.imageUrl} alt="" style={{ width: 64, height: 64, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600, color: "#0F172A", lineHeight: 1.4,
                          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>
                          {p.title}
                        </p>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center" }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "#FF6B00" }}>{p.price} €</span>
                          <span style={{ fontSize: 12, color: "#64748B" }}>{countryFlag(p.shipFrom)} {p.shipFrom}</span>
                          {p.orders > 0 && <span style={{ fontSize: 11, color: "#94A3B8" }}>{p.orders} Bestellungen</span>}
                          {p.rating && <span style={{ fontSize: 11, color: "#F59E0B", display: "flex", alignItems: "center", gap: 2 }}><Star size={10} />{p.rating}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {/* Detail Loading */}
        {detailLoading && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <Loader size={32} color="#FF6B00" style={{ animation: "spin 1s linear infinite" }} />
            <p style={{ marginTop: 12, color: "#64748B", fontSize: 14 }}>Produktdetails werden geladen…</p>
          </div>
        )}

        {/* Results */}
        {result && selectedProduct && (
          <>
            {/* Zurück-Button */}
            <button
              onClick={() => { setResult(null); setSelectedProduct(null); setEbayResult(null); }}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "none", border: "none", color: "#64748B",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                fontFamily: "inherit", marginBottom: 14, padding: 0,
              }}
            >
              <ChevronLeft size={16} /> Zurück zur Suche
            </button>

            {/* Produkt-Info */}
            <div style={{ background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: 14, display: "flex", gap: 12 }}>
              {selectedProduct.imageUrl && (
                <img src={selectedProduct.imageUrl} alt="" style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
              )}
              <div>
                <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "#0F172A", lineHeight: 1.4 }}>{selectedProduct.title.slice(0, 100)}{selectedProduct.title.length > 100 ? "…" : ""}</p>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#FF6B00" }}>{selectedProduct.price} € · {countryFlag(selectedProduct.shipFrom)} {selectedProduct.shipFrom}</p>
              </div>
            </div>

            {/* Titel */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Titel</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: charColor }}>{charCount}/80</span>
              </div>
              <div style={{ background: "#F8FAFC", borderRadius: 10, padding: "12px 14px", fontSize: 14, color: "#0F172A", border: "1.5px solid #E2E8F0", marginBottom: 10, fontWeight: 500, lineHeight: 1.5 }}>
                {result.title}
              </div>
              <button onClick={copyTitle} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 0", borderRadius: 10, border: "none", background: copiedTitle ? "#22C55E" : "#FF6B00", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
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
              <div style={{ background: "#0F172A", borderRadius: 12, padding: 16, fontSize: 12, color: "#94A3B8", fontFamily: "monospace", marginBottom: 10, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 300, overflowY: "auto" }}>
                {result.html}
              </div>
              <button onClick={copyHtml} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 0", borderRadius: 10, border: "none", background: copiedHtml ? "#22C55E" : "#0F172A", color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
                {copiedHtml ? <Check size={16} /> : <Copy size={16} />}
                {copiedHtml ? "Kopiert!" : "HTML kopieren"}
              </button>
            </div>

            {/* Vorschau */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Vorschau</span>
                <button onClick={() => handleSelect(selectedProduct)} style={{ display: "flex", alignItems: "center", gap: 6, background: "#F1F5F9", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}>
                  <RefreshCw size={12} /> Neu laden
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
                  <input type="number" step="0.01" min="0.01" placeholder="19.99" value={ebayPrice} onChange={e => setEbayPrice(e.target.value)}
                    style={{ width: "100%", padding: "11px 14px", fontSize: 15, fontWeight: 600, border: "2px solid #E2E8F0", borderRadius: 10, outline: "none", fontFamily: "inherit", boxSizing: "border-box" as const, color: "#0F172A" }} />
                </div>
                <button onClick={handleEbayList} disabled={ebayLoading || !ebayPrice}
                  style={{ padding: "11px 20px", borderRadius: 10, border: "none", background: ebayLoading || !ebayPrice ? "#FDE68A" : "#FFD700", color: "#0F172A", fontWeight: 700, fontSize: 14, cursor: ebayLoading || !ebayPrice ? "not-allowed" : "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" as const }}>
                  {ebayLoading ? <><Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> Lädt…</> : <><ShoppingCart size={16} /> Listen</>}
                </button>
              </div>
              {ebayResult && (
                <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 10, background: ebayResult.listingId ? "#F0FDF4" : "#FEF2F2", border: `1.5px solid ${ebayResult.listingId ? "#BBF7D0" : "#FECACA"}` }}>
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
          Stele E-Transfer · AliExpress EU-Lager
        </p>
      </div>
    </div>
  );
}
