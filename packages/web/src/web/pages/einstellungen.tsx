import { useState, useEffect, useCallback } from "react";

interface AliStatus {
  connected: boolean;
  appKey: string;
  source?: string;
  expiresAt?: number | null;
  hasRefreshToken?: boolean;
}

function formatExpiry(ts: number | null | undefined): { label: string; urgent: boolean; expired: boolean } {
  if (!ts) return { label: "Unbekannt", urgent: false, expired: false };
  const now = Date.now();
  const diff = ts * 1000 - now; // ts kommt vom Server in Sekunden (Unix-Timestamp)
  if (diff <= 0) return { label: "Abgelaufen", urgent: true, expired: true };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 1) return { label: `Noch ${days} Tage`, urgent: days <= 3, expired: false };
  if (hours > 0) return { label: `Noch ${hours} Stunden`, urgent: true, expired: false };
  return { label: "Läuft bald ab", urgent: true, expired: false };
}

export default function Einstellungen() {
  const [aliStatus, setAliStatus] = useState<AliStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [driveConnected, setDriveConnected] = useState<boolean | null>(null);
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);

  const loadStatus = useCallback(() => {
    setLoading(true);
    fetch("/api/aliexpress/status", { credentials: "include" })
      .then(r => r.json())
      .then(d => setAliStatus(d as AliStatus))
      .catch(() => setAliStatus({ connected: false, appKey: "535690" }))
      .finally(() => setLoading(false));
    fetch("/api/drive/status", { credentials: "include" })
      .then(r => r.json())
      .then(d => setDriveConnected((d as { connected?: boolean }).connected ?? false))
      .catch(() => setDriveConnected(false));
    fetch("/api/gmail/status", { credentials: "include" })
      .then(r => r.json())
      .then(d => setGmailConnected((d as { connected?: boolean }).connected ?? false))
      .catch(() => setGmailConnected(false));
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleAliConnect = () => {
    window.location.href = "/api/aliexpress/auth";
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const r = await fetch("/api/aliexpress/refresh", { method: "POST", credentials: "include" });
      const d = await r.json() as { ok?: boolean; error?: string; expiresAt?: number };
      if (d.ok) {
        setRefreshMsg({ ok: true, text: "Token erfolgreich erneuert ✓" });
        loadStatus();
      } else {
        setRefreshMsg({ ok: false, text: d.error || "Refresh fehlgeschlagen" });
      }
    } catch {
      setRefreshMsg({ ok: false, text: "Netzwerkfehler beim Refresh" });
    } finally {
      setRefreshing(false);
    }
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

  const expiry = formatExpiry(aliStatus?.expiresAt);

  return (
    <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 16px" }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1E293B", marginBottom: 20 }}>
        ⚙️ Einstellungen
      </h2>

      {/* AliExpress Verbindung */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 22 }}>🛍️</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>AliExpress API</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 14px", maxWidth: 480 }}>
          Offizielle Produktdaten: Titel, Preise, Bilder, Versandland — zuverlässig ohne Scraping.
          App Key: <code style={{ background: "#F1F5F9", padding: "1px 6px", borderRadius: 4 }}>535690</code>
        </p>

        {loading ? (
          <span style={{ fontSize: 13, color: "#94A3B8" }}>Prüfe...</span>
        ) : (
          <>
            {/* Status-Zeile */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <span style={badge(aliStatus?.connected ?? false)}>
                {aliStatus?.connected
                  ? `✅ Verbunden${aliStatus.source === 'db' ? ' (OAuth DB)' : aliStatus.source === 'env' ? ' (Env-Token)' : ''}`
                  : "❌ Nicht verbunden"}
              </span>

              {/* Token-Ablauf Badge */}
              {aliStatus?.connected && aliStatus?.expiresAt && (
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  padding: "4px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600,
                  background: expiry.expired ? "#FEF2F2" : expiry.urgent ? "#FFF7ED" : "#EFF6FF",
                  color: expiry.expired ? "#991B1B" : expiry.urgent ? "#92400E" : "#1D4ED8",
                }}>
                  🕐 {expiry.label}
                </span>
              )}
            </div>

            {/* Refresh-Meldung */}
            {refreshMsg && (
              <div style={{
                marginBottom: 10, padding: "8px 12px", borderRadius: 8, fontSize: 13,
                background: refreshMsg.ok ? "#DCFCE7" : "#FEF2F2",
                color: refreshMsg.ok ? "#166534" : "#991B1B",
                border: `1px solid ${refreshMsg.ok ? "#BBF7D0" : "#FECACA"}`,
              }}>
                {refreshMsg.text}
              </div>
            )}

            {/* Buttons */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                onClick={handleAliConnect}
                style={{
                  background: aliStatus?.connected ? "#F1F5F9" : "#D97706",
                  color: aliStatus?.connected ? "#64748B" : "#fff",
                  border: "none", borderRadius: 8, padding: "8px 18px",
                  fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                {aliStatus?.connected ? "Neu verbinden" : "Mit AliExpress verbinden"}
              </button>

              {/* Refresh-Button — nur wenn Refresh-Token vorhanden und Token env-basiert NICHT */}
              {aliStatus?.connected && aliStatus?.hasRefreshToken && aliStatus?.source !== 'env' && (
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  style={{
                    background: expiry.expired ? "#DC2626" : expiry.urgent ? "#D97706" : "#3B82F6",
                    color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px",
                    fontSize: 13, fontWeight: 600, cursor: refreshing ? "not-allowed" : "pointer",
                    opacity: refreshing ? 0.7 : 1,
                  }}
                >
                  {refreshing ? "Wird erneuert..." : "Token erneuern"}
                </button>
              )}
            </div>

            {/* Warnung: Token abgelaufen */}
            {aliStatus?.connected && expiry.expired && (
              <div style={{
                marginTop: 10, background: "#FEF2F2", border: "1px solid #FECACA",
                borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#991B1B",
              }}>
                ⚠️ <strong>Token abgelaufen!</strong> API-Calls werden fehlschlagen. Bitte erneuern oder neu verbinden.
              </div>
            )}
            {aliStatus?.connected && expiry.urgent && !expiry.expired && (
              <div style={{
                marginTop: 10, background: "#FFF7ED", border: "1px solid #FED7AA",
                borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400E",
              }}>
                ⏰ <strong>Token läuft bald ab!</strong> Jetzt erneuern, um Unterbrechungen zu vermeiden.
              </div>
            )}
          </>
        )}

        {/* Kein Token */}
        {!aliStatus?.connected && !loading && (
          <div style={{
            marginTop: 14, background: "#FFF7ED", border: "1px solid #FED7AA",
            borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400E",
          }}>
            ⚠️ <strong>Ohne Verbindung:</strong> Produktdaten werden per Scraping geladen (weniger zuverlässig, CAPTCHA-Probleme möglich). Verbindung empfohlen.
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
          Für Listings, Preisupdate und Bestellungen. Client:{" "}
          <code style={{ background: "#F1F5F9", padding: "1px 6px", borderRadius: 4 }}>steleetr-SETDSAPP-PRD</code>
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

      {/* Google Drive */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>📁</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>Google Drive</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
          Für automatische Backups, Produktbilder und Rechnungen (statt lokalem Server-Speicher).
        </p>
        {driveConnected === null ? (
          <span style={{ fontSize: 13, color: "#94A3B8" }}>Prüfe Status…</span>
        ) : driveConnected ? (
          <span style={badge(true)}>✅ Verbunden</span>
        ) : (
          <div>
            <span style={badge(false)}>⚠️ Nicht verbunden</span>
            <div style={{ marginTop: 10 }}>
              <a href="/api/drive/auth" style={{
                display: "inline-block", padding: "8px 16px", borderRadius: 8,
                background: "#4285F4", color: "#fff", fontWeight: 700, fontSize: 13,
                textDecoration: "none",
              }}>
                Mit Google Drive verbinden
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Gmail (P-84) */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>📬</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>Gmail</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
          Für Sendungsnummer-Vorschläge im Bestellungen-Tab aus AliExpress-Logistik-Mails (nur Vorschlag, keine automatische Übermittlung).
        </p>
        {gmailConnected === null ? (
          <span style={{ fontSize: 13, color: "#94A3B8" }}>Prüfe Status…</span>
        ) : gmailConnected ? (
          <span style={badge(true)}>✅ Verbunden</span>
        ) : (
          <div>
            <span style={badge(false)}>⚠️ Nicht verbunden</span>
            <div style={{ marginTop: 10 }}>
              <a href="/api/gmail/auth" style={{
                display: "inline-block", padding: "8px 16px", borderRadius: 8,
                background: "#4285F4", color: "#fff", fontWeight: 700, fontSize: 13,
                textDecoration: "none",
              }}>
                Mit Gmail verbinden
              </a>
            </div>
          </div>
        )}
      </div>

      {/* App Info */}
      <div style={{ ...card, background: "#F8FAFC" }}>
        <div style={{ fontSize: 13, color: "#64748B" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Version</span><span style={{ fontWeight: 600, color: "#1E293B" }}>v1.1</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Shop</span><span style={{ fontWeight: 600, color: "#1E293B" }}>stele-e-transfer (eBay DE)</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>Plattform</span><span style={{ fontWeight: 600, color: "#10B981" }}>Live ✓</span>
          </div>
        </div>
      </div>
    </div>
  );
}
