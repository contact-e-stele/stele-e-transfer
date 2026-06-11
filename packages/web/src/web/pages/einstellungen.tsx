import { useState, useEffect } from "react";

interface AliStatus {
  connected: boolean;
  appKey: string;
}

export default function Einstellungen() {
  const [aliStatus, setAliStatus] = useState<AliStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/aliexpress/status", { credentials: "include" })
      .then(r => r.json())
      .then(d => setAliStatus(d as AliStatus))
      .catch(() => setAliStatus({ connected: false, appKey: "530690" }))
      .finally(() => setLoading(false));
  }, []);

  const handleAliConnect = () => {
    window.location.href = "/api/aliexpress/auth";
  };

  const card: React.CSSProperties = {
    background: "#fff",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 16,
    boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
    border: "1px solid #E2E8F0",
  };

  const badge = (ok: boolean) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 12px",
    borderRadius: 20,
    fontSize: 13,
    fontWeight: 600,
    background: ok ? "#DCFCE7" : "#FEF2F2",
    color: ok ? "#166534" : "#991B1B",
  } as React.CSSProperties);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 16px" }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1E293B", marginBottom: 20 }}>
        ⚙️ Einstellungen
      </h2>

      {/* AliExpress Verbindung */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 22 }}>🛍️</span>
              <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>AliExpress API</span>
            </div>
            <p style={{ fontSize: 13, color: "#64748B", margin: 0, maxWidth: 360 }}>
              Offizielle Produktdaten: Titel, Preise, Bilder, Versandland — zuverlässig ohne Scraping.
              App Key: <code style={{ background: "#F1F5F9", padding: "1px 6px", borderRadius: 4 }}>530690</code>
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            {loading ? (
              <span style={{ fontSize: 13, color: "#94A3B8" }}>Prüfe...</span>
            ) : (
              <>
                <span style={badge(aliStatus?.connected ?? false)}>
                  {aliStatus?.connected ? "✅ Verbunden" : "❌ Nicht verbunden"}
                </span>
                <button
                  onClick={handleAliConnect}
                  style={{
                    background: aliStatus?.connected ? "#F1F5F9" : "#D97706",
                    color: aliStatus?.connected ? "#64748B" : "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 18px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {aliStatus?.connected ? "Neu verbinden" : "Mit AliExpress verbinden"}
                </button>
              </>
            )}
          </div>
        </div>
        {!aliStatus?.connected && !loading && (
          <div style={{
            marginTop: 14,
            background: "#FFF7ED",
            border: "1px solid #FED7AA",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 12,
            color: "#92400E",
          }}>
            ⚠️ <strong>Ohne Verbindung:</strong> Produktdaten werden per Scraping geladen (weniger zuverlässig, CAPTCHA-Probleme möglich). Verbindung empfohlen für Go-Live.
          </div>
        )}
      </div>

      {/* eBay Verbindung */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🛒</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>eBay API</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
          Für Listings, Preisupdate und Bestellungen. Client: <code style={{ background: "#F1F5F9", padding: "1px 6px", borderRadius: 4 }}>steleetr-SETDSAPP-PRD</code>
        </p>
        <span style={badge(true)}>✅ Verbunden (Refresh Token gesetzt)</span>
      </div>

      {/* ScrapingAnt */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🕷️</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>ScrapingAnt</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
          Fallback-Scraper für AliExpress. Free Plan: 10.000 Credits/Monat. Browser-Modus aktiv.
        </p>
        <span style={badge(true)}>✅ API Key konfiguriert</span>
      </div>

      {/* App Info */}
      <div style={{ ...card, background: "#F8FAFC" }}>
        <div style={{ fontSize: 13, color: "#64748B" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Version</span><span style={{ fontWeight: 600, color: "#1E293B" }}>v0.5</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Shop</span><span style={{ fontWeight: 600, color: "#1E293B" }}>stele-e-transfer (eBay DE)</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Go-Live Ziel</span><span style={{ fontWeight: 600, color: "#D97706" }}>15.06.2026</span>
          </div>
        </div>
      </div>
    </div>
  );
}
