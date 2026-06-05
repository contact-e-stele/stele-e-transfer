import { useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Return {
  returnId: string;
  orderId: string;
  itemTitle: string;
  itemImage?: string;
  buyerName: string;
  reason: string;
  status: "OPEN" | "IN_PROGRESS" | "CLOSED" | "REFUNDED";
  createdAt: string;
  amount: number;
  currency: string;
  note?: string;
}

const STATUS_LABELS: Record<Return["status"], string> = {
  OPEN: "Offen",
  IN_PROGRESS: "In Bearbeitung",
  CLOSED: "Abgeschlossen",
  REFUNDED: "Erstattet",
};

const STATUS_COLORS: Record<Return["status"], string> = {
  OPEN: "#EF4444",
  IN_PROGRESS: "#F59E0B",
  CLOSED: "#6B7280",
  REFUNDED: "#10B981",
};

// ─── Demo-Daten (bis eBay OAuth aktiv) ───────────────────────────────────────

const DEMO_RETURNS: Return[] = [
  {
    returnId: "5001234567",
    orderId: "12-34567-89012",
    itemTitle: "Silikon Backform Set 3-teilig antihaftbeschichtet",
    buyerName: "Max Mustermann",
    reason: "Artikel entspricht nicht der Beschreibung",
    status: "OPEN",
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    amount: 18.99,
    currency: "EUR",
  },
  {
    returnId: "5001234568",
    orderId: "12-34567-89013",
    itemTitle: "Edelstahl Küchenmesser Set 5-teilig",
    buyerName: "Anna Schmidt",
    reason: "Defekter Artikel",
    status: "IN_PROGRESS",
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    amount: 34.5,
    currency: "EUR",
    note: "Käufer schickt Fotos",
  },
  {
    returnId: "5001234569",
    orderId: "12-34567-89014",
    itemTitle: "LED Schreibtischlampe dimmbar USB",
    buyerName: "Peter Huber",
    reason: "Artikel nicht angekommen",
    status: "REFUNDED",
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    amount: 22.99,
    currency: "EUR",
    note: "Vollständig erstattet am 02.06.2026",
  },
];

// ─── Statistik-Karte ──────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: 12,
      padding: "14px 18px",
      border: "1px solid #E2E8F0",
      flex: 1,
      minWidth: 100,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ─── Status-Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Return["status"] }) {
  return (
    <span style={{
      background: STATUS_COLORS[status] + "22",
      color: STATUS_COLORS[status],
      border: `1px solid ${STATUS_COLORS[status]}44`,
      borderRadius: 6,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 600,
    }}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ─── Retouren-Karte ───────────────────────────────────────────────────────────

function ReturnCard({
  ret,
  onStatusChange,
  onNote,
  onRefund,
}: {
  ret: Return;
  onStatusChange: (id: string, status: Return["status"]) => void;
  onNote: (id: string, note: string) => void;
  onRefund: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(ret.note ?? "");
  const [refunding, setRefunding] = useState(false);

  const date = new Date(ret.createdAt).toLocaleDateString("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });

  return (
    <div style={{
      background: "#fff",
      border: "1px solid #E2E8F0",
      borderRadius: 12,
      overflow: "hidden",
      marginBottom: 10,
    }}>
      {/* Header */}
      <div
        style={{ padding: "12px 16px", cursor: "pointer", display: "flex", gap: 12, alignItems: "center" }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#0F172A", marginBottom: 3 }}>
            {ret.itemTitle.length > 55 ? ret.itemTitle.slice(0, 55) + "…" : ret.itemTitle}
          </div>
          <div style={{ fontSize: 11, color: "#64748B", display: "flex", gap: 10, flexWrap: "wrap" }}>
            <span>🛒 #{ret.orderId}</span>
            <span>👤 {ret.buyerName}</span>
            <span>📅 {date}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <StatusBadge status={ret.status} />
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0F172A" }}>
            {ret.amount.toFixed(2)} {ret.currency}
          </div>
        </div>
        <span style={{ color: "#94A3B8", fontSize: 14 }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Details */}
      {expanded && (
        <div style={{ borderTop: "1px solid #F1F5F9", padding: "14px 16px", background: "#FAFAFA" }}>
          {/* Grund */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 3 }}>Retourengrund</div>
            <div style={{ fontSize: 13, color: "#334155" }}>🔔 {ret.reason}</div>
          </div>

          {/* Status ändern */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 6 }}>Status ändern</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(["OPEN", "IN_PROGRESS", "CLOSED"] as Return["status"][]).map(s => (
                <button
                  key={s}
                  onClick={() => onStatusChange(ret.returnId, s)}
                  style={{
                    padding: "5px 12px",
                    borderRadius: 7,
                    border: "1px solid",
                    borderColor: ret.status === s ? STATUS_COLORS[s] : "#E2E8F0",
                    background: ret.status === s ? STATUS_COLORS[s] + "22" : "#fff",
                    color: ret.status === s ? STATUS_COLORS[s] : "#64748B",
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Notiz */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#94A3B8", marginBottom: 4 }}>Interne Notiz</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="z.B. Käufer wartet auf Antwort..."
                style={{
                  flex: 1,
                  padding: "7px 10px",
                  borderRadius: 8,
                  border: "1px solid #E2E8F0",
                  fontSize: 12,
                  fontFamily: "'Poppins', sans-serif",
                  outline: "none",
                }}
              />
              <button
                onClick={() => onNote(ret.returnId, note)}
                style={{
                  padding: "7px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "#3B82F6",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Speichern
              </button>
            </div>
          </div>

          {/* Rückerstattung */}
          {ret.status !== "REFUNDED" && (
            <div style={{
              background: "#FEF3C7",
              border: "1px solid #FDE68A",
              borderRadius: 8,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#92400E" }}>
                  💸 Rückerstattung auslösen
                </div>
                <div style={{ fontSize: 11, color: "#B45309" }}>
                  {ret.amount.toFixed(2)} {ret.currency} an {ret.buyerName}
                </div>
              </div>
              <button
                disabled={refunding}
                onClick={async () => {
                  setRefunding(true);
                  await onRefund(ret.returnId);
                  setRefunding(false);
                }}
                style={{
                  padding: "7px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: refunding ? "#D1D5DB" : "#EF4444",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: refunding ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {refunding ? "…" : "Erstatten"}
              </button>
            </div>
          )}

          {ret.status === "REFUNDED" && (
            <div style={{
              background: "#D1FAE5",
              border: "1px solid #A7F3D0",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 12,
              color: "#065F46",
              fontWeight: 600,
            }}>
              ✅ Bereits erstattet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Hauptseite ───────────────────────────────────────────────────────────────

export default function Retouren() {
  const [returns, setReturns] = useState<Return[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Return["status"] | "ALL">("ALL");
  const [toast, setToast] = useState<string | null>(null);
  const [ebayConnected, setEbayConnected] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    // Versuche echte Retouren von eBay zu laden
    fetch("/api/ebay/returns")
      .then(r => {
        if (!r.ok) throw new Error();
        return r.json() as Promise<Return[]>;
      })
      .then(data => {
        setReturns(data);
        setEbayConnected(true);
        setLoading(false);
      })
      .catch(() => {
        // Fallback: Demo-Daten + lokale gespeicherte Notizen
        const saved = JSON.parse(localStorage.getItem("stele_returns") ?? "null") as Return[] | null;
        setReturns(saved ?? DEMO_RETURNS);
        setLoading(false);
      });
  }, []);

  const saveReturns = (updated: Return[]) => {
    setReturns(updated);
    localStorage.setItem("stele_returns", JSON.stringify(updated));
  };

  const handleStatusChange = (id: string, status: Return["status"]) => {
    const updated = returns.map(r => r.returnId === id ? { ...r, status } : r);
    saveReturns(updated);
    showToast(`Status auf "${STATUS_LABELS[status]}" gesetzt`);
  };

  const handleNote = (id: string, note: string) => {
    const updated = returns.map(r => r.returnId === id ? { ...r, note } : r);
    saveReturns(updated);
    showToast("Notiz gespeichert");
  };

  const handleRefund = async (id: string) => {
    const ret = returns.find(r => r.returnId === id);
    if (!ret) return;

    try {
      const res = await fetch(`/api/ebay/returns/${id}/refund`, { method: "POST" });
      if (!res.ok) throw new Error();
      const updated = returns.map(r => r.returnId === id ? { ...r, status: "REFUNDED" as const } : r);
      saveReturns(updated);
      showToast(`✅ ${ret.amount.toFixed(2)} € erstattet`);
    } catch {
      // Demo-Modus: lokal markieren
      const updated = returns.map(r => r.returnId === id ? { ...r, status: "REFUNDED" as const } : r);
      saveReturns(updated);
      showToast(`✅ ${ret.amount.toFixed(2)} € erstattet (Demo)`);
    }
  };

  const filtered = filter === "ALL" ? returns : returns.filter(r => r.status === filter);

  // Statistiken
  const stats = {
    total: returns.length,
    open: returns.filter(r => r.status === "OPEN").length,
    inProgress: returns.filter(r => r.status === "IN_PROGRESS").length,
    refunded: returns.filter(r => r.status === "REFUNDED").length,
    totalAmount: returns.reduce((s, r) => s + r.amount, 0),
    topReasons: Object.entries(
      returns.reduce((acc, r) => {
        acc[r.reason] = (acc[r.reason] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).sort((a, b) => b[1] - a[1]).slice(0, 3),
  };

  return (
    <div style={{
      maxWidth: 680,
      margin: "0 auto",
      padding: "16px 12px 40px",
      fontFamily: "'Poppins', sans-serif",
    }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 70, left: "50%", transform: "translateX(-50%)",
          background: "#1E293B", color: "#fff", borderRadius: 10,
          padding: "10px 20px", fontSize: 13, fontWeight: 600, zIndex: 999,
          boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
        }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0F172A", margin: 0 }}>
          🔄 Retouren
        </h2>
        {!ebayConnected && (
          <div style={{
            marginTop: 8,
            background: "#FEF3C7",
            border: "1px solid #FDE68A",
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 11,
            color: "#92400E",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}>
            <span>⚠️ Demo-Modus — eBay noch nicht verbunden</span>
            <a href="/api/ebay/auth" style={{ color: "#D97706", fontWeight: 700, textDecoration: "none", fontSize: 11 }}>
              eBay verbinden →
            </a>
          </div>
        )}
      </div>

      {/* Statistiken */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <StatCard label="Gesamt" value={stats.total} color="#3B82F6" />
        <StatCard label="Offen" value={stats.open} color="#EF4444" />
        <StatCard label="In Bearb." value={stats.inProgress} color="#F59E0B" />
        <StatCard label="Erstattet" value={stats.refunded} color="#10B981" />
        <StatCard label="Volumen" value={`${stats.totalAmount.toFixed(0)} €`} color="#8B5CF6" />
      </div>

      {/* Top Gründe */}
      {stats.topReasons.length > 0 && (
        <div style={{
          background: "#fff",
          border: "1px solid #E2E8F0",
          borderRadius: 12,
          padding: "12px 16px",
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#64748B", marginBottom: 8 }}>
            📊 Häufigste Retourengründe
          </div>
          {stats.topReasons.map(([reason, count]) => (
            <div key={reason} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <div style={{ fontSize: 11, color: "#334155" }}>{reason}</div>
              <div style={{
                background: "#3B82F611",
                color: "#3B82F6",
                borderRadius: 5,
                padding: "1px 8px",
                fontSize: 11,
                fontWeight: 700,
              }}>
                {count}×
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {(["ALL", "OPEN", "IN_PROGRESS", "CLOSED", "REFUNDED"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              border: "1px solid",
              borderColor: filter === f ? "#3B82F6" : "#E2E8F0",
              background: filter === f ? "#3B82F6" : "#fff",
              color: filter === f ? "#fff" : "#64748B",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {f === "ALL" ? `Alle (${returns.length})` : `${STATUS_LABELS[f]} (${returns.filter(r => r.status === f).length})`}
          </button>
        ))}
      </div>

      {/* Liste */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: "#94A3B8", fontSize: 13 }}>
          Lade Retouren…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: "center",
          padding: "40px 20px",
          color: "#94A3B8",
          fontSize: 13,
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #E2E8F0",
        }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>🎉</div>
          Keine Retouren in dieser Kategorie
        </div>
      ) : (
        filtered.map(ret => (
          <ReturnCard
            key={ret.returnId}
            ret={ret}
            onStatusChange={handleStatusChange}
            onNote={handleNote}
            onRefund={handleRefund}
          />
        ))
      )}
    </div>
  );
}
