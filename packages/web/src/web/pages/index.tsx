import { useState } from "react";
import { Calculator, TrendingDown, Euro, Percent, Copy, Check, ShoppingCart, Tag, RefreshCw, AlertCircle, CheckCircle } from "lucide-react";
import { safeJson } from "../lib/safeFetch";

function formatEuro(val: number) {
  return val.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
}

const ABLEHNUNGS_VORLAGEN = [
  `vielen Dank für Ihren Vorschlag. Leider können wir den Preis nicht weiter senken. Der aktuelle Preis ist unser letztes Angebot.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
  `danke für Ihr Interesse. Ihr Preisvorschlag liegt leider unter unserer Grenze. Der Preis ist nicht verhandelbar.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
  `vielen Dank für Ihren Vorschlag. Wir können diesen leider nicht annehmen. Der Preis ist bereits das Minimum.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
];

const NULLGEWINN_VORLAGEN = [
  `vielen Dank für Ihren Vorschlag. Dies ist unser letztes Angebot – wir können den Preis nicht weiter reduzieren. Bitte teilen Sie uns mit, ob Sie zu diesem Preis kaufen möchten.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
  `danke für Ihr Interesse. Der aktuelle Preis ist unser absolutes Limit. Ein weiteres Entgegenkommen ist leider nicht möglich.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
  `vielen Dank für Ihren Vorschlag. Dies ist unser finales Angebot und kann nicht weiter unterschritten werden. Wir freuen uns auf Ihre Rückmeldung.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
  `herzlichen Dank für Ihr Interesse. Der Preis ist unser letztes Wort – eine weitere Reduzierung ist ausgeschlossen.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
];

const VERLUST_VORLAGEN = [
  `vielen Dank für Ihr Angebot. Zu diesem Preis ist ein Verkauf für uns leider nicht möglich, da wir damit Verlust machen würden. Bitte haben Sie Verständnis.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
  `herzlichen Dank für Ihren Vorschlag. Dieser Preis liegt unter unseren Einkaufskosten, daher können wir ihn leider nicht annehmen.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
  `vielen Dank für Ihr Interesse. Zu diesem Preis arbeiten wir leider unter Selbstkosten. Ein Verkauf ist uns nicht möglich.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
  `danke für Ihren Preisvorschlag. Leider deckt dieser nicht unsere Kosten. Wir können den Artikel zu diesem Preis nicht verkaufen.\n\nMit freundlichen Grüßen\nstele-e-transfer`,
];

function Ampel({ gewinnProzent }: { gewinnProzent: number | null }) {
  if (gewinnProzent === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        {["#1a1a1a", "#1a1a1a", "#1a1a1a"].map((c, i) => (
          <div key={i} style={{ width: 52, height: 52, borderRadius: "50%", background: c, border: "2px solid #333" }} />
        ))}
      </div>
    );
  }
  const isGreen = gewinnProzent >= 1;
  const isYellow = gewinnProzent >= 0 && gewinnProzent < 1;
  const isRed = gewinnProzent < 0;

  return (
    <div style={{
      background: "#1a1a1a", borderRadius: 20, padding: "18px 14px",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
      border: "2px solid #2a2a2a", boxShadow: "0 4px 20px rgba(0,0,0,0.3)"
    }}>
      {/* Rot */}
      <div style={{
        width: 52, height: 52, borderRadius: "50%",
        background: isRed ? "#EF4444" : "#2a1a1a",
        boxShadow: isRed ? "0 0 18px rgba(239,68,68,0.7)" : "none",
        border: `2px solid ${isRed ? "#EF4444" : "#3a2a2a"}`,
        transition: "all 0.3s"
      }} />
      {/* Gelb */}
      <div style={{
        width: 52, height: 52, borderRadius: "50%",
        background: isYellow ? "#F59E0B" : "#1a1a0a",
        boxShadow: isYellow ? "0 0 18px rgba(245,158,11,0.7)" : "none",
        border: `2px solid ${isYellow ? "#F59E0B" : "#2a2a1a"}`,
        transition: "all 0.3s"
      }} />
      {/* Grün */}
      <div style={{
        width: 52, height: 52, borderRadius: "50%",
        background: isGreen ? "#22C55E" : "#0a1a0a",
        boxShadow: isGreen ? "0 0 18px rgba(34,197,94,0.7)" : "none",
        border: `2px solid ${isGreen ? "#22C55E" : "#1a2a1a"}`,
        transition: "all 0.3s"
      }} />
    </div>
  );
}

export default function Index() {
  const [listenpreis, setListenpreis] = useState("");
  const [vorschlag, setVorschlag] = useState("");
  const [gebuehr, setGebuehr] = useState("17");
  const [einkauf, setEinkauf] = useState("");
  const [anzeigegebuehr, setAnzeigegebuehr] = useState("");

  const [copied, setCopied] = useState(false);
  const [copiedVerlust, setCopiedVerlust] = useState(false);
  const [copiedNull, setCopiedNull] = useState(false);
  const [vorlageIndex, setVorlageIndex] = useState(0);
  const [verlustVorlageIndex, setVerlustVorlageIndex] = useState(0);
  const [nullVorlageIndex, setNullVorlageIndex] = useState(0);

  // Preisüberwachung — Background-Job mit Polling
  const [priceChecking, setPriceChecking] = useState(false);
  const [priceCheckResult, setPriceCheckResult] = useState<{
    checked?: number;
    results: { id: number; title: string; status: string; oldPrice?: number | null; newPrice?: number }[];
  } | null>(null);
  const [priceCheckError, setPriceCheckError] = useState("");
  const [priceProgress, setPriceProgress] = useState<{ done: number; total: number; changed: number } | null>(null);

  const handleCheckAllPrices = async () => {
    setPriceChecking(true);
    setPriceCheckResult(null);
    setPriceCheckError("");
    setPriceProgress(null);
    try {
      // Job starten — antwortet sofort mit jobId
      const { jobId, total } = await safeJson<{ jobId: string; total: number }>("/api/products/check-all-prices", { method: "POST" });
      setPriceProgress({ done: 0, total, changed: 0 });

      // Polling alle 3s bis fertig
      const poll = async (): Promise<void> => {
        const job = await safeJson<{ status: string; done: number; total: number; changed: number; results?: typeof priceCheckResult extends null ? never : NonNullable<typeof priceCheckResult>["results"] }>(`/api/products/price-job/${jobId}`);
        setPriceProgress({ done: job.done, total: job.total, changed: job.changed });
        if (job.status === 'done') {
          setPriceCheckResult({ checked: job.total, results: job.results ?? [] });
          setPriceChecking(false);
        } else {
          setTimeout(poll, 3000);
        }
      };
      setTimeout(poll, 3000);
    } catch (e) {
      setPriceCheckError(e instanceof Error ? e.message : "Fehler");
      setPriceChecking(false);
    }
  };

  const listen = parseFloat(listenpreis.replace(",", ".")) || 0;
  const vorschlagVal = parseFloat(vorschlag.replace(",", ".")) || 0;
  const einkaufVal = parseFloat(einkauf.replace(",", ".")) || 0;
  const anzeigegebuehrProzent = (parseFloat(anzeigegebuehr.replace(",", ".")) || 0) / 100;
  const verkaufBrutto = vorschlagVal > 0 ? vorschlagVal : listen;

  const EBAY_FEE_NETTO = (parseFloat(gebuehr.replace(",", ".")) || 18) / 100;
  const MWST = 1.19;
  // Alle Gebühren inkl. 19% MwSt.
  const EBAY_FEE = EBAY_FEE_NETTO * MWST;
  const FIXBETRAG = 0.45 * MWST; // 0,45 € + 19% MwSt. = 0,5355 €

  // Anzeigegebühr: % vom Listenpreis, inkl. MwSt.
  const anzeigegebuehrVal = verkaufBrutto * anzeigegebuehrProzent * MWST;

  // Netto = was du bekommst nach allen eBay-Gebühren (Provision % + Fixbetrag)
  const nettoListen = listen > 0 ? listen * (1 - EBAY_FEE) - FIXBETRAG : 0;
  const nettoVorschlag = vorschlagVal > 0 ? vorschlagVal * (1 - EBAY_FEE) - FIXBETRAG : 0;
  const rabattProzent = listen > 0 ? ((listen - vorschlagVal) / listen) * 100 : 0;
  const differenz = nettoListen - nettoVorschlag;

  // Gewinn basierend auf Vorschlag (wenn vorhanden) sonst Listenpreis
  const verkaufNetto = vorschlagVal > 0 ? nettoVorschlag : nettoListen;
  const gesamtGebuehren = verkaufBrutto * EBAY_FEE + FIXBETRAG + anzeigegebuehrVal;
  const gewinn = einkaufVal > 0 ? verkaufNetto - einkaufVal - anzeigegebuehrVal : null;
  const gewinnProzent = einkaufVal > 0
    ? ((verkaufNetto - einkaufVal - anzeigegebuehrVal) / einkaufVal) * 100
    : null;

  const hasResult = listen > 0 && vorschlagVal > 0;
  const istZuNiedrig = hasResult && rabattProzent > 20;

  let bewertung: { label: string; color: string; bg: string; borderColor: string } | null = null;
  if (hasResult) {
    if (rabattProzent <= 5) {
      bewertung = { label: "Super Deal – annehmen!", color: "#16a34a", bg: "#f0fdf4", borderColor: "#86efac" };
    } else if (rabattProzent <= 12) {
      bewertung = { label: "OK – kannst annehmen", color: "#ca8a04", bg: "#fefce8", borderColor: "#fde047" };
    } else if (rabattProzent <= 20) {
      bewertung = { label: "Grenzwertig – überlege gut", color: "#ea580c", bg: "#fff7ed", borderColor: "#fdba74" };
    } else {
      bewertung = { label: "Zu wenig – ablehnen", color: "#dc2626", bg: "#fef2f2", borderColor: "#fca5a5" };
    }
  }

  const minPreis80 = listen > 0 ? (nettoListen * 0.8) / (1 - EBAY_FEE) : 0;

  const handleCopy = () => {
    navigator.clipboard.writeText("Sehr geehrte Damen und Herren,\n\n" + ABLEHNUNGS_VORLAGEN[vorlageIndex]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyVerlust = () => {
    navigator.clipboard.writeText("Sehr geehrte Damen und Herren,\n\n" + VERLUST_VORLAGEN[verlustVorlageIndex]);
    setCopiedVerlust(true);
    setTimeout(() => setCopiedVerlust(false), 2000);
  };

  const handleNeueVerlustVorlage = () => {
    setVerlustVorlageIndex((verlustVorlageIndex + 1) % VERLUST_VORLAGEN.length);
  };

  const handleCopyNull = () => {
    navigator.clipboard.writeText("Sehr geehrte Damen und Herren,\n\n" + NULLGEWINN_VORLAGEN[nullVorlageIndex]);
    setCopiedNull(true);
    setTimeout(() => setCopiedNull(false), 2000);
  };

  const inputStyle = {
    width: "100%", padding: "12px 14px 12px 36px", fontSize: 18,
    fontWeight: 600, border: "2px solid #E2E8F0", borderRadius: 12,
    outline: "none", fontFamily: "inherit", boxSizing: "border-box" as const,
    color: "#0F172A", background: "#F8FAFC", transition: "border-color 0.2s"
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: 16, background: "#3B82F6",
            marginBottom: 12, boxShadow: "0 4px 14px rgba(59,130,246,0.35)"
          }}>
            <Calculator size={28} color="white" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", margin: 0 }}>STELE-DS-APP</h1>
          <p style={{ color: "#64748B", marginTop: 4, fontSize: 14 }}>stele-e-transfer</p>
        </div>

        {/* Eingabe-Card mit Ampel */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "flex-start" }}>
          {/* Felder */}
          <div style={{
            flex: 1, background: "#fff", borderRadius: 20, padding: 24,
            boxShadow: "0 2px 16px rgba(0,0,0,0.07)"
          }}>
            {/* eBay Gebühr */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontWeight: 600, color: "#0F172A", marginBottom: 8, fontSize: 14 }}>
                eBay Gebühr (%)
              </label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontWeight: 600 }}>%</span>
                <input
                  type="number" inputMode="decimal" placeholder="18" value={gebuehr}
                  onChange={e => setGebuehr(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: 14, paddingRight: 36 }}
                  onFocus={e => (e.target.style.borderColor = "#3B82F6")}
                  onBlur={e => (e.target.style.borderColor = "#E2E8F0")}
                />
              </div>
            </div>

            {/* eBay Anzeigegebühr */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "#0F172A", marginBottom: 8, fontSize: 14 }}>
                <Tag size={15} color="#8B5CF6" />
                eBay Anzeigegebühr (%)
              </label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontWeight: 600 }}>%</span>
                <input
                  type="number" inputMode="decimal" placeholder="z.B. 6" value={anzeigegebuehr}
                  onChange={e => setAnzeigegebuehr(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: 14, paddingRight: 36 }}
                  onFocus={e => (e.target.style.borderColor = "#8B5CF6")}
                  onBlur={e => (e.target.style.borderColor = "#E2E8F0")}
                />
              </div>
            </div>

            {/* Amazon Einkaufspreis */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "#0F172A", marginBottom: 8, fontSize: 14 }}>
                <ShoppingCart size={15} color="#F97316" />
                Amazon Einkaufspreis (€)
              </label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontWeight: 600 }}>€</span>
                <input
                  type="number" inputMode="decimal" placeholder="z.B. 45,00" value={einkauf}
                  onChange={e => setEinkauf(e.target.value)}
                  style={inputStyle}
                  onFocus={e => (e.target.style.borderColor = "#F97316")}
                  onBlur={e => (e.target.style.borderColor = "#E2E8F0")}
                />
              </div>
              {gewinn !== null && (
                <p style={{ fontSize: 13, marginTop: 6, fontWeight: 600, color: gewinn >= 0 ? "#16a34a" : "#dc2626" }}>
                  Gewinn: {formatEuro(gewinn)} ({gewinnProzent!.toFixed(1)}%)
                </p>
              )}
            </div>

            {/* Listenpreis */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", fontWeight: 600, color: "#0F172A", marginBottom: 8, fontSize: 14 }}>
                eBay Listenpreis (€)
              </label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontWeight: 600 }}>€</span>
                <input
                  type="number" inputMode="decimal" placeholder="z.B. 85,00" value={listenpreis}
                  onChange={e => setListenpreis(e.target.value)}
                  style={inputStyle}
                  onFocus={e => (e.target.style.borderColor = "#3B82F6")}
                  onBlur={e => (e.target.style.borderColor = "#E2E8F0")}
                />
              </div>
              {listen > 0 && (
                <p style={{ color: "#64748B", fontSize: 13, marginTop: 6 }}>
                  Netto nach eBay: <strong style={{ color: "#0F172A" }}>{formatEuro(nettoListen)}</strong>
                </p>
              )}
            </div>

            {/* Preisvorschlag */}
            <div>
              <label style={{ display: "block", fontWeight: 600, color: "#0F172A", marginBottom: 8, fontSize: 14 }}>
                Preisvorschlag vom Käufer (€)
              </label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#94A3B8", fontWeight: 600 }}>€</span>
                <input
                  type="number" inputMode="decimal" placeholder="z.B. 70,00" value={vorschlag}
                  onChange={e => setVorschlag(e.target.value)}
                  style={inputStyle}
                  onFocus={e => (e.target.style.borderColor = "#3B82F6")}
                  onBlur={e => (e.target.style.borderColor = "#E2E8F0")}
                />
              </div>
            </div>
          </div>

          {/* Ampel */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 16, gap: 8 }}>
            <Ampel gewinnProzent={gewinnProzent} />
            {gewinnProzent !== null && (
              <span style={{
                fontSize: 11, fontWeight: 700, color:
                  gewinnProzent >= 1 ? "#22C55E" : gewinnProzent >= 0 ? "#F59E0B" : "#EF4444",
                textAlign: "center"
              }}>
                {gewinnProzent >= 1 ? "Gewinn" : gewinnProzent >= 0 ? "Null" : "Verlust"}
              </span>
            )}
          </div>
        </div>

        {/* Ergebnis */}
        {hasResult && bewertung && (
          <>
            <div style={{
              background: bewertung.bg, border: `2px solid ${bewertung.borderColor}`,
              borderRadius: 16, padding: "16px 20px", marginBottom: 16,
              display: "flex", alignItems: "center", gap: 10
            }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: bewertung.color, flexShrink: 0 }} />
              <span style={{ fontWeight: 700, fontSize: 16, color: bewertung.color }}>{bewertung.label}</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div style={{ background: "#fff", borderRadius: 16, padding: 18, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Euro size={16} color="#3B82F6" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Du bekommst</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#0F172A" }}>{formatEuro(nettoVorschlag)}</div>
                <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>nach eBay inkl. MwSt.</div>
              </div>

              <div style={{ background: "#fff", borderRadius: 16, padding: 18, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Percent size={16} color="#F59E0B" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Rabatt</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#0F172A" }}>-{rabattProzent.toFixed(1)}%</div>
                <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>vom Listenpreis</div>
              </div>

              <div style={{ background: "#fff", borderRadius: 16, padding: 18, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <TrendingDown size={16} color="#EF4444" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>Verlust vs. Liste</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#EF4444" }}>-{formatEuro(differenz)}</div>
                <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>vs. Listenpreis netto</div>
              </div>

              <div style={{ background: "#fff", borderRadius: 16, padding: 18, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <Euro size={16} color="#8B5CF6" />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#64748B", textTransform: "uppercase" as const, letterSpacing: "0.05em" }}>eBay nimmt</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: "#0F172A" }}>{formatEuro(gesamtGebuehren)}</div>
                <div style={{ fontSize: 12, color: "#94A3B8", marginTop: 2 }}>
                  {gebuehr || 18}% + 0,45 € Fix{anzeigegebuehrProzent > 0 ? ` + ${anzeigegebuehr}% Anzeige` : ""} (inkl. 19% MwSt.)
                </div>
              </div>
            </div>

            {/* Untergrenze */}
            {listen > 0 && (
              <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: 14, padding: "14px 18px", marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 13, color: "#1E40AF", fontWeight: 500 }}>
                  💡 Untergrenze: Geh nicht unter{" "}
                  <strong>{formatEuro(Math.ceil(minPreis80 * 100) / 100)}</strong> —
                  darunter verlierst du mehr als 20% deines Netto-Erlöses.
                </p>
              </div>
            )}

            {/* Letztes Angebot – wenn Gelb (0% bis 1%) */}
            {gewinnProzent !== null && gewinnProzent >= 0 && gewinnProzent < 1 && (
              <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", border: "2px solid #FDE68A", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#B45309" }}>🟡 Letztes Angebot – Nachricht an Käufer</span>
                  <button
                    onClick={() => setNullVorlageIndex((nullVorlageIndex + 1) % NULLGEWINN_VORLAGEN.length)}
                    style={{ background: "#F1F5F9", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Andere Vorlage
                  </button>
                </div>
                <div style={{ background: "#FFFBEB", borderRadius: 12, padding: "14px 16px", fontSize: 13, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 14, border: "1px solid #FDE68A" }}>
                  {"Sehr geehrte Damen und Herren,\n\n" + NULLGEWINN_VORLAGEN[nullVorlageIndex]}
                </div>
                <button
                  onClick={handleCopyNull}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 12, border: "none", background: copiedNull ? "#22C55E" : "#F59E0B", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit", transition: "background 0.2s" }}
                >
                  {copiedNull ? <Check size={18} /> : <Copy size={18} />}
                  {copiedNull ? "Kopiert!" : "Text kopieren"}
                </button>
              </div>
            )}

            {/* Verlust-Nachricht – wenn unter 0% Gewinn */}
            {gewinnProzent !== null && gewinnProzent < 0 && (
              <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", border: "2px solid #FCA5A5", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#DC2626" }}>🔴 Verlust – Nachricht an Käufer</span>
                  <button
                    onClick={handleNeueVerlustVorlage}
                    style={{ background: "#F1F5F9", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Andere Vorlage
                  </button>
                </div>
                <div style={{ background: "#FEF2F2", borderRadius: 12, padding: "14px 16px", fontSize: 13, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 14, border: "1px solid #FECACA" }}>
                  {"Sehr geehrte Damen und Herren,\n\n" + VERLUST_VORLAGEN[verlustVorlageIndex]}
                </div>
                <button
                  onClick={handleCopyVerlust}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 12, border: "none", background: copiedVerlust ? "#22C55E" : "#DC2626", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit", transition: "background 0.2s" }}
                >
                  {copiedVerlust ? <Check size={18} /> : <Copy size={18} />}
                  {copiedVerlust ? "Kopiert!" : "Text kopieren"}
                </button>
              </div>
            )}

            {/* Ablehnungs-Vorlage */}
            {istZuNiedrig && (
              <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", border: "2px solid #FECACA" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#DC2626" }}>Ablehnungs-Nachricht</span>
                  <button
                    onClick={() => setVorlageIndex((vorlageIndex + 1) % ABLEHNUNGS_VORLAGEN.length)}
                    style={{ background: "#F1F5F9", border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "#475569", cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Andere Vorlage
                  </button>
                </div>
                <div style={{ background: "#FEF2F2", borderRadius: 12, padding: "14px 16px", fontSize: 13, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap", marginBottom: 14, border: "1px solid #FECACA" }}>
                  {"Sehr geehrte Damen und Herren,\n\n" + ABLEHNUNGS_VORLAGEN[vorlageIndex]}
                </div>
                <button
                  onClick={handleCopy}
                  style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "12px 0", borderRadius: 12, border: "none", background: copied ? "#22C55E" : "#DC2626", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer", fontFamily: "inherit", transition: "background 0.2s" }}
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />}
                  {copied ? "Kopiert!" : "Text kopieren"}
                </button>
              </div>
            )}
          </>
        )}

        {!hasResult && (
          <div style={{ textAlign: "center", color: "#94A3B8", padding: "24px 0", fontSize: 14 }}>
            Gib beide Preise ein um das Ergebnis zu sehen
          </div>
        )}

        <p style={{ textAlign: "center", color: "#CBD5E1", fontSize: 12, marginTop: 24 }}>
          eBay: {gebuehr || 18}% + 0,45 € Fix + 19% MwSt.{anzeigegebuehrProzent > 0 ? ` + ${anzeigegebuehr}% Anzeige` : ""} · stele-e-transfer
        </p>

        {/* ─── Preisüberwachung ──────────────────────────────────────────────────── */}
        <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginTop: 24, border: "1.5px solid #E2E8F0" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, color: "#0F172A", display: "flex", alignItems: "center", gap: 8 }}>
                <TrendingDown size={18} color="#8B5CF6" /> Preisüberwachung
              </div>
              <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>AliExpress Preise aller Produkte prüfen</div>
            </div>
            <button
              onClick={handleCheckAllPrices}
              disabled={priceChecking}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "10px 18px", borderRadius: 12, border: "none",
                background: priceChecking ? "#EDE9FE" : "#8B5CF6",
                color: priceChecking ? "#8B5CF6" : "#fff",
                fontWeight: 700, fontSize: 13, cursor: priceChecking ? "not-allowed" : "pointer",
                fontFamily: "inherit", transition: "all 0.2s",
              }}
            >
              <RefreshCw size={15} style={priceChecking ? { animation: "spin 1s linear infinite" } : {}} />
              {priceChecking ? "Prüfe..." : "Jetzt prüfen"}
            </button>
          </div>

          {/* Fortschrittsbalken */}
          {priceChecking && priceProgress && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#64748B", marginBottom: 6 }}>
                <span>{priceProgress.done} / {priceProgress.total} geprüft</span>
                <span style={{ color: "#F59E0B", fontWeight: 700 }}>{priceProgress.changed} geändert</span>
              </div>
              <div style={{ background: "#E2E8F0", borderRadius: 99, height: 8, overflow: "hidden" }}>
                <div style={{
                  background: "linear-gradient(90deg, #8B5CF6, #A78BFA)",
                  height: "100%", borderRadius: 99,
                  width: `${Math.round((priceProgress.done / (priceProgress.total || 1)) * 100)}%`,
                  transition: "width 0.5s ease",
                }} />
              </div>
            </div>
          )}

          {priceCheckError && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FEF2F2", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#DC2626", fontWeight: 600 }}>
              <AlertCircle size={15} /> {priceCheckError}
            </div>
          )}

          {priceCheckResult && (
            <div>
              {/* Zusammenfassung */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
                {[
                  { label: "Geprüft", value: priceCheckResult.results.filter(r => r.status !== "skipped").length, color: "#8B5CF6", bg: "#F5F3FF" },
                  { label: "Geändert", value: priceCheckResult.results.filter(r => r.status === "changed").length, color: "#F59E0B", bg: "#FFFBEB" },
                  { label: "Übersprungen", value: priceCheckResult.results.filter(r => r.status === "skipped").length, color: "#94A3B8", bg: "#F8FAFC" },
                ].map(s => (
                  <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 11, color: "#64748B" }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Geänderte Preise */}
              {priceCheckResult.results.filter(r => r.status === "changed").length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Preisänderungen</div>
                  {priceCheckResult.results.filter(r => r.status === "changed").map(r => (
                    <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FFFBEB", borderRadius: 10, padding: "10px 14px", marginBottom: 6, border: "1px solid #FDE68A" }}>
                      <div style={{ fontSize: 12, color: "#374151", flex: 1, marginRight: 12 }}>{r.title?.slice(0, 50)}…</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", whiteSpace: "nowrap" }}>
                        {r.oldPrice?.toFixed(2)} € → {r.newPrice?.toFixed(2)} €
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {priceCheckResult.results.filter(r => r.status === "changed").length === 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F0FDF4", borderRadius: 10, padding: "12px 14px", fontSize: 13, color: "#16A34A", fontWeight: 600 }}>
                  <CheckCircle size={15} /> Alle Preise aktuell — keine Änderungen
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
