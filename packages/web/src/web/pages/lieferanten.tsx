/**
 * Lieferanten-Tab — AliExpress URL scrapen → Produkt importieren
 * Ersetzt AutoDS komplett für den Import-Schritt
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { buildEbayHTML, buildEbayHTMLLight } from "../lib/ebay-description";
import { safeJson } from "../lib/safeFetch";
import {
  FileText, Copy, Check, Loader, AlertCircle,
  RefreshCw, ShoppingCart, Package, Link, ChevronLeft,
  TrendingDown, Save, Eye, EyeOff, X, Plus, Trash2,
} from "lucide-react";

interface VariantPrice {
  skuId: string;
  attrs: Record<string, string>;
  price: number;
  originalPrice?: number;
  stock?: number;
  imageUrl?: string;
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
  // SKU-Varianten für HTML-Template aufbereiten
  const skuVariants = (product.variantPrices ?? []).length > 0
    ? product.variantPrices!.map(v => ({
        name: Object.values(v.attrs).join(" / ") || `SKU …${v.skuId.slice(-6)}`,
        price: v.price,
        imageUrl: (v as any).imageUrl as string | undefined,
      }))
    : undefined;
  const enriched = { ...product, skuVariants };
  return theme === "light" ? buildEbayHTMLLight(enriched) : buildEbayHTML(enriched);
}

function parsePrice(raw: string): number {
  if (!raw) return 0;
  const m = raw.match(/([\d]+[.,][\d]{2})/);
  if (!m) return 0;
  return parseFloat(m[1].replace(",", "."));
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Lieferanten() {
  const [urlInput, setUrlInput] = useState(() => {
    // URL aus Suche-Tab übernehmen (sessionStorage)
    const saved = sessionStorage.getItem("import_url") || "";
    if (saved) sessionStorage.removeItem("import_url");
    return saved;
  });
  const [loading, setLoading] = useState(false);
  const autoStartRef = useRef(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"url" | "manual">("url");

  // Manual
  const [manualTitle, setManualTitle] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const [manualPrice, setManualPrice] = useState("");

  const [product, setProduct] = useState<ScrapedProduct | null>(null);
  const [allImages, setAllImages] = useState<string[]>([]); // alle Bilder (inkl. ausgeblendete)
  const [excludedImages, setExcludedImages] = useState<Set<number>>(new Set()); // ausgeblendete Indizes
  const [visibleImages, setVisibleImages] = useState<string[]>([]); // nur sichtbare (= eingeschlossen)
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
  const [variantEbayPrices, setVariantEbayPrices] = useState<Record<string, string>>({});
  const [buyPrice, setBuyPrice] = useState(() => {
    const saved = sessionStorage.getItem("import_price") || "";
    if (saved) sessionStorage.removeItem("import_price");
    return saved;
  });
  const [adRate, setAdRate] = useState<number>(() => {
    const saved = localStorage.getItem("stele_ad_rate");
    return saved ? parseFloat(saved) : 5;
  });
  const [ebayLoading, setEbayLoading] = useState(false);
  const [ebayResult, setEbayResult] = useState<{ listingId?: string; error?: string } | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [gpsrHersteller, setGpsrHersteller] = useState("");
  const [saveResult, setSaveResult] = useState<{ id?: number; error?: string } | null>(null);
  const [shipsFromInfo, setShipsFromInfo] = useState<{ country: string; isEU: boolean } | null>(null);

  // ─── Marge berechnen ──────────────────────────────────────────────────────
  const einkauf = parseFloat(buyPrice.replace(",", ".")) || parsePrice(product?.price ?? "");
  const verkauf = parseFloat(ebayPrice.replace(",", ".")) || 0;
  // Formel: (13% eBay + adRate%) × 1.19 MwSt + 0.45€ Fix × 1.19
  const EBAY_BASE = 13; // eBay fix
  const totalFeePercent = (EBAY_BASE + adRate) / 100;
  const FIXBETRAG = 0.45 * 1.19;
  const ebayFee = verkauf * totalFeePercent * 1.19 + FIXBETRAG;
  const gewinn = verkauf - einkauf - ebayFee;
  const margePercent = verkauf > 0 ? (gewinn / verkauf) * 100 : 0;

  // ─── Auto-Start from Suche-Tab ────────────────────────────────────────────
  useEffect(() => {
    const autostart = sessionStorage.getItem("import_autostart");
    if (autostart && !autoStartRef.current && urlInput.trim()) {
      sessionStorage.removeItem("import_autostart");
      autoStartRef.current = true;
      // slight delay so component fully mounts
      setTimeout(() => handleScrape(), 300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      const data = await safeJson<ScrapedProduct & { error?: string }>("/api/aliexpress/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (data.error) throw new Error(data.error);
      setProduct(data);
      setAllImages(data.images ?? []);
      setExcludedImages(new Set());
      setVisibleImages(data.images ?? []);
      const t = buildTitle(data.title);
      const h = buildHTML(data, htmlTheme);
      setResult({ title: t, html: h });
      setEditableTitle(t);
      setEditableHtml(h);
      // GPSR auto-fill: wenn AliExpress GPSR-Daten liefert, direkt ins Textfeld setzen
      if (data.gpsr && (data.gpsr.name || data.gpsr.email)) {
        const lines: string[] = [];
        if (data.gpsr.name)      lines.push(`Name: ${data.gpsr.name}`);
        if (data.gpsr.address)   lines.push(`Adresse: ${data.gpsr.address}`);
        if (data.gpsr.email)     lines.push(`E-Mail: ${data.gpsr.email}`);
        if (data.gpsr.phone)     lines.push(`Telefon: ${data.gpsr.phone}`);
        if (data.gpsr.productId) lines.push(`Produktkennzeichnung: ${data.gpsr.productId}`);
        setGpsrHersteller(lines.join('\n'));
      }
      // (seller = nur AliExpress Shop-Name, kein GPSR-Text)

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
      const data = await safeJson<{ id?: number; error?: string }>("/api/products", {
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
          variantPrices: (product.variantPrices ?? []).map(v => ({
            ...v,
            ebayPrice: parseFloat((variantEbayPrices[v.skuId] ?? "").replace(",", ".")) || undefined,
          })),
          description: product.description,
          images: visibleImages,
          buyPrice: einkauf || null,
          sellPrice: verkauf || null,
          adRate: adRate,
        }),
      });
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
      const data = await safeJson<{ listingId?: string; error?: string }>("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: saveResult.id }),
      });
      setEbayResult(data);
    } catch (e) {
      setEbayResult({ error: e instanceof Error ? e.message : "Fehler" });
    } finally {
      setEbayLoading(false);
    }
  };

  // ─── Speichern + Direkt Listen (kombiniert) ───────────────────────────────
  const [saveAndListLoading, setSaveAndListLoading] = useState(false);
  const [saveAndListResult, setSaveAndListResult] = useState<{ listingId?: string; error?: string; step?: string } | null>(null);

  const handleSaveAndList = async () => {
    if (!result || !product) return;
    if (!ebayPrice || parseFloat(ebayPrice.replace(",", ".")) <= 0) {
      setSaveAndListResult({ error: "Bitte Verkaufspreis eingeben (Schritt 4 oben)" });
      return;
    }
    setSaveAndListLoading(true);
    setSaveAndListResult({ step: "Speichere in DB..." });
    try {
      // 1) Speichern
      let productId = saveResult?.id;
      if (!productId) {
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
            variants: editedVariants.filter(g => g.values.length > 0),
            variantPrices: (product.variantPrices ?? []).map(v => ({
              ...v,
              ebayPrice: parseFloat((variantEbayPrices[v.skuId] ?? "").replace(",", ".")) || undefined,
            })),
            description: product.description,
            images: visibleImages,
            buyPrice: einkauf || null,
            sellPrice: verkauf || null,
            adRate: adRate,
          }),
        });
        const data = await res.json() as { id?: number; error?: string };
        if (!data.id) {
          setSaveAndListResult({ error: data.error || "Speichern fehlgeschlagen" });
          return;
        }
        setSaveResult(data);
        productId = data.id;
      }
      // 2) Listen
      setSaveAndListResult({ step: "Liste auf eBay..." });
      const listRes = await fetch("/api/ebay/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      const listData = await listRes.json() as { listingId?: string; error?: string };
      setEbayResult(listData);
      setSaveAndListResult(listData);
    } catch (e) {
      setSaveAndListResult({ error: e instanceof Error ? e.message : "Fehler" });
    } finally {
      setSaveAndListLoading(false);
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
        const data = await safeJson<{ url?: string; error?: string }>('/api/upload-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, filename: `gpsr-${Date.now()}` }),
        });
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

  // Toggle-Bild-Ausblenden (für allImages aus Scrape)
  const toggleImageExcluded = useCallback((idx: number) => {
    setExcludedImages(prev => {
      const next = new Set(prev);
      if (next.has(idx)) { next.delete(idx); } else { next.add(idx); }
      // visibleImages neu berechnen
      const newVisible = allImages.filter((_, i) => !next.has(i));
      setVisibleImages(newVisible);
      setSelectedImage(si => Math.min(si, Math.max(0, newVisible.length - 1)));
      return next;
    });
  }, [allImages]);

  const reset = () => {
    setProduct(null); setResult(null); setEbayResult(null); setGpsrHersteller("");
    setSaveResult(null); setUrlInput(""); setManualTitle(""); setShipsFromInfo(null);
    setManualDesc(""); setManualPrice(""); setBuyPrice(""); setEbayPrice("");
    setShowPreview(false); setVisibleImages([]); setAllImages([]); setExcludedImages(new Set()); setSelectedImage(0);
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
            {(allImages.length > 0 || visibleImages.length > 0) && (
              <div style={{ background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: 14 }}>
                {/* Hauptbild = aktuell ausgewähltes sichtbares Bild */}
                {visibleImages.length > 0 ? (
                  <img src={visibleImages[Math.min(selectedImage, visibleImages.length - 1)]} alt=""
                    style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 10, background: "#F8FAFC" }} />
                ) : (
                  <div style={{ width: "100%", height: 160, borderRadius: 10, background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", color: "#94A3B8", fontSize: 13 }}>
                    Alle Bilder ausgeblendet
                  </div>
                )}

                {/* Thumbnail-Leiste: zeigt ALLE allImages, ausgeblendete grau + Auge */}
                <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", paddingBottom: 4 }}>
                  {(allImages.length > 0 ? allImages : visibleImages).map((img, i) => {
                    const isExcluded = allImages.length > 0 ? excludedImages.has(i) : false;
                    // visibleIndex = wie dieses Bild in visibleImages steht
                    const visIdx = visibleImages.indexOf(img);
                    const isSelected = !isExcluded && visIdx === selectedImage;
                    return (
                      <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                        <img src={img} alt=""
                          onClick={() => {
                            if (!isExcluded) {
                              if (visIdx >= 0) setSelectedImage(visIdx);
                            } else {
                              // Klick auf ausgeblendetes = wieder einblenden
                              toggleImageExcluded(i);
                            }
                          }}
                          title={isExcluded ? "Klick: Bild einblenden" : "Klick: Bild auswählen"}
                          style={{
                            width: 48, height: 48, borderRadius: 8, objectFit: "cover",
                            cursor: "pointer", display: "block",
                            border: isSelected ? "2px solid #FF6B00" : isExcluded ? "2px solid #CBD5E1" : "2px solid transparent",
                            opacity: isExcluded ? 0.3 : isSelected ? 1 : 0.7,
                            filter: isExcluded ? "grayscale(100%)" : "none",
                            transition: "all 0.15s",
                          }}
                        />
                        {/* Toggle-Button: Auge (ausblenden/einblenden) */}
                        {allImages.length > 0 && (
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleImageExcluded(i); }}
                            title={isExcluded ? "Bild einblenden" : "Bild ausblenden"}
                            style={{
                              position: "absolute", top: -6, right: -6,
                              width: 18, height: 18, borderRadius: "50%",
                              background: isExcluded ? "#94A3B8" : "#0F172A", border: "none",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              cursor: "pointer", padding: 0, zIndex: 10,
                              fontSize: 9, color: "#fff",
                            }}
                          >
                            {isExcluded ? "👁" : "✕"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {/* GPSR-Bilder (manuell hinzugefügt, nicht in allImages) */}
                  {visibleImages.filter(img => !allImages.includes(img)).map((img, i) => (
                    <div key={`gpsr-${i}`} style={{ position: "relative", flexShrink: 0 }}>
                      <img src={img} alt="" onClick={() => setSelectedImage(visibleImages.indexOf(img))}
                        style={{
                          width: 48, height: 48, borderRadius: 8, objectFit: "cover",
                          cursor: "pointer", display: "block",
                          border: visibleImages.indexOf(img) === selectedImage ? "2px solid #C9A227" : "2px dashed #C9A227",
                          opacity: 0.85,
                        }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); removeImage(visibleImages.indexOf(img)); }}
                        title="GPSR-Bild entfernen"
                        style={{
                          position: "absolute", top: -6, right: -6,
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
                    {visibleImages.length}/{allImages.length || visibleImages.length} Bilder · ✕ ausblenden · 👁 einblenden
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
                  {/* Header */}
                  <div style={{ background: "#1a1a1a", padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: "#C9A227", fontSize: 11, fontWeight: 700 }}>GPSR — Produktsicherheit</span>
                      {product?.gpsr?.name && (
                        <span style={{
                          background: "#1a3a1a", color: "#4caf50", border: "1px solid #2d5a2d",
                          padding: "1px 6px", borderRadius: 3, fontSize: 9, fontWeight: 700
                        }}>✓ Auto-befüllt</span>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {/* Link zur AliExpress Produktseite → Compliance-Tab */}
                      {urlInput && urlInput.includes("aliexpress") && (
                        <a
                          href={urlInput}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            background: "#2a2a2a", color: "#C9A227", border: "1px solid #C9A227",
                            padding: "4px 10px", borderRadius: 4, fontSize: 11,
                            fontWeight: 700, cursor: "pointer", textDecoration: "none",
                            display: "inline-flex", alignItems: "center", gap: 4
                          }}
                          title="AliExpress Produktseite öffnen → nach 'Product Safety Information' scrollen"
                        >
                          🔗 AliExpress öffnen
                        </a>
                      )}
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
                  </div>
                  {/* Anleitung */}
                  <div style={{ background: "#161616", padding: "6px 10px", borderTop: "1px solid #2a2a2a" }}>
                    {product?.gpsr?.name ? (
                      <span style={{ color: "#4caf50", fontSize: 10, lineHeight: 1.5, display: "block" }}>
                        ✓ GPSR-Daten wurden automatisch von AliExpress geladen. Du kannst den Text unten noch bearbeiten.
                      </span>
                    ) : (
                      <span style={{ color: "#888", fontSize: 10, lineHeight: 1.5, display: "block" }}>
                        1. AliExpress öffnen → ganz nach unten scrollen → <b style={{ color: "#aaa" }}>"Product Safety Information"</b> aufklappen<br/>
                        2. Manufacturer, EU Responsible Person, Product Identifier — Text hier einfügen:<br/>
                      </span>
                    )}
                    <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                      <button
                        onClick={() => {
                          if (!gpsrHersteller.trim()) {
                            setGpsrHersteller(
                              "Manufacturer information\nName: [Name eintragen]\nAddress: [Adresse]\nEmail: [E-Mail]\nPhone: [Telefon]\n\nEU responsible person information\nName: [Name]\nAddress: [Adresse]\nEmail: [E-Mail]\n\nProduct identifier\n[Modellnummer / EAN]"
                            );
                          }
                        }}
                        style={{
                          background: "#2a2a2a", color: "#aaa", border: "1px solid #444",
                          padding: "3px 10px", borderRadius: 4, fontSize: 10,
                          cursor: "pointer", whiteSpace: "nowrap"
                        }}
                      >
                        Vorlage einfügen
                      </button>
                      {gpsrHersteller.trim() && (
                        <button
                          onClick={() => setGpsrHersteller("")}
                          style={{
                            background: "transparent", color: "#666", border: "1px solid #333",
                            padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer"
                          }}
                        >
                          Löschen
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Textarea */}
                  <div style={{ background: "#1a1a1a", padding: "6px 10px", borderTop: "1px solid #2a2a2a" }}>
                    <textarea
                      value={gpsrHersteller}
                      onChange={e => setGpsrHersteller(e.target.value)}
                      placeholder={"Manufacturer information\nName:...\nAddress:...\nEmail:...\n\nEU responsible person information\nName:...\n..."}
                      rows={5}
                      style={{
                        width: "100%", background: "#111", color: "#fff", border: "1px solid #444",
                        borderRadius: 4, padding: "6px 8px", fontSize: 11, fontFamily: "monospace",
                        resize: "vertical", boxSizing: "border-box"
                      }}
                    />
                  </div>
                  {/* Vorschau */}
                  {gpsrHersteller.trim() && (
                    <div style={{
                      background: "#111", color: "#ccc", fontFamily: "monospace",
                      fontSize: 11, lineHeight: 1.6, padding: "10px 12px",
                      whiteSpace: "pre-wrap", userSelect: "text", borderTop: "1px solid #2a2a2a"
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4, textTransform: "uppercase" }}>Einkauf (€)</label>
                  <input type="number" step="0.01" placeholder="0.00" value={buyPrice} onChange={e => setBuyPrice(e.target.value)} style={{
                    width: "100%", padding: "10px 12px", fontSize: 14, fontWeight: 600,
                    border: "2px solid #E2E8F0", borderRadius: 10, outline: "none",
                    fontFamily: "inherit", boxSizing: "border-box", color: "#0F172A",
                  }} />
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>Verkauf eBay (€)</label>
                    {einkauf > 0 && (
                      <button
                        onClick={() => {
                          // Empfohlener Mindestpreis: (einkauf + 1.60) / (1 - (13+adRate)/100*1.19) + 0.45*1.19/(1-(13+adRate)/100*1.19)
                          // Vereinfacht: (einkauf + 1.60 + 0.45*1.19) / (1 - (13+adRate)/100*1.19)
                          const feeRate = (13 + adRate) / 100 * 1.19;
                          const recommended = Math.ceil(((einkauf + 1.60 + 0.45 * 1.19) / (1 - feeRate)) * 100) / 100;
                          setEbayPrice(recommended.toFixed(2));
                        }}
                        style={{
                          fontSize: 10, fontWeight: 700, color: "#16A34A", background: "#F0FDF4",
                          border: "1px solid #BBF7D0", borderRadius: 6, padding: "2px 8px", cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        ≥1,60€ Gewinn →
                      </button>
                    )}
                  </div>
                  <input type="number" step="0.01" placeholder="0.00" value={ebayPrice} onChange={e => setEbayPrice(e.target.value)} style={{
                    width: "100%", padding: "10px 12px", fontSize: 14, fontWeight: 600,
                    border: "2px solid #E2E8F0", borderRadius: 10, outline: "none",
                    fontFamily: "inherit", boxSizing: "border-box", color: "#0F172A",
                  }} />
                </div>
              </div>

              {/* Anzeigentarif */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4, textTransform: "uppercase" }}>
                  Anzeigentarif (Promoted Listings)
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {[2, 3, 5, 8, 10].map(rate => (
                    <button
                      key={rate}
                      onClick={() => { setAdRate(rate); localStorage.setItem("stele_ad_rate", String(rate)); }}
                      style={{
                        padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                        border: `2px solid ${adRate === rate ? "#FFD700" : "#E2E8F0"}`,
                        background: adRate === rate ? "#FFF8DC" : "#F8FAFC",
                        color: adRate === rate ? "#92400E" : "#64748B",
                        cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
                      }}
                    >{rate}%</button>
                  ))}
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600 }}>Eigener:</span>
                    <input
                      type="number" min="1" max="20" step="0.5"
                      value={![2, 3, 5, 8, 10].includes(adRate) ? adRate : ""}
                      placeholder="z.B. 7"
                      onChange={e => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v > 0 && v <= 20) {
                          setAdRate(v);
                          localStorage.setItem("stele_ad_rate", String(v));
                        }
                      }}
                      style={{
                        width: 64, padding: "7px 10px", fontSize: 13, fontWeight: 600,
                        border: `2px solid ${![2, 3, 5, 8, 10].includes(adRate) ? "#FFD700" : "#E2E8F0"}`,
                        borderRadius: 8, outline: "none", fontFamily: "inherit",
                        background: ![2, 3, 5, 8, 10].includes(adRate) ? "#FFF8DC" : "#F8FAFC",
                        color: "#0F172A",
                      }}
                    />
                    <span style={{ fontSize: 11, color: "#94A3B8" }}>%</span>
                  </div>
                </div>
                <div style={{ marginTop: 5, fontSize: 10, color: "#94A3B8" }}>
                  eBay 13% + Anzeige {adRate}% = {(13 + adRate)}% gesamt (× 1,19 MwSt)
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
                      { label: `Gebühr (${13 + adRate}%)`, value: `−${ebayFee.toFixed(2)} €`, color: "#64748B" },
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

            {/* Varianten-Preistabelle — AutoDS-Style: Bild + Name + SKU + Preis */}
            {product && (product.variantPrices ?? []).length > 0 && (() => {
              const vp = product.variantPrices!;
              const minP = Math.min(...vp.map(v => v.price));
              const ebay = parseFloat(ebayPrice) || 0;
              const totalFeeRate = (13 + adRate) / 100 * 1.19 + 0.0045 * 1.19 / (ebay || 1);
              return (
                <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FFF8DC", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <TrendingDown size={18} color="#92400E" />
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Varianten</span>
                    <span style={{ fontSize: 11, background: "#FEF9C3", color: "#92400E", padding: "2px 8px", borderRadius: 20, fontWeight: 700, marginLeft: "auto" }}>
                      {vp.length} Varianten · ab {minP.toFixed(2)} €
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Header */}
                    <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 120px 80px 80px 70px", gap: 8, padding: "0 8px", alignItems: "center" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}></div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Name / SKU</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", textAlign: "right" }}>Einkauf</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", textAlign: "right" }}>eBay</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", textAlign: "right" }}>Gewinn</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", textAlign: "right" }}>Lager</div>
                    </div>
                    {vp.map((v, i) => {
                      const isCheapest = v.price === minP;
                      const attrLabel = Object.values(v.attrs).join(" / ") || `Variante …${v.skuId.slice(-6)}`;
                      const varEbayRaw = variantEbayPrices[v.skuId] ?? "";
                      const varEbay = parseFloat(varEbayRaw.replace(",", ".")) || 0;
                      const varProfit = varEbay > 0
                        ? varEbay - varEbay * (13 + adRate) / 100 * 1.19 - 0.45 * 1.19 - v.price
                        : null;
                      return (
                        <div key={v.skuId} style={{
                          display: "grid", gridTemplateColumns: "36px 1fr 90px 90px 80px 55px",
                          gap: 6, padding: "8px 6px", alignItems: "center",
                          borderRadius: 10, border: `1.5px solid ${isCheapest ? "#BBF7D0" : "#F1F5F9"}`,
                          background: isCheapest ? "#F0FDF4" : i % 2 === 0 ? "#fff" : "#FAFAFA",
                        }}>
                          {/* Bild */}
                          <div style={{ width: 34, height: 34, borderRadius: 6, overflow: "hidden", background: "#F1F5F9", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {v.imageUrl
                              ? <img src={v.imageUrl} alt={attrLabel} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                              : <Package size={14} color="#CBD5E1" />
                            }
                          </div>
                          {/* Name + SKU */}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: "#0F172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={attrLabel}>{attrLabel}</div>
                            <div style={{ fontSize: 10, color: "#94A3B8", fontFamily: "monospace", cursor: "help" }} title={`SKU: ${v.skuId}`}>…{v.skuId.slice(-8)}</div>
                          </div>
                          {/* Einkauf */}
                          <div style={{ textAlign: "right" }}>
                            <span style={{ fontSize: 12, fontWeight: 800, color: isCheapest ? "#16A34A" : "#1D4ED8" }}>{v.price.toFixed(2)} €</span>
                            {isCheapest && <div style={{ fontSize: 9, color: "#16A34A", fontWeight: 700 }}>günstigst</div>}
                          </div>
                          {/* eBay Eingabe */}
                          <div style={{ textAlign: "right" }}>
                            <input
                              type="number" step="0.01" min="0"
                              placeholder={`min. ${(v.price * 1.19 * (1 + (13 + adRate) / 100) + 0.54 + 1.6).toFixed(2)}`}
                              value={varEbayRaw}
                              onChange={e => setVariantEbayPrices(prev => ({ ...prev, [v.skuId]: e.target.value }))}
                              style={{
                                width: "100%", textAlign: "right", fontSize: 12, fontWeight: 700,
                                border: "1.5px solid #E2E8F0", borderRadius: 6, padding: "3px 5px",
                                background: varEbay > 0 ? "#F0F9FF" : "#fff", color: "#0F172A", outline: "none",
                              }}
                            />
                          </div>
                          {/* Gewinn */}
                          <div style={{ textAlign: "right" }}>
                            {varProfit !== null
                              ? <span style={{ fontSize: 12, fontWeight: 800, color: varProfit >= 1.6 ? "#16A34A" : varProfit >= 0 ? "#F59E0B" : "#DC2626" }}>{varProfit >= 0 ? "+" : ""}{varProfit.toFixed(2)} €</span>
                              : <span style={{ color: "#CBD5E1", fontSize: 11 }}>–</span>
                            }
                          </div>
                          {/* Lager */}
                          <div style={{ textAlign: "right", fontSize: 11, color: v.stock === 0 ? "#DC2626" : "#64748B", fontWeight: v.stock === 0 ? 700 : 400 }}>
                            {v.stock !== undefined ? (v.stock === 0 ? "0 ❌" : v.stock) : "–"}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

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

            {/* Varianten-Auswahl + Manuell */}
            <div style={{ background:'#fff', borderRadius:20, padding:24, boxShadow:'0 2px 16px rgba(0,0,0,0.07)', marginBottom:14 }}>
              {/* Header */}
              <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:16}}>
                <div style={{width:36,height:36,borderRadius:10,background:'#7C3AED',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <Package size={18} color='#fff'/>
                </div>
                <span style={{fontWeight:700,fontSize:15,color:'#0F172A'}}>Varianten</span>
                <button onClick={() => {
                  const name = 'Variante';
                  setEditedVariants(prev => [...prev, {name, values:[]}]);
                  setSelectedVariants(prev => ({...prev, [name]:[]}));
                }} style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:5,padding:'6px 12px',borderRadius:8,border:'2px dashed #C4B5FD',background:'#F5F3FF',color:'#7C3AED',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                  <Plus size={13}/> Gruppe hinzufügen
                </button>
              </div>
              {editedVariants.length === 0 && (
                <p style={{textAlign:'center',color:'#94A3B8',fontSize:13,padding:'16px 0'}}>Keine Varianten — oben Gruppe hinzufügen</p>
              )}
              {editedVariants.map((group, gi) => (
                <div key={gi} style={{marginBottom:16,background:'#F8FAFC',borderRadius:12,padding:14}}>
                  {/* Gruppenname + Löschen */}
                  <div style={{display:'flex',gap:8,marginBottom:10,alignItems:'center'}}>
                    <input value={group.name} onChange={e => setEditedVariants(prev => prev.map((g,i)=>i===gi?{...g,name:e.target.value}:g))}
                      style={{flex:1,padding:'7px 10px',borderRadius:8,border:'1.5px solid #E2E8F0',fontSize:13,fontWeight:700,color:'#7C3AED',background:'#fff',outline:'none'}}/>
                    <button onClick={() => setEditedVariants(prev => prev.filter((_,i)=>i!==gi))}
                      style={{padding:'7px 10px',borderRadius:8,border:'none',background:'#FEF2F2',color:'#DC2626',cursor:'pointer',display:'flex',alignItems:'center'}}>
                      <Trash2 size={14}/>
                    </button>
                  </div>
                  {/* Werte */}
                  <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:8}}>
                    {group.values.map((val,vi) => (
                      <div key={vi} style={{display:'flex',alignItems:'center',gap:4,background:'#fff',borderRadius:8,border:'1.5px solid #E2E8F0',padding:'4px 8px'}}>
                        <input value={val} onChange={e => setEditedVariants(prev => prev.map((g,i)=>{if(i!==gi)return g;const v=[...g.values];v[vi]=e.target.value;return{...g,values:v};}))}
                          style={{border:'none',outline:'none',fontSize:13,fontWeight:600,color:'#0F172A',background:'transparent',width:Math.max(40,val.length*9)+'px'}}/>
                        <button onClick={() => setEditedVariants(prev => prev.map((g,i)=>{if(i!==gi)return g;return{...g,values:g.values.filter((_,j)=>j!==vi)};}))}
                          style={{background:'none',border:'none',cursor:'pointer',color:'#94A3B8',padding:0,display:'flex',alignItems:'center'}}><X size={11}/></button>
                      </div>
                    ))}
                    <button onClick={() => setEditedVariants(prev => prev.map((g,i)=>i===gi?{...g,values:[...g.values,'']}:g))}
                      style={{padding:'4px 10px',borderRadius:8,border:'2px dashed #C4B5FD',background:'#F5F3FF',color:'#7C3AED',fontSize:12,fontWeight:700,cursor:'pointer'}}>
                      + Wert
                    </button>
                  </div>
                </div>
              ))}
            </div>

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
                  width: "100%", padding: "13px 0", borderRadius: 12,
                  border: saveResult?.id ? "1.5px solid #BBF7D0" : "1.5px solid transparent",
                  background: saveResult?.id ? "#F0FDF4" : saveLoading ? "#E2E8F0" : "#0F172A",
                  color: saveResult?.id ? "#15803D" : saveLoading ? "#94A3B8" : "#C9A227",
                  fontWeight: 700, fontSize: 14,
                  cursor: (saveLoading || !!saveResult?.id) ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {saveLoading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={16} />}
                {saveLoading ? "Wird gespeichert…" : saveResult?.id ? "Bereits gespeichert" : "In DB speichern"}
              </button>
              {saveResult?.error && (
                <p style={{ margin: "8px 0 0", color: "#DC2626", fontSize: 13, fontWeight: 600 }}>Fehler: {saveResult.error}</p>
              )}
            </div>

            {/* ─── Speichern + Direkt Listen (Ein-Klick) ─── */}
            <div style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E3A5F 100%)", borderRadius: 20, padding: 24, boxShadow: "0 4px 20px rgba(15,23,42,0.25)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#C9A227", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <ShoppingCart size={18} color="#0F172A" />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#fff" }}>Speichern + Direkt Listen</span>
                <span style={{ fontSize: 11, color: "#C9A227", fontWeight: 600, background: "rgba(201,162,39,0.15)", padding: "2px 8px", borderRadius: 20 }}>Ein Klick</span>
              </div>
              <button
                onClick={handleSaveAndList}
                disabled={saveAndListLoading || !!ebayResult?.listingId}
                style={{
                  width: "100%", padding: "14px 0", borderRadius: 12, border: "none",
                  background: ebayResult?.listingId ? "#166534" : saveAndListLoading ? "rgba(201,162,39,0.5)" : "#C9A227",
                  color: ebayResult?.listingId ? "#fff" : "#0F172A",
                  fontWeight: 800, fontSize: 15,
                  cursor: (saveAndListLoading || !!ebayResult?.listingId) ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "all 0.2s",
                }}
              >
                {saveAndListLoading
                  ? <><Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> {saveAndListResult?.step || "Wird verarbeitet..."}</>
                  : ebayResult?.listingId
                  ? <><ShoppingCart size={16} /> ✓ Gelistet! ID: {ebayResult.listingId}</>
                  : <><ShoppingCart size={16} /> Speichern & auf eBay listen{ebayPrice ? ` (${ebayPrice} €)` : ""}</>
                }
              </button>
              {saveAndListResult?.error && (
                <p style={{ margin: "8px 0 0", color: "#FCA5A5", fontSize: 13, fontWeight: 600 }}>✗ {saveAndListResult.error}</p>
              )}
            </div>

            {/* eBay Listen (separat, für bereits gespeicherte Produkte) */}
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
