/**
 * Bestellungen-Tab — eBay Bestellungen anzeigen (Grundgerüst P13)
 * Tracking-Eingabe folgt als nächster Schritt separat.
 */
import { useState, useEffect, useCallback } from "react";
import {
  Package, RefreshCw, Loader, Search, Truck, CheckCircle, Clock,
  FileText, Download, User, MapPin, CreditCard,
} from "lucide-react";

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
  shippingAddress: { fullName: string; city: string; postalCode: string; countryCode: string } | null;
  trackingNumber: string | null;
  carrier: string | null;
  localNote: { invoiceGeneratedAt: string | null; invoicePath: string | null; trackingNumber: string | null } | null;
}

type FilterMode = "all" | "open" | "shipped";

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function statusLabel(status: string): { label: string; color: string; bg: string; icon: JSX.Element } {
  if (status === "FULFILLED") return { label: "Versendet", color: "#16A34A", bg: "#F0FDF4", icon: <Truck size={13} /> };
  if (status === "IN_PROGRESS") return { label: "In Bearbeitung", color: "#F59E0B", bg: "#FFFBEB", icon: <Clock size={13} /> };
  return { label: "Offen", color: "#DC2626", bg: "#FEF2F2", icon: <Clock size={13} /> };
}

export default function Bestellungen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

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

  const filtered = orders.filter(o => {
    if (filter === "open" && o.orderFulfillmentStatus === "FULFILLED") return false;
    if (filter === "shipped" && o.orderFulfillmentStatus !== "FULFILLED") return false;
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
    open: orders.filter(o => o.orderFulfillmentStatus !== "FULFILLED").length,
    shipped: orders.filter(o => o.orderFulfillmentStatus === "FULFILLED").length,
    revenue: orders.reduce((a, o) => a + o.total, 0),
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
          {[
            { label: "Gesamt", value: stats.total, color: "#8B5CF6", bg: "#F5F3FF", icon: <Package size={16} color="#8B5CF6" /> },
            { label: "Offen", value: stats.open, color: "#DC2626", bg: "#FEF2F2", icon: <Clock size={16} color="#DC2626" /> },
            { label: "Versendet", value: stats.shipped, color: "#16A34A", bg: "#F0FDF4", icon: <Truck size={16} color="#16A34A" /> },
            { label: "Umsatz", value: stats.revenue.toFixed(2) + " €", color: "#0EA5E9", bg: "#F0F9FF", icon: <CreditCard size={16} color="#0EA5E9" /> },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: "12px 8px", textAlign: "center" }}>
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: s.label === "Umsatz" ? 15 : 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "#64748B", fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
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
          const status = statusLabel(order.orderFulfillmentStatus);
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
                    {li.title.length > 60 ? li.title.slice(0, 60) + "…" : li.title}
                    <span style={{ color: "#94A3B8", fontWeight: 500 }}> · {li.quantity}×</span>
                  </div>
                </div>
              ))}

              {/* Adresse + Datum + Betrag */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 11, color: "#64748B" }}>
                {order.shippingAddress && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <MapPin size={11} /> {order.shippingAddress.postalCode} {order.shippingAddress.city}
                  </span>
                )}
                <span>Bestellt: {fmtDate(order.orderDate)}</span>
                <span style={{ fontWeight: 700, color: "#0F172A" }}>{order.total.toFixed(2)} {order.currency}</span>
              </div>

              {/* Aktionen */}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
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
