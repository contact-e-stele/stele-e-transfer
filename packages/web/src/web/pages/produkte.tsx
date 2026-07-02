/**
 * Produkte-Tab — eigene Produktdatenbank
 * Zeigt alle importierten Produkte, Preisänderungen, eBay-Status
 */
import { useState, useEffect } from "react";
import {
  Package, ExternalLink, RefreshCw, ShoppingCart,
  Clock, CheckCircle, XCircle, Loader, TrendingUp,
  TrendingDown, AlertTriangle, Search, Trash2, Layers, Plus, X, Eye, ShieldCheck,
} from "lucide-react";
import { safeJson } from "../lib/safeFetch";
import { buildEbayHTMLLight, type ScrapedProduct as EbayScrapedProduct } from "../lib/ebay-description";

interface VariantGroup {
  name: string;
  values: string[];
}

interface VariantPrice {
  skuId: string;
  attrs: Record<string, string>;
  price: number;
  originalPrice?: number;
  stock?: number;
  imageUrl?: string;
  ebayPrice?: number;
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
  variantPrices: string | null; // JSON
  variantContents: Record<string, string> | null;
  gpsrRaw: string | null;
  gpsrHtml: string | null;
  images: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  lastPriceCheck: string | null;
  priceChanged: boolean;
  ebayListingId: string | null;
  ebayStatus: string;
  ebayError: string | null;
  ebayCategory: string | null;
  handlingTimeDays: number | null;
  gpsrName: string | null;
  gpsrAddress: string | null;
  gpsrCity: string | null;
  gpsrEmail: string | null;
  gpsrPhone: string | null;
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

// Gruppen die KEINE echten Produktvarianten sind (z.B. "Ships From")
const SKIP_VARIANT_GROUPS_P = ['ships from', 'ships_from', 'ship from', 'versandland', 'versand von', 'country of origin', 'herstellungsland'];
const isSkipGroup = (name: string) => SKIP_VARIANT_GROUPS_P.includes(name.toLowerCase().trim());

// Hilfsfunktion: Varianten aus DB-Format lesen (entweder alt: string[] oder neu: VariantGroup[])
function parseVariants(raw: string[] | VariantGroup[]): VariantGroup[] {
  if (!raw || raw.length === 0) return [];
  if (typeof raw[0] === "object" && "name" in raw[0]) {
    return (raw as VariantGroup[]).filter(g => !isSkipGroup(g.name));
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
          {groups.length > 0
            ? <><strong>✅ Varianten automatisch erkannt!</strong> Prüfe die Werte und ergänze falls nötig.</>
            : <>Füge Varianten-Gruppen hinzu (z.B. "Farbe", "Größe") und trage die möglichen Werte ein.</>}
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

            {/* Wert hinzufügen - Komma-Trennung möglich */}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="text"
                placeholder="Wert(e) eingeben, Komma trennt (z.B. Rot, Blau, Grün)"
                value={newValues[gi] ?? ""}
                onChange={e => setNewValues(v => ({ ...v, [gi]: e.target.value }))}
                onBlur={() => {
                  const vals = (newValues[gi] ?? "").split(",").map(v => v.trim()).filter(Boolean);
                  if (vals.length === 0) return;
                  setGroups(g => g.map((group, i) =>
                    i === gi ? { ...group, values: [...group.values, ...vals.filter(v => !group.values.includes(v))] } : group
                  ));
                  setNewValues(v => ({ ...v, [gi]: "" }));
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const vals = (newValues[gi] ?? "").split(",").map(v => v.trim()).filter(Boolean);
                    if (vals.length === 0) return;
                    setGroups(g => g.map((group, i) =>
                      i === gi ? { ...group, values: [...group.values, ...vals.filter(v => !group.values.includes(v))] } : group
                    ));
                    setNewValues(v => ({ ...v, [gi]: "" }));
                  }
                }}
                style={{
                  flex: 1, padding: "6px 10px", borderRadius: 8,
                  border: "2px solid #E2E8F0", fontSize: 12, fontFamily: "inherit", outline: "none",
                }}
              />
              <button onClick={() => {
                const vals = (newValues[gi] ?? "").split(",").map(v => v.trim()).filter(Boolean);
                if (vals.length === 0) return;
                setGroups(g => g.map((group, i) =>
                  i === gi ? { ...group, values: [...group.values, ...vals.filter(v => !group.values.includes(v))] } : group
                ));
                setNewValues(v => ({ ...v, [gi]: "" }));
              }} style={{
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

interface GpsrModalProps {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}

function GpsrModal({ product, onClose, onSaved }: GpsrModalProps) {
  const [name, setName] = useState(product.gpsrName ?? "");
  const [address, setAddress] = useState(product.gpsrAddress ?? "");
  const [city, setCity] = useState(product.gpsrCity ?? "");
  const [email, setEmail] = useState(product.gpsrEmail ?? "");
  const [phone, setPhone] = useState(product.gpsrPhone ?? "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const hasFallback = !product.gpsrName;

  const save = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gpsrName: name.trim() || null,
          gpsrAddress: address.trim() || null,
          gpsrCity: city.trim() || null,
          gpsrEmail: email.trim() || null,
          gpsrPhone: phone.trim() || null,
        }),
      });
      if (res.ok) {
        setSaveMsg("Gespeichert!");
        onSaved();
        setTimeout(onClose, 700);
      } else {
        setSaveMsg("Fehler beim Speichern");
      }
    } catch {
      setSaveMsg("Netzwerkfehler");
    } finally {
      setSaving(false);
    }
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%", padding: "9px 12px", borderRadius: 10,
    border: "2px solid #E2E8F0", fontSize: 13, fontFamily: "inherit",
    outline: "none", boxSizing: "border-box", color: "#0F172A",
    background: "#FAFAFA",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 20, padding: 24, maxWidth: 460, width: "100%",
        maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={18} color="#0EA5E9" /> GPSR Verantwortliche Person
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748B" }}>{product.generatedTitle.slice(0, 50)}…</p>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        {/* Info Banner */}
        {hasFallback ? (
          <div style={{ background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#C2410C" }}>
            <strong>Kein GPSR gesetzt</strong> — eBay verwendet automatisch den Stele-E-Transfer Fallback.
            Hier kannst du produktspezifische Daten hinterlegen.
          </div>
        ) : (
          <div style={{ background: "#F0F9FF", border: "1px solid #BAE6FD", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#0369A1" }}>
            <strong>✅ Produktspezifische GPSR gesetzt</strong> — wird beim eBay-Listen verwendet.
          </div>
        )}

        {/* Felder */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>Firmenname / Person</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="z.B. Stele-E-Transfer"
              style={fieldStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>Straße + Hausnummer</label>
            <input
              type="text"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="z.B. Musterstraße 12"
              style={fieldStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>PLZ + Stadt</label>
            <input
              type="text"
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="z.B. 65205 Wiesbaden"
              style={fieldStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>E-Mail</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="z.B. info@example.de"
              style={fieldStyle}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>Telefon (optional)</label>
            <input
              type="text"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="z.B. +49 611 12345"
              style={fieldStyle}
            />
          </div>
        </div>

        {/* Löschen-Button */}
        {!hasFallback && (
          <button onClick={async () => {
            setName(""); setAddress(""); setCity(""); setEmail(""); setPhone("");
            await fetch(`/api/products/${product.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ gpsrName: null, gpsrAddress: null, gpsrCity: null, gpsrEmail: null, gpsrPhone: null }),
            });
            setSaveMsg("GPSR gelöscht — Fallback aktiv");
            onSaved();
            setTimeout(onClose, 800);
          }} style={{
            marginTop: 14, width: "100%", padding: "8px 0", borderRadius: 10,
            background: "#FEF2F2", color: "#DC2626", border: "1px solid #FECACA",
            fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}>
            GPSR zurücksetzen (Fallback verwenden)
          </button>
        )}

        {/* Footer */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", marginTop: 16 }}>
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
            padding: "8px 20px", borderRadius: 10, background: "#0EA5E9", color: "#fff",
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
  const [gpsrModal, setGpsrModal] = useState<Product | null>(null);
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null);
  const [editPreviewTitle, setEditPreviewTitle] = useState<string>("");
  const [editPreviewBullets, setEditPreviewBullets] = useState<string>("");
  const [previewSaving, setPreviewSaving] = useState(false);
  const [previewSaveMsg, setPreviewSaveMsg] = useState("");
  const [katHelpId, setKatHelpId] = useState<number | null>(null);
  const [katSearchId, setKatSearchId] = useState<number | null>(null);
  const [katSearchQuery, setKatSearchQuery] = useState("");
  const [katSearchLoading, setKatSearchLoading] = useState(false);
  const [katSearchResults, setKatSearchResults] = useState<Array<{ id: string; name: string; path: string }>>([]);
  const [expandedVariants, setExpandedVariants] = useState<Set<number>>(new Set());
  const [copiedSku, setCopiedSku] = useState<number | null>(null);

  // Alle-Preise-prüfen Job
  const [priceJob, setPriceJob] = useState<{
    jobId: string; status: string; total: number; done: number;
    changed?: number; ebayUpdated?: number;
  } | null>(null);
  const [priceJobError, setPriceJobError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await safeJson<Product[]>("/api/products");
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

  const startAllPriceCheck = async () => {
    setPriceJobError("");
    try {
      const data = await safeJson<{ jobId?: string; total?: number; error?: string }>("/api/products/check-all-prices", { method: "POST" });
      if (!data.jobId) {
        setPriceJobError(data.error ?? "Fehler beim Starten");
        return;
      }
      setPriceJob({ jobId: data.jobId, status: "running", total: data.total ?? 0, done: 0 });

      // Polling alle 2s bis fertig
      const poll = async () => {
        try {
          const j = await safeJson<{
            status: string; total: number; done: number;
            changed?: number; results?: Array<{ status: string; ebayUpdated?: boolean }>;
          }>(`/api/products/price-job/${data.jobId}`);
          const ebayUpdated = (j.results ?? []).filter(r => r.ebayUpdated).length;
          setPriceJob({ jobId: data.jobId!, status: j.status, total: j.total, done: j.done, changed: j.changed, ebayUpdated });
          if (j.status !== "done") {
            setTimeout(poll, 2000);
          } else {
            load(); // Produkte neu laden nach fertigem Job
          }
        } catch { /* ignore polling errors */ }
      };
      setTimeout(poll, 2000);
    } catch {
      setPriceJobError("Netzwerkfehler");
    }
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
      {gpsrModal && (
        <GpsrModal
          product={gpsrModal}
          onClose={() => setGpsrModal(null)}
          onSaved={load}
        />
      )}

      {/* Beschreibungs-Preview Modal */}
      {previewProduct && (() => {
        // Live-Vorschau: HTML aus aktuellen Edit-Feldern neu bauen
        const liveBullets = editPreviewBullets.split("\n").map(s => s.trim()).filter(Boolean);
        // Nur VariantGroup-Objekte (mit name/values) weitergeben — reine Strings (Amazon-Format) ignorieren
        const safeVariants: EbayScrapedProduct["variants"] = Array.isArray(previewProduct.variants)
          ? (previewProduct.variants as any[]).filter(v => v && typeof v === 'object' && typeof v.name === 'string') as EbayScrapedProduct["variants"]
          : undefined;
        const liveProduct: EbayScrapedProduct = {
          title: editPreviewTitle,
          bullets: liveBullets,
          variants: safeVariants,
          skuVariants: (() => {
            try {
              const vp = previewProduct.variantPrices ? JSON.parse(previewProduct.variantPrices) : null;
              if (!Array.isArray(vp)) return undefined;
              // AliExpress-Rohdaten haben kein "name" (nur skuId + attrs) — Name aus attrs zusammenbauen
              return vp.map((v: any) => ({
                name: typeof v.name === 'string' && v.name
                  ? v.name
                  : (v.attrs && typeof v.attrs === 'object'
                      ? Object.values(v.attrs).filter(Boolean).join(' / ')
                      : String(v.skuId ?? 'Variante')),
                price: typeof v.ebayPrice === 'number' ? v.ebayPrice : (typeof v.price === 'number' ? v.price : 0),
                imageUrl: v.imageUrl,
              })).filter((v: any) => v.name);
            } catch { return undefined; }
          })(),
          setContents: previewProduct.variantContents ?? undefined,
          gpsrRaw: previewProduct.gpsrRaw ?? undefined,
        };
        let liveHtml = "";
        try {
          liveHtml = buildEbayHTMLLight(liveProduct);
        } catch (err) {
          liveHtml = '<p style="color:red;font-size:13px;">Vorschau-Fehler: ' + String(err) + '</p>';
        }

        const handleSave = async () => {
          setPreviewSaving(true);
          setPreviewSaveMsg("");
          try {
            const res = await fetch(`/api/products/${previewProduct.id}/description`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ generatedTitle: editPreviewTitle, bullets: liveBullets, htmlDescription: liveHtml }),
            });
            if (!res.ok) throw new Error(await res.text());
            // Lokalen State updaten
            const updated = { ...previewProduct, generatedTitle: editPreviewTitle, bullets: liveBullets, htmlDescription: liveHtml };
            setPreviewProduct(updated);
            setProducts(prev => prev.map(p => p.id === previewProduct.id ? updated : p));

            // Wenn Produkt bereits auf eBay gelistet ist: Titel + Beschreibung sofort live pushen
            if (previewProduct.ebayListingId) {
              try {
                const ebayRes = await fetch(`/api/ebay/listings/${previewProduct.ebayListingId}/content`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ title: editPreviewTitle, htmlDescription: liveHtml }),
                });
                const ebayData = await ebayRes.json() as { ok?: boolean; error?: string };
                if (ebayData.ok) {
                  setPreviewSaveMsg("✓ Gespeichert & auf eBay aktualisiert");
                } else {
                  setPreviewSaveMsg("✓ In DB gespeichert — eBay-Push fehlgeschlagen: " + (ebayData.error ?? "unbekannt"));
                }
              } catch (ebayErr) {
                setPreviewSaveMsg("✓ In DB gespeichert — eBay-Push fehlgeschlagen: " + String(ebayErr));
              }
            } else {
              setPreviewSaveMsg("✓ Gespeichert");
            }
          } catch (e) {
            setPreviewSaveMsg("Fehler: " + String(e));
          } finally {
            setPreviewSaving(false);
          }
        };

        return (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000,
          background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 16,
        }} onClick={() => setPreviewProduct(null)}>
          <div style={{
            background: "#fff", borderRadius: 16, width: "100%", maxWidth: 860,
            maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, background: "#fff", zIndex: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>eBay Beschreibung bearbeiten</span>
              <button onClick={() => setPreviewProduct(null)} style={{ background: "none", border: "none", cursor: "pointer", padding: 6, borderRadius: 8, display: "flex" }}>
                <X size={18} color="#94A3B8" />
              </button>
            </div>

            {/* Edit-Bereich */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #E2E8F0", background: "#F8FAFC" }}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>EBAY TITEL (max. 80 Zeichen)</label>
                <input
                  value={editPreviewTitle}
                  onChange={e => setEditPreviewTitle(e.target.value)}
                  maxLength={80}
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1",
                    fontSize: 13, fontFamily: "inherit", color: "#0F172A", background: "#fff", boxSizing: "border-box",
                  }}
                />
                <div style={{ fontSize: 10, color: editPreviewTitle.length > 75 ? "#DC2626" : "#94A3B8", textAlign: "right", marginTop: 2 }}>
                  {editPreviewTitle.length}/80
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 4 }}>BULLET-POINTS (eine pro Zeile)</label>
                <textarea
                  value={editPreviewBullets}
                  onChange={e => setEditPreviewBullets(e.target.value)}
                  rows={6}
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1",
                    fontSize: 12, fontFamily: "inherit", color: "#0F172A", background: "#fff",
                    resize: "vertical", boxSizing: "border-box", lineHeight: 1.6,
                  }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  onClick={handleSave}
                  disabled={previewSaving}
                  style={{
                    padding: "8px 20px", borderRadius: 8, background: "#16A34A", color: "#fff",
                    fontSize: 13, fontWeight: 700, border: "none", cursor: previewSaving ? "wait" : "pointer",
                    fontFamily: "inherit", opacity: previewSaving ? 0.7 : 1,
                  }}
                >
                  {previewSaving ? "Speichert…" : "Speichern"}
                </button>
                {previewSaveMsg && (
                  <span style={{ fontSize: 12, color: previewSaveMsg.startsWith("✓") ? "#16A34A" : "#DC2626", fontWeight: 600 }}>
                    {previewSaveMsg}
                  </span>
                )}
              </div>
            </div>

            {/* Vorschau */}
            <div style={{ padding: 20 }}>
              <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 12 }}>Live-Vorschau (wird bei Speichern übernommen):</div>
              <div dangerouslySetInnerHTML={{ __html: liveHtml }} />
              {previewProduct.variantContents && Object.keys(previewProduct.variantContents).length > 0 && (
                <div style={{ marginTop: 20, borderTop: "1px solid #E2E8F0", paddingTop: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", marginBottom: 10 }}>Varianten-Inhalte</div>
                  {Object.entries(previewProduct.variantContents).map(([key, val]) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#64748B", marginBottom: 4 }}>{key}</div>
                      <div style={{ fontSize: 12, color: "#0F172A", whiteSpace: "pre-wrap", background: "#F8FAFC", padding: "8px 10px", borderRadius: 6 }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}
              {previewProduct.gpsrRaw && (
                <div style={{ marginTop: 20, borderTop: "1px solid #E2E8F0", paddingTop: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#0F172A", marginBottom: 8 }}>Produktsicherheit (GPSR)</div>
                  <div style={{ fontSize: 12, color: "#374151", whiteSpace: "pre-wrap", background: "#F8FAFC", padding: "8px 10px", borderRadius: 6, fontFamily: "monospace" }}>{previewProduct.gpsrRaw}</div>
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}
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
            const d = await safeJson<{ ok?: boolean; status?: string; error?: string }>("/api/ebay/setup-location", { method: "POST" });
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

        {/* Alle Preise prüfen — Job Panel */}
        {priceJob ? (
          <div style={{ marginBottom: 16, background: "#fff", borderRadius: 14, padding: "14px 18px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "1.5px solid #E2E8F0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: "#0F172A" }}>
                {priceJob.status === "done" ? "✅ Preischeck abgeschlossen" : "🔄 Preischeck läuft…"}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {priceJob.status === "done" && priceJob.changed !== undefined && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", background: "#FFFBEB", padding: "2px 8px", borderRadius: 6 }}>
                    {priceJob.changed} geändert
                  </span>
                )}
                {priceJob.status === "done" && (priceJob.ebayUpdated ?? 0) > 0 && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#16A34A", background: "#F0FDF4", padding: "2px 8px", borderRadius: 6 }}>
                    {priceJob.ebayUpdated} eBay-Updates
                  </span>
                )}
                <button onClick={() => setPriceJob(null)} style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", fontSize: 16 }}>✕</button>
              </div>
            </div>
            <div style={{ background: "#F1F5F9", borderRadius: 6, height: 8, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 6,
                background: priceJob.status === "done" ? "#16A34A" : "#F59E0B",
                width: `${Math.round((priceJob.done / (priceJob.total || 1)) * 100)}%`,
                transition: "width 0.5s ease",
              }} />
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: "#64748B" }}>
              {priceJob.done} / {priceJob.total} Produkte geprüft
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 16, display: "flex", gap: 8, alignItems: "center" }}>
            <button
              onClick={startAllPriceCheck}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "#FFF8DC", border: "1.5px solid #FCD34D", borderRadius: 10,
                padding: "9px 16px", fontSize: 13, fontWeight: 700, color: "#92400E",
                cursor: "pointer", fontFamily: "inherit",
              }}
            >
              <RefreshCw size={14} />
              Alle Preise prüfen + eBay updaten
            </button>
            {priceJobError && <span style={{ fontSize: 12, color: "#DC2626" }}>{priceJobError}</span>}
          </div>
        )}

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
                    {product.skuId && (
                      <span
                        onClick={() => {
                          navigator.clipboard.writeText(product.skuId).then(() => {
                            setCopiedSku(product.id);
                            setTimeout(() => setCopiedSku(null), 1800);
                          });
                        }}
                        title="SKU kopieren"
                        style={{
                          fontSize: 10, fontFamily: "monospace",
                          background: copiedSku === product.id ? "#DCFCE7" : "#F8FAFC",
                          color: copiedSku === product.id ? "#16A34A" : "#94A3B8",
                          padding: "2px 6px", borderRadius: 5,
                          cursor: "pointer", border: "1px solid #E2E8F0",
                          transition: "all 0.2s",
                          userSelect: "none",
                        }}
                      >
                        {copiedSku === product.id ? "✓ Kopiert" : `SKU: ${product.skuId}`}
                      </span>
                    )}
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
                <button onClick={() => { setPreviewProduct(product); setEditPreviewTitle(product.generatedTitle || product.title || ""); setEditPreviewBullets((product.bullets || []).join("\n")); setPreviewSaveMsg(""); }} style={{
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

                {/* GPSR */}
                <button onClick={() => setGpsrModal(product)} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "6px 10px", borderRadius: 8,
                  background: product.gpsrName ? "#F0F9FF" : "#F8FAFC",
                  color: product.gpsrName ? "#0EA5E9" : "#94A3B8",
                  fontSize: 11, fontWeight: 700,
                  border: product.gpsrName ? "1px solid #BAE6FD" : "1px solid #E2E8F0",
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  <ShieldCheck size={11} />
                  {product.gpsrName ? "GPSR ✓" : "GPSR"}
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

              {/* Varianten-Preise aufklappen */}
              {(() => {
                const vp: VariantPrice[] = (() => { try { return JSON.parse(product.variantPrices ?? '[]'); } catch { return []; } })();
                if (vp.length === 0) return null;
                const isOpen = expandedVariants.has(product.id);
                const minP = Math.min(...vp.map(v => v.price));
                return (
                  <div style={{ marginTop: 8 }}>
                    <button onClick={() => setExpandedVariants(prev => { const s = new Set(prev); s.has(product.id) ? s.delete(product.id) : s.add(product.id); return s; })}
                      style={{ display:"inline-flex", alignItems:"center", gap:4, padding:"6px 10px", borderRadius:8, background:"#FFF8DC", color:"#92400E", fontSize:11, fontWeight:700, border:"1px solid #FDE68A", cursor:"pointer", fontFamily:"inherit" }}>
                      <TrendingUp size={11} /> {vp.length} Varianten-Preise {isOpen ? "▲" : "▼"}
                    </button>
                    {isOpen && (
                      <div style={{ marginTop:8, border:"1px solid #E2E8F0", borderRadius:10, overflow:"hidden" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
                          <thead>
                            <tr style={{ background:"#F8FAFC" }}>
                              {Object.keys(vp[0]?.attrs ?? {}).filter(k => k.toLowerCase() !== 'ships from' && k.toLowerCase() !== 'ships_from' && k.toLowerCase() !== 'versandland').map(k => <th key={k} style={{ padding:"6px 10px", textAlign:"left", fontWeight:700, color:"#64748B", borderBottom:"1px solid #E2E8F0" }}>{k}</th>)}
                              <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:700, color:"#64748B", borderBottom:"1px solid #E2E8F0" }}>Einkauf</th>
                              {vp.some(v => v.ebayPrice) && <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:700, color:"#64748B", borderBottom:"1px solid #E2E8F0" }}>eBay</th>}
                              {vp.some(v => v.ebayPrice) && <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:700, color:"#64748B", borderBottom:"1px solid #E2E8F0" }}>Gewinn</th>}
                              <th style={{ padding:"6px 10px", textAlign:"right", fontWeight:700, color:"#64748B", borderBottom:"1px solid #E2E8F0" }}>Lager</th>
                            </tr>
                          </thead>
                          <tbody>
                            {vp.map((v, i) => {
                              const hasEbay = vp.some(x => x.ebayPrice);
                              const ebayP = v.ebayPrice as number | undefined;
                              const adR = product.adRate ?? 5;
                              const profit = ebayP ? ebayP - ebayP*(13+adR)/100*1.19 - 0.45*1.19 - v.price : null;
                              return (
                              <tr key={v.skuId} style={{ background: v.price === minP ? "#F0FDF4" : i%2===0 ? "#fff" : "#FAFAFA" }}>
                                {Object.entries(v.attrs).filter(([k]) => k.toLowerCase() !== 'ships from' && k.toLowerCase() !== 'ships_from' && k.toLowerCase() !== 'versandland').map(([k, val]) => <td key={k} style={{ padding:"6px 10px", color:"#0F172A", borderBottom:"1px solid #F1F5F9" }}>{String(val)}</td>)}
                                <td style={{ padding:"6px 10px", textAlign:"right", fontWeight:700, color: v.price === minP ? "#16A34A" : "#1D4ED8", borderBottom:"1px solid #F1F5F9" }}>
                                  {v.price.toFixed(2)} €{v.price === minP && <span style={{fontSize:9,color:"#16A34A"}}> ▼</span>}
                                </td>
                                {hasEbay && <td style={{ padding:"6px 10px", textAlign:"right", color:"#0F172A", borderBottom:"1px solid #F1F5F9", fontWeight:600 }}>{ebayP ? `${ebayP.toFixed(2)} €` : "–"}</td>}
                                {hasEbay && <td style={{ padding:"6px 10px", textAlign:"right", borderBottom:"1px solid #F1F5F9", fontWeight:700, color: profit === null ? "#94A3B8" : profit >= 1.6 ? "#16A34A" : profit >= 0 ? "#F59E0B" : "#DC2626" }}>
                                  {profit !== null ? `${profit >= 0 ? "+" : ""}${profit.toFixed(2)} €` : "–"}
                                </td>}
                                <td style={{ padding:"6px 10px", textAlign:"right", color:"#64748B", borderBottom:"1px solid #F1F5F9" }}>{v.stock ?? "–"}</td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })()}

              {listingResult?.id === product.id && (
                <div style={{
                  fontSize: 11, padding: "6px 10px", borderRadius: 6, marginTop: 8, fontWeight: 600,
                  background: listingResult.success ? "#F0FDF4" : "#FEF2F2",
                  color: listingResult.success ? "#16A34A" : "#DC2626",
                }}>
                  {listingResult.msg}
                </div>
              )}
              {/* eBay Kategorie manuell setzen */}
              <div style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                  <span
                    onClick={() => setKatHelpId(katHelpId === product.id ? null : product.id)}
                    style={{ fontSize: 10, color: "#94A3B8", whiteSpace: "nowrap", cursor: "pointer", textDecoration: "underline dotted", userSelect: "none" }}
                    title="Klicken für Anleitung"
                  >eBay Kat-ID ❓</span>
                  <input
                    defaultValue={product.ebayCategory ?? ''}
                    placeholder="z.B. 179247"
                    onBlur={async (e) => {
                      const val = e.currentTarget.value.trim();
                      if (val === (product.ebayCategory ?? '')) return;
                      await fetch(`/api/products/${product.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ebayCategory: val || null }),
                      });
                      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, ebayCategory: val || null } : p));
                    }}
                    style={{
                      fontSize: 11, padding: "4px 8px", borderRadius: 6,
                      border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#0F172A",
                      width: 110, fontFamily: "inherit",
                    }}
                  />
                  {product.ebayCategory && (
                    <span style={{ fontSize: 10, color: "#16A34A", fontWeight: 700 }}>✓ Manuell</span>
                  )}
                  {/* Suche-Button */}
                  <button
                    onClick={() => {
                      if (katSearchId === product.id) { setKatSearchId(null); setKatSearchResults([]); return; }
                      setKatSearchId(product.id);
                      setKatHelpId(null);
                      setKatSearchQuery(product.generatedTitle?.slice(0, 30) ?? "");
                      setKatSearchResults([]);
                    }}
                    style={{
                      fontSize: 10, padding: "3px 8px", borderRadius: 5, cursor: "pointer",
                      border: "1px solid #C9A227", background: katSearchId === product.id ? "#C9A227" : "#FFF8E7",
                      color: katSearchId === product.id ? "#fff" : "#92400E", fontWeight: 600,
                    }}
                  >🔍 Suchen</button>
                </div>
                {/* Kategorie-Suche Popup */}
                {katSearchId === product.id && (
                  <div style={{
                    position: "absolute", top: "100%", left: 0, zIndex: 1000,
                    background: "#fff", border: "1.5px solid #C9A227", borderRadius: 10,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.18)", padding: "12px 14px",
                    width: 360, marginTop: 6,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: 13, color: "#0F172A" }}>🔍 eBay Kategorie suchen</span>
                      <span onClick={() => { setKatSearchId(null); setKatSearchResults([]); }} style={{ cursor: "pointer", fontSize: 16, color: "#94A3B8" }}>✕</span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input
                        value={katSearchQuery}
                        onChange={e => setKatSearchQuery(e.currentTarget.value)}
                        onKeyDown={async e => {
                          if (e.key === 'Enter') {
                            const q = katSearchQuery.trim();
                            if (!q) return;
                            setKatSearchLoading(true);
                            setKatSearchResults([]);
                            try {
                              const res = await fetch(`/api/ebay/categories?q=${encodeURIComponent(q)}`);
                              const data = await res.json() as { results?: Array<{ id: string; name: string; path: string }> };
                              setKatSearchResults(data.results ?? []);
                            } catch { setKatSearchResults([]); }
                            finally { setKatSearchLoading(false); }
                          }
                        }}
                        placeholder="Suchbegriff eingeben..."
                        autoFocus
                        style={{
                          flex: 1, fontSize: 12, padding: "5px 8px", borderRadius: 6,
                          border: "1px solid #E2E8F0", fontFamily: "inherit",
                        }}
                      />
                      <button
                        onClick={async () => {
                          const q = katSearchQuery.trim();
                          if (!q) return;
                          setKatSearchLoading(true);
                          setKatSearchResults([]);
                          try {
                            const res = await fetch(`/api/ebay/categories?q=${encodeURIComponent(q)}`);
                            const data = await res.json() as { results?: Array<{ id: string; name: string; path: string }> };
                            setKatSearchResults(data.results ?? []);
                          } catch { setKatSearchResults([]); }
                          finally { setKatSearchLoading(false); }
                        }}
                        style={{ padding: "5px 12px", background: "#C9A227", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 700, fontSize: 12 }}
                      >{katSearchLoading ? "..." : "Go"}</button>
                    </div>
                    {katSearchResults.length > 0 && (
                      <div style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
                        {katSearchResults.map(r => (
                          <div
                            key={r.id}
                            onClick={async () => {
                              // ID in Feld setzen + speichern
                              await fetch(`/api/products/${product.id}`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ebayCategory: r.id }),
                              });
                              setProducts(prev => prev.map(p => p.id === product.id ? { ...p, ebayCategory: r.id } : p));
                              setKatSearchId(null);
                              setKatSearchResults([]);
                            }}
                            style={{
                              padding: "7px 8px", borderRadius: 6, cursor: "pointer", marginBottom: 2,
                              background: "#F8FAFC", border: "1px solid #E2E8F0",
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = "#FFF8E7")}
                            onMouseLeave={e => (e.currentTarget.style.background = "#F8FAFC")}
                          >
                            <div style={{ fontWeight: 700, fontSize: 12, color: "#0F172A" }}>{r.name} <span style={{ color: "#C9A227" }}>#{r.id}</span></div>
                            {r.path && <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>{r.path}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                    {katSearchResults.length === 0 && !katSearchLoading && katSearchQuery && (
                      <div style={{ marginTop: 8, fontSize: 11, color: "#94A3B8", textAlign: "center" }}>Enter drücken oder "Go" klicken</div>
                    )}
                  </div>
                )}
                {/* Kategorie-Hilfe Popup */}
                {katHelpId === product.id && (
                  <div style={{
                    position: "absolute", top: "100%", left: 0, zIndex: 999,
                    background: "#fff", border: "1.5px solid #C9A227", borderRadius: 10,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.18)", padding: "16px 18px",
                    width: 320, marginTop: 6,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontWeight: 800, fontSize: 13, color: "#0F172A" }}>📂 Wie finde ich die Kat-ID?</span>
                      <span onClick={() => setKatHelpId(null)} style={{ cursor: "pointer", fontSize: 16, color: "#94A3B8", lineHeight: 1 }}>✕</span>
                    </div>
                    <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: "#334155", lineHeight: 2 }}>
                      <li>Gehe auf <strong>ebay.de</strong> und suche nach einem ähnlichen Produkt</li>
                      <li>Klicke auf ein passendes Angebot</li>
                      <li>Schau in die <strong>URL</strong> — dort steht <code style={{ background: "#F1F5F9", padding: "1px 5px", borderRadius: 4 }}>_sacat=XXXXX</code></li>
                      <li>Die Zahl nach <code style={{ background: "#F1F5F9", padding: "1px 5px", borderRadius: 4 }}>_sacat=</code> ist die <strong>Kategorie-ID</strong></li>
                      <li>Diese Zahl hier eintragen und speichern</li>
                    </ol>
                    <div style={{ marginTop: 10, background: "#FFF8E7", borderRadius: 6, padding: "8px 10px", fontSize: 11, color: "#92400E" }}>
                      <strong>Beispiel URL:</strong><br/>
                      <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>ebay.de/sch/i.html?_sacat=<strong>179466</strong></span><br/>
                      <span style={{ marginTop: 4, display: "block" }}>→ Kat-ID = <strong>179466</strong></span>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, color: "#64748B" }}>
                      💡 Richtige Kategorie verhindert Fehler beim Einstellen
                    </div>
                  </div>
                )}
              </div>

              {/* Bearbeitungszeit (Handling Time) */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
                <span style={{ fontSize: 10, color: "#94A3B8", whiteSpace: "nowrap" }}>Bearb.-Zeit</span>
                <select
                  value={String(product.handlingTimeDays ?? 10)}
                  onChange={async (e) => {
                    const val = parseInt(e.currentTarget.value);
                    await fetch(`/api/products/${product.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ handlingTimeDays: val }),
                    });
                    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, handlingTimeDays: val } : p));
                  }}
                  style={{
                    fontSize: 11, padding: "4px 8px", borderRadius: 6,
                    border: "1px solid #E2E8F0", background: "#F8FAFC", color: "#0F172A",
                    fontFamily: "inherit", cursor: "pointer",
                  }}
                >
                  <option value="3">3 Tage</option>
                  <option value="5">5 Tage</option>
                  <option value="7">7 Tage</option>
                  <option value="10">10 Tage</option>
                  <option value="14">14 Tage</option>
                </select>
              </div>

              {product.ebayError && !listingResult && (
                <div style={{ fontSize: 11, color: "#DC2626", background: "#FEF2F2", padding: "6px 10px", borderRadius: 6, marginTop: 8 }}>
                  {product.ebayError.slice(0, 120)}
                  <button
                    onClick={async () => {
                      await fetch(`/api/products/${product.id}/reset-error`, { method: 'POST' });
                      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, ebayStatus: 'none', ebayError: null } : p));
                    }}
                    style={{ display: 'block', marginTop: 6, padding: '3px 10px', fontSize: 11, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                  >
                    Fehler zurücksetzen
                  </button>
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
