// P-2611-25E: Knopf „Lagerort eintragen“ zur Meldung „Kein Lagerort für Herkunft XX …“ — in der frischen Listen-Meldung UND in der
// gespeicherten ebayError-Box. Springt nach Einstellungen › Lagerorte (#lagerort-XX); gespeichert wird dort erst mit „Speichern“.
import { lagerortIsoFromError, lagerortLink } from "../../shared/klapp-status";

export function LagerortKnopf({ msg, navigate }: { msg: string | null | undefined; navigate: (to: string) => void }) {
  const iso = lagerortIsoFromError(msg);
  if (!iso) return null;
  const to = lagerortLink(iso);
  return (
    <a href={to} data-testid="lagerort-eintragen"
      onClick={e => {
        e.preventDefault();
        navigate(to);
        // pushState löst kein hashchange aus — die schon offene Einstellungen-Seite soll den Sprung trotzdem sehen.
        if (typeof window !== "undefined") window.dispatchEvent(new HashChangeEvent("hashchange"));
      }}
      style={{ display: "inline-block", marginLeft: 8, marginTop: 6, padding: "3px 8px", borderRadius: 6, background: "#FFD700", color: "#0F172A", fontWeight: 700, fontSize: 11, textDecoration: "none" }}>
      Lagerort eintragen
    </a>
  );
}
