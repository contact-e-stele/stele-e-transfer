// OFFEN 030 Weg B (ENTSCHEIDUNG Inhaber 04.11.2026 21:56): Knopf legt die Versandrichtlinien "Versand aus China" und
// "Versand aus EU-Lager" im eBay-Konto an. Regeln in shared/fulfillment-policy.ts; hier nur Anzeige + zweistufige Bestätigung.
// Keine Standardwerte: Bearbeitungszeit und (EU) Versandservice müssen gewählt werden, sonst bleibt der Knopf aus.
import { useEffect, useState } from "react";
import type { FulfillmentPolicyInfo, PolicyOrigin, ShippingServiceOption } from "../../shared/fulfillment-policy";

interface StatusRow { origin: PolicyOrigin; name: string; existing: FulfillmentPolicyInfo[]; services: ShippingServiceOption[] }

const box = { background: "#fff", border: "1px solid #E2E8F0", borderRadius: 12, padding: 20, marginBottom: 16 } as const;
const sel = { padding: "8px 10px", fontSize: 14, border: "2px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" } as const;
const btn = { padding: "8px 16px", fontSize: 13, fontWeight: 700, borderRadius: 8, border: "none", background: "#FFD700", color: "#0F172A", cursor: "pointer", fontFamily: "inherit" } as const;

function PolicyRow({ row, days, onDone }: { row: StatusRow; days: readonly number[]; onDone: () => void }) {
  const [handling, setHandling] = useState<string>("");
  const [service, setService] = useState<string>(row.services.length === 1 ? row.services[0].code : "");
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (row.existing.length > 0) {
    return (
      <div style={{ fontSize: 13, marginBottom: 10 }}>
        🟢 <b>{row.name}</b> ist im Konto: {row.existing.map(p => `${p.id} · Bearbeitung ${p.handlingDays ?? "?"} Tage · ${p.services.join(", ")}`).join(" | ")}
        {row.existing.length > 1 && <span style={{ color: "#B91C1C" }}> — mehrfach vorhanden, bitte im Seller Hub bereinigen</span>}
      </div>
    );
  }

  const ready = handling !== "" && service !== "";
  const svc = row.services.find(s => s.code === service);
  const create = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/ebay/origin-policies/create", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ origin: row.origin, handlingDays: Number(handling), serviceCode: service, confirm: true }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error ?? String(r.status));
      setMsg({ ok: true, text: `Angelegt: ${d.name} (${d.fulfillmentPolicyId})` });
      onDone();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); setArmed(false); }
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>🔴 <b>{row.name}</b> fehlt im Konto</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <select style={sel} value={service} onChange={e => { setService(e.currentTarget.value); setArmed(false); }}>
          {row.services.length > 1 && <option value="">— Versandservice wählen —</option>}
          {row.services.map(s => <option key={s.code} value={s.code}>{s.label} ({s.transit})</option>)}
        </select>
        <select style={sel} value={handling} onChange={e => { setHandling(e.currentTarget.value); setArmed(false); }}>
          <option value="">— Bearbeitungszeit wählen —</option>
          {days.map(d => <option key={d} value={String(d)}>{d} {d === 1 ? "Tag" : "Tage"}</option>)}
        </select>
        {!armed
          ? <button style={{ ...btn, opacity: ready ? 1 : 0.5, cursor: ready ? "pointer" : "not-allowed" }} disabled={!ready || busy} onClick={() => setArmed(true)}>Anlegen …</button>
          : <>
              <button style={{ ...btn, background: "#16A34A", color: "#fff" }} disabled={busy} onClick={create}>{busy ? "lege an …" : "Wirklich bei eBay anlegen"}</button>
              <button style={{ ...btn, background: "#F1F5F9" }} disabled={busy} onClick={() => setArmed(false)}>Abbrechen</button>
            </>}
      </div>
      {armed && svc && (
        <div style={{ fontSize: 12, color: "#92400E", marginTop: 6 }}>
          Wird im eBay-Konto angelegt: „{row.name}“ · {svc.label} ({svc.code}, {svc.transit} laut eBay) · Bearbeitung {handling} Tage · Versand kostenlos · nur Deutschland.
        </div>
      )}
      {!ready && <div style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>Bearbeitungszeit erst nach dem Gegencheck der Agenten eintragen (Inhaber 21:56).</div>}
      {msg && <div style={{ fontSize: 13, marginTop: 6, color: msg.ok ? "#15803D" : "#B91C1C" }}>{msg.text}</div>}
    </div>
  );
}

export function OriginPolicyCard() {
  const [rows, setRows] = useState<StatusRow[] | null>(null);
  const [days, setDays] = useState<readonly number[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    setErr(null);
    fetch("/api/ebay/origin-policies", { credentials: "include" }).then(r => r.json())
      .then(d => { if (d.error) setErr(d.error); else { setRows(d.status as StatusRow[]); setDays(d.allowedHandlingDays ?? []); } })
      .catch(e => setErr(String(e)));
  };
  useEffect(load, []);
  return (
    <div style={box}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 22 }}>📦</span>
        <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>Versandrichtlinien je Herkunft (eBay-Konto)</span>
      </div>
      <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
        Damit eBays Lieferschätzung zur Fußzeile passt, braucht jedes Angebot die Richtlinie seiner Herkunft. Der Knopf legt sie einmalig an — nie doppelt, nie überschreibend.
      </p>
      {err && <div style={{ fontSize: 13, color: "#B91C1C" }}>eBay-Konto nicht lesbar: {err}</div>}
      {rows?.map(r => <PolicyRow key={r.origin} row={r} days={days} onDone={load} />)}
    </div>
  );
}
