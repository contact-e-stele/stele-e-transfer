import { useState } from "react";
import { FileText, Search, Copy, Check, Loader, AlertCircle, RefreshCw } from "lucide-react";
import { hc } from "hono/client";
import type { AppType } from "../../api/index";

const client = hc<AppType>("/");

// ─── Text helpers ─────────────────────────────────────────────────────────────
function decodeEntities(str: string): string {
  return str
    .replace(/&uuml;/g, "ü").replace(/&Uuml;/g, "Ü")
    .replace(/&auml;/g, "ä").replace(/&Auml;/g, "Ä")
    .replace(/&ouml;/g, "ö").replace(/&Ouml;/g, "Ö")
    .replace(/&szlig;/g, "ß")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&[a-zA-Z]+;/g, "");
}

function cleanText(text: string): string {
  return text
    .replace(/\d+[\s,.]?\d*\s*Sterne[n]?/gi, "")
    .replace(/\d+[\s,.]?\d*\s*Bewertung[en]*/gi, "")
    .replace(/ASIN[:\s]+[A-Z0-9]+/gi, "")
    .replace(/[€$]\s*[\d,.]+/g, "")
    .replace(/[\d,.]+\s*[€$]/g, "")
    .replace(/\d+[\s%]\s*Rabatt/gi, "")
    .trim();
}

function extractKeyword(text: string): string {
  const words = text.split(/[\s,–\-:]/);
  const meaningful = words.filter(w => w.length > 3).slice(0, 2);
  return meaningful.join(" ") || words[0] || "Merkmal";
}

function summarizeVariants(variants: string[], maxLen = 999): string {
  if (variants.length === 0) return "";
  if (variants.length === 1) return variants[0].slice(0, maxLen);
  const numPattern = /^(\d+)\s+(.+)$/;
  const numbered = variants.map(v => {
    const m = v.match(numPattern);
    return m ? { num: parseInt(m[1]), label: m[2].trim() } : null;
  });
  if (numbered.every(Boolean)) {
    const labels = [...new Set(numbered.map(n => n!.label))];
    if (labels.length === 1) {
      const nums = numbered.map(n => n!.num).sort((a, b) => a - b);
      const s = nums.length <= 4 ? `${nums.join("/")} ${labels[0]}` : `${nums[0]}–${nums[nums.length - 1]} ${labels[0]}`;
      return s.slice(0, maxLen);
    }
  }
  if (variants.length <= 3) return variants.join(", ").slice(0, maxLen);
  return `${variants.slice(0, 2).join(", ")} +${variants.length - 2} Varianten`.slice(0, maxLen);
}

function buildTitle(rawTitle: string, variants: string[]): string {
  let title = decodeEntities(rawTitle).replace(/\[.*?\]/g, "").replace(/\s{2,}/g, " ").trim();

  // Marke entfernen: erstes Wort wenn es groß geschrieben und vor einem Trennzeichen steht
  // z.B. "PEARL Aufbewahrungsbox..." → "Aufbewahrungsbox..."
  // oder "Relaxdays 10er Set..." → "10er Set..."
  title = title
    .replace(/^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß&.\-]{1,30}\s+/, "") // Marke am Anfang
    .replace(/^[A-ZÄÖÜ]{2,}\s+/, "")                        // Komplett-Großbuchstaben Marke
    .replace(/\s{2,}/g, " ")
    .trim();

  // Wenn mehrere Varianten → KEINE Größen/Mengen im Titel
  if (variants.length === 1) {
    const baseTitle = title.length > 55 ? title.slice(0, 54).replace(/[,\s]+$/, "") : title;
    const remaining = 80 - baseTitle.length - 3;
    const variantSummary = summarizeVariants(variants, Math.max(15, remaining));
    const candidate = baseTitle + ` – ${variantSummary}`;
    title = candidate.length <= 80 ? candidate : candidate.slice(0, 77) + "...";
  }

  if (title.length > 80) title = title.slice(0, 77) + "...";
  return title;
}

function buildHTML(rawTitle: string, bullets: string[], variants: string[], description: string): string {
  const lines: string[] = ["<ul>"];
  if (variants.length > 0) {
    if (variants.length === 1) {
      lines.push(`<li><strong>【Variante】</strong> Erhältlich als: ${decodeEntities(variants[0])}</li>`);
    } else {
      const listStr = variants.map(v => decodeEntities(v)).join(", ");
      lines.push(`<li><strong>【Verfügbare Varianten】</strong> Erhältlich in folgenden Ausführungen: ${listStr}</li>`);
    }
  }
  const usableBullets = bullets
    .map(b => cleanText(decodeEntities(b)))
    .filter(b => b.length > 15 && !b.toLowerCase().includes("sicherstellen") && !b.toLowerCase().includes("melden sie"));
  for (const bullet of usableBullets.slice(0, 8)) {
    lines.push(`<li><strong>【${extractKeyword(bullet)}】</strong> ${bullet}</li>`);
  }
  lines.push("</ul>");
  if (description && description.length > 20) {
    const cleaned = cleanText(decodeEntities(description));
    const paras = cleaned.split(/\n{2,}|(?<=\.)\s+(?=[A-ZÄÖÜ])/);
    for (const para of paras) {
      const p = para.trim();
      if (p.length > 20) lines.push(`<p>${p}</p>`);
    }
  } else if (usableBullets.length === 0) {
    lines.push(`<p>${decodeEntities(rawTitle).trim()}</p>`);
  }
  return lines.join("\n");
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function AutoDS() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ title: string; html: string } | null>(null);
  const [copiedTitle, setCopiedTitle] = useState(false);
  const [copiedHtml, setCopiedHtml] = useState(false);

  const handleScrape = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await client.api["scrape-amazon"].$get({ query: { url: url.trim() } });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setError(err.error ?? "Fehler beim Laden");
        return;
      }
      const data = await res.json() as { title: string; bullets: string[]; variants: string[]; description: string };
      setResult({
        title: buildTitle(data.title, data.variants),
        html: buildHTML(data.title, data.bullets, data.variants, data.description),
      });
    } catch {
      setError("Netzwerkfehler – bitte erneut versuchen.");
    } finally {
      setLoading(false);
    }
  };

  const copyTitle = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.title);
    setCopiedTitle(true);
    setTimeout(() => setCopiedTitle(false), 2000);
  };

  const copyHtml = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.html);
    setCopiedHtml(true);
    setTimeout(() => setCopiedHtml(false), 2000);
  };

  const charCount = result ? result.title.length : 0;
  const charColor = charCount > 80 ? "#DC2626" : charCount > 70 ? "#F59E0B" : "#16a34a";

  const inputStyle = {
    width: "100%", padding: "13px 16px", fontSize: 14, fontWeight: 500,
    border: "2px solid #E2E8F0", borderRadius: 12, outline: "none",
    fontFamily: "inherit", boxSizing: "border-box" as const,
    color: "#0F172A", background: "#F8FAFC", transition: "border-color 0.2s",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", fontFamily: "'Poppins', sans-serif", padding: "24px 16px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: 16, background: "#8B5CF6",
            marginBottom: 12, boxShadow: "0 4px 14px rgba(139,92,246,0.35)"
          }}>
            <FileText size={28} color="white" />
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "#0F172A", margin: 0 }}>AutoDS Beschreibungsgenerator</h1>
          <p style={{ color: "#64748B", marginTop: 4, fontSize: 14 }}>stele-e-transfer</p>
        </div>

        {/* Input */}
        <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
          <label style={{ display: "block", fontWeight: 600, color: "#0F172A", marginBottom: 8, fontSize: 14 }}>
            Amazon Produkt-URL
          </label>
          <input
            type="url"
            placeholder="https://www.amazon.de/dp/..."
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleScrape()}
            style={inputStyle}
            onFocus={e => (e.target.style.borderColor = "#8B5CF6")}
            onBlur={e => (e.target.style.borderColor = "#E2E8F0")}
          />
          <button
            onClick={handleScrape}
            disabled={loading || !url.trim()}
            style={{
              width: "100%", marginTop: 12,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "13px 0", borderRadius: 12, border: "none",
              background: loading || !url.trim() ? "#C4B5FD" : "#8B5CF6",
              color: "#fff", fontWeight: 700, fontSize: 15,
              cursor: loading || !url.trim() ? "not-allowed" : "pointer",
              fontFamily: "inherit", transition: "background 0.2s"
            }}
          >
            {loading
              ? <><Loader size={18} style={{ animation: "spin 1s linear infinite" }} /> Lädt…</>
              : <><Search size={18} /> Beschreibung generieren</>
            }
          </button>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 14,
            padding: "14px 18px", marginBottom: 16,
            display: "flex", alignItems: "flex-start", gap: 10
          }}>
            <AlertCircle size={18} color="#DC2626" style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ margin: 0, fontWeight: 600, color: "#DC2626", fontSize: 14 }}>Fehler</p>
              <p style={{ margin: "4px 0 0", color: "#7F1D1D", fontSize: 13 }}>{error}</p>
              <p style={{ margin: "6px 0 0", color: "#991B1B", fontSize: 12, fontWeight: 600 }}>
                💡 Tipp: Direkte URL → <span style={{ fontFamily: "monospace", background: "#FEE2E2", padding: "1px 5px", borderRadius: 4 }}>amazon.de/dp/ASIN</span>
              </p>
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Titel</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: charColor }}>{charCount}/80 Zeichen</span>
              </div>
              <div style={{
                background: "#F8FAFC", borderRadius: 12, padding: "14px 16px",
                fontSize: 14, color: "#0F172A", lineHeight: 1.6,
                border: "1.5px solid #E2E8F0", marginBottom: 12,
                fontWeight: 500, wordBreak: "break-word"
              }}>
                {result.title}
              </div>
              <button onClick={copyTitle} style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "11px 0", borderRadius: 10, border: "none",
                background: copiedTitle ? "#22C55E" : "#8B5CF6",
                color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: "pointer", fontFamily: "inherit", transition: "background 0.2s"
              }}>
                {copiedTitle ? <Check size={16} /> : <Copy size={16} />}
                {copiedTitle ? "Kopiert!" : "Titel kopieren"}
              </button>
            </div>

            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>HTML Beschreibung</span>
                <span style={{ fontSize: 11, color: "#94A3B8", background: "#F1F5F9", padding: "3px 8px", borderRadius: 6, fontWeight: 600 }}>AutoDS-Format</span>
              </div>
              <div style={{
                background: "#0F172A", borderRadius: 12, padding: "16px",
                fontSize: 12, color: "#94A3B8", lineHeight: 1.7,
                fontFamily: "monospace", marginBottom: 12,
                overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
                maxHeight: 360, overflowY: "auto"
              }}>
                {result.html}
              </div>
              <button onClick={copyHtml} style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "11px 0", borderRadius: 10, border: "none",
                background: copiedHtml ? "#22C55E" : "#0F172A",
                color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: "pointer", fontFamily: "inherit", transition: "background 0.2s"
              }}>
                {copiedHtml ? <Check size={16} /> : <Copy size={16} />}
                {copiedHtml ? "Kopiert!" : "HTML kopieren"}
              </button>
            </div>

            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>Vorschau</span>
                <button onClick={handleScrape} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: "#F1F5F9", border: "none", borderRadius: 8,
                  padding: "6px 12px", fontSize: 12, fontWeight: 600,
                  color: "#475569", cursor: "pointer", fontFamily: "inherit"
                }}>
                  <RefreshCw size={12} /> Neu laden
                </button>
              </div>
              <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.8 }}
                dangerouslySetInnerHTML={{ __html: result.html }} />
            </div>
          </>
        )}

        <p style={{ textAlign: "center", color: "#CBD5E1", fontSize: 12, marginTop: 24, marginBottom: 8 }}>
          AutoDS Beschreibungsgenerator · stele-e-transfer
        </p>
      </div>
    </div>
  );
}
