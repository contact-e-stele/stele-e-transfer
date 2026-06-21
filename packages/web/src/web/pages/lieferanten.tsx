/**
 * Lieferanten-Tab — AliExpress URL scrapen → Produkt importieren
 * Ersetzt AutoDS komplett für den Import-Schritt
 */
import { useState, useCallback, useRef } from "react";
import { buildEbayHTML, buildEbayHTMLLight } from "../lib/ebay-description";
import {
  FileText, Copy, Check, Loader, AlertCircle,
  RefreshCw, ShoppingCart, Package, Link, ChevronLeft,
  TrendingDown, Save, Eye, EyeOff, X,
} from "lucide-react";

interface VariantPrice {
  skuId: string;
  attrs: Record<string, string>;
  price: number;
  originalPrice?: number;
  stock?: number;
}

interface ScrapedProduct {
  title: string;
  images: string[];
  price: string;
  description: string;
  specs: Record<string, string>;
  variants?: Array<{ name: string; values: string[] }>;
  variantPrices?: VariantPrice[];
  shipsFrom?: string;
  shipsFromDE?: boolean;
}

// EU-Länder die akzeptiert werden (schnelle Lieferung, kein Zoll)
const EU_COUNTRIES = ['germany', 'deutschland', 'austria', 'österreich', 'france', 'frankreich',
  'netherlands', 'niederlande', 'poland', 'polen', 'czech', 'tschechien', 'belgium',
  'belgien', 'luxembourg', 'spain', 'spanien', 'italy', 'italien', 'sweden', 'schweden',
  'denmark', 'dänemark', 'finland', 'finnland', 'portugal', 'hungary', 'ungarn',
  'romania', 'rumänien', 'slovakia', 'slowakei', 'slovenia', 'slowenien',
  'switzerland', 'schweiz', // nicht EU aber Zollfrei-nah
];

function isEUShipping(shipsFrom?: string): boolean {
  if (!shipsFrom) return false;
  const lower = shipsFrom.toLowerCase();
  return EU_COUNTRIES.some(c => lower.includes(c));
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
    // AliExpress Plattform-Müll entfernen: "– AliExpress 200000297", "- AliExpress", etc.
    .replace(/[-–]\s*AliExpress\s*\d*/gi, "")
    .replace(/\bAliExpress\s*\d*/gi, "")
    // Mengenangaben am Anfang entfernen: "1/4 Stück", "2 Paar", "1 Stück", "3 Stück " etc.
    .replace(/^\d+\/\d+\s*(Stück|Paar|stücke|St\.?|pc\.?|pcs\.?)\s*/i, "")
    .replace(/^\d+\s*(Stück|Paar|stücke|St\.?|pc\.?|pcs\.?)\s*/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (title.length > 80) title = title.slice(0, 77) + "...";
  return title;
}

// Bekannte Footer/Spam-Phrasen die aus AliExpress HTML kommen
const BLOCKED_PHRASES = [
  /aliexpress/gi, /alibaba/gi, /alimama/gi, /taobao/gi, /tmall/gi, /fliggy/gi,
  /dingtalk/gi, /juhuasuan/gi, /alintern/gi, /alicdn/gi, /alipay/gi,
  /amazon/gi, /temu/gi, /wish\.com/gi, /ebay\.com/gi,
  /mehrsprachige.*websites/gi, /browse by category/gi,
  /hilfe-?center/gi, /streitigkeiten/gi, /rückgabe.*erstattung/gi,
  /transparenz.*zentrum/gi, /dsa.*osa/gi, /integrität.*konformität/gi,
  /beschwerdeein.*stieg/gi, /rückruf/gi,
  /русский|portuguese|español|français|italiano|türkçe|日本語|한국어|عربي|hebrew|polski/gi,
];

function isCleanLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 15) return false;
  for (const re of BLOCKED_PHRASES) {
    if (re.test(trimmed)) return false;
  }
  return true;
}

function buildHTML(product: ScrapedProduct, theme: "dark" | "light" = "dark"): string {
  return theme === "light" ? buildEbayHTMLLight(product) : buildEbayHTML(product);
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
  const [visibleImages, setVisibleImages] = useState<string[]>([]);
  const [result, setResult] = useState<{ title: string; html: string } | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [showPreview, setShowPreview] = useState(false);

  // Varianten-Auswahl: { "Farbe": ["Schwarz", "Blau"], "Größe": ["M"] }
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string[]>>({});
  // Varianten-Bearbeitung: welcher Wert gerade editiert wird { "Farbe:Schwarz": true }
  const [editingVariant, setEditingVariant] = useState<Record<string, string>>({}); // key = "group||oldVal", value = currentEditText
  // Varianten-Werte (editierbar, Kopie von product.variants)
  const [editedVariants, setEditedVariants] = useState<Array<{ name: string; values: string[] }>>([]);

  const [copiedTitle, setCopiedTitle] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [editableTitle, setEditableTitle] = useState("");
  const [editableHtml, setEditableHtml] = useState("");
  const [htmlTheme, setHtmlTheme] = useState<"dark" | "light">("dark");

  const [ebayPrice, setEbayPrice] = useState("");
  const [buyPrice, setBuyPrice] = useState("");
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayResult, setEbayResult] = useState<{ listingId?: string; error?: string } | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [gpsrHersteller, setGpsrHersteller] = useState("");
  const [saveResult, setSaveResult] = useState<{ id?: number; error?: string } | null>(null);
  const [shipsFromInfo, setShipsFromInfo] = useState<{ country: string; isEU: boolean } | null>(null);

  // ─── Marge berechnen ──────────────────────────────────────────────────────
  const einkauf = parseFloat(buyPrice.replace(",", ".")) || parsePrice(product?.price ?? "");
  const verkauf = parseFloat(ebayPrice.replace(",", ".")) || 0;
  // Gleiche Formel wie Preise-Tab: 18% netto × 1.19 MwSt + 0.45€ Fix × 1.19
  const EBAY_FEE = (18 / 100) * 1.19;
  const FIXBETRAG = 0.45 * 1.19;
  const ebayFee = verkauf * EBAY_FEE + FIXBETRAG;
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
      setVisibleImages(data.images ?? []);
      const t = buildTitle(data.title);
      const h = buildHTML(data, htmlTheme);
      setResult({ title: t, html: h });
      setEditableTitle(t);
      setEditableHtml(h);
      if (data.seller) setGpsrHersteller(data.seller);

      // EU-Filter: shipsFrom prüfen und anzeigen
      if (data.shipsFrom) {
        const euOk = isEUShipping(data.shipsFrom);
        setShipsFromInfo({ country: data.shipsFrom, isEU: euOk });
      } else {
        setShipsFromInfo(null);
      }

      // Varianten: alle vorselektieren + editierbare Kopie anlegen
      const initVariants: Record<string, string[]> = {};
      for (const g of (data.variants ?? [])) {
        initVariants[g.name] = [...g.values];
      }
      setSelectedVariants(initVariants);
      setEditedVariants(data.variants ? data.variants.map(g => ({ name: g.name, values: [...g.values] })) : []);
      setEditingVariant({});
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
    setVisibleImages([]);
    const t2 = buildTitle(fp.title);
    const h2 = buildHTML(fp, htmlTheme);
    setResult({ title: t2, html: h2 });
    setEditableTitle(t2);
    setEditableHtml(h2);
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
          generatedTitle: editableTitle,
          htmlDescription: editableHtml,
          bullets: Object.entries(product.specs).map(([k, v]) => `${k}: ${v}`),
          variants: editedVariants
            .filter(g => g.values.length > 0),
          variantPrices: product.variantPrices ?? [],
          description: product.description,
          images: visibleImages,
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

  // ─── eBay listen (nur mit bereits gespeicherter productId) ───────────────
  const handleEbayList = async () => {
    if (!saveResult?.id) return;
    const price = parseFloat(ebayPrice.replace(",", "."));
    if (!price || price <= 0) return;
    setEbayLoading(true);
    setEbayResult(null);
    try {
      const listRes = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: saveResult.id }),
      });
      const data = await listRes.json() as { listingId?: string; error?: string };
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

  const charCount = editableTitle.length;
  const charColor = charCount > 80 ? "#DC2626" : charCount > 70 ? "#F59E0B" : "#16a34a";

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "13px 16px", fontSize: 14, fontWeight: 500,
    border: "2px solid #E2E8F0", borderRadius: 12, outline: "none",
    fontFamily: "inherit", boxSizing: "border-box",
    color: "#0F172A", background: "#F8FAFC",
  };

  const gpsrInputRef = useRef<HTMLInputElement>(null);

  const handleGpsrUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      if (!dataUrl) return;
      try {
        // Bild auf Server hochladen → öffentliche URL (eBay akzeptiert kein base64)
        const res = await fetch('/api/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, filename: `gpsr-${Date.now()}` }),
        });
        const data = await res.json() as { url?: string; error?: string };
        if (data.url) {
          setVisibleImages(prev => [...prev, data.url!]);
        } else {
          // Fallback: base64 lokal anzeigen aber Warnung
          setVisibleImages(prev => [...prev, dataUrl]);
          console.warn('[GPSR Upload] Fehler:', data.error);
        }
      } catch {
        // Fallback base64
        setVisibleImages(prev => [...prev, dataUrl]);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }, []);

  const removeImage = useCallback((index: number) => {
    setVisibleImages(prev => {
      const next = prev.filter((_, i) => i !== index);
      setSelectedImage(si => {
        if (si >= next.length) return Math.max(0, next.length - 1);
        return si;
      });
      return next;
    });
  }, []);

  const reset = () => {
    setProduct(null); setResult(null); setEbayResult(null); setGpsrHersteller("");
    setSaveResult(null); setUrlInput(""); setManualTitle(""); setShipsFromInfo(null);
    setManualDesc(""); setManualPrice(""); setBuyPrice(""); setEbayPrice("");
    setShowPreview(false); setVisibleImages([]); setSelectedImage(0);
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

            {/* EU-Lager Banner */}
            {shipsFromInfo && (
              <div style={{
                display: "flex", alignItems: "center", gap: 10,
                background: shipsFromInfo.isEU ? "#F0FDF4" : "#FFF7ED",
                border: `1.5px solid ${shipsFromInfo.isEU ? "#86EFAC" : "#FED7AA"}`,
                borderRadius: 12, padding: "10px 14px", marginBottom: 14,
              }}>
                <span style={{ fontSize: 20 }}>{shipsFromInfo.isEU ? "✅" : "⚠️"}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: shipsFromInfo.isEU ? "#15803D" : "#C2410C" }}>
                    {shipsFromInfo.isEU
                      ? `EU-Lager erkannt: ${shipsFromInfo.country}`
                      : `Kein EU-Lager: ${shipsFromInfo.country}`}
                  </div>
                  <div style={{ fontSize: 11, color: shipsFromInfo.isEU ? "#16A34A" : "#EA580C", marginTop: 2 }}>
                    {shipsFromInfo.isEU
                      ? "Schnelle Lieferung (3–7 Tage), kein Zollrisiko"
                      : "China-Versand = langer Lieferweg + mögliche Zollprobleme. Besser: EU-Lager Variante suchen."}
                  </div>
                </div>
              </div>
            )}

            {/* Produktbild */}
            {visibleImages.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: 14 }}>
                <img src={visibleImages[selectedImage]} alt="" style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 10, background: "#F8FAFC" }} />
                <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
                  {visibleImages.map((img, i) => (
                    <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                      <img src={img} alt="" onClick={() => setSelectedImage(i)} style={{
                        width: 48, height: 48, borderRadius: 8, objectFit: "cover",
                        cursor: "pointer", display: "block",
                        border: i === selectedImage ? "2px solid #FF6B00" : "2px solid transparent",
                        opacity: i === selectedImage ? 1 : 0.6,
                      }} />
                      <button
                        onClick={(e) => { e.stopPropagation(); removeImage(i); }}
                        title="Bild entfernen"
                        style={{
                          position: "absolute", bottom: -6, right: -6,
                          width: 18, height: 18, borderRadius: "50%",
                          background: "#EF4444", border: "none",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", padding: 0, zIndex: 10,
                        }}
                      >
                        <X size={10} color="#fff" />
                      </button>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                  <p style={{ margin: 0, fontSize: 11, color: "#94A3B8" }}>
                    {visibleImages.length} Bild{visibleImages.length !== 1 ? "er" : ""} · X zum Entfernen
                  </p>
                  <button
                    onClick={() => gpsrInputRef.current?.click()}
                    title="GPSR-Bild hochladen"
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "5px 10px", borderRadius: 8, border: "1px solid #C9A227",
                      background: "#0f0f0f", color: "#C9A227", fontSize: 11,
                      fontWeight: 700, cursor: "pointer", letterSpacing: 0.5,
                    }}
                  >
                    📎 GPSR-Bild
                  </button>
                  <input
                    ref={gpsrInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handleGpsrUpload}
                  />
                </div>

                {/* GPSR Kopier-Box */}
                <div style={{ marginTop: 10, border: "1px solid #C9A227", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ background: "#1a1a1a", padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ color: "#C9A227", fontSize: 11, fontWeight: 700 }}>GPSR — kopierbar</span>
                    <button
                      onClick={() => {
                        const gpsr = gpsrHersteller.trim();
                        const text = gpsr
                          ? `Produktsicherheit (GPSR)\n\n${gpsr}`
                          : `Produktsicherheit (GPSR)\n\n[Compliance-Text von AliExpress einfügen]`;
                        navigator.clipboard.writeText(text).catch(() => {});
                      }}
                      style={{
                        background: "#C9A227", color: "#0f0f0f", border: "none",
                        padding: "4px 12px", borderRadius: 4, fontSize: 11,
                        fontWeight: 700, cursor: "pointer"
                      }}
                    >
                      Kopieren
                    </button>
                  </div>
                  {/* AliExpress Compliance einfügen */}
                  <div style={{ background: "#1a1a1a", padding: "6px 10px", borderTop: "1px solid #333" }}>
                    <span style={{ color: "#aaa", fontSize: 10, display: "block", marginBottom: 4 }}>
                      Compliance-Text von AliExpress einfügen (Manufacturer + EU responsible person + Product identifier):
                    </span>
                    <textarea
                      value={gpsrHersteller}
                      onChange={e => setGpsrHersteller(e.target.value)}
                      placeholder={"Manufacturer information\nName:...\nAddress:...\nEmail:...\nPhone:...\n\nEU responsible person information\nName:...\n..."}
                      rows={5}
                      style={{
                        width: "100%", background: "#111", color: "#fff", border: "1px solid #444",
                        borderRadius: 4, padding: "6px 8px", fontSize: 11, fontFamily: "monospace",
                        resize: "vertical", boxSizing: "border-box"
                      }}
                    />
                  </div>
                  {gpsrHersteller.trim() && (
                    <div style={{
                      background: "#111", color: "#ccc", fontFamily: "monospace",
                      fontSize: 11, lineHeight: 1.6, padding: "10px 12px",
                      whiteSpace: "pre-wrap", userSelect: "text"
                    }}>
                      {`Produktsicherheit (GPSR)\n\n${gpsrHersteller.trim()}`}
                    </div>
                  )}
                </div>

                {product.price && <p style={{ margin: "8px 0 0", fontSize: 16, fontWeight: 700, color: "#FF6B00" }}>{product.price}</p>}
              </div>
            )}

            {/* Titel */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>eBay Titel</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: charColor }}>{charCount}/80</span>
              </div>
              <textarea
                value={editableTitle}
                onChange={e => setEditableTitle(e.target.value)}
                rows={2}
                style={{
                  width: "100%", background: "#F8FAFC", borderRadius: 10, padding: "12px 14px",
                  fontSize: 14, color: "#0F172A", border: "1.5px solid #E2E8F0", marginBottom: 10,
                  fontWeight: 500, lineHeight: 1.5, resize: "vertical", outline: "none",
                  fontFamily: "inherit", boxSizing: "border-box",
                }}
              />
              <button onClick={() => copy(editableTitle, setCopiedTitle)} style={{
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
                <div style={{ display: "flex", gap: 6 }}>
                  {/* Theme Toggle */}
                  <div style={{ display: "flex", background: "#F1F5F9", borderRadius: 8, overflow: "hidden", border: "1px solid #E2E8F0" }}>
                    <button onClick={() => {
                      setHtmlTheme("dark");
                      if (product) setEditableHtml(buildHTML(product, "dark"));
                    }} style={{
                      padding: "5px 10px", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer",
                      background: htmlTheme === "dark" ? "#0F172A" : "transparent",
                      color: htmlTheme === "dark" ? "#C9A84C" : "#64748B",
                      fontFamily: "inherit",
                    }}>🌑 Dunkel</button>
                    <button onClick={() => {
                      setHtmlTheme("light");
                      if (product) setEditableHtml(buildHTML(product, "light"));
                    }} style={{
                      padding: "5px 10px", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer",
                      background: htmlTheme === "light" ? "#B8860B" : "transparent",
                      color: htmlTheme === "light" ? "#ffffff" : "#64748B",
                      fontFamily: "inherit",
                    }}>☀️ Hell</button>
                  </div>
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
              </div>
              {showPreview ? (
                <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.8, marginBottom: 10 }} dangerouslySetInnerHTML={{ __html: editableHtml }} />
              ) : (
                <textarea
                  value={editableHtml}
                  onChange={e => setEditableHtml(e.target.value)}
                  rows={10}
                  style={{
                    width: "100%", background: "#0F172A", borderRadius: 12, padding: 16,
                    fontSize: 12, color: "#94A3B8", fontFamily: "monospace", marginBottom: 10,
                    whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 260,
                    overflowY: "auto", resize: "vertical", outline: "none",
                    border: "none", boxSizing: "border-box",
                  }}
                />
              )}
              <button onClick={() => copy(editableHtml, setCopiedHtml)} style={{
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

            {/* Neu scrapen */}
            <div style={{ marginBottom: 14 }}>
              <button onClick={handleScrape} disabled={!urlInput.trim() || loading} style={{
                width: "100%", padding: "13px 0", borderRadius: 12, border: "1.5px solid #E2E8F0",
                background: "#fff", color: "#475569", fontWeight: 700, fontSize: 14,
                cursor: !urlInput.trim() ? "not-allowed" : "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
                <RefreshCw size={16} /> Neu scrapen
              </button>
            </div>

            {/* Varianten-Auswahl + Bearbeiten */}
            {editedVariants.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Package size={18} color="#fff" />
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Varianten</span>
                  <span style={{ fontSize: 11, color: "#94A3B8", marginLeft: "auto" }}>
                    {editedVariants.reduce((a, g) => a + (selectedVariants[g.name] ?? []).length, 0)} ausgewählt
                  </span>
                </div>

                {editedVariants.map((group, gi) => (
                  <div key={gi} style={{ marginBottom: 18, borderBottom: gi < editedVariants.length - 1 ? "1px solid #F1F5F9" : "none", paddingBottom: gi < editedVariants.length - 1 ? 14 : 0 }}>
                    {/* Gruppenname editierbar */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      {editingVariant[`__group__${gi}`] !== undefined ? (
                        <input
                          autoFocus
                          value={editingVariant[`__group__${gi}`]}
                          onChange={e => setEditingVariant(prev => ({ ...prev, [`__group__${gi}`]: e.target.value }))}
                          onBlur={() => {
                            const newName = (editingVariant[`__group__${gi}`] ?? "").trim();
                            if (newName && newName !== group.name) {
                              setEditedVariants(prev => prev.map((g, i) => i === gi ? { ...g, name: newName } : g));
                              setSelectedVariants(prev => {
                                const vals = prev[group.name] ?? [];
                                const next = { ...prev };
                                delete next[group.name];
                                next[newName] = vals;
                                return next;
                              });
                            }
                            setEditingVariant(prev => { const n = { ...prev }; delete n[`__group__${gi}`]; return n; });
                          }}
                          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          style={{
                            fontSize: 12, fontWeight: 700, color: "#7C3AED",
                            border: "none", borderBottom: "2px solid #7C3AED",
                            background: "transparent", outline: "none",
                            textTransform: "uppercase", letterSpacing: 0.5, padding: "2px 4px",
                          }}
                        />
                      ) : (
                        <>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: 0.5 }}>
                            {group.name}
                          </span>
                          <button
                            title="Gruppenname bearbeiten"
                            onClick={() => setEditingVariant(prev => ({ ...prev, [`__group__${gi}`]: group.name }))}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: "1px 4px", color: "#94A3B8", display: "flex", alignItems: "center" }}
                          >
                            ✏️
                          </button>
                        </>
                      )}
                    </div>

                    {/* Werte */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      {group.values.map((val, vi) => {
                        const editKey = `${gi}||${vi}`;
                        const isEditing = editingVariant[editKey] !== undefined;
                        const isSelected = (selectedVariants[group.name] ?? []).includes(val);

                        return (
                          <div key={vi} style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                            {isEditing ? (
                              <input
                                autoFocus
                                value={editingVariant[editKey]}
                                onChange={e => setEditingVariant(prev => ({ ...prev, [editKey]: e.target.value }))}
                                onBlur={() => {
                                  const newVal = (editingVariant[editKey] ?? "").trim();
                                  if (newVal && newVal !== val) {
                                    setEditedVariants(prev => prev.map((g, i) => {
                                      if (i !== gi) return g;
                                      const newVals = [...g.values];
                                      newVals[vi] = newVal;
                                      return { ...g, values: newVals };
                                    }));
                                    // Update selectedVariants wenn der alte Wert selektiert war
                                    setSelectedVariants(prev => {
                                      const current = prev[group.name] ?? [];
                                      if (current.includes(val)) {
                                        return { ...prev, [group.name]: current.map(v => v === val ? newVal : v) };
                                      }
                                      return prev;
                                    });
                                  }
                                  setEditingVariant(prev => { const n = { ...prev }; delete n[editKey]; return n; });
                                }}
                                onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setEditingVariant(prev => { const n = { ...prev }; delete n[editKey]; return n; }); } }}
                                style={{
                                  padding: "5px 10px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                                  border: "2px solid #7C3AED", outline: "none",
                                  background: "#F5F3FF", color: "#7C3AED",
                                  width: Math.max(60, val.length * 9) + "px",
                                }}
                              />
                            ) : (
                              <button
                                onClick={() => {
                                  setSelectedVariants(prev => {
                                    const current = prev[group.name] ?? [];
                                    const next = isSelected
                                      ? current.filter(v => v !== val)
                                      : [...current, val];
                                    return { ...prev, [group.name]: next };
                                  });
                                }}
                                style={{
                                  padding: "6px 28px 6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                                  cursor: "pointer", transition: "all 0.15s",
                                  background: isSelected ? "#7C3AED" : "#F1F5F9",
                                  color: isSelected ? "#fff" : "#475569",
                                  border: isSelected ? "2px solid #7C3AED" : "2px solid #E2E8F0",
                                  position: "relative",
                                }}
                              >
                                {val}
                                {/* Edit-Icon rechts im Button */}
                                <span
                                  onClick={e => {
                                    e.stopPropagation();
                                    setEditingVariant(prev => ({ ...prev, [editKey]: val }));
                                  }}
                                  title="Bearbeiten"
                                  style={{
                                    position: "absolute", right: 5, top: "50%", transform: "translateY(-50%)",
                                    fontSize: 10, cursor: "pointer", opacity: 0.5,
                                    lineHeight: 1,
                                  }}
                                >
                                  ✏️
                                </span>
                              </button>
                            )}
                            {/* X zum Löschen */}
                            {!isEditing && (
                              <button
                                onClick={() => {
                                  setEditedVariants(prev => prev.map((g, i) => {
                                    if (i !== gi) return g;
                                    return { ...g, values: g.values.filter((_, j) => j !== vi) };
                                  }));
                                  setSelectedVariants(prev => ({
                                    ...prev,
                                    [group.name]: (prev[group.name] ?? []).filter(v => v !== val),
                                  }));
                                }}
                                title="Löschen"
                                style={{
                                  position: "absolute", top: -6, right: -6,
                                  width: 16, height: 16, borderRadius: "50%",
                                  background: "#EF4444", border: "none",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  cursor: "pointer", padding: 0, zIndex: 5, fontSize: 9, color: "#fff",
                                }}
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}

                      {/* + neuen Wert hinzufügen */}
                      <button
                        onClick={() => {
                          const newVal = "Neu";
                          setEditedVariants(prev => prev.map((g, i) => i === gi ? { ...g, values: [...g.values, newVal] } : g));
                          // Neuen Wert automatisch selektieren
                          setSelectedVariants(prev => ({ ...prev, [group.name]: [...group.values, newVal] }));
                          // Sofort in Edit-Modus
                          setTimeout(() => {
                            const newVi = group.values.length;
                            setEditingVariant(prev => ({ ...prev, [`${gi}||${newVi}`]: newVal }));
                          }, 50);
                        }}
                        style={{
                          padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                          cursor: "pointer", background: "#F5F3FF",
                          color: "#7C3AED", border: "2px dashed #C4B5FD",
                        }}
                      >
                        + Neu
                      </button>
                    </div>

                    <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                      <button
                        onClick={() => setSelectedVariants(prev => ({ ...prev, [group.name]: [...group.values] }))}
                        style={{ fontSize: 11, color: "#7C3AED", background: "none", border: "none", cursor: "pointer", padding: 0, fontWeight: 600 }}
                      >
                        Alle wählen
                      </button>
                      <span style={{ color: "#CBD5E1", fontSize: 11 }}>|</span>
                      <button
                        onClick={() => setSelectedVariants(prev => ({ ...prev, [group.name]: [] }))}
                        style={{ fontSize: 11, color: "#94A3B8", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                      >
                        Alle abwählen
                      </button>
                    </div>
                  </div>
                ))}

                <div style={{ marginTop: 12, padding: "10px 14px", background: "#F5F3FF", borderRadius: 10, fontSize: 12, color: "#6D28D9" }}>
                  💡 ✏️ = Wert bearbeiten · × = löschen · + Neu = hinzufügen
                </div>
              </div>
            )}

            {/* In DB speichern */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#0F172A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Save size={18} color="#C9A227" />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>In DB speichern</span>
                {saveResult?.id && <span style={{ fontSize: 12, color: "#15803D", fontWeight: 600 }}>✓ Gespeichert (ID: {saveResult.id})</span>}
              </div>
              <button
                onClick={handleSave}
                disabled={saveLoading || !!saveResult?.id}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 12, border: "none",
                  background: saveResult?.id ? "#F0FDF4" : saveLoading ? "#E2E8F0" : "#0F172A",
                  color: saveResult?.id ? "#15803D" : saveLoading ? "#94A3B8" : "#C9A227",
                  fontWeight: 700, fontSize: 14,
                  cursor: (saveLoading || !!saveResult?.id) ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  border: saveResult?.id ? "1.5px solid #BBF7D0" : "none",
                }}
              >
                {saveLoading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={16} />}
                {saveLoading ? "Wird gespeichert…" : saveResult?.id ? "Bereits gespeichert" : "In DB speichern"}
              </button>
              {saveResult?.error && (
                <p style={{ margin: "8px 0 0", color: "#DC2626", fontSize: 13, fontWeight: 600 }}>Fehler: {saveResult.error}</p>
              )}
            </div>

            {/* eBay Listen */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FFD700", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ShoppingCart size={18} color="#0F172A" />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Auf eBay listen</span>
              </div>
              {!saveResult?.id && (
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "#94A3B8", textAlign: "center" }}>
                  Zuerst in DB speichern (Schritt 2 oben)
                </p>
              )}
              <button
                onClick={handleEbayList}
                disabled={ebayLoading || !ebayPrice || parseFloat(ebayPrice) <= 0 || !saveResult?.id}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 12, border: "none",
                  background: (!saveResult?.id || !ebayPrice) ? "#E2E8F0" : ebayLoading ? "#FDE68A" : "#FFD700",
                  color: (!saveResult?.id || !ebayPrice) ? "#94A3B8" : "#0F172A",
                  fontWeight: 700, fontSize: 14,
                  cursor: (!saveResult?.id || !ebayPrice || ebayLoading) ? "not-allowed" : "pointer",
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
