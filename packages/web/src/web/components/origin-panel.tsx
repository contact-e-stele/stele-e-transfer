// OFFEN 030 Teil 2: Anzeige für Herkunft → Lagerort / Versandrichtlinie / Lieferzeit.
// Die Regeln stehen in shared/origin-shipping.ts + shared/listing-origin.ts (dieselben reinen Funktionen wie im Server); hier nur Anzeige/Speichern.
import { useEffect, useState } from "react";
import { listingOrigin, type DeliveryTimes } from "../../shared/listing-origin";
import type { AmpelColor, InventoryRow, OriginLocations } from "../../shared/origin-shipping";

const dot: Record<AmpelColor, string> = { green: "🟢", red: "🔴", grey: "⚪" };
const bg: Record<AmpelColor, string> = { green: "#DCFCE7", red: "#FEE2E2", grey: "#F1F5F9" };
const border: Record<AmpelColor, string> = { green: "#86EFAC", red: "#FCA5A5", grey: "#CBD5E1" };

/** Herkunft lokal (ohne eBay-Aufruf): ohne/gemischte Herkunft ist sofort rot — sperrt das Listen. */
export function localOriginColor(shipsFrom: string | null | undefined, variantPricesJson: string | null | undefined): { color: AmpelColor; text: string } {
  let attrs: Array<Record<string, string> | null> = [];
  try {
    const parsed = JSON.parse(variantPricesJson ?? "[]");
    if (Array.isArray(parsed)) attrs = parsed.map((v: { attrs?: Record<string, string> }) => (v && typeof v.attrs === "object" ? v.attrs : null));
  } catch { /* leer */ }
  const o = listingOrigin(shipsFrom, attrs);
  if (o.mixed) return { color: "red", text: `Herkunft gemischt (${[...new Set(o.perVariant.map(v => v.label || "unbekannt"))].join(", ")}) — Listen gesperrt` };
  if (o.kind === "UNKNOWN") return { color: "red", text: "Herkunft fehlt — Listen gesperrt" };
  return { color: "grey", text: `Herkunft ${o.label} — Klick: Lagerort, Versandrichtlinie und eBay-Lieferschätzung prüfen` };
}

interface OriginCheck {
  herkunft: string; standort: AmpelColor; standortText: string; blockError: string | null; deliveryTime: string | null;
  lieferzeit: { color: AmpelColor; text: string };
}

/** Produkte-Tab: Ampel "Standort/Lieferzeit". Klick liest Offer, Richtlinien und eBay-Lieferschätzung (nur lesen). */
export function OriginAmpelButton({ productId, shipsFrom, variantPrices }: { productId: number; shipsFrom?: string | null; variantPrices: string | null }) {
  const local = localOriginColor(shipsFrom, variantPrices);
  const [check, setCheck] = useState<OriginCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/ebay/origin-check/${productId}`, { credentials: "include" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? String(r.status));
      setCheck(d as OriginCheck);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const s = check ? check.standort : local.color;
  const l = check ? check.lieferzeit.color : "grey";
  const worst: AmpelColor = s === "red" || l === "red" ? "red" : s === "green" && l !== "grey" ? "green" : s === "green" ? "green" : "grey";
  const tip = err ? `Prüfung fehlgeschlagen: ${err}` : check
    ? `Standort: ${check.standortText}\nLieferzeit: ${check.lieferzeit.text}${check.deliveryTime ? `\nFußzeile: ${check.deliveryTime}` : ""}`
    : local.text;
  return (
    <button onClick={run} title={tip} disabled={busy} style={{
      display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 8,
      background: bg[worst], color: "#0F172A", fontSize: 11, fontWeight: 700, border: `1px solid ${border[worst]}`,
      cursor: busy ? "wait" : "pointer", fontFamily: "inherit",
    }}>
      {busy ? "…" : `${dot[s]} Standort ${dot[l]} Lieferzeit`}
    </button>
  );
}

const box = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 20, marginBottom: 16 } as const;
const input = { padding: "8px 10px", fontSize: 14, border: "2px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" } as const;
const btn = { padding: "8px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none", background: "#FFD700", color: "#0F172A", cursor: "pointer", fontFamily: "inherit" } as const;

interface PolicyMapping { CN: { name: string; id?: string; error?: string }; EU: { name: string; id?: string; error?: string } }

/** Einstellungen-Tab: Lieferzeiten je Herkunft, Lagerorte je Land, Zuordnung der Versandrichtlinien (nur Anzeige), Bestandsliste. */
export function OriginSettingsCard() {
  const [times, setTimes] = useState<DeliveryTimes>({});
  const [locs, setLocs] = useState<OriginLocations>({});
  const [newIso, setNewIso] = useState("");
  const [mapping, setMapping] = useState<PolicyMapping | null>(null);
  const [mappingErr, setMappingErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [rows, setRows] = useState<InventoryRow[] | null>(null);
  const [rowsBusy, setRowsBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings/delivery-times", { credentials: "include" }).then(r => r.json()).then(d => setTimes(d.times ?? {})).catch(() => {});
    fetch("/api/settings/origin-locations", { credentials: "include" }).then(r => r.json()).then(d => setLocs(d.locations ?? {})).catch(() => {});
    fetch("/api/ebay/fulfillment-policies", { credentials: "include" }).then(r => r.json())
      .then(d => d.mapping ? setMapping(d.mapping as PolicyMapping) : setMappingErr(d.error ?? "nicht lesbar")).catch(e => setMappingErr(String(e)));
  }, []);

  const save = async () => {
    setMsg(null);
    try {
      const a = await fetch("/api/settings/delivery-times", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ times }) }).then(r => r.json());
      const b = await fetch("/api/settings/origin-locations", { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ locations: locs }) }).then(r => r.json());
      if (!a.ok || !b.ok) throw new Error(a.error ?? b.error ?? "Fehler");
      setTimes(a.times); setLocs(b.locations);
      setMsg({ ok: true, text: "Gespeichert. Leere oder ungültige Werte wurden verworfen (keine Zahl = neutraler Satz)." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
  };

  const loadInventory = async () => {
    setRowsBusy(true);
    try { const d = await fetch("/api/ebay/origin-inventory", { credentials: "include" }).then(r => r.json()); setRows(d.rows ?? []); if (d.error) setMsg({ ok: false, text: d.error }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); } finally { setRowsBusy(false); }
  };

  const setLoc = (iso: string, field: "city" | "postalCode" | "stateOrProvince", v: string) => setLocs(prev => ({ ...prev, [iso]: { ...(prev[iso] ?? { city: "" }), [field]: v } }));

  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 22 }}>🚚</span>
        <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>Lieferzeiten &amp; Lagerorte je Herkunft</span>
      </div>
      <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
        Die Fußzeile „Versand &amp; Rückgabe“ nimmt die Lieferzeit aus der Herkunft des Angebots. Ohne Wert steht dort „Lieferzeit gemäß eBay-Angabe“ — nie eine geratene Zahl.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center", maxWidth: 420 }}>
        {(["CN", "EU", "DE"] as const).map(k => (
          <label key={k} style={{ display: "contents" }}>
            <span style={{ fontSize: 13 }}>{k === "CN" ? "China" : k === "EU" ? "EU-Lager" : "Deutschland"}</span>
            <input style={input} value={times[k] ?? ""} placeholder="z. B. 3–7 Werktage" onChange={e => setTimes(t => ({ ...t, [k]: e.currentTarget.value }))} />
          </label>
        ))}
      </div>

      <div style={{ fontWeight: 700, fontSize: 14, margin: "16px 0 6px" }}>Lagerorte (Ort des Lieferanten-Lagers)</div>
      <p style={{ fontSize: 12, color: "#64748B", margin: "0 0 8px" }}>China ohne Eintrag: Shenzhen, Guangdong (als „Ort geschätzt“ markiert). EU-Länder und Deutschland werden ohne Eintrag NICHT gelistet.</p>
      {Object.keys(locs).sort().map(iso => (
        <div key={iso} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ width: 30 }}>{iso}</b>
          <input style={{ ...input, width: 140 }} placeholder="Ort" value={locs[iso].city} onChange={e => setLoc(iso, "city", e.currentTarget.value)} />
          <input style={{ ...input, width: 100 }} placeholder="PLZ" value={locs[iso].postalCode ?? ""} onChange={e => setLoc(iso, "postalCode", e.currentTarget.value)} />
          <input style={{ ...input, width: 130 }} placeholder="Region" value={locs[iso].stateOrProvince ?? ""} onChange={e => setLoc(iso, "stateOrProvince", e.currentTarget.value)} />
          <button style={{ ...btn, background: "#F1F5F9" }} onClick={() => setLocs(prev => { const n = { ...prev }; delete n[iso]; return n; })}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input style={{ ...input, width: 80 }} placeholder="PL" maxLength={2} value={newIso} onChange={e => setNewIso(e.currentTarget.value.toUpperCase())} />
        <button style={{ ...btn, background: "#F1F5F9" }} onClick={() => { if (/^[A-Z]{2}$/.test(newIso) && !locs[newIso]) { setLocs(p => ({ ...p, [newIso]: { city: "" } })); setNewIso(""); } }}>Land hinzufügen</button>
      </div>
      <button style={btn} onClick={save}>Speichern</button>
      {msg && <div style={{ marginTop: 8, fontSize: 13, color: msg.ok ? "#15803D" : "#B91C1C" }}>{msg.text}</div>}

      <div style={{ fontWeight: 700, fontSize: 14, margin: "16px 0 6px" }}>Versandrichtlinien (aus dem eBay-Konto gelesen)</div>
      {mappingErr && <div style={{ fontSize: 13, color: "#B91C1C" }}>Nicht lesbar: {mappingErr}</div>}
      {mapping && (["CN", "EU"] as const).map(k => (
        <div key={k} style={{ fontSize: 13, marginBottom: 4 }}>
          {mapping[k].id ? "🟢" : "🔴"} {k === "CN" ? "China" : "EU-Lager / Deutschland"} → „{mapping[k].name}“ {mapping[k].id ? `(${mapping[k].id})` : `— ${mapping[k].error}`}
        </div>
      ))}

      <div style={{ fontWeight: 700, fontSize: 14, margin: "16px 0 6px" }}>Bestandsliste Live-Angebote (nur lesen)</div>
      <button style={{ ...btn, background: "#F1F5F9" }} onClick={loadInventory} disabled={rowsBusy}>{rowsBusy ? "lese …" : "Bestandsliste laden"}</button>
      {rows && (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ fontSize: 12, borderCollapse: "collapse" }}>
            <thead><tr>{["stele-Nr", "eBay-Nr", "Herkunft", "Lagerort heute", "Lagerort neu", "Richtlinie heute", "Richtlinie neu", "Umstellen?"].map(h => <th key={h} style={{ textAlign: "left", padding: "4px 8px", borderBottom: "1px solid #E2E8F0" }}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.itemId}>{[r.steleNr, r.itemId, r.herkunft, r.heuteLagerort, r.neuerLagerort, r.heuteRichtlinie, r.neueRichtlinie, r.umstellungNoetig === null ? "?" : r.umstellungNoetig ? "ja" : "nein"].map((v, i) => <td key={i} style={{ padding: "4px 8px", borderBottom: "1px solid #F1F5F9" }}>{v}</td>)}</tr>
            ))}</tbody>
          </table>
          <div style={{ fontSize: 12, color: "#64748B", marginTop: 6 }}>Umgestellt wird hier nichts — erst nach „ja Standort Bestand“ des Inhabers.</div>
        </div>
      )}
    </div>
  );
}
