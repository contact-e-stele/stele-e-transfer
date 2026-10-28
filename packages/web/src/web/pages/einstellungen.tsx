import { aliEinfuhrEur } from "../../shared/constants";
import { useState, useEffect, useCallback } from "react";
import { ElectricSettingsCard } from "../components/electric-panel";

interface AliStatus {
  connected: boolean;
  appKey: string;
  source?: string;
  expiresAt?: number | null;
  hasRefreshToken?: boolean;
}

interface EbayStatus {
  connected: boolean;
  hasRefreshToken: boolean;
  scopes: string[] | null;
  hasMarketingScope: boolean;
  source: "db" | "env" | "none";
  updatedAt: string | null;
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
  const [ebayStatus, setEbayStatus] = useState<EbayStatus | null>(null);
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  // P-94: zentral gespeicherte, editierbare Vorlage für den "Workflow kopieren"-Text
  const [workflowTemplate, setWorkflowTemplate] = useState<string>("");
  const [workflowTemplateLoading, setWorkflowTemplateLoading] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateMsg, setTemplateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadWorkflowTemplate = useCallback(() => {
    setWorkflowTemplateLoading(true);
    fetch("/api/settings/workflow-template", { credentials: "include" })
      .then(r => r.json())
      .then(d => setWorkflowTemplate((d as { template?: string }).template ?? ""))
      .catch(() => setTemplateMsg({ ok: false, text: "Laden fehlgeschlagen — Netzwerkfehler" }))
      .finally(() => setWorkflowTemplateLoading(false));
  }, []);

  useEffect(() => { loadWorkflowTemplate(); }, [loadWorkflowTemplate]);

  const handleSaveWorkflowTemplate = async () => {
    setSavingTemplate(true);
    setTemplateMsg(null);
    try {
      const r = await fetch("/api/settings/workflow-template", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ template: workflowTemplate }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        setTemplateMsg({ ok: true, text: "Gespeichert ✓" });
      } else {
        setTemplateMsg({ ok: false, text: d.error || "Speichern fehlgeschlagen" });
      }
    } catch {
      setTemplateMsg({ ok: false, text: "Netzwerkfehler beim Speichern" });
    } finally {
      setSavingTemplate(false);
    }
  };

  // P-88 Schritt 1c: nutzerpflegbare Default-Werte für eBay-Pflichtmerkmale (global + je Kategorie)
  const [aspectDefaults, setAspectDefaults] = useState<{ global: Record<string, string>; byCategory: Record<string, Record<string, string>> }>({ global: {}, byCategory: {} });
  const [aspectDefaultsLoading, setAspectDefaultsLoading] = useState(true);
  const [savingAspectDefaults, setSavingAspectDefaults] = useState(false);
  const [aspectDefaultsMsg, setAspectDefaultsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newGlobalName, setNewGlobalName] = useState("");
  const [newGlobalValue, setNewGlobalValue] = useState("");
  const [newCatId, setNewCatId] = useState("");
  const [newCatName, setNewCatName] = useState("");
  const [newCatValue, setNewCatValue] = useState("");

  useEffect(() => {
    setAspectDefaultsLoading(true);
    fetch("/api/settings/aspect-defaults", { credentials: "include" })
      .then(r => r.json())
      .then(d => setAspectDefaults(d as { global: Record<string, string>; byCategory: Record<string, Record<string, string>> }))
      .catch(() => setAspectDefaultsMsg({ ok: false, text: "Laden fehlgeschlagen — Netzwerkfehler" }))
      .finally(() => setAspectDefaultsLoading(false));
  }, []);

  const saveAspectDefaults = async (next: typeof aspectDefaults) => {
    setAspectDefaults(next);
    setSavingAspectDefaults(true);
    setAspectDefaultsMsg(null);
    try {
      const r = await fetch("/api/settings/aspect-defaults", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(next),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      setAspectDefaultsMsg(d.ok ? { ok: true, text: "Gespeichert ✓" } : { ok: false, text: d.error || "Speichern fehlgeschlagen" });
    } catch {
      setAspectDefaultsMsg({ ok: false, text: "Netzwerkfehler beim Speichern" });
    } finally {
      setSavingAspectDefaults(false);
    }
  };

  const [maxQty, setMaxQty] = useState("10");
  const [maxQtyMsg, setMaxQtyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    fetch("/api/settings/max-variant-quantity", { credentials: "include" })
      .then(r => r.json())
      .then(d => setMaxQty(String((d as { value?: number }).value ?? 10)))
      .catch(() => setMaxQtyMsg({ ok: false, text: "Laden fehlgeschlagen — Netzwerkfehler" }));
  }, []);
  const saveMaxQty = async () => {
    const n = Number(maxQty);
    if (!Number.isInteger(n) || n < 1) { setMaxQtyMsg({ ok: false, text: "Bitte eine ganze Zahl ab 1 eingeben" }); return; }
    setMaxQtyMsg(null);
    try {
      const r = await fetch("/api/settings/max-variant-quantity", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ value: n }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      setMaxQtyMsg(d.ok ? { ok: true, text: "Gespeichert ✓" } : { ok: false, text: d.error || "Speichern fehlgeschlagen" });
    } catch {
      setMaxQtyMsg({ ok: false, text: "Netzwerkfehler beim Speichern" });
    }
  };

  // OFFEN 006: Import-Regeln — Sterne-Sperre und höchstens Varianten.
  const [minRating, setMinRating] = useState("4.2");
  const [maxVariants, setMaxVariants] = useState("5");
  const [rulesMsg, setRulesMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    fetch("/api/settings/import-rules", { credentials: "include" })
      .then(r => r.json())
      .then(d => { const v = (d as { value?: { minRating: number; maxVariants: number } }).value; if (v) { setMinRating(String(v.minRating)); setMaxVariants(String(v.maxVariants)); } })
      .catch(() => setRulesMsg({ ok: false, text: "Laden fehlgeschlagen — Netzwerkfehler" }));
  }, []);
  const saveRules = async () => {
    setRulesMsg(null);
    try {
      const r = await fetch("/api/settings/import-rules", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ value: { minRating: Number(minRating.replace(",", ".")), maxVariants: Number(maxVariants) } }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      setRulesMsg(d.ok ? { ok: true, text: "Gespeichert ✓ (gilt für neue Importe)" } : { ok: false, text: d.error || "Speichern fehlgeschlagen" });
    } catch {
      setRulesMsg({ ok: false, text: "Netzwerkfehler beim Speichern" });
    }
  };

  // Multi-Rabatt (Inhaber 18.10.2026): Euro-Regel — 2 Stück / 3 Stück so viel billiger (höchstens 3 Stück).
  const [multiEur2, setMultiEur2] = useState("3");
  const [multiEur3, setMultiEur3] = useState("5");
  const [multiMsg, setMultiMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    fetch("/api/settings/multi-rabatt", { credentials: "include" })
      .then(r => r.json())
      .then(d => { const v = (d as { value?: { eur2: number; eur3: number } }).value; if (v) { setMultiEur2(String(v.eur2)); setMultiEur3(String(v.eur3)); } })
      .catch(() => setMultiMsg({ ok: false, text: "Laden fehlgeschlagen — Netzwerkfehler" }));
  }, []);
  const saveMulti = async () => {
    const eur2 = Number(multiEur2.replace(",", ".")), eur3 = Number(multiEur3.replace(",", "."));
    setMultiMsg(null);
    try {
      const r = await fetch("/api/settings/multi-rabatt", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ value: { eur2, eur3 } }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      setMultiMsg(d.ok ? { ok: true, text: "Gespeichert ✓ (gilt für neue Vorschauen; an eBay erst per Knopf im Listings-Tab)" } : { ok: false, text: d.error || "Speichern fehlgeschlagen" });
    } catch {
      setMultiMsg({ ok: false, text: "Netzwerkfehler beim Speichern" });
    }
  };

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
    fetch("/api/ebay/status", { credentials: "include" })
      .then(r => r.json())
      .then(d => setEbayStatus(d as EbayStatus))
      .catch(() => setEbayStatus(null));
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const handleAliConnect = () => {
    window.location.href = "/api/aliexpress/auth";
  };

  const handleEbayConnect = () => {
    window.location.href = "/api/ebay/auth";
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

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <span style={badge(ebayStatus?.connected ?? false)}>
            {ebayStatus?.connected ? "✅ Verbunden" : "❌ Nicht verbunden"}
          </span>
        </div>

        {ebayStatus?.scopes ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {ebayStatus.scopes.map(scope => {
              const isMarketing = scope === "sell.marketing";
              const ok = !isMarketing || ebayStatus.hasMarketingScope;
              return (
                <span key={scope} style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 12,
                  background: ok ? "#DCFCE7" : "#FEF2F2",
                  color: ok ? "#166534" : "#991B1B",
                }}>
                  {scope}{isMarketing ? (ok ? " ✓" : " ✗") : ""}
                </span>
              );
            })}
            {!ebayStatus.hasMarketingScope && !ebayStatus.scopes.includes("sell.marketing") && (
              <span style={{
                fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 12,
                background: "#FEF2F2", color: "#991B1B",
              }}>
                sell.marketing ✗ (fehlt)
              </span>
            )}
          </div>
        ) : ebayStatus?.hasRefreshToken ? (
          <div style={{
            marginBottom: 10, background: "#FFF7ED", border: "1px solid #FED7AA",
            borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400E",
          }}>
            ⚠️ <strong>Marketing-Zugriff vermutlich nicht vorhanden — bitte neu verbinden.</strong> Für diesen
            Token (aus einer Umgebungsvariable, vor dieser Funktion gesetzt) sind die Scopes unbekannt.
          </div>
        ) : null}

        <button
          onClick={handleEbayConnect}
          style={{
            background: ebayStatus?.connected ? "#F1F5F9" : "#D97706",
            color: ebayStatus?.connected ? "#64748B" : "#fff",
            border: "none", borderRadius: 8, padding: "8px 18px",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          {ebayStatus?.connected ? "Neu verbinden" : "Mit eBay verbinden"}
        </button>
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

      {/* P-94: Bestellabwicklungs-Workflow-Text */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🧭</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>Bestellabwicklungs-Workflow</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 8px" }}>
          Text, den der "Workflow kopieren"-Button im Bestellungen-Tab verwendet. Bestelldaten (Adresse, Artikel, Duplikat-Warnung) werden davon unabhängig weiterhin live pro Bestellung eingesetzt.
        </p>
        <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 10px" }}>
          Platzhalter: <code>{"{{ORDER_ID}}"}</code>, <code>{"{{EBAY_LISTING_URL}}"}</code>, <code>{"{{ALIEXPRESS_URL}}"}</code>, <code>{"{{ORDER_TOTAL}}"}</code>, <code>{"{{SICHERHEITS_CHECK}}"}</code> — werden beim Kopieren durch die echten Bestelldaten ersetzt.
        </p>
        <p style={{ fontSize: 12, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 6, padding: "6px 10px", margin: "0 0 10px" }}>
          ⚠️ Feste Regel bei Änderungen (auch für Claude Code): neue Version immer gegen die vorherige vergleichen, nur ergänzen/verbessern, nie bestehende Punkte einfach löschen. Grundstruktur erhalten.
        </p>
        {workflowTemplateLoading ? (
          <span style={{ fontSize: 13, color: "#94A3B8" }}>Lade…</span>
        ) : (
          <>
            <textarea
              value={workflowTemplate}
              onChange={e => setWorkflowTemplate(e.target.value)}
              rows={16}
              style={{
                width: "100%", boxSizing: "border-box", fontFamily: "ui-monospace, monospace",
                fontSize: 12.5, lineHeight: 1.5, padding: 10, borderRadius: 8,
                border: "1px solid #E2E8F0", color: "#1E293B", resize: "vertical",
              }}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <button
                onClick={handleSaveWorkflowTemplate}
                disabled={savingTemplate}
                style={{
                  padding: "8px 16px", borderRadius: 8, background: "#1E293B", color: "#fff",
                  fontWeight: 700, fontSize: 13, border: "none", cursor: savingTemplate ? "default" : "pointer",
                  opacity: savingTemplate ? 0.6 : 1,
                }}
              >
                {savingTemplate ? "Speichere…" : "Speichern"}
              </button>
              {templateMsg && (
                <span style={{ fontSize: 12, fontWeight: 600, color: templateMsg.ok ? "#16A34A" : "#DC2626" }}>
                  {templateMsg.text}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* P-88 Schritt 1c: Standardwerte für eBay-Pflichtmerkmale */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🏷️</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>eBay-Pflichtmerkmale — Standardwerte</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
          Rangfolge: AliExpress-Daten/Variantenattribute zuerst, dann der Kategorie-Wert hier, dann der globale Wert hier — ein manuell am Produkt eingetragener Wert gewinnt immer, unabhängig von allen anderen Quellen. Globale Werte gelten für alle Kategorien, Kategorie-Werte haben Vorrang vor dem globalen Wert.
        </p>
        {aspectDefaultsLoading ? (
          <span style={{ fontSize: 13, color: "#94A3B8" }}>Lade…</span>
        ) : (
          <>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", margin: "12px 0 6px" }}>Global</div>
            {Object.entries(aspectDefaults.global).map(([name, value]) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: "#334155", minWidth: 140 }}>{name}</span>
                <input
                  value={value}
                  onChange={e => setAspectDefaults(prev => ({ ...prev, global: { ...prev.global, [name]: e.target.value } }))}
                  onBlur={() => saveAspectDefaults(aspectDefaults)}
                  style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", flex: 1, maxWidth: 220 }}
                />
                <button
                  onClick={() => {
                    const { [name]: _removed, ...rest } = aspectDefaults.global;
                    saveAspectDefaults({ ...aspectDefaults, global: rest });
                  }}
                  style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "none", background: "#FEE2E2", color: "#DC2626", cursor: "pointer" }}
                >
                  Entfernen
                </button>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <input placeholder="Merkmalname (z.B. Farbe)" value={newGlobalName} onChange={e => setNewGlobalName(e.target.value)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", minWidth: 140 }} />
              <input placeholder="Wert" value={newGlobalValue} onChange={e => setNewGlobalValue(e.target.value)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", flex: 1, maxWidth: 220 }} />
              <button
                onClick={() => {
                  if (!newGlobalName.trim() || !newGlobalValue.trim()) return;
                  saveAspectDefaults({ ...aspectDefaults, global: { ...aspectDefaults.global, [newGlobalName.trim()]: newGlobalValue.trim() } });
                  setNewGlobalName(""); setNewGlobalValue("");
                }}
                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, border: "none", background: "#1E293B", color: "#fff", cursor: "pointer" }}
              >
                + Hinzufügen
              </button>
            </div>

            <div style={{ fontSize: 13, fontWeight: 700, color: "#1E293B", margin: "18px 0 6px" }}>Je eBay-Kategorie</div>
            {Object.entries(aspectDefaults.byCategory).map(([catId, values]) => (
              <div key={catId} style={{ border: "1px solid #E2E8F0", borderRadius: 8, padding: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#7C3AED", marginBottom: 6 }}>Kategorie {catId}</div>
                {Object.entries(values).map(([name, value]) => (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: "#334155", minWidth: 140 }}>{name}</span>
                    <input
                      value={value}
                      onChange={e => setAspectDefaults(prev => ({ ...prev, byCategory: { ...prev.byCategory, [catId]: { ...prev.byCategory[catId], [name]: e.target.value } } }))}
                      onBlur={() => saveAspectDefaults(aspectDefaults)}
                      style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", flex: 1, maxWidth: 220 }}
                    />
                    <button
                      onClick={() => {
                        const { [name]: _removed, ...rest } = aspectDefaults.byCategory[catId];
                        const byCategory = { ...aspectDefaults.byCategory, [catId]: rest };
                        if (Object.keys(rest).length === 0) delete byCategory[catId];
                        saveAspectDefaults({ ...aspectDefaults, byCategory });
                      }}
                      style={{ fontSize: 11, padding: "3px 8px", borderRadius: 4, border: "none", background: "#FEE2E2", color: "#DC2626", cursor: "pointer" }}
                    >
                      Entfernen
                    </button>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input placeholder="Kategorie-ID" value={newCatId} onChange={e => setNewCatId(e.target.value)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", width: 100 }} />
              <input placeholder="Merkmalname" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", minWidth: 140 }} />
              <input placeholder="Wert" value={newCatValue} onChange={e => setNewCatValue(e.target.value)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #E2E8F0", flex: 1, maxWidth: 220 }} />
              <button
                onClick={() => {
                  if (!newCatId.trim() || !newCatName.trim() || !newCatValue.trim()) return;
                  saveAspectDefaults({
                    ...aspectDefaults,
                    byCategory: { ...aspectDefaults.byCategory, [newCatId.trim()]: { ...aspectDefaults.byCategory[newCatId.trim()], [newCatName.trim()]: newCatValue.trim() } },
                  });
                  setNewCatId(""); setNewCatName(""); setNewCatValue("");
                }}
                style={{ fontSize: 11, padding: "4px 10px", borderRadius: 4, border: "none", background: "#1E293B", color: "#fff", cursor: "pointer" }}
              >
                + Hinzufügen
              </button>
            </div>
            <div style={{ marginTop: 10, minHeight: 18 }}>
              {savingAspectDefaults && <span style={{ fontSize: 12, color: "#94A3B8" }}>Speichere…</span>}
              {!savingAspectDefaults && aspectDefaultsMsg && (
                <span style={{ fontSize: 12, fontWeight: 600, color: aspectDefaultsMsg.ok ? "#16A34A" : "#DC2626" }}>{aspectDefaultsMsg.text}</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Paket 2 / F2: Mengen-Obergrenze pro Variante */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>📦</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>eBay-Menge pro Variante — Obergrenze</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
          Die Obergrenze schützt vor Überverkauf, wenn der AliExpress-Bestand schneller fällt als der Abgleich läuft. An eBay geht der kleinere Wert aus echtem Bestand und Obergrenze; ein Bestand von 0 bleibt 0.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="number" min={1} step={1} value={maxQty} onChange={e => setMaxQty(e.target.value)}
            style={{ width: 90, padding: "8px 10px", fontSize: 14, border: "2px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" }} />
          <button onClick={saveMaxQty} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none", background: "#16A34A", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Speichern</button>
          {maxQtyMsg && <span style={{ fontSize: 12, fontWeight: 600, color: maxQtyMsg.ok ? "#16A34A" : "#DC2626" }}>{maxQtyMsg.text}</span>}
        </div>
      </div>

      {/* OFFEN 006: Import-Regeln */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>⭐</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>Import-Regeln — Sterne und Varianten</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
          Import nur ab dieser Artikelbewertung (Sterne auf AliExpress). Höchstens so viele Varianten je Angebot — beim Import wählt die App die besten automatisch (Lager ≥ 5, Gewinn ≥ 1,00 €). Gilt nur für neue Importe, gelistete Angebote bleiben unberührt.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>ab <input type="text" inputMode="decimal" value={minRating} onChange={e => setMinRating(e.target.value)}
            style={{ width: 60, padding: "8px 10px", fontSize: 14, border: "2px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" }} /> Sterne</label>
          <label style={{ fontSize: 13 }}>höchstens <input type="number" min={1} step={1} value={maxVariants} onChange={e => setMaxVariants(e.target.value)}
            style={{ width: 60, padding: "8px 10px", fontSize: 14, border: "2px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" }} /> Varianten</label>
          <button onClick={saveRules} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none", background: "#16A34A", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Speichern</button>
          {rulesMsg && <span style={{ fontSize: 12, fontWeight: 600, color: rulesMsg.ok ? "#16A34A" : "#DC2626" }}>{rulesMsg.text}</span>}
        </div>
      </div>

      {/* Multi-Rabatt (Inhaber 18.10.2026) */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🏷️</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>Multi-Rabatt — Mengenrabatt in Euro</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
          So viel ist die ganze Bestellung billiger. Höchstens 3 Stück. eBay rechnet nur ganze Prozent — die App rechnet je Angebot um und prüft den Gewinn je Variante.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13 }}>2 Stück − <input type="text" inputMode="decimal" value={multiEur2} onChange={e => setMultiEur2(e.target.value)}
            style={{ width: 60, padding: "8px 10px", fontSize: 14, border: "2px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" }} /> €</label>
          <label style={{ fontSize: 13 }}>3 Stück − <input type="text" inputMode="decimal" value={multiEur3} onChange={e => setMultiEur3(e.target.value)}
            style={{ width: 60, padding: "8px 10px", fontSize: 14, border: "2px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" }} /> €</label>
          <button onClick={saveMulti} style={{ padding: "8px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none", background: "#16A34A", color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>Speichern</button>
          {multiMsg && <span style={{ fontSize: 12, fontWeight: 600, color: multiMsg.ok ? "#16A34A" : "#DC2626" }}>{multiMsg.text}</span>}
        </div>
        <MultiRabattSendAll />
      </div>

      {/* C2 (Inhaber 25.10.2026): Artikelmerkmale aus AliExpress in die Live-Angebote — nur fehlende, je Klick 10 Angebote */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🧾</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>Artikelmerkmale in Live-Angebote</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 8px" }}>
          Ergänzt nur fehlende Merkmale (Material, Herstellungsland, Füllmaterial, Muster, Form, Maße) — übersetzt und gegen die eBay-Kategorie geprüft. Vorhandene Merkmale, Preise und Mengen bleiben unverändert.
        </p>
        <MerkmaleLive />
      </div>

      {/* P-EINFUHR (24.10.2026): Das frühere Feld "Zollpauschale (Bestellungen-Tab) 3,58 €" floss seit A-014 in keine Rechnung mehr ein
          (order-matching.ts) und führte in die Irre. Ersetzt durch eine reine Anzeige des Werts, mit dem die App überall rechnet. */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🛃</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>Einfuhrabgaben (China)</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: 0 }}>
          Die App rechnet überall (Import, Produkte, Listings, Bestellungen, Preisautomatik) mit <b>{aliEinfuhrEur().toFixed(2).replace(".", ",")} €</b> je
          AliExpress-Bestellung und Artikeltyp: Zoll 3,57 € + EU-Bearbeitungsgebühr 2,38 € (seit 23.10.2026, vorher 3,57 €).
          Mehrere Stück desselben Artikels zahlen die Einfuhr nur einmal.
        </p>
      </div>

      {/* A-029 (P-E01): Elektro Kat. 5 */}
      <ElectricSettingsCard />

      {/* App Info */}
      <div style={{ ...card, background: "#F8FAFC" }}>
        <div style={{ fontSize: 13, color: "#64748B" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span>Version</span><span style={{ fontWeight: 600, color: "#1E293B" }}>v1.41</span>
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

type MerkmaleRow = { productId: number; error?: string; rows?: Array<{ target: string; added: Record<string, string>; written: boolean; verified?: boolean; error?: string }> };
function MerkmaleLive() {
  const [offset, setOffset] = useState(0);
  const [res, setRes] = useState<{ gesamt?: number; naechsterOffset?: number | null; results?: MerkmaleRow[]; mode?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const call = async (confirm: boolean) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/products/merkmale-live-all", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ confirm, offset }) });
      const d = await r.json() as { error?: string; gesamt?: number; naechsterOffset?: number | null; results?: MerkmaleRow[]; mode?: string };
      if (d.error) setErr(d.error); else setRes(d);
    } catch { setErr("Netzwerkfehler"); } finally { setBusy(false); }
  };
  const btn = (bg: string) => ({ padding: "8px 14px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none", background: bg, color: "#fff", cursor: busy ? "wait" : "pointer", fontFamily: "inherit" } as const);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button disabled={busy} onClick={() => call(false)} style={btn("#2563EB")}>Vorschau (10 ab Nr. {offset + 1})</button>
        <button disabled={busy || !res || res.mode !== "preview"} onClick={() => call(true)} style={btn("#16A34A")}>Diese 10 an eBay schreiben</button>
        <button disabled={busy || res?.naechsterOffset == null} onClick={() => { if (res?.naechsterOffset != null) { setOffset(res.naechsterOffset); setRes(null); } }} style={btn("#64748B")}>Nächste 10</button>
        {res?.gesamt != null && <span style={{ fontSize: 12, color: "#334155" }}>{res.gesamt} Angebote mit Merkmalen</span>}
        {err && <span style={{ fontSize: 12, color: "#DC2626" }}>{err}</span>}
      </div>
      {res?.results && (
        <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8, fontSize: 12 }}>
          {res.results.map(r => {
            const first = r.rows?.[0];
            const added = first ? Object.entries(first.added).map(([k, v]) => `${k}: ${v}`).join(", ") : "";
            const status = r.error ? `⚠ ${r.error}` : res.mode === "apply" ? (r.rows?.every(x => x.written || Object.keys(x.added).length === 0) ? (r.rows?.every(x => x.verified !== false) ? "✓ geschrieben" : "geschrieben, Rücklese-Abweichung") : `Fehler: ${r.rows?.find(x => x.error)?.error ?? ""}`) : (added ? "würde ergänzen" : "nichts zu ergänzen");
            return <div key={r.productId} style={{ padding: "3px 0", color: r.error ? "#B45309" : "#1E293B" }}>stele-{r.productId}: {status}{added ? ` · ${added}` : ""}</div>;
          })}
        </div>
      )}
    </div>
  );
}

// Inhaber 25.10.2026: nach einer Regeländerung alle Angebote neu senden — erst Vorschau, dann Senden (je Klick höchstens 15).
type SendAllRowUi = { productId: number; neu: { 2: number; 3: number } | null; bisher: { 2: number; 3: number } | null; aktion: string; grund?: string; ergebnis?: string };
function MultiRabattSendAll() {
  const [rows, setRows] = useState<SendAllRowUi[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const call = async (apply: boolean) => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/multi-rabatt/send-all", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ apply }) });
      const d = await r.json() as { ok?: boolean; error?: string; rows?: SendAllRowUi[]; zuSenden?: number; rest?: number };
      if (!d.ok) { setMsg(d.error || "Fehler"); return; }
      setRows(d.rows ?? []);
      setMsg(apply ? `Gesendet/beendet. Noch offen: ${d.rest ?? 0} — bei Bedarf erneut klicken.` : `Vorschau: ${d.zuSenden ?? 0} Angebote würden gesendet oder beendet.`);
    } catch { setMsg("Netzwerkfehler"); } finally { setBusy(false); }
  };
  const btn = (bg: string) => ({ padding: "8px 14px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none", background: bg, color: "#fff", cursor: busy ? "wait" : "pointer", fontFamily: "inherit" } as const);
  const pct = (p: { 2: number; 3: number } | null) => (p ? `${p[2]} % / ${p[3]} %` : "—");
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid #E2E8F0", paddingTop: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button disabled={busy} onClick={() => call(false)} style={btn("#2563EB")}>Alle Angebote: Vorschau</button>
        <button disabled={busy || !rows || !rows.some(r => r.aktion === "senden" || r.aktion === "beenden")} onClick={() => call(true)} style={btn("#16A34A")}>An eBay senden (max. 15)</button>
        {msg && <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>{msg}</span>}
      </div>
      {rows && (
        <div style={{ maxHeight: 260, overflowY: "auto", marginTop: 8, fontSize: 12 }}>
          {rows.map(r => (
            <div key={r.productId} style={{ padding: "3px 0", color: r.aktion === "nicht sendbar" ? "#B45309" : r.aktion === "beenden" ? "#DC2626" : r.aktion === "senden" ? "#1E293B" : "#94A3B8" }}>
              stele-{r.productId}: {r.aktion} · neu {pct(r.neu)} · bisher {pct(r.bisher)}{r.grund ? ` · ${r.grund}` : ""}{r.ergebnis ? ` · ${r.ergebnis}` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
