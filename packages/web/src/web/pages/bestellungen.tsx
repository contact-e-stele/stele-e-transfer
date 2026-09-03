/**
 * Bestellungen-Tab — eBay Bestellungen anzeigen (Grundgerüst P13)
 * Tracking-Eingabe folgt als nächster Schritt separat.
 */
import { useState, useEffect, useCallback } from "react";
import type { JSX } from "react";
import {
  Package, RefreshCw, Loader, Search, Truck, CheckCircle, Clock,
  FileText, Download, User, MapPin, CreditCard, ExternalLink, Clipboard,
} from "lucide-react";
import { DEFAULT_WORKFLOW_TEMPLATE, renderWorkflowTemplate } from "../../shared/workflow-template";

interface OrderLineItem {
  lineItemId: string;
  title: string;
  imageUrl: string | null;
  quantity: number;
  sku: string | null;
}

interface Order {
  orderId: string;
  buyerUsername: string;
  orderDate: string;
  orderFulfillmentStatus: string;
  orderPaymentStatus: string;
  total: number;
  currency: string;
  lineItems: OrderLineItem[];
  shippingAddress: {
    fullName: string;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    postalCode: string;
    countryCode: string;
    phone: string | null;
  } | null;
  trackingNumber: string | null;
  carrier: string | null;
  nettoEinkauf: number | null;
  nettoErgebnis: number | null;
  nettoQuelle: "manuell" | "automatisch" | null;
  aliexpressUrl: string | null;
  ebayListingUrl: string | null;
  localNote: {
    invoiceGeneratedAt: string | null;
    invoicePath: string | null;
    trackingNumber: string | null;
    carrier: string | null;
    shippedAt: string | null;
    aliexpressOrderId: string | null;
    aliexpressInvoiceUrl: string | null;
    manualBuyPrice: number | null;
    customerNotifiedAt: string | null;
    thankYouSentAt: string | null;
    trackingEbaySubmitted: boolean | null; // P-98: true/false = bekanntes Ergebnis, null = unbekannt/Altbestand
    trackingEbaySubmittedError: string | null;
  } | null;
}

// Dropdown-Werte für den Carrier — Zuordnung zum eBay-shippingCarrierCode passiert
// serverseitig (ebay.ts: mapCarrierToEbayCode). "Sonstige" fällt sicher auf eBays
// universellen Fallback "OTHER" zurück.
const CARRIER_OPTIONS = ["DHL", "DPD", "GLS", "Hermes", "UPS", "FedEx", "Sonstige / AliExpress Standard"];

type FilterMode = "all" | "open" | "shipped";

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// P-90/P-94: Personalisierte Version des Bestellabwicklungs-Workflows für "Workflow kopieren".
// Bestelldaten-Header + Duplikat-Warnung bleiben live berechnet (echte Bestelldaten, keine
// editierbare Vorlage). Der Rest (Rolle, Schritte 1-6, Effizienz-Hinweis) kommt seit P-94 aus
// der zentral in app_settings gespeicherten, im Einstellungen-Tab editierbaren Vorlage (`template`)
// — Platzhalter siehe shared/workflow-template.ts.
function buildWorkflowText(order: Order, template: string): string {
  const addr = order.shippingAddress;
  const addressBlock = addr
    ? [
        addr.fullName,
        addr.addressLine1,
        addr.addressLine2 ?? null,
        `${addr.postalCode} ${addr.city}`,
        addr.countryCode,
        addr.phone ? `Tel.: ${addr.phone}` : null,
      ].filter(Boolean).join("\n")
    : "⚠️ Keine Lieferadresse in der App hinterlegt — bitte direkt in eBay nachsehen.";

  const itemsBlock = order.lineItems
    .map(li => `   - ${li.title}${li.sku ? ` (SKU: ${li.sku})` : ""} × ${li.quantity}`)
    .join("\n");

  const nettoBlock = order.nettoErgebnis != null
    ? `${order.nettoErgebnis.toFixed(2)} ${order.currency} (${order.nettoQuelle === "manuell" ? "manuell erfasster Einkaufspreis" : "automatisch aus Produkt-DB geschätzt"})`
    : "noch nicht berechnet (kein bekannter Einkaufspreis)";

  const hasAliOrderId = !!order.localNote?.aliexpressOrderId;
  const hasTracking = !!order.localNote?.trackingNumber;
  const duplicateWarning = (hasAliOrderId || hasTracking)
    ? "⚠️⚠️ DUPLIKAT-WARNUNG — VOR DEM BESTELLEN PRÜFEN ⚠️⚠️\n" +
      (hasAliOrderId ? `Bereits eingetragene AliExpress-Bestellnummer: ${order.localNote!.aliexpressOrderId}\n` : "") +
      (hasTracking ? `Bereits eingetragene Sendungsnummer: ${order.localNote!.trackingNumber} (${order.localNote!.carrier ?? "Carrier unbekannt"})\n` : "") +
      "→ Diese Bestellung wurde vermutlich schon bearbeitet! Erst gegenprüfen, ob wirklich noch etwas bei AliExpress bestellt werden muss, bevor irgendetwas in den Warenkorb gelegt wird."
    : "Noch keine AliExpress-Bestellnummer oder Sendungsnummer eingetragen — vermutlich noch nicht bestellt.";

  const header = `# Bestellabwicklungs-Workflow — stele-e-transfer
Personalisiert für Bestellung ${order.orderId} · erzeugt ${new Date().toLocaleString("de-DE")}

## 📋 Bestelldaten (diese konkrete Bestellung)
- Bestellnummer: ${order.orderId}
- Käufer: ${addr?.fullName ?? order.buyerUsername}
- Artikel:
${itemsBlock}
- eBay-Verkaufspreis (Summe): ${order.total.toFixed(2)} ${order.currency}
- Erwartete Netto-Marge: ${nettoBlock}
- AliExpress-Quelle: ${order.aliexpressUrl ?? "kein Produkt-Match gefunden — bitte manuell auf AliExpress suchen"}
- eBay-Listing: ${order.ebayListingUrl ?? "kein Link verfügbar"}
- Lieferadresse:
${addressBlock}

${duplicateWarning}

---

**Verwendung:** Diesen kompletten Prompt bei einer neuen, offenen Bestellung in Claude (mit Chrome-/Browser-Zugriff) einfügen.

---

`;

  const rendered = renderWorkflowTemplate(template, {
    "{{ORDER_ID}}": order.orderId,
    "{{EBAY_LISTING_URL}}": order.ebayListingUrl ?? "kein Link vorhanden, manuell in eBay Seller Hub suchen",
    "{{ALIEXPRESS_URL}}": order.aliexpressUrl ?? "kein Link vorhanden, manuell auf AliExpress suchen",
    "{{ORDER_TOTAL}}": `${order.total.toFixed(2)} ${order.currency}`,
    "{{SICHERHEITS_CHECK}}": hasAliOrderId
      ? "Es ist bereits eine AliExpress-Bestellnummer eingetragen → STOPP, frag mich, ob das Produkt schon gekauft wurde (Duplikat-Kauf vermeiden)"
      : "Noch keine AliExpress-Bestellnummer eingetragen (siehe oben) — vermutlich unbedenklich, trotzdem kurz gegenprüfen",
  });

  return header + rendered;
}

function statusLabel(status: string): { label: string; color: string; bg: string; icon: JSX.Element } {
  if (status === "FULFILLED") return { label: "Versendet", color: "#16A34A", bg: "#F0FDF4", icon: <Truck size={13} /> };
  if (status === "IN_PROGRESS") return { label: "In Bearbeitung", color: "#F59E0B", bg: "#FFFBEB", icon: <Clock size={13} /> };
  return { label: "Offen", color: "#DC2626", bg: "#FEF2F2", icon: <Clock size={13} /> };
}

// Bestellung gilt als versendet, wenn eBay das bestätigt ODER wir es manuell markiert haben
function isEffectivelyShipped(order: Order): boolean {
  return order.orderFulfillmentStatus === "FULFILLED" || !!order.localNote?.shippedAt;
}

function effectiveStatusLabel(order: Order): { label: string; color: string; bg: string; icon: JSX.Element } {
  if (order.orderFulfillmentStatus === "FULFILLED") return statusLabel(order.orderFulfillmentStatus);
  if (order.localNote?.shippedAt) return { label: "Manuell versendet", color: "#0EA5E9", bg: "#F0F9FF", icon: <Truck size={13} /> };
  return statusLabel(order.orderFulfillmentStatus);
}

export default function Bestellungen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  // Manuelle Zusatzinfos (AliExpress-Bestellnummer, Rechnung-Upload, manuell versendet)
  const [editingAliId, setEditingAliId] = useState<string | null>(null); // orderId
  const [aliIdInput, setAliIdInput] = useState("");
  const [savingNote, setSavingNote] = useState<string | null>(null); // orderId
  const [uploadingInvoice, setUploadingInvoice] = useState<string | null>(null); // orderId
  const [markingShipped, setMarkingShipped] = useState<string | null>(null); // orderId
  const [toast, setToast] = useState<string | null>(null);
  // P-84: Sendungsnummer-Vorschläge aus AliExpress-Logistik-Mails — orderId -> Vorschlag.
  // Nur ein Vorschlag, kein Auto-Save; befüllt beim Bestätigen nur die vorhandenen P-80-Felder.
  const [trackingSuggestions, setTrackingSuggestions] = useState<Record<string, { trackingNumber: string; carrier: string }>>({});
  // P-85: Bewertungsbitte-Entwürfe aus AliExpress-Zustellbestätigungen — orderId -> Entwurf.
  // Reiner Text zum Kopieren, kein Versand-Mechanismus.
  const [reviewSuggestions, setReviewSuggestions] = useState<Record<string, { draftText: string; source: "email" | "zeit-schaetzung" }>>({});
  // P-99: Bestellungen, die sehr lange ohne jede Zustellmail unterwegs sind — Warnhinweis statt
  // Bewertungsbitte-Vorschlag (evtl. verlorene Sendung, bitte manuell prüfen).
  const [lostShipmentWarnings, setLostShipmentWarnings] = useState<Record<string, { daysSinceShipped: number }>>({});
  const [expandedReviewDraft, setExpandedReviewDraft] = useState<string | null>(null); // orderId
  const [markingNotified, setMarkingNotified] = useState<string | null>(null); // orderId
  // P-86: Danke+Sendungsnummer-Entwürfe für gerade versandte Bestellungen — orderId -> Entwurf.
  // V1: reiner Entwurf, kein Versand-Mechanismus (wie P-85).
  const [thankYouSuggestions, setThankYouSuggestions] = useState<Record<string, { draftText: string }>>({});
  const [expandedThankYouDraft, setExpandedThankYouDraft] = useState<string | null>(null); // orderId
  const [markingThankYouSent, setMarkingThankYouSent] = useState<string | null>(null); // orderId
  // P-94: zentral im Einstellungen-Tab gepflegte Vorlage für "Workflow kopieren" — bis zum
  // ersten erfolgreichen Laden gilt der eingebaute Startinhalt als Fallback, damit der Button
  // sofort funktioniert.
  const [workflowTemplate, setWorkflowTemplate] = useState<string>(DEFAULT_WORKFLOW_TEMPLATE);

  useEffect(() => {
    fetch("/api/settings/workflow-template", { credentials: "include" })
      .then(r => r.json())
      .then(d => { if ((d as { template?: string }).template) setWorkflowTemplate((d as { template: string }).template); })
      .catch(() => { /* Fallback bleibt der eingebaute Startinhalt */ });
  }, []);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const saveOrderNote = async (orderId: string, body: Record<string, unknown>) => {
    setSavingNote(orderId);
    try {
      const res = await fetch(`/api/order-notes/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null) as { ok?: boolean; ebay?: { submitted: boolean; error?: string } } | null;
      await load(true);
      return data;
    } finally {
      setSavingNote(null);
    }
  };

  const handleAliIdSave = (orderId: string) => {
    saveOrderNote(orderId, { aliexpressOrderId: aliIdInput.trim() || null });
    setEditingAliId(null);
  };

  // Sendungsnummer + Carrier — bei gemeinsamem Speichern wird automatisch an eBay übermittelt
  const [editingTracking, setEditingTracking] = useState<string | null>(null); // orderId
  const [trackingNumberInput, setTrackingNumberInput] = useState("");
  const [carrierInput, setCarrierInput] = useState(CARRIER_OPTIONS[0]);

  const handleTrackingSave = async (orderId: string) => {
    const trackingNumber = trackingNumberInput.trim();
    const carrier = carrierInput.trim();
    const data = await saveOrderNote(orderId, { trackingNumber: trackingNumber || null, carrier: carrier || null });
    setEditingTracking(null);
    if (!trackingNumber || !carrier) {
      showToast("Gespeichert (unvollständig — für eBay-Übermittlung werden Sendungsnummer UND Carrier benötigt)");
    } else if (data?.ebay?.submitted) {
      showToast(`✅ Sendungsnummer gespeichert und an eBay übermittelt (${carrier})`);
    } else {
      showToast(`⚠️ Lokal gespeichert, aber NICHT an eBay übermittelt — Fehler: ${data?.ebay?.error ?? "unbekannt"}`);
    }
  };

  // P-98: erneuter Übermittlungsversuch mit der bereits gespeicherten Sendungsnummer/Carrier —
  // für Bestellungen, bei denen trackingEbaySubmitted===false ist (eBay hat den letzten Versuch
  // abgelehnt). Kein erneutes Eintippen nötig, PATCH-Route versucht den eBay-Call erneut, sobald
  // beide Felder mitgeschickt werden.
  const handleRetryEbaySubmit = async (orderId: string) => {
    const order = orders.find(o => o.orderId === orderId);
    const trackingNumber = order?.localNote?.trackingNumber;
    const carrier = order?.localNote?.carrier;
    if (!trackingNumber || !carrier) return;
    const data = await saveOrderNote(orderId, { trackingNumber, carrier });
    if (data?.ebay?.submitted) {
      showToast(`✅ Erneuter Versuch erfolgreich — an eBay übermittelt (${carrier})`);
    } else {
      showToast(`⚠️ Erneuter Versuch fehlgeschlagen — Fehler: ${data?.ebay?.error ?? "unbekannt"}`);
    }
  };

  const [editingBuyPrice, setEditingBuyPrice] = useState<string | null>(null); // orderId
  const [buyPriceInput, setBuyPriceInput] = useState("");

  const handleBuyPriceSave = (orderId: string) => {
    const val = parseFloat(buyPriceInput.replace(",", "."));
    saveOrderNote(orderId, { manualBuyPrice: isNaN(val) ? null : val });
    setEditingBuyPrice(null);
  };

  const handleInvoiceUpload = async (orderId: string, aliexpressOrderId: string | null, file: File) => {
    setUploadingInvoice(orderId);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      // P-93: einheitliches Namensschema für die Buchhaltung — "Aliexpress {Ali-Bestellnr.} Ebay
      // {eBay-Bestellnr.}", damit Rechnungen ohne Nachschlagen den beiden Bestellungen zuzuordnen
      // sind. Fehlt die AliExpress-Bestellnummer noch (nicht eingetragen), "unbekannt" statt
      // Upload zu blockieren — kann später über den Dateinamen nachvollzogen/korrigiert werden.
      const filename = `Aliexpress ${aliexpressOrderId ?? "unbekannt"} Ebay ${orderId}`;
      const res = await fetch("/api/upload-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, filename }),
      });
      const data = await res.json() as { url?: string; error?: string };
      if (data.url) {
        await saveOrderNote(orderId, { aliexpressInvoiceUrl: data.url });
      } else {
        alert("Upload fehlgeschlagen: " + (data.error ?? "unbekannt"));
      }
    } catch (e) {
      alert("Upload fehlgeschlagen: " + String(e));
    } finally {
      setUploadingInvoice(null);
    }
  };

  const handleMarkShipped = async (orderId: string) => {
    setMarkingShipped(orderId);
    await saveOrderNote(orderId, { markShipped: true });
    setMarkingShipped(null);
  };


  const load = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError("");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);
      let res: Response;
      try {
        res = await fetch(`/api/ebay/orders${forceRefresh ? "?refresh=1" : ""}`, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) {
        let errMsg = `Fehler ${res.status}`;
        try { const d = await res.json() as { error?: string }; errMsg = d.error ?? errMsg; } catch { /* ignore */ }
        throw new Error(errMsg);
      }
      const data = await res.json() as { orders: Order[]; total: number };
      setOrders(data.orders);
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

  // P-84: Vorschläge laden — best-effort, bricht die Seite nicht falls Gmail nicht
  // verbunden ist oder der Abgleich fehlschlägt (einfach keine Vorschläge anzeigen).
  useEffect(() => {
    fetch("/api/gmail/tracking-suggestions")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const list = (d as { suggestions?: Array<{ orderId: string; trackingNumber: string; carrier: string }> } | null)?.suggestions ?? [];
        const map: Record<string, { trackingNumber: string; carrier: string }> = {};
        for (const s of list) map[s.orderId] = { trackingNumber: s.trackingNumber, carrier: s.carrier };
        setTrackingSuggestions(map);
      })
      .catch(() => { /* still, keine Vorschläge */ });
  }, []);

  // P-85/P-96/P-97: Bewertungsbitte-Entwürfe laden — ebenfalls best-effort. "source" unterscheidet
  // eine per AliExpress-Mail bestätigte Zustellung von einer reinen Zeit-Schätzung (P-97-Fallback,
  // wenn 11+ Tage seit "Als verschickt markieren" vergangen sind, aber keine Mail gefunden wurde).
  // P-99: zusätzlich "warnings" — sehr lange ohne jede Zustellmail unterwegs, evtl. verloren.
  useEffect(() => {
    fetch("/api/gmail/review-request-suggestions")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const body = d as { suggestions?: Array<{ orderId: string; draftText: string; source?: "email" | "zeit-schaetzung" }>; warnings?: Array<{ orderId: string; daysSinceShipped: number }> } | null;
        const list = body?.suggestions ?? [];
        const map: Record<string, { draftText: string; source: "email" | "zeit-schaetzung" }> = {};
        for (const s of list) map[s.orderId] = { draftText: s.draftText, source: s.source ?? "email" };
        setReviewSuggestions(map);

        const warningList = body?.warnings ?? [];
        const warningMap: Record<string, { daysSinceShipped: number }> = {};
        for (const w of warningList) warningMap[w.orderId] = { daysSinceShipped: w.daysSinceShipped };
        setLostShipmentWarnings(warningMap);
      })
      .catch(() => { /* still, keine Vorschläge */ });
  }, []);

  const handleMarkNotified = async (orderId: string) => {
    setMarkingNotified(orderId);
    await saveOrderNote(orderId, { markCustomerNotified: true });
    setMarkingNotified(null);
    setExpandedReviewDraft(null);
    showToast("Als erledigt markiert — wird für diesen Käufer nicht erneut vorgeschlagen");
  };

  // P-86: Danke+Sendungsnummer-Entwürfe laden — ebenfalls best-effort, kein Gmail nötig.
  useEffect(() => {
    fetch("/api/thank-you-suggestions")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const list = (d as { suggestions?: Array<{ orderId: string; draftText: string }> } | null)?.suggestions ?? [];
        const map: Record<string, { draftText: string }> = {};
        for (const s of list) map[s.orderId] = { draftText: s.draftText };
        setThankYouSuggestions(map);
      })
      .catch(() => { /* still, keine Vorschläge */ });
  }, []);

  const handleMarkThankYouSent = async (orderId: string) => {
    setMarkingThankYouSent(orderId);
    await saveOrderNote(orderId, { markThankYouSent: true });
    setMarkingThankYouSent(null);
    setExpandedThankYouDraft(null);
    showToast("Als erledigt markiert");
  };

  const filtered = orders.filter(o => {
    if (filter === "open" && isEffectivelyShipped(o)) return false;
    if (filter === "shipped" && !isEffectivelyShipped(o)) return false;
    if (search) {
      const q = search.toLowerCase();
      const matchesOrderId = o.orderId.toLowerCase().includes(q);
      const matchesBuyer = o.buyerUsername.toLowerCase().includes(q);
      const matchesItem = o.lineItems.some(li => li.title.toLowerCase().includes(q));
      if (!matchesOrderId && !matchesBuyer && !matchesItem) return false;
    }
    return true;
  });

  const stats = {
    total: orders.length,
    open: orders.filter(o => !isEffectivelyShipped(o)).length,
    shipped: orders.filter(o => isEffectivelyShipped(o)).length,
    revenue: orders.reduce((a, o) => a + o.total, 0),
    nettoKnown: orders.filter(o => o.nettoErgebnis !== null),
  };
  const nettoSumme = stats.nettoKnown.reduce((a, o) => a + (o.nettoErgebnis ?? 0), 0);

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      {toast && (
        <div style={{
          position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
          background: "#1E293B", color: "#fff", borderRadius: 10,
          padding: "10px 20px", fontSize: 13, fontWeight: 600, zIndex: 999,
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)", maxWidth: "90vw", textAlign: "center",
        }}>
          {toast}
        </div>
      )}
      <div style={{ maxWidth: 780, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#0EA5E9", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Package size={22} color="#fff" />
            </div>
            <div>
              <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", margin: 0 }}>Bestellungen</h1>
              <p style={{ fontSize: 12, color: "#64748B", margin: 0 }}>{orders.length} Bestellungen · {stats.open} offen · {stats.shipped} versendet</p>
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
        <div className="stele-grid-4" style={{ gap: 8, marginBottom: 8 }}>
          {[
            { label: "Gesamt", value: stats.total, color: "#8B5CF6", bg: "#F5F3FF", icon: <Package size={16} color="#8B5CF6" /> },
            { label: "Offen", value: stats.open, color: "#DC2626", bg: "#FEF2F2", icon: <Clock size={16} color="#DC2626" /> },
            { label: "Versendet", value: stats.shipped, color: "#16A34A", bg: "#F0FDF4", icon: <Truck size={16} color="#16A34A" /> },
            { label: "Umsatz (Brutto)", value: stats.revenue.toFixed(2) + " €", color: "#0EA5E9", bg: "#F0F9FF", icon: <CreditCard size={16} color="#0EA5E9" /> },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: s.label === "Umsatz (Brutto)" ? 15 : 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Netto-Ergebnis (Umsatz minus Einkauf/Zoll) — nur für Bestellungen mit bekanntem Einkaufspreis */}
        <div style={{ background: "#F0FDF4", border: "1.5px solid #BBF7D0", borderRadius: 12, padding: "10px 14px", marginBottom: 20, fontSize: 12 }}>
          <span style={{ fontWeight: 700, color: "#166534" }}>
            Netto-Ergebnis (nach Einkauf{"/"}Zoll): {nettoSumme.toFixed(2)} €
          </span>
          <span style={{ color: "#64748B", marginLeft: 8 }}>
            ({stats.nettoKnown.length}/{orders.length} Bestellungen berechenbar — Einkaufspreis muss im Produkt hinterlegt sein)
          </span>
          <div style={{ fontSize: 10, color: "#94A3B8", marginTop: 4 }}>
            Hinweis: Enthält noch keine eBay-Gebühren, Versandkosten oder Anzeigenkosten — reiner Wareneinsatz-Abzug.
            {stats.nettoKnown.length < orders.length && (
              <> Nur Produkte, die über diese App importiert wurden, haben einen hinterlegten Einkaufspreis — ältere eBay-Listings (vor App-Nutzung) fehlt dieser Wert noch.</>
            )}
          </div>
        </div>

        {/* Suche + Filter */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search size={14} color="#94A3B8" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Bestellnummer, Käufer oder Artikel suchen…"
              style={{
                width: "100%", padding: "10px 12px 10px 34px", fontSize: 13,
                border: "1.5px solid #E2E8F0", borderRadius: 10, outline: "none",
                fontFamily: "inherit", boxSizing: "border-box", color: "#0F172A", background: "#fff",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {([["all", "Alle"], ["open", "Offen"], ["shipped", "Versendet"]] as [FilterMode, string][]).map(([f, label]) => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "8px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600,
                border: "1.5px solid " + (filter === f ? "#0EA5E9" : "#E2E8F0"),
                background: filter === f ? "#F0F9FF" : "#fff",
                color: filter === f ? "#0369A1" : "#64748B",
                cursor: "pointer", fontFamily: "inherit",
              }}>
                {label}
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
            <Loader size={32} style={{ animation: "spin 1s linear infinite", margin: "0 auto 12px" }} color="#0EA5E9" />
            <div style={{ color: "#94A3B8", fontSize: 13 }}>Bestellungen werden geladen…</div>
          </div>
        )}

        {/* Bestellungen */}
        {!loading && filtered.map(order => {
          const status = effectiveStatusLabel(order);
          return (
            <div key={order.orderId} style={{
              background: "#fff", borderRadius: 16, padding: 16,
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)", marginBottom: 10,
              borderLeft: `4px solid ${status.color}`,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 2 }}>Bestellnummer: {order.orderId}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", fontWeight: 600 }}>
                    <User size={12} /> {order.shippingAddress?.fullName ?? order.buyerUsername}
                  </div>
                </div>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20,
                  background: status.bg, color: status.color,
                }}>
                  {status.icon} {status.label}
                </span>
              </div>

              {/* Artikel */}
              {order.lineItems.map(li => (
                <div key={li.lineItemId} style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6 }}>
                  {li.imageUrl ? (
                    <img src={li.imageUrl} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", flexShrink: 0 }} />
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: 6, background: "#F1F5F9", flexShrink: 0 }} />
                  )}
                  <div style={{ fontSize: 12, color: "#0F172A", fontWeight: 600 }}>
                    {li.title}
                    {li.sku && <span style={{ color: "#94A3B8", fontWeight: 500 }}> ({li.sku})</span>}
                    <span style={{ color: "#94A3B8", fontWeight: 500 }}> · {li.quantity}×</span>
                  </div>
                </div>
              ))}

              {/* Adresse + Datum + Betrag */}
              {/* Volle Lieferadresse + Telefon, mit einem Klick kopierbar (P-90) */}
              {order.shippingAddress && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, padding: "6px 10px", background: "#F8FAFC", borderRadius: 8, fontSize: 11, color: "#475569" }}>
                  <MapPin size={12} color="#94A3B8" style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>
                    {order.shippingAddress.addressLine1}
                    {order.shippingAddress.addressLine2 ? `, ${order.shippingAddress.addressLine2}` : ""}
                    {", "}{order.shippingAddress.postalCode} {order.shippingAddress.city}
                    {order.shippingAddress.countryCode ? `, ${order.shippingAddress.countryCode}` : ""}
                    {order.shippingAddress.phone ? ` · Tel.: ${order.shippingAddress.phone}` : ""}
                  </span>
                  <button
                    onClick={() => {
                      const a = order.shippingAddress!;
                      const text = [
                        a.fullName, a.addressLine1, a.addressLine2 ?? null,
                        `${a.postalCode} ${a.city}`, a.countryCode, a.phone ? `Tel.: ${a.phone}` : null,
                      ].filter(Boolean).join("\n");
                      navigator.clipboard.writeText(text);
                      showToast("Adresse kopiert");
                    }}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0,
                      background: "none", border: "1px solid #E2E8F0", borderRadius: 6, padding: "3px 8px",
                      fontSize: 10, fontWeight: 700, color: "#475569", cursor: "pointer", fontFamily: "inherit",
                    }}
                  >
                    <Clipboard size={10} /> Kopieren
                  </button>
                </div>
              )}

              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: "#64748B" }}>
                <span>Bestellt: {fmtDate(order.orderDate)}</span>
                <span style={{ fontWeight: 700, color: "#0F172A" }}>{order.total.toFixed(2)} {order.currency}</span>
                {order.nettoErgebnis !== null && (
                  <span style={{ fontWeight: 700, color: order.nettoErgebnis >= 0 ? "#16A34A" : "#DC2626" }}>
                    Netto: {order.nettoErgebnis.toFixed(2)} {order.currency}
                    {order.nettoQuelle === "manuell" && <span style={{ fontWeight: 500, color: "#94A3B8" }}> (manuell)</span>}
                  </span>
                )}
                {editingBuyPrice === order.orderId ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <input
                      autoFocus
                      value={buyPriceInput}
                      onChange={e => setBuyPriceInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleBuyPriceSave(order.orderId)}
                      placeholder="Einkauf laut Rechnung €"
                      style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1.5px solid #16A34A", outline: "none", fontFamily: "inherit", width: 130 }}
                    />
                    <button onClick={() => handleBuyPriceSave(order.orderId)} style={{ background: "#16A34A", color: "#fff", border: "none", borderRadius: 6, padding: "3px 6px", cursor: "pointer" }}>
                      <CheckCircle size={11} />
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => { setEditingBuyPrice(order.orderId); setBuyPriceInput(order.localNote?.manualBuyPrice != null ? String(order.localNote.manualBuyPrice) : ""); }}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#94A3B8", fontFamily: "inherit", padding: 0, textDecoration: "underline" }}
                  >
                    {order.localNote?.manualBuyPrice != null ? "Einkauf ändern" : "Einkaufspreis eintragen"}
                  </button>
                )}
                {savingNote === order.orderId && <Loader size={11} style={{ animation: "spin 1s linear infinite" }} color="#94A3B8" />}
                {order.localNote?.shippedAt && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#16A34A", fontWeight: 700 }}>
                    <Truck size={11} /> Manuell als versendet markiert ({fmtDate(order.localNote.shippedAt)})
                  </span>
                )}
              </div>

              {/* AliExpress-Bestellnummer */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                {editingAliId === order.orderId ? (
                  <>
                    <input
                      autoFocus
                      value={aliIdInput}
                      onChange={e => setAliIdInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleAliIdSave(order.orderId)}
                      placeholder="AliExpress-Bestellnummer"
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #FF6B00", outline: "none", fontFamily: "inherit", width: 160 }}
                    />
                    <button onClick={() => handleAliIdSave(order.orderId)} style={{ background: "#FF6B00", color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>
                      <CheckCircle size={11} />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setEditingAliId(order.orderId); setAliIdInput(order.localNote?.aliexpressOrderId ?? ""); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", fontSize: 11, color: order.localNote?.aliexpressOrderId ? "#FF6B00" : "#94A3B8", fontFamily: "inherit", padding: 0 }}
                  >
                    <FileText size={11} />
                    {order.localNote?.aliexpressOrderId ? `AliExpress-Bestellnr.: ${order.localNote.aliexpressOrderId}` : "AliExpress-Bestellnummer eintragen"}
                  </button>
                )}
                {savingNote === order.orderId && <Loader size={11} style={{ animation: "spin 1s linear infinite" }} color="#94A3B8" />}
              </div>

              {/* P-84: Sendungsnummer-Vorschlag aus AliExpress-Logistik-Mail — nur Vorschlag, kein Auto-Save */}
              {!order.localNote?.trackingNumber && editingTracking !== order.orderId && trackingSuggestions[order.orderId] && (
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                  marginTop: 10, padding: "8px 12px", borderRadius: 8,
                  background: "#EFF6FF", border: "1px solid #BFDBFE",
                }}>
                  <span style={{ fontSize: 11, color: "#1D4ED8" }}>
                    💡 Sendungsnummer erkannt: <strong>{trackingSuggestions[order.orderId].trackingNumber}</strong>
                  </span>
                  <button
                    onClick={() => {
                      const s = trackingSuggestions[order.orderId];
                      setEditingTracking(order.orderId);
                      setTrackingNumberInput(s.trackingNumber);
                      setCarrierInput(s.carrier);
                    }}
                    style={{ background: "#1D4ED8", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                  >
                    Übernehmen
                  </button>
                </div>
              )}

              {/* P-99: Sendung ungewöhnlich lange ohne jede Zustellmail unterwegs — Warnhinweis
                  statt Bewertungsbitte-Vorschlag, da eine verlorene Sendung sonst fälschlich als
                  "wahrscheinlich zugestellt" behandelt würde. Reiner Hinweis, keine Aktion nötig. */}
              {!order.localNote?.customerNotifiedAt && lostShipmentWarnings[order.orderId] && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 8, background: "#FFF7ED", border: "1px solid #FED7AA" }}>
                  <span style={{ fontSize: 11, color: "#C2410C", fontWeight: 700 }}>
                    ⚠️ Sendung seit {lostShipmentWarnings[order.orderId].daysSinceShipped} Tagen unterwegs, noch keine Zustellbestätigung gefunden — bitte manuell bei eBay/Sendungsnummer prüfen, evtl. verloren
                  </span>
                </div>
              )}

              {/* P-85: Bewertungsbitte-Entwurf aus AliExpress-Zustellbestätigung — reiner Text zum
                  Kopieren, KEIN Versand-Mechanismus. Erst "Erledigt" markiert die Bestellung. */}
              {!order.localNote?.customerNotifiedAt && reviewSuggestions[order.orderId] && (
                <div style={{
                  marginTop: 10, padding: "8px 12px", borderRadius: 8,
                  background: "#F5F3FF", border: "1px solid #DDD6FE",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#6D28D9" }}>
                      ⭐ Bewertungsbitte-Entwurf verfügbar ({reviewSuggestions[order.orderId].source === "zeit-schaetzung"
                        ? "wahrscheinlich zugestellt — Zeitschätzung, bitte prüfen"
                        : "Zustellung per Mail erkannt"})
                    </span>
                    <button
                      onClick={() => setExpandedReviewDraft(expandedReviewDraft === order.orderId ? null : order.orderId)}
                      style={{ background: "#6D28D9", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      {expandedReviewDraft === order.orderId ? "Ausblenden" : "Text anzeigen"}
                    </button>
                  </div>
                  {expandedReviewDraft === order.orderId && (
                    <div style={{ marginTop: 8 }}>
                      <textarea
                        readOnly
                        value={reviewSuggestions[order.orderId].draftText}
                        style={{
                          width: "100%", minHeight: 110, fontSize: 12, padding: 8, borderRadius: 6,
                          border: "1px solid #DDD6FE", fontFamily: "inherit", resize: "vertical", background: "#fff",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(reviewSuggestions[order.orderId].draftText);
                            showToast("Text kopiert — jetzt selbst in eBays Kontakt-Käufer-Funktion einfügen");
                          }}
                          style={{ background: "#fff", color: "#6D28D9", border: "1px solid #DDD6FE", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                        >
                          Kopieren
                        </button>
                        <button
                          onClick={() => handleMarkNotified(order.orderId)}
                          disabled={markingNotified === order.orderId}
                          style={{ background: "#F5F3FF", color: "#6D28D9", border: "1px solid #DDD6FE", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: markingNotified === order.orderId ? "not-allowed" : "pointer" }}
                        >
                          {markingNotified === order.orderId ? "…" : "Erledigt (nicht mehr vorschlagen)"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sendungsnummer — wird bei Speichern automatisch an eBay übermittelt */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {editingTracking === order.orderId ? (
                  <>
                    <input
                      autoFocus
                      value={trackingNumberInput}
                      onChange={e => setTrackingNumberInput(e.target.value)}
                      placeholder="Sendungsnummer"
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #0EA5E9", outline: "none", fontFamily: "inherit", width: 160 }}
                    />
                    <select
                      value={carrierInput}
                      onChange={e => setCarrierInput(e.target.value)}
                      style={{ fontSize: 11, padding: "4px 8px", borderRadius: 6, border: "1.5px solid #0EA5E9", outline: "none", fontFamily: "inherit", background: "#fff" }}
                    >
                      {CARRIER_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button onClick={() => handleTrackingSave(order.orderId)} style={{ background: "#0EA5E9", color: "#fff", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" }}>
                      <CheckCircle size={11} />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setEditingTracking(order.orderId);
                      setTrackingNumberInput(order.localNote?.trackingNumber ?? "");
                      setCarrierInput(order.localNote?.carrier ?? CARRIER_OPTIONS[0]);
                    }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", fontSize: 11, color: order.localNote?.trackingNumber ? "#0EA5E9" : "#94A3B8", fontFamily: "inherit", padding: 0 }}
                  >
                    <Truck size={11} />
                    {order.localNote?.trackingNumber
                      ? `Sendung: ${order.localNote.carrier ?? "?"} ${order.localNote.trackingNumber}`
                      : "Sendungsnummer eintragen (→ eBay)"}
                  </button>
                )}
                {savingNote === order.orderId && <Loader size={11} style={{ animation: "spin 1s linear infinite" }} color="#94A3B8" />}
              </div>

              {/* P-98/P-103: persistente Warnung statt nur Toast, sobald trackingEbaySubmitted
                  nicht nachweislich TRUE ist. Zwei Fälle, bewusst unterschiedlich eingefärbt:
                  - false: eBay hat den letzten Übermittlungsversuch nachweislich abgelehnt (rot).
                  - null/undefined ("nie verifiziert"): Sendungsnummer wurde vor dem P-98-Fix
                    eingetragen, ohne dass je geprüft wurde, ob eBay sie überhaupt akzeptiert hat —
                    P-98 blendete das bisher fälschlich als "kein Fehler" aus (Live-Fund Engel:
                    App zeigte "Versendet", eBay Seller Hub weiterhin "+ Sendungsnummer
                    hinzufügen"). Absichtlich amber statt rot, um bei potenziell längst
                    erfolgreichen Altfällen keinen falschen Alarm auszulösen — aber sichtbar genug,
                    um zum Nachprüfen per Klick zu motivieren, statt stillschweigend "erfolgreich"
                    zu unterstellen. Bleibt sichtbar, bis erfolgreich erneut übermittelt oder die
                    Sendungsnummer manuell geändert wird. */}
              {order.localNote?.trackingNumber && order.localNote?.trackingEbaySubmitted !== true && (() => {
                const confirmed = order.localNote.trackingEbaySubmitted === false;
                return (
                  <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 8, background: confirmed ? "#FEF2F2" : "#FFFBEB", border: `1px solid ${confirmed ? "#FECACA" : "#FDE68A"}` }}>
                    <div style={{ fontSize: 11, color: confirmed ? "#DC2626" : "#B45309", fontWeight: 700 }}>
                      {confirmed
                        ? "⚠️ eBay hat die Sendungsnummer NICHT bestätigt — Käufer hat vermutlich keine Versandbenachrichtigung mit Tracking erhalten"
                        : "❔ eBay-Übermittlung nie verifiziert — bitte prüfen, ob eBay die Sendungsnummer wirklich hat"}
                    </div>
                    {order.localNote.trackingEbaySubmittedError && (
                      <div style={{ fontSize: 10, color: "#991B1B", marginTop: 2 }}>{order.localNote.trackingEbaySubmittedError.slice(0, 200)}</div>
                    )}
                    <button
                      onClick={() => handleRetryEbaySubmit(order.orderId)}
                      disabled={savingNote === order.orderId}
                      style={{ marginTop: 6, background: confirmed ? "#DC2626" : "#B45309", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: savingNote === order.orderId ? "not-allowed" : "pointer" }}
                    >
                      Erneut an eBay übermitteln
                    </button>
                  </div>
                );
              })()}

              {/* P-86: Danke+Sendungsnummer-Entwurf, sobald P-80 erfolgreich eine trackingNumber
                  gespeichert hat — reiner Text zum Kopieren, KEIN Versand-Mechanismus (V1, wie P-85).
                  Der einmalige Live-Test von AddMemberMessageAAQToPartner folgt separat. */}
              {!order.localNote?.thankYouSentAt && thankYouSuggestions[order.orderId] && (
                <div style={{
                  marginTop: 10, padding: "8px 12px", borderRadius: 8,
                  background: "#F0FDF4", border: "1px solid #BBF7D0",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#15803D" }}>
                      📦 Danke-Nachricht-Entwurf verfügbar (Sendungsnummer übermittelt)
                    </span>
                    <button
                      onClick={() => setExpandedThankYouDraft(expandedThankYouDraft === order.orderId ? null : order.orderId)}
                      style={{ background: "#15803D", color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
                    >
                      {expandedThankYouDraft === order.orderId ? "Ausblenden" : "Text anzeigen"}
                    </button>
                  </div>
                  {expandedThankYouDraft === order.orderId && (
                    <div style={{ marginTop: 8 }}>
                      <textarea
                        readOnly
                        value={thankYouSuggestions[order.orderId].draftText}
                        style={{
                          width: "100%", minHeight: 90, fontSize: 12, padding: 8, borderRadius: 6,
                          border: "1px solid #BBF7D0", fontFamily: "inherit", resize: "vertical", background: "#fff",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(thankYouSuggestions[order.orderId].draftText);
                            showToast("Text kopiert — jetzt selbst in eBays Kontakt-Käufer-Funktion einfügen");
                          }}
                          style={{ background: "#fff", color: "#15803D", border: "1px solid #BBF7D0", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
                        >
                          Kopieren
                        </button>
                        <button
                          onClick={() => handleMarkThankYouSent(order.orderId)}
                          disabled={markingThankYouSent === order.orderId}
                          style={{ background: "#F0FDF4", color: "#15803D", border: "1px solid #BBF7D0", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 700, cursor: markingThankYouSent === order.orderId ? "not-allowed" : "pointer" }}
                        >
                          {markingThankYouSent === order.orderId ? "…" : "Erledigt"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Aktionen */}
              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(buildWorkflowText(order, workflowTemplate));
                    showToast("Workflow kopiert — jetzt in Claude einfügen");
                  }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "6px 10px", borderRadius: 8, background: "#F8FAFC", color: "#475569",
                    fontSize: 11, fontWeight: 700, border: "1px solid #E2E8F0", cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <Clipboard size={11} /> Workflow kopieren
                </button>

                <a
                  href={`/api/ebay/orders/${order.orderId}/invoice`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "6px 10px", borderRadius: 8, background: "#EFF6FF", color: "#1D4ED8",
                    fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: "inherit",
                    border: "1px solid #BFDBFE",
                  }}
                >
                  {order.localNote?.invoicePath ? <Download size={11} /> : <FileText size={11} />}
                  {order.localNote?.invoicePath ? "Rechnung herunterladen" : "Rechnung erzeugen"}
                </a>

                {order.aliexpressUrl && (
                  <a
                    href={order.aliexpressUrl}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8, background: "#FFF7ED", color: "#C2410C",
                      fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: "inherit",
                      border: "1px solid #FED7AA",
                    }}
                  >
                    <ExternalLink size={11} /> Zum AliExpress-Artikel
                  </a>
                )}

                {order.ebayListingUrl && (
                  <a
                    href={order.ebayListingUrl}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8, background: "#F5F3FF", color: "#6D28D9",
                      fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: "inherit",
                      border: "1px solid #DDD6FE",
                    }}
                  >
                    <ExternalLink size={11} /> Zum eBay-Listing
                  </a>
                )}

                {order.localNote?.aliexpressInvoiceUrl ? (
                  <>
                    <a href={order.localNote.aliexpressInvoiceUrl} target="_blank" rel="noopener noreferrer" style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8, background: "#FFF7ED", color: "#C2410C",
                      fontSize: 11, fontWeight: 700, textDecoration: "none", fontFamily: "inherit", border: "1px solid #FED7AA",
                    }}>
                      <Download size={11} /> AliExpress-Rechnung ansehen
                    </a>
                    <label style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8, background: "#FEF2F2", color: "#DC2626",
                      fontSize: 11, fontWeight: 700, fontFamily: "inherit", border: "1px solid #FECACA", cursor: "pointer",
                    }}>
                      {uploadingInvoice === order.orderId ? <Loader size={11} style={{ animation: "spin 1s linear infinite" }} /> : <FileText size={11} />}
                      Ersetzen
                      <input type="file" accept="application/pdf,image/*" style={{ display: "none" }}
                        onChange={e => { const f = e.target.files?.[0]; if (f) handleInvoiceUpload(order.orderId, order.localNote?.aliexpressOrderId ?? null, f); }} />
                    </label>
                  </>
                ) : (
                  <label style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "6px 10px", borderRadius: 8, background: "#FFF7ED", color: "#C2410C",
                    fontSize: 11, fontWeight: 700, fontFamily: "inherit", border: "1px solid #FED7AA", cursor: "pointer",
                  }}>
                    {uploadingInvoice === order.orderId ? <Loader size={11} style={{ animation: "spin 1s linear infinite" }} /> : <FileText size={11} />}
                    AliExpress-Rechnung hochladen
                    <input type="file" accept="application/pdf,image/*" style={{ display: "none" }}
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleInvoiceUpload(order.orderId, order.localNote?.aliexpressOrderId ?? null, f); }} />
                  </label>
                )}

                {!order.localNote?.shippedAt && (
                  <button
                    onClick={() => handleMarkShipped(order.orderId)}
                    disabled={markingShipped === order.orderId}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8, background: "#F0FDF4", color: "#16A34A",
                      fontSize: 11, fontWeight: 700, border: "1px solid #BBF7D0",
                      cursor: markingShipped === order.orderId ? "not-allowed" : "pointer", fontFamily: "inherit",
                    }}
                  >
                    {markingShipped === order.orderId ? <Loader size={11} style={{ animation: "spin 1s linear infinite" }} /> : <Truck size={11} />}
                    Manuell als versendet markieren
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {!loading && filtered.length === 0 && !error && (
          <div style={{ background: "#fff", borderRadius: 20, padding: "48px 24px", textAlign: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <Package size={48} color="#E2E8F0" style={{ margin: "0 auto 16px" }} />
            <p style={{ color: "#94A3B8", fontSize: 14, margin: 0 }}>
              {search ? "Keine Treffer" : "Keine Bestellungen gefunden"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
