/**
 * Suche-Tab — AliExpress DS Produktsuche mit EU/DE-Lager Filter
 * Nach OAuth-Genehmigung: echte API-Ergebnisse
 * Vorher: "API ausstehend" Hinweis + externe Links als Fallback
 */
import { useState, useCallback } from "react";
import { Search, ExternalLink, Package, ShoppingCart, Star, Filter, RefreshCw, AlertCircle, CheckCircle } from "lucide-react";
import { useLocation } from "wouter";

const SHIP_FROM_OPTIONS = [
  { value: "ALL", label: "Alle Laender" },
  { value: "DE", label: "Deutschland" },
  { value: "ES", label: "Spanien" },
  { value: "FR", label: "Frankreich" },
  { value: "IT", label: "Italien" },
  { value: "PL", label: "Polen" },
  { value: "NL", label: "Niederlande" },
  { value: "CZ", label: "Tschechien" },
  { value: "CN", label: "China" },
];

const SORT_OPTIONS = [
  { value: "LAST_VOLUME_DESC", label: "Meistverkauft" },
  { value: "SALE_PRICE_ASC", label: "Preis aufsteigend" },
  { value: "SALE_PRICE_DESC", label: "Preis absteigend" },
];

const FALLBACK_PLATFORMS = [
  {
    id: "aliexpress",
    name: "AliExpress DE",
    icon: "🔴",
    color: "#E53E3E",
    buildUrl: (q: string, sf: string) =>
      `https://www.aliexpress.com/wholesale?SearchText=${encodeURIComponent(q)}&ship_from_country=${sf}&SortType=total_tranAmount_sort`,
  },
  {
    id: "cj",
    name: "CJ Dropshipping",
    icon: "🟢",
    color: "#00A650",
    buildUrl: (q: string) =>
      `https://app.cjdropshipping.com/search.html#/?searchKey=${encodeURIComponent(q)}`,
  },
  {
    id: "dsers",
    name: "DSers",
    icon: "🔶",
    color: "#FF6B00",
    buildUrl: (q: string) =>
      `https://www.dsers.com/app/find-suppliers?productName=${encodeURIComponent(q)}&shipFromCountry=DE`,
  },
];

interface SearchResult {
  id: string;
  title: string;
  image: string;
  price: number;
  shipFrom: string;
  isEU: boolean;
  rating: number;
  sold: number;
  url: string;
}

interface SearchResponse {
  status: "ok" | "no_token" | "api_error" | "no_result" | "error";
  results: SearchResult[];
  total: number;
  page: number;
  keyword: string;
  message?: string;
}

export default function Suche() {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [shipFrom, setShipFrom] = useState("ALL");
  const [sort, setSort] = useState("LAST_VOLUME_DESC");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const doSearch = useCallback(async (q: string, p: number, sf: string, s: string) => {
    if (!q.trim()) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        keyword: q,
        page: String(p),
        ship_from: sf,
        sort: s,
      });
      const res = await fetch(`/api/aliexpress/search?${params}`);
      const data = await res.json() as SearchResponse;
      setResponse(data);
    } catch {
      setResponse({ status: "error", results: [], total: 0, page: p, keyword: q, message: "Verbindungsfehler" });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => {
    const q = query.trim();
    if (!q) return;
    setPage(1);
    doSearch(q, 1, shipFrom, sort);
  };

  const handleImport = (result: SearchResult) => {
    // Alle Produktdaten direkt übergeben → Lieferanten-Tab liest aus und startet Scrape
    sessionStorage.setItem("import_url", result.url);
    sessionStorage.setItem("import_title", result.title);
    sessionStorage.setItem("import_image", result.image);
    if (result.price > 0) sessionStorage.setItem("import_price", result.price.toFixed(2));
    if (result.shipFrom) sessionStorage.setItem("import_shipFrom", result.shipFrom);
    sessionStorage.setItem("import_autostart", "1");
    setLocation("/lieferanten");
  };

  const noToken = response?.status === "no_token";
  const hasResults = response?.status === "ok" && response.results.length > 0;
  const totalPages = response ? Math.ceil(response.total / 20) : 0;

  return (
    <div style={{
      minHeight: "100vh", background: "#F8FAFC",
      fontFamily: "'Poppins', sans-serif", padding: "24px 16px",
    }}>
      <div style={{ maxWidth: 560, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 52, height: 52, borderRadius: 14, background: "#7C3AED",
            marginBottom: 10, boxShadow: "0 4px 14px rgba(124,58,237,0.35)",
          }}>
            <Search size={26} color="white" />
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#0F172A", margin: 0 }}>
            AliExpress Suche
          </h1>
          <p style={{ color: "#64748B", marginTop: 4, fontSize: 13 }}>
            Weltweite Suche · DE/EU/CN · Direkt importieren
          </p>
        </div>

        {/* Suchfeld */}
        <div style={{
          background: "#fff", borderRadius: 20, padding: 18,
          boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 12,
        }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search size={15} color="#94A3B8" style={{
                position: "absolute", left: 12, top: "50%",
                transform: "translateY(-50%)", pointerEvents: "none",
              }} />
              <input
                type="text"
                placeholder="z.B. Handyhülle, LED Streifen, Yoga Matte..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                style={{
                  width: "100%", padding: "11px 14px 11px 36px",
                  fontSize: 14, fontWeight: 500,
                  border: "2px solid #E2E8F0", borderRadius: 10,
                  outline: "none", fontFamily: "inherit",
                  boxSizing: "border-box", color: "#0F172A", background: "#F8FAFC",
                }}
              />
            </div>
            <button
              onClick={() => setShowFilters(v => !v)}
              style={{
                padding: "11px 14px", borderRadius: 10, border: "2px solid #E2E8F0",
                background: showFilters ? "#7C3AED" : "#F8FAFC",
                color: showFilters ? "#fff" : "#64748B",
                cursor: "pointer", display: "flex", alignItems: "center",
              }}
              title="Filter"
            >
              <Filter size={16} />
            </button>
            <button
              onClick={handleSearch}
              disabled={!query.trim() || loading}
              style={{
                padding: "11px 18px", borderRadius: 10, border: "none",
                background: !query.trim() || loading ? "#C4B5FD" : "#7C3AED",
                color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: !query.trim() || loading ? "not-allowed" : "pointer",
                fontFamily: "inherit", display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {loading ? <RefreshCw size={15} style={{ animation: "spin 1s linear infinite" }} /> : "Suchen"}
            </button>
          </div>

          {/* Filter-Panel */}
          {showFilters && (
            <div style={{
              borderTop: "1px solid #E2E8F0", paddingTop: 12,
              display: "flex", gap: 12, flexWrap: "wrap",
            }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 5, textTransform: "uppercase" }}>
                  Lager
                </label>
                <select
                  value={shipFrom}
                  onChange={e => setShipFrom(e.target.value)}
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8,
                    border: "1.5px solid #E2E8F0", fontSize: 13, fontFamily: "inherit",
                    background: "#F8FAFC", color: "#0F172A", outline: "none",
                  }}
                >
                  {SHIP_FROM_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: "#64748B", display: "block", marginBottom: 5, textTransform: "uppercase" }}>
                  Sortierung
                </label>
                <select
                  value={sort}
                  onChange={e => setSort(e.target.value)}
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8,
                    border: "1.5px solid #E2E8F0", fontSize: 13, fontFamily: "inherit",
                    background: "#F8FAFC", color: "#0F172A", outline: "none",
                  }}
                >
                  {SORT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Schnellvorschläge */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
            {["Grillmatte", "LED Streifen", "Handyhülle", "Küchen Organizer", "Bluetooth Lautsprecher", "Yoga Matte"].map(s => (
              <button
                key={s}
                onClick={() => { setQuery(s); setPage(1); doSearch(s, 1, shipFrom, sort); }}
                style={{
                  padding: "4px 10px", borderRadius: 16,
                  border: "1.5px solid #E2E8F0", background: "#F8FAFC",
                  fontSize: 11, fontWeight: 600, color: "#475569",
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Status: OAuth fehlt */}
        {noToken && (
          <>
            <div style={{
              background: "#FFF7ED", borderRadius: 16, padding: 16,
              border: "1.5px solid #FED7AA", marginBottom: 16,
              display: "flex", gap: 12, alignItems: "flex-start",
            }}>
              <AlertCircle size={20} color="#F59E0B" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: "#92400E" }}>
                  AliExpress API ausstehend
                </p>
                <p style={{ margin: "4px 0 0", fontSize: 12, color: "#78350F", lineHeight: 1.6 }}>
                  OAuth-Genehmigung wird noch geprüft (1–3 Tage).<br />
                  Bis dahin kannst du direkt auf den Plattformen suchen:
                </p>
              </div>
            </div>

            {/* Fallback externe Links */}
            {query.trim() && FALLBACK_PLATFORMS.map(p => (
              <div key={p.id} style={{
                background: "#fff", borderRadius: 16, padding: 16,
                boxShadow: "0 2px 12px rgba(0,0,0,0.06)", marginBottom: 10,
                display: "flex", alignItems: "center", gap: 12,
              }}>
                <span style={{ fontSize: 26 }}>{p.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#0F172A" }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>Suche: „{query.trim()}"</div>
                </div>
                <button
                  onClick={() => window.open(p.buildUrl(query.trim(), shipFrom), "_blank")}
                  style={{
                    padding: "8px 14px", borderRadius: 10, border: "none",
                    background: p.color, color: "#fff", fontWeight: 700, fontSize: 13,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
                  }}
                >
                  Öffnen <ExternalLink size={13} />
                </button>
              </div>
            ))}
          </>
        )}

        {/* Ergebnisse */}
        {hasResults && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: "#64748B" }}>
                <strong style={{ color: "#0F172A" }}>{response!.total.toLocaleString()}</strong> Ergebnisse für „{response!.keyword}"
              </p>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: "3px 8px",
                borderRadius: 12, background: "#F0FDF4", color: "#16A34A",
                border: "1px solid #BBF7D0",
              }}>
                🇩🇪 {SHIP_FROM_OPTIONS.find(o => o.value === shipFrom)?.label}
              </span>
            </div>

            {response!.results.map(item => (
              <div key={item.id} style={{
                background: "#fff", borderRadius: 16, padding: 14,
                boxShadow: "0 2px 12px rgba(0,0,0,0.06)", marginBottom: 10,
                display: "flex", gap: 12,
              }}>
                {/* Bild */}
                <div style={{
                  width: 80, height: 80, borderRadius: 10, overflow: "hidden",
                  background: "#F1F5F9", flexShrink: 0,
                }}>
                  {item.image ? (
                    <img src={item.image} alt={item.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Package size={28} color="#CBD5E1" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    margin: "0 0 4px", fontSize: 13, fontWeight: 600, color: "#0F172A",
                    overflow: "hidden", textOverflow: "ellipsis",
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                  }}>
                    {item.title || "Kein Titel"}
                  </p>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {/* Preis */}
                    <span style={{ fontSize: 15, fontWeight: 800, color: "#7C3AED" }}>
                      {item.price > 0 ? `${item.price.toFixed(2).replace(".", ",")} €` : "–"}
                    </span>

                    {/* Lager Badge */}
                    {item.isEU ? (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 7px",
                        borderRadius: 10, background: "#F0FDF4", color: "#16A34A",
                        border: "1px solid #BBF7D0", display: "flex", alignItems: "center", gap: 3,
                      }}>
                        <CheckCircle size={9} /> EU
                      </span>
                    ) : item.shipFrom ? (
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: "2px 7px",
                        borderRadius: 10, background: "#FFF7ED", color: "#C2410C",
                        border: "1px solid #FED7AA",
                      }}>
                        {item.shipFrom.toUpperCase().slice(0,2)}
                      </span>
                    ) : null}

                    {/* Verkäufe */}
                    {item.sold > 0 && (
                      <span style={{ fontSize: 11, color: "#64748B" }}>
                        {item.sold.toLocaleString()}x verkauft
                      </span>
                    )}

                    {/* Rating */}
                    {item.rating > 0 && (
                      <span style={{ fontSize: 11, color: "#F59E0B", display: "flex", alignItems: "center", gap: 2 }}>
                        <Star size={10} fill="#F59E0B" /> {Number(item.rating).toFixed(1)}%
                      </span>
                    )}
                  </div>

                  {/* Buttons */}
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleImport(item)}
                      style={{
                        flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
                        background: "#7C3AED", color: "#fff", fontWeight: 700, fontSize: 12,
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                      }}
                    >
                      <ShoppingCart size={13} /> Importieren
                    </button>
                    <button
                      onClick={() => window.open(item.url, "_blank")}
                      style={{
                        padding: "8px 12px", borderRadius: 8,
                        border: "1.5px solid #E2E8F0", background: "#F8FAFC",
                        color: "#475569", cursor: "pointer",
                        display: "flex", alignItems: "center",
                      }}
                      title="Auf AliExpress öffnen"
                    >
                      <ExternalLink size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {/* Pagination */}
            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16 }}>
                <button
                  disabled={page <= 1}
                  onClick={() => { const p = page - 1; setPage(p); doSearch(response!.keyword, p, shipFrom, sort); }}
                  style={{
                    padding: "8px 16px", borderRadius: 10, border: "1.5px solid #E2E8F0",
                    background: page <= 1 ? "#F1F5F9" : "#fff", color: page <= 1 ? "#CBD5E1" : "#0F172A",
                    fontWeight: 600, fontSize: 13, cursor: page <= 1 ? "not-allowed" : "pointer",
                  }}
                >
                  ← Zurück
                </button>
                <span style={{ padding: "8px 14px", fontSize: 13, color: "#64748B", fontWeight: 600 }}>
                  {page} / {totalPages}
                </span>
                <button
                  disabled={page >= totalPages}
                  onClick={() => { const p = page + 1; setPage(p); doSearch(response!.keyword, p, shipFrom, sort); }}
                  style={{
                    padding: "8px 16px", borderRadius: 10, border: "1.5px solid #E2E8F0",
                    background: page >= totalPages ? "#F1F5F9" : "#fff", color: page >= totalPages ? "#CBD5E1" : "#0F172A",
                    fontWeight: 600, fontSize: 13, cursor: page >= totalPages ? "not-allowed" : "pointer",
                  }}
                >
                  Weiter →
                </button>
              </div>
            )}
          </>
        )}

        {/* Leer-Zustand */}
        {!response && !loading && (
          <div style={{
            background: "#fff", borderRadius: 20, padding: 28,
            boxShadow: "0 2px 16px rgba(0,0,0,0.07)", textAlign: "center",
          }}>
            <div style={{ fontSize: 44, marginBottom: 10 }}>🔍</div>
            <p style={{ fontWeight: 700, fontSize: 16, color: "#0F172A", margin: 0 }}>
              AliExpress Suche
            </p>
            <p style={{ color: "#64748B", fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
              Suche weltweit — DE/EU und CN Produkte.<br />
              Lager-Filter im Filter-Panel einstellbar.<br />
              Produkte direkt in den Import-Tab übernehmen.
            </p>
            <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 10, background: "#F0FDF4", color: "#16A34A", border: "1px solid #BBF7D0" }}>EU Lager</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 10, background: "#FFF7ED", color: "#C2410C", border: "1px solid #FED7AA" }}>CN Lager</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 10, background: "#F5F3FF", color: "#7C3AED", border: "1px solid #C4B5FD" }}>Import</span>
            </div>
          </div>
        )}

        {/* Error */}
        {response?.status === "error" && (
          <div style={{
            background: "#FEF2F2", borderRadius: 14, padding: 14,
            border: "1.5px solid #FECACA", marginTop: 8,
            display: "flex", gap: 10, alignItems: "center",
          }}>
            <AlertCircle size={18} color="#DC2626" />
            <p style={{ margin: 0, fontSize: 13, color: "#DC2626", fontWeight: 600 }}>
              Fehler: {response.message}
            </p>
          </div>
        )}

        {/* Keine Ergebnisse */}
        {response?.status === "ok" && response.results.length === 0 && (
          <div style={{ textAlign: "center", padding: 24, color: "#64748B", fontSize: 13 }}>
            Keine Ergebnisse für „{response.keyword}".<br />
            Versuch einen anderen Suchbegriff oder anderen Lager-Filter.
          </div>
        )}

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>

        <p style={{ textAlign: "center", color: "#CBD5E1", fontSize: 11, marginTop: 16 }}>
          Stele E-Transfer · AliExpress DS Suche
        </p>
      </div>
    </div>
  );
}
