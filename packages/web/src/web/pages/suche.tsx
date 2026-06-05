/**
 * Suche-Tab — AliExpress DE-Lager Produkte suchen via DSers & Spocket
 */
import { useState } from "react";
import { Search, ExternalLink, Package, Zap } from "lucide-react";

const PLATFORMS = [
  {
    id: "dsers",
    name: "DSers",
    desc: "AliExpress offiziell · DE/EU Lager Filter",
    color: "#FF6B00",
    icon: "🔶",
    free: true,
    buildUrl: (q: string) =>
      `https://www.dsers.com/app/find-suppliers?productName=${encodeURIComponent(q)}&shipFromCountry=DE`,
    fallbackUrl: (q: string) =>
      `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}&shipCountry=de&localDelivery=y&ship_from_country=DE`,
    tip: "Kostenlos · Direkt mit AliExpress verknüpft · Local+ DE Filter eingebaut",
  },
  {
    id: "cj",
    name: "CJ Dropshipping",
    desc: "EU/DE Lager · Kein Kreditkarte nötig",
    color: "#00A650",
    icon: "🟢",
    free: true,
    buildUrl: (q: string) =>
      `https://app.cjdropshipping.com/search.html#/?searchKey=${encodeURIComponent(q)}`,
    fallbackUrl: (q: string) =>
      `https://app.cjdropshipping.com/search.html#/?searchKey=${encodeURIComponent(q)}`,
    tip: "Kostenlos · EU/DE Lager · Kein Kreditkarte nötig · Direkter Import",
  },
  {
    id: "aliexpress",
    name: "AliExpress DE",
    desc: "Direkt · Lager Deutschland Filter",
    color: "#E53E3E",
    icon: "🔴",
    free: true,
    buildUrl: (q: string) =>
      `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}&shipCountry=de&ship_from_country=DE&SortType=total_tranAmount_sort`,
    fallbackUrl: (q: string) =>
      `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}&ship_from_country=DE`,
    tip: "Direkt auf AliExpress · Ship from DE Filter voreingestellt · Meist günstigste Preise",
  },
  {
    id: "eprolo",
    name: "Eprolo",
    desc: "EU/DE Lager · Kostenlos · Kein Kreditkarte",
    color: "#0EA5E9",
    icon: "🔵",
    free: true,
    buildUrl: (q: string) =>
      `https://www.eprolo.com/search/?q=${encodeURIComponent(q)}`,
    fallbackUrl: (q: string) =>
      `https://www.eprolo.com/search/?q=${encodeURIComponent(q)}`,
    tip: "Kostenlos · EU/DE Lager · Direkte eBay Integration möglich",
  },
];

export default function Suche() {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");

  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    setSubmitted(q);
  };

  const openPlatform = (platform: typeof PLATFORMS[0]) => {
    const q = submitted || query.trim();
    if (!q) return;
    window.open(platform.buildUrl(q), "_blank");
  };

  const openAll = () => {
    const q = submitted || query.trim();
    if (!q) return;
    PLATFORMS.forEach((p, i) => {
      setTimeout(() => window.open(p.buildUrl(q), "_blank"), i * 300);
    });
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#F8FAFC",
      fontFamily: "'Poppins', sans-serif", padding: "24px 16px",
    }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: 16, background: "#7C3AED",
            marginBottom: 12, boxShadow: "0 4px 14px rgba(124,58,237,0.35)",
          }}>
            <Search size={28} color="white" />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#0F172A", margin: 0 }}>
            Produkt-Suche
          </h1>
          <p style={{ color: "#64748B", marginTop: 4, fontSize: 13 }}>
            DE/EU Lager auf DSers, CJ Dropshipping, Eprolo & AliExpress
          </p>
        </div>

        {/* Suchfeld */}
        <div style={{
          background: "#fff", borderRadius: 20, padding: 20,
          boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16,
        }}>
          <label style={{
            display: "block", fontSize: 12, fontWeight: 700,
            color: "#64748B", marginBottom: 8,
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            Suchbegriff
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={16} color="#94A3B8" style={{
                position: "absolute", left: 13, top: "50%",
                transform: "translateY(-50%)", pointerEvents: "none",
              }} />
              <input
                type="text"
                placeholder="z.B. Grillmatte, Staubsauger, Handyhülle..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                style={{
                  width: "100%", padding: "13px 16px 13px 38px",
                  fontSize: 14, fontWeight: 500,
                  border: "2px solid #E2E8F0", borderRadius: 12,
                  outline: "none", fontFamily: "inherit",
                  boxSizing: "border-box", color: "#0F172A", background: "#F8FAFC",
                }}
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={!query.trim()}
              style={{
                padding: "13px 18px", borderRadius: 12, border: "none",
                background: !query.trim() ? "#C4B5FD" : "#7C3AED",
                color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: !query.trim() ? "not-allowed" : "pointer",
                fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >
              Suchen
            </button>
          </div>

          {/* Schnellvorschläge */}
          <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["Grillmatte", "Handyhülle", "LED Streifen", "Küchen Organizer", "Yoga Matte", "Bluetooth Lautsprecher"].map(s => (
              <button
                key={s}
                onClick={() => { setQuery(s); setSubmitted(s); }}
                style={{
                  padding: "5px 12px", borderRadius: 20,
                  border: "1.5px solid #E2E8F0", background: "#F8FAFC",
                  fontSize: 12, fontWeight: 600, color: "#475569",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Plattformen */}
        {submitted && (
          <>
            {/* Alle öffnen */}
            <button
              onClick={openAll}
              style={{
                width: "100%", padding: "14px 0", borderRadius: 14,
                border: "none", background: "linear-gradient(135deg, #FF6B00, #7C3AED)",
                color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: "pointer", fontFamily: "inherit",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                marginBottom: 16, boxShadow: "0 4px 14px rgba(124,58,237,0.3)",
              }}
            >
              <Zap size={18} />
              Alle 4 Plattformen gleichzeitig öffnen

            </button>

            <p style={{ fontSize: 12, color: "#94A3B8", textAlign: "center", marginTop: -10, marginBottom: 16 }}>
              Suche nach: <strong style={{ color: "#0F172A" }}>„{submitted}"</strong>
            </p>

            {/* Plattform Cards */}
            {PLATFORMS.map(platform => (
              <div
                key={platform.id}
                style={{
                  background: "#fff", borderRadius: 20, padding: 20,
                  boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 12,
                  border: `2px solid transparent`,
                  transition: "border-color 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: `${platform.color}15`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 22,
                  }}>
                    {platform.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700, fontSize: 16, color: "#0F172A" }}>
                        {platform.name}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 8px",
                        borderRadius: 20, background: "#F0FDF4", color: "#16A34A",
                        border: "1px solid #BBF7D0",
                      }}>
                        KOSTENLOS
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "#64748B", marginTop: 2 }}>
                      {platform.desc}
                    </p>
                  </div>
                </div>

                <p style={{
                  margin: "0 0 12px", fontSize: 12, color: "#64748B",
                  background: "#F8FAFC", borderRadius: 10, padding: "8px 12px",
                  lineHeight: 1.5,
                }}>
                  💡 {platform.tip}
                </p>

                <button
                  onClick={() => openPlatform(platform)}
                  style={{
                    width: "100%", padding: "12px 0", borderRadius: 12,
                    border: "none", background: platform.color,
                    color: "#fff", fontWeight: 700, fontSize: 14,
                    cursor: "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  <Package size={16} />
                  Auf {platform.name} suchen
                  <ExternalLink size={14} />
                </button>
              </div>
            ))}

            {/* Tipp */}
            <div style={{
              background: "#FFF7ED", borderRadius: 16, padding: 16,
              border: "1.5px solid #FED7AA", marginBottom: 16,
            }}>
              <p style={{ margin: 0, fontSize: 13, color: "#92400E", fontWeight: 600 }}>
                💡 Workflow-Tipp
              </p>
              <p style={{ margin: "6px 0 0", fontSize: 12, color: "#78350F", lineHeight: 1.6 }}>
                Produkt auf DSers/CJ gefunden? → AliExpress URL kopieren → in den <strong>Import</strong> Tab einfügen → Titel + Beschreibung generieren → auf eBay listen.
              </p>
            </div>
          </>
        )}

        {/* Leer-Zustand */}
        {!submitted && (
          <div style={{
            background: "#fff", borderRadius: 20, padding: 32,
            boxShadow: "0 2px 16px rgba(0,0,0,0.07)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
            <p style={{ fontWeight: 700, fontSize: 16, color: "#0F172A", margin: 0 }}>
              DE/EU Lager suchen
            </p>
            <p style={{ color: "#64748B", fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
              Gib einen Suchbegriff ein und öffne direkt<br />
              DSers, CJ Dropshipping, Eprolo oder AliExpress<br />
              mit voreingestelltem DE-Lager Filter.
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
              {PLATFORMS.map(p => (
                <span key={p.id} style={{
                  fontSize: 20, padding: "6px 12px",
                  background: `${p.color}10`, borderRadius: 10,
                }}>
                  {p.icon} {p.name}
                </span>
              ))}
            </div>
          </div>
        )}

        <p style={{ textAlign: "center", color: "#CBD5E1", fontSize: 12, marginTop: 8 }}>
          Stele E-Transfer · Produkt-Suche
        </p>
      </div>
    </div>
  );
}
