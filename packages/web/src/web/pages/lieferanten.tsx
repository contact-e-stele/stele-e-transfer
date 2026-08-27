/**
 * Lieferanten-Tab — AliExpress URL scrapen → Produkt importieren
 * Ersetzt AutoDS komplett für den Import-Schritt
 */
import { useState, useCallback, useRef, useEffect } from "react";
import { buildEbayHTML, buildEbayHTMLLight } from "../lib/ebay-description";
import { safeJson } from "../lib/safeFetch";
import { CHINA_ZOLL_EUR, MIN_GEWINN_EUR, PRICE_SAFETY_BUFFER_EUR, SHOP_CATEGORIES } from "../../shared/constants";
import { matchRegulatedCategories, type RegulatedCategory } from "../../shared/regulated-categories";
import {
  FileText, Copy, Check, Loader, AlertCircle,
  RefreshCw, Package, Link, ChevronLeft,
  TrendingDown, Save, Eye, EyeOff, X, Plus, Trash2,
} from "lucide-react";

// Gruppen-Namen die KEINE echten Produktvarianten sind → aus eBay-Listing herausfiltern
const SKIP_VARIANT_GROUPS = ['ships from', 'ships_from', 'ship from', 'versandland', 'versand von', 'country of origin', 'herstellungsland'];
const isSkipVariantGroup = (name: string) => SKIP_VARIANT_GROUPS.includes(name.toLowerCase().trim());

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
  seller?: string; // echter AliExpress Händler-/Shopname (z.B. "BOBO GO 1 Store")
  reviewCount?: number | null; // Anzahl Bewertungen — nur verfügbar wenn DS-API genutzt wurde
  rating?: number | null;      // Durchschnittliche Sternebewertung 0-5 — nur verfügbar wenn DS-API genutzt wurde
  shippingCost?: number | null; // Versandkosten laut AliExpress (P-69) — nur verfügbar wenn DS-API genutzt wurde
  gpsr?: { name: string; address: string; email: string; phone: string; productId?: string }; // EU-Verantwortlicher, aus AliExpress-HTML gescraped
  gpsrRaw?: string | null; // manuell/vorbefüllter Rohtext für den GPSR-Block in der Beschreibung
}

// P-73: Bewertungs-Ampel — kombiniert Anzahl UND Sternebewertung, schlechterer Wert gewinnt
type RatingLevel = "red" | "yellow" | "green" | "unknown";

function getRatingLevel(reviewCount?: number | null, rating?: number | null): RatingLevel {
  if (reviewCount == null || rating == null) return "unknown";
  if (reviewCount === 0) return "red";
  if (reviewCount < 50 || rating < 4.0) return "red";
  if (reviewCount < 300 || rating < 4.5) return "yellow";
  return "green";
}

const RATING_LEVEL_STYLE: Record<RatingLevel, { bg: string; border: string; fg: string; fgSub: string; icon: string }> = {
  red:     { bg: "#FEF2F2", border: "#FECACA", fg: "#B91C1C", fgSub: "#DC2626", icon: "🔴" },
  yellow:  { bg: "#FFFBEB", border: "#FDE68A", fg: "#92400E", fgSub: "#B45309", icon: "🟡" },
  green:   { bg: "#F0FDF4", border: "#86EFAC", fg: "#15803D", fgSub: "#16A34A", icon: "🟢" },
  unknown: { bg: "#F8FAFC", border: "#E2E8F0", fg: "#475569", fgSub: "#64748B", icon: "⚪" },
};

function RatingBanner({ reviewCount, rating }: { reviewCount?: number | null; rating?: number | null }) {
  const level = getRatingLevel(reviewCount, rating);
  const style = RATING_LEVEL_STYLE[level];

  let title: string;
  let subtitle: string;
  if (level === "unknown") {
    title = "Keine Bewertungsdaten verfügbar";
    subtitle = "Diese Import-Methode liefert keine Bewertungen (nur über AliExpress DS-API verfügbar)";
  } else if (reviewCount === 0) {
    title = "Keine Bewertungen vorhanden";
    subtitle = "Neues oder unbewertetes Angebot — erhöhtes Risiko";
  } else {
    title = `${rating!.toFixed(1)} ★ · ${reviewCount} Bewertung${reviewCount === 1 ? "" : "en"}`;
    subtitle = level === "red"
      ? "Wenige Bewertungen oder niedrige Sternebewertung — vor Import prüfen"
      : level === "yellow"
      ? "Mittlere Bewertungslage — noch keine breite Vertrauensbasis"
      : "Solide Bewertungslage";
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: style.bg, border: `1.5px solid ${style.border}`,
      borderRadius: 12, padding: "10px 14px", marginBottom: 14,
    }}>
      <span style={{ fontSize: 20 }}>{style.icon}</span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13, color: style.fg }}>{title}</div>
        <div style={{ fontSize: 11, color: style.fgSub, marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );
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

// Zoll gilt ausschliesslich bei China-Versand (nicht bei "nicht EU" allgemein) — konsistent mit Backend-Logik
function isChinaShipping(shipsFrom?: string): boolean {
  if (!shipsFrom) return false;
  return shipsFrom.toLowerCase().includes('china');
}

// P-74: Rundet zur NÄCHSTEN ,95-Endung (auf oder ab) — bewusst anders als der automatische
// Preis-Monitor (dort immer aufrunden für garantierten Mindestgewinn). Hier im manuellen
// Modal darf der Preis auch knapp unter den berechneten Mindestpreis fallen.
function roundToNearest95(value: number): number {
  const nearestInt = Math.round(value - 0.95);
  return Math.round((nearestInt + 0.95) * 100) / 100;
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

function buildHTML(product: ScrapedProduct, theme: "dark" | "light" = "light", overrideTitle?: string, setContents?: Record<string, string>, gpsrRaw?: string): string {
  // SKU-Varianten für HTML-Template aufbereiten
  // Nur echte Varianten (Farbe/Größe/etc.) zählen — reine "Ships From"-Einträge sind KEINE
  // echten Varianten und wuerden sonst als sinnlose graue Box + SKU-Nummer angezeigt werden.
  const realVariants = (product.variantPrices ?? []).filter(v =>
    Object.keys(v.attrs).some(k => !isSkipVariantGroup(k))
  );
  const skuVariants = realVariants.length > 0
    ? realVariants.map(v => ({
        name: Object.entries(v.attrs).filter(([k]) => !isSkipVariantGroup(k)).map(([,val]) => val).join(" / ") || `SKU …${v.skuId.slice(-6)}`,
        price: v.price,
        imageUrl: (v as any).imageUrl as string | undefined,
      }))
    : undefined;
  const enriched = {
    ...product,
    ...(overrideTitle ? { title: overrideTitle } : {}),
    skuVariants,
    setContents,
    gpsrRaw: gpsrRaw ?? product.gpsrRaw ?? null,
  };
  return theme === "light" ? buildEbayHTMLLight(enriched) : buildEbayHTML(enriched);
}

function parsePrice(raw: string): number {
  if (!raw) return 0;
  const m = raw.match(/([\d]+[.,][\d]{2})/);
  if (!m) return 0;
  return parseFloat(m[1].replace(",", "."));
}

// Ordnet den beim Scrape gelieferten Shop-Namen einem gespeicherten Lieferanten zu.
// Simple case-insensitive Gleichheit/Teilstring-Prüfung — kein exaktes ID-Matching möglich,
// da AliExpress-Scrapes keine stabile Store-ID liefern, nur den Anzeigenamen.
function findMatchingSupplier<T extends { shopName: string }>(sellerName: string | undefined, suppliers: T[]): T | undefined {
  if (!sellerName?.trim()) return undefined;
  const needle = sellerName.trim().toLowerCase();
  return suppliers.find(s => {
    const hay = s.shopName.trim().toLowerCase();
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
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
  const [showPreview, setShowPreview] = useState(false); // false = Vorschau sichtbar, true = Code sichtbar

  // Varianten-Auswahl: { "Farbe": ["Schwarz", "Blau"], "Größe": ["M"] }
  const [, setSelectedVariants] = useState<Record<string, string[]>>({});
  // Varianten-Bearbeitung: welcher Wert gerade editiert wird { "Farbe:Schwarz": true }
  const [, setEditingVariant] = useState<Record<string, string>>({}); // key = "group||oldVal", value = currentEditText
  // Varianten-Werte (editierbar, Kopie von product.variants)
  const [editedVariants, setEditedVariants] = useState<Array<{ name: string; values: string[] }>>([]);
  // Lieferumfang je SET-Wert: { "SET1": "10 kleine + 10 große + Bohrer", ... }
  const [variantContents, setVariantContents] = useState<Record<string, string>>({});

  const [copiedTitle, setCopiedTitle] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);
  const [editableTitle, setEditableTitle] = useState("");
  const [editableHtml, setEditableHtml] = useState("");

  const [ebayPrice, setEbayPrice] = useState("");
  const [variantEbayPrices, setVariantEbayPrices] = useState<Record<string, string>>({});
  const [variantHerkunft, setVariantHerkunft] = useState<Record<string, boolean>>({}); // true = China (zollpflichtig), false = EU
  const [variantZollManuell, setVariantZollManuell] = useState<Record<string, string>>({}); // manueller Zollbetrag bei Sendungswert > 150€
  const [buyPrice, setBuyPrice] = useState(() => {
    const saved = sessionStorage.getItem("import_price") || "";
    if (saved) sessionStorage.removeItem("import_price");
    return saved;
  });
  const [shippingCost, setShippingCost] = useState("0"); // Versandkosten laut AliExpress-Seite (0 = kostenlos)
  const [adRate, setAdRate] = useState<number>(() => {
    const saved = localStorage.getItem("stele_ad_rate");
    return saved ? parseFloat(saved) : 5;
  });
  const [, setEbayResult] = useState<{ listingId?: string; error?: string } | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [gpsrHersteller, setGpsrHersteller] = useState("");
  const [saveResult, setSaveResult] = useState<{ id?: number; error?: string } | null>(null);
  const [rawAliText, setRawAliText] = useState("");
  const [rawGenLoading, setRawGenLoading] = useState(false);
  const [rawGenError, setRawGenError] = useState("");
  const [shipsFromInfo, setShipsFromInfo] = useState<{ country: string; isEU: boolean } | null>(null);
  const [generatedDescription, setGeneratedDescription] = useState("");
  const [trustedSuppliers, setTrustedSuppliers] = useState<Array<{
    id: number; shopName: string; shopUrl: string; aliStoreId: string | null; euConfirmed: boolean; category: string | null;
    complianceStatus: 'ungeprueft' | 'geprueft' | 'abgelehnt'; complianceDocsVerifiedAt: string | null; complianceNotes: string | null;
  }>>([]);
  // Manuelles Shop-Formular (statt automatischem Scraping — zuverlässiger)
  const [manualShopUrl, setManualShopUrl] = useState("");
  const [manualShopName, setManualShopName] = useState("");
  const [manualShopCategory, setManualShopCategory] = useState<typeof SHOP_CATEGORIES[number]>(SHOP_CATEGORIES[0]);
  const [manualShopSaving, setManualShopSaving] = useState(false);
  const [manualShopError, setManualShopError] = useState("");
  const [shopDropdownOpen, setShopDropdownOpen] = useState(false);
  const [shopSearch, setShopSearch] = useState("");
  const shopDropdownRef = useRef<HTMLDivElement>(null);
  const [complianceFilter, setComplianceFilter] = useState<'all' | 'ungeprueft' | 'geprueft' | 'abgelehnt'>('all');
  const [editingSupplierId, setEditingSupplierId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ complianceStatus: 'ungeprueft' | 'geprueft' | 'abgelehnt'; complianceDocsVerifiedAt: string; complianceNotes: string }>({
    complianceStatus: 'ungeprueft', complianceDocsVerifiedAt: '', complianceNotes: '',
  });
  const [editSaving, setEditSaving] = useState(false);
  // P-31: Duplikat-Warnung vor dem Import
  const [duplicateWarning, setDuplicateWarning] = useState<{
    productId: string;
    product: { id: number; title: string; generatedTitle: string; ebayStatus: string | null; createdAt: string | null };
  } | null>(null);
  const [duplicateChecking, setDuplicateChecking] = useState(false);

  // Meine Shops laden
  useEffect(() => {
    fetch('/api/trusted-suppliers').then(r => r.json()).then(data => {
      if (Array.isArray(data)) setTrustedSuppliers(data);
    }).catch(() => {});
  }, []);

  const handleAddShopManual = async () => {
    setManualShopError("");
    if (!manualShopUrl.trim() || !manualShopName.trim()) {
      setManualShopError("Link und Name bitte ausfüllen");
      return;
    }
    setManualShopSaving(true);
    try {
      const res = await fetch('/api/trusted-suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopName: manualShopName.trim(),
          shopUrl: manualShopUrl.trim(),
          euConfirmed: true,
          category: manualShopCategory,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTrustedSuppliers(prev => [...prev, data]);
        setManualShopUrl("");
        setManualShopName("");
      } else {
        setManualShopError(data.error ?? "Fehler beim Speichern");
      }
    } catch (e) {
      setManualShopError(e instanceof Error ? e.message : "Fehler beim Speichern");
    } finally {
      setManualShopSaving(false);
    }
  };

  const handleDeleteShop = async (id: number) => {
    await fetch(`/api/trusted-suppliers/${id}`, { method: 'DELETE' });
    setTrustedSuppliers(prev => prev.filter(s => s.id !== id));
  };

  const handleStartEditSupplier = (s: typeof trustedSuppliers[number]) => {
    setEditingSupplierId(s.id);
    setEditDraft({
      complianceStatus: s.complianceStatus,
      complianceDocsVerifiedAt: s.complianceDocsVerifiedAt ?? '',
      complianceNotes: s.complianceNotes ?? '',
    });
  };

  const handleCancelEditSupplier = () => setEditingSupplierId(null);

  const handleSaveSupplierCompliance = async (id: number) => {
    setEditSaving(true);
    try {
      const res = await fetch(`/api/trusted-suppliers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          complianceStatus: editDraft.complianceStatus,
          complianceDocsVerifiedAt: editDraft.complianceDocsVerifiedAt || null,
          complianceNotes: editDraft.complianceNotes || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTrustedSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
        setEditingSupplierId(null);
      }
    } finally {
      setEditSaving(false);
    }
  };

  const COMPLIANCE_LABELS: Record<string, string> = { ungeprueft: 'Ungeprüft', geprueft: 'Geprüft', abgelehnt: 'Abgelehnt' };
  const COMPLIANCE_COLORS: Record<string, { bg: string; fg: string }> = {
    ungeprueft: { bg: '#FEF3C7', fg: '#92400E' },
    geprueft: { bg: '#DCFCE7', fg: '#166534' },
    abgelehnt: { bg: '#FEE2E2', fg: '#991B1B' },
  };

  // Dropdown schließen bei Klick außerhalb (P-30)
  useEffect(() => {
    if (!shopDropdownOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (shopDropdownRef.current && !shopDropdownRef.current.contains(e.target as Node)) {
        setShopDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [shopDropdownOpen]);

  const handleSelectShop = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
    setShopDropdownOpen(false);
    setShopSearch("");
  };

  // Nach Kategorie gruppieren, vorher nach Name/Kategorie filtern (P-30)
  const SHOP_NO_CATEGORY = "Ohne Kategorie";
  const shopSearchLower = shopSearch.trim().toLowerCase();
  const filteredShops = trustedSuppliers
    .filter(s => complianceFilter === 'all' || s.complianceStatus === complianceFilter)
    .filter(s =>
      !shopSearchLower ||
      s.shopName.toLowerCase().includes(shopSearchLower) ||
      (s.category ?? "").toLowerCase().includes(shopSearchLower)
    );
  const groupedShops = filteredShops.reduce<Record<string, typeof trustedSuppliers>>((groups, s) => {
    const key = s.category ?? SHOP_NO_CATEGORY;
    (groups[key] ??= []).push(s);
    return groups;
  }, {});
  const shopGroupNames = Object.keys(groupedShops).sort((a, b) =>
    a === SHOP_NO_CATEGORY ? 1 : b === SHOP_NO_CATEGORY ? -1 : a.localeCompare(b, "de")
  );

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

  // ─── P-66 Schritt 2: Compliance-Gate für regulierte Produktgruppen ────────
  const regulatedMatches: RegulatedCategory[] = product
    ? matchRegulatedCategories([product.title, editableTitle, product.description ?? ''].join(' '))
    : [];
  const matchedSupplier = product ? findMatchingSupplier(product.seller, trustedSuppliers) : undefined;
  const supplierVerified = matchedSupplier?.complianceStatus === 'geprueft';
  const complianceBlocked = regulatedMatches.length > 0 && !supplierVerified;

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

  // ─── GPSR-Änderung → Vorschau automatisch neu rendern ────────────────────
  useEffect(() => {
    if (!product) return; // nur wenn Produkt geladen
    const base = product;
    const realVariants = (base.variantPrices ?? []).filter(v =>
      Object.keys(v.attrs).some(k => !isSkipVariantGroup(k))
    );
    const skuVariants = realVariants.length > 0
      ? realVariants.map(v => ({
          name: Object.entries(v.attrs).filter(([k]) => !isSkipVariantGroup(k)).map(([,val]) => val).join(" / ") || `SKU …${v.skuId.slice(-6)}`,
          price: v.price,
          imageUrl: (v as any).imageUrl as string | undefined,
        }))
      : undefined;
    const descToUse = generatedDescription || base.description || "";
    const enriched = { ...base, description: descToUse, skuVariants, gpsrRaw: gpsrHersteller.trim() || null, setContents: Object.keys(variantContents).length > 0 ? variantContents : undefined };
    const updated = buildEbayHTMLLight(enriched);
    setEditableHtml(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsrHersteller, generatedDescription, variantContents]);

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
      // Versandkosten vom Scrape übernehmen (P-69) — "0" nur wenn AliExpress tatsächlich kostenlosen Versand meldet
      setShippingCost(data.shippingCost != null ? data.shippingCost.toFixed(2) : "0");
      setAllImages(data.images ?? []);
      setExcludedImages(new Set());
      setVisibleImages(data.images ?? []);
      const t = buildTitle(data.title);
      const h = buildHTML(data, "light", t);
      setResult({ title: t, html: h });
      setEditableTitle(t);
      setEditableHtml(""); // Leer lassen — User generiert Beschreibung manuell per KI
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
      // P-88: Bei nur einer Varianten-Gruppe ist der von AliExpress gelieferte Name unzuverlässig
      // (oft pauschal "Color", auch wenn es z.B. um Größen/Sets wie "1PC-30x40CM" geht) — Standardname
      // stattdessen "Varianten", vom Nutzer wie gewohnt frei umbenennbar. Bei mehreren Gruppen bleiben
      // die AliExpress-Labels unverändert (dort in der Regel zuverlässiger).
      const nonSkipGroupCount = (data.variants ?? []).filter(g => !isSkipVariantGroup(g.name)).length;
      const namedVariants = (data.variants ?? []).map(g =>
        nonSkipGroupCount === 1 && !isSkipVariantGroup(g.name) ? { ...g, name: "Varianten" } : g
      );

      const initVariants: Record<string, string[]> = {};
      for (const g of namedVariants) {
        initVariants[g.name] = [...g.values];
      }
      setSelectedVariants(initVariants);
      setEditedVariants(namedVariants.filter(g => !isSkipVariantGroup(g.name)).map(g => ({ name: g.name, values: [...g.values] })));
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

  // ─── Duplikat-Check vor dem Import (P-31) ──────────────────────────────────
  // Extrahiert die AliExpress-Produkt-ID serverseitig und prüft, ob das Produkt
  // bereits importiert wurde. Blockiert NICHT automatisch — zeigt nur eine
  // Warnung, die Nutzerin entscheidet, ob trotzdem importiert werden soll.
  const handleScrapeClick = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setDuplicateWarning(null);
    setDuplicateChecking(true);
    try {
      const data = await safeJson<{
        exists: boolean;
        productId: string | null;
        product?: { id: number; title: string; generatedTitle: string; ebayStatus: string | null; createdAt: string | null };
      }>(`/api/products/check-duplicate?url=${encodeURIComponent(url)}`);
      if (data.exists && data.productId && data.product) {
        setDuplicateChecking(false);
        setDuplicateWarning({ productId: data.productId, product: data.product });
        return; // Import NICHT automatisch fortsetzen — erst nach Bestätigung
      }
    } catch {
      // Duplikat-Check fehlgeschlagen (z.B. Netzwerk) — Import trotzdem normal fortsetzen, nicht blockieren
    }
    setDuplicateChecking(false);
    handleScrape();
  };

  const handleImportAnyway = () => {
    setDuplicateWarning(null);
    handleScrape();
  };

  const handleManual = () => {
    if (!manualTitle.trim()) return;
    const fp: ScrapedProduct = { title: manualTitle.trim(), images: [], price: manualPrice.trim(), description: manualDesc.trim(), specs: {} };
    setProduct(fp);
    setVisibleImages([]);
    const t2 = buildTitle(fp.title);
    const h2 = buildHTML(fp, "light");
    setResult({ title: t2, html: h2 });
    setEditableTitle(t2);
    setEditableHtml(""); // Leer lassen — User generiert Beschreibung manuell per KI
    const p = parsePrice(fp.price);
    if (p > 0) setBuyPrice(p.toFixed(2));
  };

  // ─── Speichern in DB ──────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!result || !product) return;
    if (complianceBlocked) return; // P-66: harte Sperre, kein Bypass
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
            .filter(g => g.values.length > 0 && !isSkipVariantGroup(g.name)),
          variantPrices: (product.variantPrices ?? []).map(v => ({
            ...v,
            ebayPrice: parseFloat((variantEbayPrices[v.skuId] ?? "").replace(",", ".")) || undefined,
          })),
          variantContents: Object.keys(variantContents).length > 0 ? variantContents : undefined,
          gpsrRaw: gpsrHersteller.trim() || undefined,
          gpsrHtml: gpsrHersteller.trim() ? `<div class="gpsr-block"><h3>Produktsicherheit (GPSR)</h3><pre>${gpsrHersteller.trim()}</pre></div>` : undefined,
          description: product.description,
          images: visibleImages,
          buyPrice: einkauf || null,
          sellPrice: verkauf || null,
          adRate: adRate,
          shippingCost: parseFloat(shippingCost.replace(",", ".")) || 0,
          shipsFrom: shipsFromInfo?.country,
        }),
      });
      setSaveResult(data);
    } catch (e) {
      setSaveResult({ error: e instanceof Error ? e.message : "Fehler" });
    } finally {
      setSaveLoading(false);
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
    setVariantContents({});
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>

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

        {/* ─── Meine Shops (Vertrauenswürdige Lieferanten) — gruppiertes Dropdown (P-30) ── */}
        {trustedSuppliers.length > 0 && (
          <div ref={shopDropdownRef} style={{ position: "relative", background: "#fff", borderRadius: 16, padding: "16px 20px", marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1.5px solid #E2E8F0" }}>
            <div
              onClick={() => setShopDropdownOpen(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
            >
              <span style={{ fontSize: 16 }}>⭐</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: "#0F172A" }}>Meine EU-Shops</span>
              <span style={{ fontSize: 11, color: "#64748B", marginLeft: 4 }}>{trustedSuppliers.length} gespeichert</span>
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#94A3B8", transform: shopDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
            </div>

            {shopDropdownOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 20, right: 20, zIndex: 20,
                background: "#fff", border: "1.5px solid #E2E8F0", borderRadius: 12,
                boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 360, display: "flex", flexDirection: "column",
              }}>
                <div style={{ display: "flex", gap: 4, padding: "8px 10px 0", flexWrap: "wrap" }}>
                  {(["all", "ungeprueft", "geprueft", "abgelehnt"] as const).map(f => (
                    <button
                      key={f}
                      onClick={(e) => { e.stopPropagation(); setComplianceFilter(f); }}
                      style={{
                        padding: "3px 8px", borderRadius: 999, border: "1px solid " + (complianceFilter === f ? "#FF6B00" : "#E2E8F0"),
                        background: complianceFilter === f ? "#FF6B00" : "#fff",
                        color: complianceFilter === f ? "#fff" : "#64748B",
                        fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      {f === "all" ? "Alle" : COMPLIANCE_LABELS[f]}
                    </button>
                  ))}
                </div>
                <div style={{ padding: 10, borderBottom: "1px solid #F1F5F9" }}>
                  <input
                    autoFocus
                    value={shopSearch}
                    onChange={(e) => setShopSearch(e.target.value)}
                    placeholder="Shop oder Kategorie suchen…"
                    style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 13, border: "1.5px solid #E2E8F0", borderRadius: 8, outline: "none", fontFamily: "inherit" }}
                  />
                </div>
                <div style={{ overflowY: "auto" }}>
                  {shopGroupNames.length === 0 && (
                    <div style={{ padding: "16px 14px", fontSize: 12, color: "#94A3B8", textAlign: "center" }}>Keine Treffer</div>
                  )}
                  {shopGroupNames.map(groupName => (
                    <div key={groupName}>
                      <div style={{ padding: "8px 14px 4px", fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {groupName}
                      </div>
                      {groupedShops[groupName].map(s => (
                        <div key={s.id}>
                          <div
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "8px 14px", cursor: "pointer",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#F8FAFC")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          >
                            <span onClick={() => handleSelectShop(s.shopUrl)} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, cursor: "pointer" }}>
                              {s.euConfirmed && <span style={{ color: "#16A34A", fontSize: 12 }}>🇪🇺</span>}
                              <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{s.shopName}</span>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
                                background: COMPLIANCE_COLORS[s.complianceStatus].bg, color: COMPLIANCE_COLORS[s.complianceStatus].fg,
                              }}>
                                {COMPLIANCE_LABELS[s.complianceStatus]}
                              </span>
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleStartEditSupplier(s); }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: "0 2px", fontSize: 13, lineHeight: 1 }}
                              title="Compliance bearbeiten"
                            >✎</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteShop(s.id); }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: "0 2px", fontSize: 14, lineHeight: 1 }}
                              title="Entfernen"
                            >×</button>
                          </div>
                          {editingSupplierId === s.id && (
                            <div onClick={(e) => e.stopPropagation()} style={{ padding: "8px 14px 12px", background: "#F8FAFC", display: "flex", flexDirection: "column", gap: 6 }}>
                              <select
                                value={editDraft.complianceStatus}
                                onChange={(e) => setEditDraft(d => ({ ...d, complianceStatus: e.target.value as typeof d.complianceStatus }))}
                                style={{ padding: "6px 8px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" }}
                              >
                                {(["ungeprueft", "geprueft", "abgelehnt"] as const).map(v => <option key={v} value={v}>{COMPLIANCE_LABELS[v]}</option>)}
                              </select>
                              <input
                                type="date"
                                value={editDraft.complianceDocsVerifiedAt}
                                onChange={(e) => setEditDraft(d => ({ ...d, complianceDocsVerifiedAt: e.target.value }))}
                                style={{ padding: "6px 8px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" }}
                              />
                              <textarea
                                value={editDraft.complianceNotes}
                                onChange={(e) => setEditDraft(d => ({ ...d, complianceNotes: e.target.value }))}
                                placeholder="Notiz zur Prüfung…"
                                rows={2}
                                style={{ padding: "6px 8px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit", resize: "vertical" }}
                              />
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  onClick={() => handleSaveSupplierCompliance(s.id)}
                                  disabled={editSaving}
                                  style={{ flex: 1, padding: "6px 0", borderRadius: 8, border: "none", background: "#FF6B00", color: "#fff", fontWeight: 700, fontSize: 12, cursor: editSaving ? "default" : "pointer", fontFamily: "inherit" }}
                                >{editSaving ? "Speichert…" : "Speichern"}</button>
                                <button
                                  onClick={handleCancelEditSupplier}
                                  style={{ flex: 1, padding: "6px 0", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                                >Abbrechen</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── Shop manuell hinzufügen (statt automatischem Scraping) ───────────── */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "16px 20px", marginBottom: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", border: "1.5px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 16 }}>⭐</span>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#0F172A" }}>Shop manuell hinzufügen</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input
              value={manualShopUrl}
              onChange={(e) => setManualShopUrl(e.target.value)}
              placeholder="Shop-Link (einfach reinkopieren)"
              style={{ padding: "10px 12px", fontSize: 13, border: "1.5px solid #E2E8F0", borderRadius: 10, outline: "none", fontFamily: "inherit" }}
            />
            <input
              value={manualShopName}
              onChange={(e) => setManualShopName(e.target.value)}
              placeholder="Shop-Name (frei eintragen)"
              style={{ padding: "10px 12px", fontSize: 13, border: "1.5px solid #E2E8F0", borderRadius: 10, outline: "none", fontFamily: "inherit" }}
            />
            <select
              value={manualShopCategory}
              onChange={(e) => setManualShopCategory(e.target.value as typeof SHOP_CATEGORIES[number])}
              style={{ padding: "10px 12px", fontSize: 13, border: "1.5px solid #E2E8F0", borderRadius: 10, outline: "none", fontFamily: "inherit", background: "#fff" }}
            >
              {SHOP_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
            <button
              onClick={handleAddShopManual}
              disabled={manualShopSaving}
              style={{
                padding: "10px 0", borderRadius: 10, border: "none",
                background: "#FF6B00", color: "#fff", fontWeight: 700, fontSize: 13,
                cursor: manualShopSaving ? "default" : "pointer", fontFamily: "inherit",
              }}
            >
              {manualShopSaving ? "Wird gespeichert…" : "+ Shop speichern"}
            </button>
            {manualShopError && (
              <p style={{ margin: 0, color: "#DC2626", fontSize: 12, fontWeight: 600 }}>{manualShopError}</p>
            )}
          </div>
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
                  onChange={e => { setUrlInput(e.target.value); setDuplicateWarning(null); }}
                  onKeyDown={e => e.key === "Enter" && handleScrapeClick()}
                  style={{ ...inputStyle, paddingLeft: 38 }}
                />
              </div>
              <button
                onClick={handleScrapeClick}
                disabled={loading || duplicateChecking || !urlInput.trim()}
                style={{
                  padding: "13px 18px", borderRadius: 12, border: "none",
                  background: loading || duplicateChecking || !urlInput.trim() ? "#FDD0A8" : "#FF6B00",
                  color: "#fff", fontWeight: 700, fontSize: 14,
                  cursor: loading || duplicateChecking || !urlInput.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
                  whiteSpace: "nowrap",
                }}
              >
                {(loading || duplicateChecking) ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <FileText size={16} />}
                {duplicateChecking ? "Prüfe…" : loading ? "Lädt…" : "Scrapen"}
              </button>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 11, color: "#94A3B8" }}>
              ⚠️ Nur EU-Lager-Produkte (DE/AT/CH) für schnelle Lieferzeiten
            </p>

            {/* P-31: Duplikat-Warnung */}
            {duplicateWarning && (
              <div style={{
                marginTop: 12, padding: "12px 14px", borderRadius: 12,
                background: "#FFFBEB", border: "1.5px solid #FDE68A",
                display: "flex", flexDirection: "column", gap: 8,
              }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <span style={{ fontSize: 16, lineHeight: "20px" }}>⚠️</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#92400E" }}>
                      Bereits importiert
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 12, color: "#78350F" }}>
                      „{duplicateWarning.product.generatedTitle || duplicateWarning.product.title}"
                      {duplicateWarning.product.createdAt && <> am {duplicateWarning.product.createdAt.slice(0, 10)}</>}
                      {" "}importiert · Status: <strong>{duplicateWarning.product.ebayStatus ?? "none"}</strong>
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={handleImportAnyway}
                    style={{
                      padding: "7px 12px", borderRadius: 8, border: "1.5px solid #F59E0B",
                      background: "#fff", color: "#92400E", fontWeight: 700, fontSize: 12,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    Trotzdem importieren
                  </button>
                  <button
                    onClick={() => setDuplicateWarning(null)}
                    style={{
                      padding: "7px 12px", borderRadius: 8, border: "1.5px solid transparent",
                      background: "transparent", color: "#92400E", fontWeight: 600, fontSize: 12,
                      cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            )}
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

            {/* 2-Spalten Grid für Desktop, 1 Spalte auf Handy */}
            <style>{`@media(max-width:768px){.stele-grid{grid-template-columns:1fr!important;}}`}</style>
            <div className="stele-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16, alignItems: "start" }}>
            <div>
            {/* LINKE SPALTE — Bild, GPSR, Varianten-Preistabelle */}

            {/* Bewertungs-Ampel (P-73) */}
            <RatingBanner reviewCount={product.reviewCount} rating={product.rating} />

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
                      <button
                        onClick={async () => {
                          if (!navigator.clipboard?.readText) {
                            alert("Dieser Browser unterstützt das Einfügen aus der Zwischenablage nicht — bitte manuell einfügen (Strg/Cmd+V) oder \"Vorlage einfügen\" nutzen.");
                            return;
                          }
                          try {
                            const text = await navigator.clipboard.readText();
                            setGpsrHersteller(text);
                          } catch {
                            alert("Zugriff auf die Zwischenablage wurde verweigert — bitte im Browser erlauben oder den Text manuell mit Strg/Cmd+V einfügen.");
                          }
                        }}
                        style={{
                          background: "#2a2a2a", color: "#aaa", border: "1px solid #444",
                          padding: "3px 10px", borderRadius: 4, fontSize: 10,
                          cursor: "pointer", whiteSpace: "nowrap"
                        }}
                      >
                        Aus Zwischenablage einfügen
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
                  <button onClick={() => setShowPreview(v => !v)} style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: showPreview ? "#0F172A" : "#F1F5F9", border: "none", borderRadius: 8,
                    padding: "5px 10px", fontSize: 11, fontWeight: 600,
                    color: showPreview ? "#fff" : "#475569", cursor: "pointer", fontFamily: "inherit",
                  }}>
                    {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showPreview ? "Code anzeigen" : "Code anzeigen"}
                  </button>
                </div>
              </div>
              {/* Live-Vorschau immer sichtbar */}
              {editableHtml ? (
                <iframe
                  srcDoc={editableHtml}
                  style={{ width: "100%", minHeight: 480, border: "1px solid #E2E8F0", borderRadius: 12, marginBottom: 10 }}
                  sandbox="allow-same-origin"
                  title="Beschreibung Vorschau"
                />
              ) : (
                <div style={{ minHeight: 120, border: "2px dashed #E2E8F0", borderRadius: 12, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
                  <span style={{ fontSize: 28 }}>⬇️</span>
                  <span style={{ fontSize: 13, color: "#94A3B8", fontWeight: 600 }}>AliExpress Text unten reinkopieren → KI-Beschreibung generieren</span>
                </div>
              )}
              {/* Code-Editor nur wenn showPreview aktiv */}
              {showPreview && (
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

            {/* KI-Beschreibung aus AliExpress Rohtext */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#FFF7ED", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                  🤖
                </div>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>KI-Beschreibung aus AliExpress Text</span>
                  <p style={{ margin: 0, fontSize: 12, color: "#64748B", marginTop: 2 }}>AliExpress Produktbeschreibung hier reinkopieren → KI erstellt saubere eBay-Beschreibung</p>
                </div>
              </div>
              <textarea
                value={rawAliText}
                onChange={e => setRawAliText(e.target.value)}
                placeholder="AliExpress Beschreibung hier reinkopieren (Titel, Features, Spezifikationen, alles was du hast)..."
                rows={6}
                style={{
                  width: "100%", padding: "12px 14px", fontSize: 13, color: "#334155",
                  border: "2px solid #E2E8F0", borderRadius: 12, outline: "none",
                  fontFamily: "inherit", boxSizing: "border-box", resize: "vertical",
                  lineHeight: 1.6, marginBottom: 10,
                }}
              />
              {rawGenError && (
                <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 13, color: "#DC2626" }}>
                  {rawGenError}
                </div>
              )}
              <button
                onClick={async () => {
                  if (!rawAliText.trim() || rawGenLoading) return;
                  setRawGenLoading(true);
                  setRawGenError("");
                  try {
                    // ─── Auto-Parse Set-Inhalte aus Rohtext ──────────────────
                    // Erkennt Muster wie: "Set 1: ...", "SET1: ...", "Set 1 : ..."
                    const autoSets: Record<string, string> = {};
                    const setRegex = /(?:^|\n|:)\s*[Ss]et\s*(\d+)\s*:?\s*(.+?)(?=\n\s*[Ss]et\s*\d|\n\s*Menge\s*:|$)/gs;
                    let m: RegExpExecArray | null;
                    while ((m = setRegex.exec(rawAliText)) !== null) {
                      const num = m[1];
                      const content = m[2].replace(/\n/g, ' ').trim();
                      if (content.length > 2) {
                        autoSets[`SET${num}`] = content;
                      }
                    }
                    // Wenn Sets gefunden: variantContents automatisch befüllen (nur leere Felder überschreiben)
                    if (Object.keys(autoSets).length > 0) {
                      setVariantContents(prev => {
                        const merged = { ...prev };
                        for (const [k, v] of Object.entries(autoSets)) {
                          if (!merged[k]) merged[k] = v;
                        }
                        return merged;
                      });
                    }
                    const mergedContents = { ...variantContents, ...Object.fromEntries(Object.entries(autoSets).filter(([k]) => !variantContents[k])) };
                    // ─────────────────────────────────────────────────────────

                    // Titel + Beschreibung parallel generieren
                    const rawTitle = editableTitle || product?.title || '';
                    const [res, titleRes] = await Promise.all([
                      fetch('/api/generate-description-from-raw', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ rawText: rawAliText, title: rawTitle }),
                      }),
                      // Nur übersetzen wenn Titel noch englisch (enthält keine deutschen Sonderzeichen und kommt aus AliExpress)
                      rawTitle ? fetch('/api/generate-german-title', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ title: rawTitle, specs: product?.specs ?? {} }),
                      }) : Promise.resolve(null),
                    ]);
                    const data = await res.json() as { description?: string; error?: string; _fallback?: boolean };
                    const titleData = titleRes ? await titleRes.json() as { title?: string; error?: string } : null;
                    // Deutschen Titel setzen falls generiert
                    const finalTitle = titleData?.title?.trim() || editableTitle;
                    if (titleData?.title?.trim()) {
                      setEditableTitle(titleData.title.trim());
                    }
                    if (!res.ok || data.error) {
                      setRawGenError(data.error || 'Fehler beim Generieren');
                    } else if (data.description) {
                      setGeneratedDescription(data.description);
                      const base = product ?? { title: finalTitle || '', images: [], price: '', description: '', specs: {} };
                      const enriched = { ...base, description: data.description };
                      const usedContents = Object.keys(mergedContents).length > 0 ? mergedContents : (Object.keys(variantContents).length > 0 ? variantContents : undefined);
                      const newHtml = buildHTML(enriched as typeof base, "light", finalTitle || undefined, usedContents, gpsrHersteller.trim() || undefined);
                      setEditableHtml(newHtml);
                    }
                  } catch (e) {
                    setRawGenError('Netzwerkfehler: ' + String(e));
                  } finally {
                    setRawGenLoading(false);
                  }
                }}
                disabled={rawGenLoading || !rawAliText.trim()}
                style={{
                  width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 8, padding: "12px 0", borderRadius: 10, border: "none",
                  background: rawGenLoading || !rawAliText.trim() ? "#E2E8F0" : "#FF6B00",
                  color: rawGenLoading || !rawAliText.trim() ? "#94A3B8" : "#fff",
                  fontWeight: 700, fontSize: 14, cursor: rawGenLoading || !rawAliText.trim() ? "not-allowed" : "pointer",
                  fontFamily: "inherit", transition: "all 0.2s",
                }}
              >
                {rawGenLoading ? "⏳ KI generiert Beschreibung..." : "🤖 KI-Beschreibung generieren"}
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

              <div className="stele-grid-2" style={{ gap: 10, marginBottom: 10 }}>
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
                          // Empfohlener Mindestpreis: (einkauf + versand + zoll + Mindestgewinn + Sicherheitspuffer) / (1 - (13+adRate)/100*1.19)
                          const feeRate = (13 + adRate) / 100 * 1.19;
                          const chinaZoll = (shipsFromInfo && isChinaShipping(shipsFromInfo.country)) ? CHINA_ZOLL_EUR : 0;
                          const versand = parseFloat(shippingCost.replace(",", ".")) || 0;
                          const recommended = Math.ceil(((einkauf + versand + chinaZoll + MIN_GEWINN_EUR + PRICE_SAFETY_BUFFER_EUR + 0.45 * 1.19) / (1 - feeRate)) * 100) / 100;
                          setEbayPrice(recommended.toFixed(2));
                        }}
                        style={{
                          fontSize: 10, fontWeight: 700, color: "#16A34A", background: "#F0FDF4",
                          border: "1px solid #BBF7D0", borderRadius: 6, padding: "2px 8px", cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                        title={`Enthält ${PRICE_SAFETY_BUFFER_EUR.toFixed(2).replace(".", ",")}€ Sicherheitspuffer über dem Mindestgewinn`}
                      >
                        ≥{MIN_GEWINN_EUR.toFixed(2).replace(".", ",")}€ Gewinn (+{PRICE_SAFETY_BUFFER_EUR.toFixed(2).replace(".", ",")}€ Puffer) →
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

              {/* Versandkosten */}
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", textTransform: "uppercase" }}>Versandkosten (€) — laut AliExpress-Seite</label>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => setShippingCost("0")} style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
                      border: "1px solid " + (shippingCost === "0" || shippingCost === "" ? "#16A34A" : "#E2E8F0"),
                      background: shippingCost === "0" || shippingCost === "" ? "#F0FDF4" : "#fff",
                      color: shippingCost === "0" || shippingCost === "" ? "#16A34A" : "#94A3B8",
                    }}>
                      Kostenlos
                    </button>
                  </div>
                </div>
                <input type="number" step="0.01" placeholder="0.00" value={shippingCost} onChange={e => setShippingCost(e.target.value)} style={{
                  width: "100%", padding: "10px 12px", fontSize: 14, fontWeight: 600,
                  border: "2px solid #E2E8F0", borderRadius: 10, outline: "none",
                  fontFamily: "inherit", boxSizing: "border-box", color: "#0F172A",
                }} />
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
                  <div className="stele-grid-3" style={{ gap: 8, textAlign: "center" }}>
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
              // P-75: Gleiche Formel wie der Einzel-Varianten-Button unten (inkl. P-74 ,95-Rundung) —
              // hier einmal extrahiert, damit "Alle übernehmen" und Einzel-Button garantiert identisch rechnen.
              const recommendedFor = (v: VariantPrice): number => {
                const ausChinaV = variantHerkunft[v.skuId] ?? isChinaShipping(shipsFromInfo?.country);
                const versandV = parseFloat(shippingCost.replace(",", ".")) || 0;
                const sendungswertV = v.price + versandV;
                const zollManuellV = parseFloat((variantZollManuell[v.skuId] ?? "").replace(",", ".")) || 0;
                const zollV = !ausChinaV ? 0 : (sendungswertV <= 150 ? CHINA_ZOLL_EUR : zollManuellV);
                const wahrerEinkaufV = v.price + versandV + zollV;
                const feeRate = (13 + adRate) / 100 * 1.19;
                const rawMinV = (wahrerEinkaufV + MIN_GEWINN_EUR + PRICE_SAFETY_BUFFER_EUR + 0.45 * 1.19) / (1 - feeRate);
                return roundToNearest95(rawMinV);
              };
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
                  <button
                    type="button"
                    onClick={() => {
                      setVariantEbayPrices(prev => {
                        const next = { ...prev };
                        vp.forEach(v => { next[v.skuId] = recommendedFor(v).toFixed(2); });
                        return next;
                      });
                    }}
                    style={{
                      width: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                      gap: 8, padding: "10px 0", borderRadius: 10, border: "1.5px solid #BBF7D0",
                      background: "#F0FDF4", color: "#16A34A", fontWeight: 700, fontSize: 13,
                      cursor: "pointer", fontFamily: "inherit", marginBottom: 14,
                    }}
                  >
                    <TrendingDown size={15} /> Alle Preisvorschläge übernehmen (≥{MIN_GEWINN_EUR.toFixed(2).replace(".", ",")}€ Gewinn +{PRICE_SAFETY_BUFFER_EUR.toFixed(2).replace(".", ",")}€ Puffer)
                  </button>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Header */}
                    <div className="stele-variant-header" style={{ display: "grid", gridTemplateColumns: "40px 1fr 120px 80px 80px 70px", gap: 8, padding: "0 8px", alignItems: "center" }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}></div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Name / SKU</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", textAlign: "right" }}>Einkauf</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", textAlign: "right" }}>eBay</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", textAlign: "right" }}>Gewinn</div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", textAlign: "right" }}>Lager</div>
                    </div>
                    {vp.map((v, i) => {
                      const isCheapest = v.price === minP;
                      const attrLabel = Object.entries(v.attrs).filter(([k]) => !['ships from','ships_from','versandland','ship from','shipto','country'].includes(k.toLowerCase())).map(([,val]) => val).join(" / ") || `Variante …${v.skuId.slice(-6)}`;
                      const varEbayRaw = variantEbayPrices[v.skuId] ?? "";
                      const varEbay = parseFloat(varEbayRaw.replace(",", ".")) || 0;
                      // Herkunft/Zoll pro Variante — Default aus dem gescrapten Ships-From-Land.
                      // Versand ist zentral (P-69): fällt pro Bestellung an, nicht pro Variante.
                      const ausChinaV = variantHerkunft[v.skuId] ?? isChinaShipping(shipsFromInfo?.country);
                      const versandV = parseFloat(shippingCost.replace(",", ".")) || 0;
                      const sendungswertV = v.price + versandV;
                      const ueberSchwelleV = ausChinaV && sendungswertV > 150;
                      const zollManuellV = parseFloat((variantZollManuell[v.skuId] ?? "").replace(",", ".")) || 0;
                      const zollV = !ausChinaV ? 0 : (sendungswertV <= 150 ? CHINA_ZOLL_EUR : zollManuellV);
                      const wahrerEinkaufV = v.price + versandV + zollV;
                      const varProfit = varEbay > 0
                        ? varEbay - varEbay * (13 + adRate) / 100 * 1.19 - 0.45 * 1.19 - wahrerEinkaufV
                        : null;
                      return (
                        <div key={v.skuId} style={{
                          display: "flex", flexDirection: "column", gap: 6, padding: "8px 6px",
                          borderRadius: 10, border: `1.5px solid ${isCheapest ? "#BBF7D0" : "#F1F5F9"}`,
                          background: isCheapest ? "#F0FDF4" : i % 2 === 0 ? "#fff" : "#FAFAFA",
                        }}>
                          <div className="stele-variant-row">
                          <div className="stele-variant-top">
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
                          </div>
                          <div className="stele-variant-stats">
                          {/* Einkauf */}
                          <div className="stele-variant-stat">
                            <div className="stele-variant-stat-label">Einkauf</div>
                            <span style={{ fontSize: 12, fontWeight: 800, color: isCheapest ? "#16A34A" : "#1D4ED8" }}>{v.price.toFixed(2)} €</span>
                            {isCheapest && <div style={{ fontSize: 9, color: "#16A34A", fontWeight: 700 }}>günstigst</div>}
                          </div>
                          {/* eBay Eingabe */}
                          <div className="stele-variant-stat">
                            <div className="stele-variant-stat-label">eBay</div>
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
                          <div className="stele-variant-stat">
                            <div className="stele-variant-stat-label">Gewinn</div>
                            {varProfit !== null
                              ? <span style={{ fontSize: 12, fontWeight: 800, color: varProfit >= 1.6 ? "#16A34A" : varProfit >= 0 ? "#F59E0B" : "#DC2626" }}>{varProfit >= 0 ? "+" : ""}{varProfit.toFixed(2)} €</span>
                              : <span style={{ color: "#CBD5E1", fontSize: 11 }}>–</span>
                            }
                          </div>
                          {/* Lager */}
                          <div className="stele-variant-stat" style={{ fontSize: 11, color: v.stock === 0 ? "#DC2626" : "#64748B", fontWeight: v.stock === 0 ? 700 : 400 }}>
                            <div className="stele-variant-stat-label">Lager</div>
                            {v.stock !== undefined ? (v.stock === 0 ? "0 ❌" : v.stock) : "–"}
                          </div>
                          </div>
                          </div>
                          {/* Herkunft / Zoll pro Variante — Versand ist zentral oben in der Preiskalkulation (P-69) */}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", paddingLeft: 42 }}>
                            <div style={{ display: "flex", gap: 3 }}>
                              <button
                                type="button"
                                onClick={() => setVariantHerkunft(prev => ({ ...prev, [v.skuId]: true }))}
                                style={{
                                  padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                                  cursor: "pointer", fontFamily: "inherit",
                                  border: ausChinaV ? "1.5px solid #0EA5E9" : "1.5px solid #E2E8F0",
                                  background: ausChinaV ? "#F0F9FF" : "#F8FAFC",
                                  color: ausChinaV ? "#0369A1" : "#94A3B8",
                                }}
                              >
                                China
                              </button>
                              <button
                                type="button"
                                onClick={() => setVariantHerkunft(prev => ({ ...prev, [v.skuId]: false }))}
                                style={{
                                  padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                                  cursor: "pointer", fontFamily: "inherit",
                                  border: !ausChinaV ? "1.5px solid #0EA5E9" : "1.5px solid #E2E8F0",
                                  background: !ausChinaV ? "#F0F9FF" : "#F8FAFC",
                                  color: !ausChinaV ? "#0369A1" : "#94A3B8",
                                }}
                              >
                                EU
                              </button>
                            </div>
                            {ausChinaV && !ueberSchwelleV && (
                              <span style={{ fontSize: 10, color: "#94A3B8" }}>
                                Zoll: {CHINA_ZOLL_EUR.toFixed(2)} €
                              </span>
                            )}
                            {ueberSchwelleV && (
                              <>
                                <span style={{ fontSize: 10, color: "#C8511B", fontWeight: 700 }}>
                                  &gt;150€ Sendungswert: Zoll manuell
                                </span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder="Zoll €"
                                  value={variantZollManuell[v.skuId] ?? ""}
                                  onChange={e => setVariantZollManuell(prev => ({ ...prev, [v.skuId]: e.target.value }))}
                                  style={{
                                    width: 70, padding: "2px 6px", fontSize: 10, fontWeight: 600,
                                    border: "1.5px solid #FED7AA", borderRadius: 6, outline: "none",
                                    fontFamily: "inherit", color: "#0F172A",
                                  }}
                                />
                              </>
                            )}
                            {(versandV > 0 || zollV > 0) && (
                              <span style={{ fontSize: 10, color: "#64748B" }}>
                                wahrer Einkauf: <strong style={{ color: "#0F172A" }}>{wahrerEinkaufV.toFixed(2)} €</strong>
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setVariantEbayPrices(prev => ({ ...prev, [v.skuId]: recommendedFor(v).toFixed(2) }));
                              }}
                              style={{
                                fontSize: 10, fontWeight: 700, color: "#16A34A", background: "#F0FDF4",
                                border: "1px solid #BBF7D0", borderRadius: 6, padding: "2px 8px", cursor: "pointer",
                                fontFamily: "inherit",
                              }}
                              title={`Enthält ${PRICE_SAFETY_BUFFER_EUR.toFixed(2).replace(".", ",")}€ Sicherheitspuffer über dem Mindestgewinn`}
                            >
                              ≥{MIN_GEWINN_EUR.toFixed(2).replace(".", ",")}€ +{PRICE_SAFETY_BUFFER_EUR.toFixed(2).replace(".", ",")}€ →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            </div>{/* Ende linke Spalte */}
            <div>
            {/* RECHTE SPALTE — Titel, HTML, Preis, Varianten-Edit, Speichern, Listen */}

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
              {editedVariants.filter(g => g.name.toLowerCase() !== 'ships from').length === 0 && (
                <p style={{textAlign:'center',color:'#94A3B8',fontSize:13,padding:'16px 0'}}>Keine Varianten — oben Gruppe hinzufügen</p>
              )}
              {editedVariants.filter(g => g.name.toLowerCase() !== 'ships from').map((group, gi) => (
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
                    {group.values.map((val,vi) => {
                      const isSetVal = /^set\s*\d+$/i.test(val.trim());
                      const setKey = val.toUpperCase().replace(/\s+/g, '');
                      return (
                        <div key={vi} style={{width: isSetVal ? '100%' : 'auto'}}>
                          <div style={{display:'flex',alignItems:'center',gap:4,background:'#fff',borderRadius:8,border:'1.5px solid #E2E8F0',padding:'4px 8px'}}>
                            <input value={val} onChange={e => setEditedVariants(prev => prev.map((g,i)=>{if(i!==gi)return g;const v=[...g.values];v[vi]=e.target.value;return{...g,values:v};}))}
                              style={{border:'none',outline:'none',fontSize:13,fontWeight:600,color:'#0F172A',background:'transparent',width:Math.max(40,val.length*9)+'px'}}/>
                            <button onClick={() => setEditedVariants(prev => prev.map((g,i)=>{if(i!==gi)return g;return{...g,values:g.values.filter((_,j)=>j!==vi)};}))}
                              style={{background:'none',border:'none',cursor:'pointer',color:'#94A3B8',padding:0,display:'flex',alignItems:'center'}}><X size={11}/></button>
                          </div>
                          {/* Lieferumfang-Input unter SET-Werten */}
                          {isSetVal && (
                            <input
                              type="text"
                              placeholder={`Lieferumfang ${val} (z.B. 10 kleine + 5 große)`}
                              value={variantContents[setKey] ?? ""}
                              onChange={e => setVariantContents(prev => ({ ...prev, [setKey]: e.target.value }))}
                              style={{
                                marginTop:4, width:'100%', padding:'6px 10px', fontSize:12,
                                border:'1.5px solid #C4B5FD', borderRadius:8,
                                background:'#F5F3FF', color:'#4C1D95',
                                fontFamily:'inherit', boxSizing:'border-box', outline:'none',
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
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

              {complianceBlocked && (
                <div style={{
                  marginBottom: 14, padding: "12px 14px", borderRadius: 12,
                  background: "#FEF2F2", border: "1.5px solid #FECACA",
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 16, lineHeight: "20px" }}>🚫</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#991B1B" }}>
                        Dieses Produkt gehört möglicherweise zu einer regulierten Kategorie. Lieferant muss erst im Lieferanten-Tab als geprüft markiert werden.
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#B91C1C" }}>
                        Erkannt als: {regulatedMatches.map(m => m.labelDe).join(', ')} — automatische Stichwort-Erkennung, keine rechtsverbindliche Prüfung.
                        {matchedSupplier && <> Lieferant „{matchedSupplier.shopName}" ist aktuell: <strong>{matchedSupplier.complianceStatus}</strong>.</>}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saveLoading || !!saveResult?.id || complianceBlocked}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 12,
                  border: saveResult?.id ? "1.5px solid #BBF7D0" : "1.5px solid transparent",
                  background: saveResult?.id ? "#F0FDF4" : complianceBlocked ? "#FEE2E2" : saveLoading ? "#E2E8F0" : "#0F172A",
                  color: saveResult?.id ? "#15803D" : complianceBlocked ? "#991B1B" : saveLoading ? "#94A3B8" : "#C9A227",
                  fontWeight: 700, fontSize: 14,
                  cursor: (saveLoading || !!saveResult?.id || complianceBlocked) ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {saveLoading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={16} />}
                {saveLoading ? "Wird gespeichert…" : saveResult?.id ? "Bereits gespeichert" : complianceBlocked ? "Blockiert — Lieferant nicht geprüft" : "In DB speichern"}
              </button>
              {saveResult?.error && (
                <p style={{ margin: "8px 0 0", color: "#DC2626", fontSize: 13, fontWeight: 600 }}>Fehler: {saveResult.error}</p>
              )}
            </div>



            </div>{/* Ende rechte Spalte */}
            </div>{/* Ende 2-Spalten Grid */}
          </>
        )}

        <p style={{ textAlign: "center", color: "#CBD5E1", fontSize: 12, marginTop: 8, marginBottom: 8 }}>
          Stele E-Transfer · Lieferanten Import
        </p>
      </div>
    </div>
  );
}
