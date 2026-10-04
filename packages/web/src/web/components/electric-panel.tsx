// A-029 (P-E01): Elektro Kat. 5 — Einstellungskarte (WEEE-Reg.-Nr., registrierte Gerätearten) und Produkt-Panel (Elektro ja/nein, Geräteart, Batterie, Nachweise).
// Die Regeln (Sperre, Format) stehen in shared/electric.ts — dieselben reinen Funktionen wie im Server; hier nur Anzeige und Speichern.
import { useEffect, useState } from "react";
import { evaluateElectricGate, isValidWeeeNr, parseElectricProofs, PROOF_KEYS, PROOF_LABELS, type ElectricSettings, type ProofKey } from "../../shared/electric";

interface ElectricSettingsResponse { weeeRegNr: string | null; registeredDeviceTypes: string[]; batteryRegistration: boolean; earUmlageEur: number }

function useElectricSettings() {
  const [settings, setSettings] = useState<ElectricSettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    fetch("/api/settings/electric", { credentials: "include" })
      .then(r => r.json())
      .then(d => setSettings(d as ElectricSettingsResponse))
      .catch(() => setError("Elektro-Einstellungen konnten nicht geladen werden"));
  };
  useEffect(load, []);
  return { settings, error, reload: load };
}

const box = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 20, marginBottom: 16 } as const;
const input = { padding: "8px 10px", fontSize: 14, border: "2px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" } as const;
const btn = { padding: "8px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none", background: "#FFD700", color: "#0F172A", cursor: "pointer", fontFamily: "inherit" } as const;

export function ElectricSettingsCard() {
  const { settings, error } = useElectricSettings();
  const [weee, setWeee] = useState("");
  const [types, setTypes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (settings) { setWeee(settings.weeeRegNr ?? ""); setTypes(settings.registeredDeviceTypes.join(", ")); }
  }, [settings]);

  const save = async () => {
    if (!isValidWeeeNr(weee)) { setMsg({ ok: false, text: 'Ungültig — Format: "DE" + 8 Ziffern (oder leer lassen)' }); return; }
    setMsg(null);
    try {
      const r = await fetch("/api/settings/electric", {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ weeeRegNr: weee.trim() === "" ? null : weee, registeredDeviceTypes: types.split(",").map(s => s.trim()).filter(Boolean) }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      setMsg(d.ok ? { ok: true, text: "Gespeichert ✓" } : { ok: false, text: d.error || "Speichern fehlgeschlagen" });
    } catch { setMsg({ ok: false, text: "Netzwerkfehler beim Speichern" }); }
  };

  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 22 }}>🔌</span>
        <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>Elektro (Kat. 5 Kleingeräte)</span>
      </div>
      <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
        Elektro-Artikel werden nur gelistet, wenn die WEEE-Reg.-Nr. eingetragen ist, die Geräteart registriert ist, keine Batterie/kein Akku enthalten ist und alle Nachweise am Produkt vorliegen. Die Nummer wird nie vorbelegt — sie trägt der Inhaber selbst ein.
      </p>
      {error && <div style={{ fontSize: 12, color: "#DC2626", marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>WEEE-Reg.-Nr. (DE + 8 Ziffern)
          <input value={weee} onChange={e => setWeee(e.target.value)} placeholder="DE________" style={{ ...input, display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#475569" }}>Registrierte Gerätearten (Komma-getrennt; nur der Inhaber erweitert)
          <input value={types} onChange={e => setTypes(e.target.value)} style={{ ...input, display: "block", width: "100%", marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 12, color: "#64748B", display: "flex", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={settings?.batteryRegistration ?? false} disabled /> Batterie-Registrierung vorhanden — fest AUS (Artikel mit Batterie/Akku werden nie gelistet)
        </label>
        <div style={{ fontSize: 12, color: "#64748B" }}>
          EAR-Umlage je Stück (Kosten in der Preisformel bei Elektro = ja): <b>{settings ? settings.earUmlageEur.toFixed(2).replace(".", ",") : "–"} €</b> (Konstante, legt der Inhaber fest)
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={save} style={btn}>Speichern</button>
        {msg && <span style={{ fontSize: 12, fontWeight: 600, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</span>}
        <a href="/api/electric/sales-export.csv" style={{ fontSize: 12, fontWeight: 600, color: "#2563EB" }}>CSV: Elektro-Verkäufe je Geräteart und Monat ↓</a>
      </div>
    </div>
  );
}

export interface ElectricProductFields {
  id: number;
  isElectric?: number | null;
  electricSuggested?: number | null;
  deviceType?: string | null;
  hasBattery?: number | null;
  electricProofs?: string | null;
}

export function ElectricPanel({ product, onSaved }: { product: ElectricProductFields; onSaved: (patch: Partial<ElectricProductFields>) => void }) {
  const { settings } = useElectricSettings();
  const [isElectric, setIsElectric] = useState<number | null>(product.isElectric ?? null);
  const [deviceType, setDeviceType] = useState(product.deviceType ?? "");
  const [hasBattery, setHasBattery] = useState(!!product.hasBattery);
  const [proofs, setProofs] = useState(parseElectricProofs(product.electricProofs));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const suggested = !!product.electricSuggested && isElectric === null;

  const setProof = (k: ProofKey, patch: Partial<{ ok: boolean; note: string }>) =>
    setProofs(p => ({ ...p, [k]: { ok: p[k]?.ok ?? false, note: p[k]?.note ?? "", ...patch } }));

  const gateSettings: ElectricSettings = { weeeRegNr: settings?.weeeRegNr ?? null, registeredDeviceTypes: settings?.registeredDeviceTypes ?? [] };
  const gate = evaluateElectricGate(
    { isElectric, electricSuggested: product.electricSuggested, deviceType, hasBattery, electricProofs: JSON.stringify(proofs) },
    gateSettings,
  );

  const save = async () => {
    setMsg(null);
    try {
      const r = await fetch(`/api/products/${product.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ isElectric: isElectric === null ? null : isElectric === 1, deviceType: deviceType || null, hasBattery, electricProofs: proofs }),
      });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (d.ok) {
        setMsg({ ok: true, text: "Gespeichert ✓" });
        onSaved({ isElectric, deviceType: deviceType || null, hasBattery: hasBattery ? 1 : 0, electricProofs: JSON.stringify(proofs) });
      } else setMsg({ ok: false, text: d.error || "Speichern fehlgeschlagen" });
    } catch { setMsg({ ok: false, text: "Netzwerkfehler beim Speichern" }); }
  };

  return (
    <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: `1px solid ${suggested ? "#FACC15" : "#E2E8F0"}`, background: suggested ? "#FEFCE8" : "#F8FAFC" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
        <span style={{ fontWeight: 700, color: "#475569" }}>🔌 Elektro</span>
        {suggested && <span style={{ fontWeight: 700, color: "#A16207", background: "#FEF08A", padding: "2px 6px", borderRadius: 6 }}>Elektro?</span>}
        <select value={isElectric === null ? "" : String(isElectric)} onChange={e => setIsElectric(e.target.value === "" ? null : Number(e.target.value))} style={{ ...input, padding: "3px 6px", fontSize: 11 }}>
          <option value="">offen (nicht entschieden)</option>
          <option value="1">ja</option>
          <option value="0">nein</option>
        </select>
        <select value={deviceType} onChange={e => setDeviceType(e.target.value)} disabled={isElectric !== 1} style={{ ...input, padding: "3px 6px", fontSize: 11 }}>
          <option value="">Geräteart wählen…</option>
          {(settings?.registeredDeviceTypes ?? []).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={hasBattery} onChange={e => setHasBattery(e.target.checked)} /> enthält Batterie/Akku
        </label>
      </div>
      {isElectric === 1 && (
        <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
          {PROOF_KEYS.map(k => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 290 }}>
                <input type="checkbox" checked={proofs[k]?.ok ?? false} onChange={e => setProof(k, { ok: e.target.checked })} /> {PROOF_LABELS[k]}
              </label>
              <input value={proofs[k]?.note ?? ""} onChange={e => setProof(k, { note: e.target.value })} placeholder="Beleg (Text oder Link, intern)" style={{ ...input, padding: "3px 6px", fontSize: 11, flex: 1 }} />
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <button onClick={save} style={{ ...btn, padding: "4px 10px", fontSize: 11 }}>Elektro speichern</button>
        {gate.blocked
          ? <span style={{ fontSize: 11, fontWeight: 600, color: "#DC2626" }}>Listen gesperrt — {gate.message}</span>
          : <span style={{ fontSize: 11, fontWeight: 600, color: "#16A34A" }}>{isElectric === 1 ? "Elektro-Sperre: alles erfüllt" : "kein Elektro-Artikel"}</span>}
        {msg && <span style={{ fontSize: 11, fontWeight: 600, color: msg.ok ? "#16A34A" : "#DC2626" }}>{msg.text}</span>}
      </div>
    </div>
  );
}
