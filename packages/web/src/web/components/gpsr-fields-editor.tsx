// A-010 — GPSR-Einzelfelder (Hersteller + EU-Person) mit Live-Ampel, Auswahllisten gespeicherter Personen und
// Warnhinweis. Reine Darstellung: alle Regeln kommen aus shared/gpsr-import-fields.ts (Import-Tab) bzw.
// shared/gpsr-ampel.ts (dieselbe Ampel wie der Produkte-Tab) — hier wird nichts nachgebaut.
import { useEffect, useState } from "react";
import { EU_EEA_COUNTRIES, sameCompanyName } from "../../shared/gpsr-parser";
import { gpsrAmpelLabel, type GpsrAmpelColor } from "../../shared/gpsr-ampel";
import {
  EU_KEYS, MFR_KEYS, effectiveForm, fieldProblems, ampelForForm, rawPartyNames, nameMismatchWarning, canAdoptAsManufacturer, sortMfrOptions,
  type GpsrFormOverrides, type EuKey, type MfrKey, type PartyOptions, type EuOption, type MfrOption,
} from "../../shared/gpsr-import-fields";

export const MFR_COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "CN", name: "China" }, { code: "HK", name: "Hongkong" }, { code: "TW", name: "Taiwan" }, { code: "KR", name: "Südkorea" },
  { code: "JP", name: "Japan" }, { code: "VN", name: "Vietnam" }, { code: "IN", name: "Indien" }, { code: "TR", name: "Türkei" },
  { code: "US", name: "USA" }, { code: "GB", name: "Vereinigtes Königreich" }, ...EU_EEA_COUNTRIES,
];

export const ampelDot: Record<GpsrAmpelColor, string> = { GRUEN: "🟢", GELB: "🟡", ROT: "🔴" };

type Theme = "dark" | "light";
const palette = (t: Theme) => t === "dark"
  ? { bg: "#161616", fieldBg: "#111", fieldColor: "#fff", border: "#444", label: "#aaa", text: "#ddd", sub: "#999", red: "#ff6b6b", redBg: "#2a1414", head: "#C9A227", warn: "#f5c542" }
  : { bg: "#F8FAFC", fieldBg: "#FAFAFA", fieldColor: "#0F172A", border: "#E2E8F0", label: "#64748B", text: "#0F172A", sub: "#475569", red: "#DC2626", redBg: "#FEF2F2", head: "#0F172A", warn: "#B45309" };

// Die Liste wird einmal je Seitenaufruf geladen (nur lesen).
let partiesCache: Promise<PartyOptions | null> | null = null;
/** Nach dem Speichern aufrufen, damit neu importierte Personen beim nächsten Öffnen in der Liste stehen. */
export function invalidatePartyOptions() { partiesCache = null; }
export function usePartyOptions(): PartyOptions | null {
  const [options, setOptions] = useState<PartyOptions | null>(null);
  useEffect(() => {
    let alive = true;
    // Fehler werden NICHT gecacht (sonst blieben die Listen bis zum Neuladen leer)
    partiesCache ??= fetch("/api/gpsr/parties")
      .then(r => { if (!r.ok) { partiesCache = null; return null; } return r.json() as Promise<PartyOptions>; })
      .catch(() => { partiesCache = null; return null; });
    partiesCache.then(o => { if (alive) setOptions(o); });
    return () => { alive = false; };
  }, []);
  return options;
}

const optionLabel = (o: EuOption) => `${o.name} — ${o.city}, ${o.country}`;

/** Auswahlliste „… übernehmen“: nur Vorschlag, nie automatisch; Warnhinweis bei abweichendem Lieferanten-Namen. */
export function PartyPicker(props: {
  kind: "eu" | "mfr"; options: PartyOptions | null; rawName: string; euName?: string; theme: Theme;
  onPick: (o: EuOption | MfrOption) => void;
}) {
  const c = palette(props.theme);
  const [picked, setPicked] = useState("");
  const [msg, setMsg] = useState<{ text: string; kind: "warn" | "block" } | null>(null);
  const list: Array<EuOption | MfrOption> = props.kind === "eu" ? (props.options?.eu ?? []) : sortMfrOptions(props.options?.mfr ?? [], props.rawName);
  if (!props.options) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <select
        value={picked}
        disabled={list.length === 0}
        onChange={e => {
          const idx = e.target.value;
          setPicked(idx);
          const o = idx === "" ? undefined : list[Number(idx)];
          if (!o) { setMsg(null); return; }
          if (props.kind === "mfr") {
            const adopt = canAdoptAsManufacturer(o, props.euName);
            if (!adopt.ok) { setMsg({ text: adopt.reason, kind: "block" }); setPicked(""); return; }
          }
          props.onPick(o);
          const warn = nameMismatchWarning(o.name, props.rawName);
          setMsg(warn ? { text: warn, kind: "warn" } : null);
        }}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 8, border: `1px solid ${c.border}`, background: c.fieldBg, color: c.fieldColor, fontSize: 12, fontFamily: "inherit" }}
      >
        <option value="">{props.kind === "eu" ? "EU-Person übernehmen …" : "Hersteller übernehmen …"} ({list.length} gespeichert)</option>
        {list.map((o, i) => <option key={i} value={i}>{optionLabel(o)}</option>)}
      </select>
      {msg && <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: msg.kind === "block" ? c.red : c.warn }}>{msg.text}</div>}
    </div>
  );
}

const LABELS_EU: Record<EuKey, string> = { name: "Firmenname / Person", address: "Straße + Hausnummer", city: "PLZ + Stadt", country: "Land (EU/EWR)", email: "E-Mail", phone: "Telefon (optional)" };
const LABELS_MFR: Record<MfrKey, string> = { name: "Name des Herstellers", address: "Straße + Hausnummer", city: "PLZ + Stadt", country: "Land", email: "E-Mail", phone: "Telefon (optional)", url: "Kontakt-URL (alternativ zur E-Mail)" };

/** Import-Tab: Ampel + zwei Blöcke mit Einzelfeldern, vorbefüllt aus dem Rohtext, jedes Feld editierbar. */
export function GpsrFieldsEditor(props: {
  raw: string; overrides: GpsrFormOverrides; onChange: (next: GpsrFormOverrides) => void; theme: Theme;
}) {
  const c = palette(props.theme);
  const form = effectiveForm(props.raw, props.overrides);
  const problems = fieldProblems(form);
  const ampel = ampelForForm(props.raw, form);
  const options = usePartyOptions();
  const names = rawPartyNames(props.raw);
  const missing = [...ampel.eu.missing, ...ampel.manufacturer.missing];
  // Anderer Name als im Rohtext → der Rohtext füllt für diesen Block keine Lücken (nie zwei Personen mischen)
  const euOther = !!props.overrides.eu.name?.trim() && !!names.eu && !sameCompanyName(props.overrides.eu.name, names.eu);
  const mfrOther = !!props.overrides.mfr.name?.trim() && !!names.mfr && !sameCompanyName(props.overrides.mfr.name, names.mfr);
  const otherNote = (
    <div style={{ fontSize: 10, color: c.warn, marginBottom: 6 }}>
      Anderer Name als im Text oben: Die übrigen Felder werden nicht aus dem Text ergänzt — bitte alle Angaben dieser Person prüfen.
    </div>
  );

  const setEu = (k: EuKey, v: string) => props.onChange({ ...props.overrides, eu: { ...props.overrides.eu, [k]: v } });
  const setMfr = (k: MfrKey, v: string) => props.onChange({ ...props.overrides, mfr: { ...props.overrides.mfr, [k]: v } });

  const input = (value: string, onChange: (v: string) => void, problem: string | undefined, opts?: { select?: Array<{ code: string; name: string }> }) => {
    const style: React.CSSProperties = {
      width: "100%", padding: "6px 8px", borderRadius: 6, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box",
      background: problem ? c.redBg : c.fieldBg, color: c.fieldColor, border: `${problem ? 2 : 1}px solid ${problem ? c.red : c.border}`,
    };
    return (
      <>
        {opts?.select ? (
          <select value={value} onChange={e => onChange(e.target.value)} style={style}>
            <option value="">— bitte wählen —</option>
            {value && !opts.select.some(o => o.code === value.toUpperCase()) && <option value={value}>{value}</option>}
            {opts.select.map(o => <option key={o.code} value={o.code}>{o.name} ({o.code})</option>)}
          </select>
        ) : (
          <input type="text" value={value} onChange={e => onChange(e.target.value)} style={style} />
        )}
        {problem && <div style={{ fontSize: 10, marginTop: 2, color: c.red }}>{problem}</div>}
      </>
    );
  };

  const field = (label: string, node: React.ReactNode) => (
    <div style={{ marginBottom: 6 }}>
      <label style={{ fontSize: 10, fontWeight: 700, color: c.label, display: "block", marginBottom: 2 }}>{label}</label>
      {node}
    </div>
  );

  return (
    <div style={{ background: c.bg, padding: "8px 10px", borderTop: `1px solid ${c.border}`, color: c.text, fontSize: 11, lineHeight: 1.5 }}>
      <div style={{ fontWeight: 800 }}>
        GPSR-Ampel: {ampelDot[ampel.overall]} {gpsrAmpelLabel(ampel.overall)}
        <span style={{ fontWeight: 600, color: c.sub }}> — EU-Person {ampelDot[ampel.eu.ampel]} · Hersteller {ampelDot[ampel.manufacturer.ampel]}</span>
      </div>
      {missing.length > 0 ? (
        <ul style={{ margin: "4px 0 8px", paddingLeft: 16, color: c.sub }}>{missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
      ) : (
        <div style={{ margin: "4px 0 8px", color: "#4caf50" }}>Alle Pflichtangaben vorhanden.</div>
      )}
      <div style={{ color: c.sub, marginBottom: 8 }}>
        Felder sind aus dem Text oben vorbefüllt; was du hier einträgst, hat Vorrang und wird beim Import gespeichert (steht danach auch im Produkte-Tab, beim Listen und Nachziehen).
      </div>

      <div style={{ fontWeight: 800, color: c.head, marginBottom: 4 }}>Hersteller</div>
      <PartyPicker kind="mfr" options={options} rawName={names.mfr} euName={form.eu.name} theme={props.theme}
        onPick={o => props.onChange({ ...props.overrides, mfr: { name: o.name, address: o.address, city: o.city, country: o.country, email: o.email, phone: o.phone, url: (o as MfrOption).url ?? "" } })} />
      {mfrOther && otherNote}
      {MFR_KEYS.map(k => <div key={k}>{field(LABELS_MFR[k], input(form.mfr[k], v => setMfr(k, v), problems.mfr[k], k === "country" ? { select: MFR_COUNTRIES } : undefined))}</div>)}

      <div style={{ fontWeight: 800, color: c.head, margin: "10px 0 4px" }}>EU-Verantwortliche Person</div>
      <PartyPicker kind="eu" options={options} rawName={names.eu} theme={props.theme}
        onPick={o => props.onChange({ ...props.overrides, eu: { name: o.name, address: o.address, city: o.city, country: o.country, email: o.email, phone: o.phone } })} />
      {euOther && otherNote}
      {EU_KEYS.map(k => <div key={k}>{field(LABELS_EU[k], input(form.eu[k], v => setEu(k, v), problems.eu[k], k === "country" ? { select: EU_EEA_COUNTRIES } : undefined))}</div>)}
    </div>
  );
}
