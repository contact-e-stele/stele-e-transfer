// P-94: Zentrale, in der App editierbare Vorlage für den "Workflow kopieren"-Text
// (Bestellungen-Tab). Wird in app_settings (Key "workflow_template") gespeichert und über
// GET/PUT /api/settings/workflow-template gelesen/geschrieben. Diese Konstante ist nur der
// Startinhalt (Seed) — die tatsächlich verwendete Fassung ist die in der DB gespeicherte
// (siehe Einstellungen-Tab), sobald einmal gespeichert wurde.
//
// WICHTIGE REGEL für jede künftige Aktualisierung dieses Texts (auch für Claude Code):
// Neue Version immer gegen die vorherige vergleichen, nur ergänzen/verbessern, niemals
// bestehende Punkte einfach löschen. Grundstruktur (Rolle, Schritte 1-6, Effizienz-Hinweis)
// bleibt erhalten.
//
// Platzhalter, die beim Kopieren einer konkreten Bestellung ersetzt werden:
//   {{ORDER_ID}}           — eBay-Bestellnummer
//   {{EBAY_LISTING_URL}}   — Link zum eBay-Listing (oder Hinweistext, falls keiner bekannt)
//   {{ALIEXPRESS_URL}}     — Link zum AliExpress-Artikel (oder Hinweistext, falls keiner bekannt)
//   {{ORDER_TOTAL}}        — eBay-Verkaufspreis (Betrag + Währung)
//   {{SICHERHEITS_CHECK}}  — Hinweissatz, ob schon eine AliExpress-Bestellnummer eingetragen ist
export const WORKFLOW_TEMPLATE_PLACEHOLDERS = [
  "{{ORDER_ID}}",
  "{{EBAY_LISTING_URL}}",
  "{{ALIEXPRESS_URL}}",
  "{{ORDER_TOTAL}}",
  "{{SICHERHEITS_CHECK}}",
] as const;

export const DEFAULT_WORKFLOW_TEMPLATE = `## Rolle

Du hilfst mir, eine offene Bestellung im Dropshipping-Geschäft **stele-e-transfer** bis kurz vor dem Kauf bei AliExpress vorzubereiten. Du analysierst, vergleichst und bereitest alles vor — **die eigentliche Zahlung löse ausschließlich ich selbst manuell aus.**

## Schritt 1 — Bestellung in der App analysieren

1. Öffne \`stele-e-transfer.onrender.com/bestellungen\`
2. Finde die Bestellung {{ORDER_ID}} (siehe Bestelldaten oben — bereits erfasst)
3. Produkt, Menge, Käufername, Netto-Erwartung: siehe Bestelldaten oben
4. **Wichtiger Sicherheits-Check:** {{SICHERHEITS_CHECK}}

## Schritt 2 — eBay-Bestellung gegenprüfen

1. Klick auf den "Zum eBay-Listing"-Link (oder direkt in eBay Seller Hub) → {{EBAY_LISTING_URL}}
2. Bestätige: exakte bestellte Variante, Menge, Verkaufspreis
3. **Lieferadresse des Käufers exakt kopieren** (Straße, Hausnummer, PLZ, Ort, Land) — nicht abtippen, direkt kopieren, um Tippfehler zu vermeiden (siehe Adresse oben, zur eBay-Seite gegenprüfen)

## Schritt 3 — AliExpress-Lieferant analysieren

1. Klick auf "Zum AliExpress-Artikel" → {{ALIEXPRESS_URL}}
2. Prüf: aktueller Preis für die exakt richtige Variante (SKU-Abgleich, nicht nur Produkt)
3. **Bewertungs-Check** (wie unsere App-Ampel): Sternebewertung + Anzahl Bewertungen — bei sehr wenigen/schlechten Bewertungen kurz mit mir Rücksprache halten
4. Optional: 1-2 alternative Anbieter desselben Produkts suchen, falls spürbar günstiger UND ähnlich gut bewertet — sonst beim bekannten Lieferanten bleiben (Zuverlässigkeit vor kleiner Ersparnis)
5. **Margen-Gegenprüfung:** Aktueller AliExpress-Preis + Versandkosten vs. eBay-Verkaufspreis ({{ORDER_TOTAL}}) — reicht die Marge noch (inkl. eBay-Gebühren, Zoll falls China-Versand)? **Falls die Marge zu gering/negativ ist → STOPP, mich informieren, bevor irgendetwas in den Warenkorb gelegt wird**

## Schritt 4 — Bestellung bei AliExpress vorbereiten

1. Richtige Variante auswählen, Menge eintragen
2. Lieferadresse aus Schritt 2 eintragen (exakt, nochmal gegenlesen)
3. Verfügbare Coupons/Rabatte prüfen und anwenden, falls vorhanden
4. Versandmethode mit **Sendungsverfolgung** wählen (wichtig für unsere automatische Tracking-Übermittlung an eBay)
5. Gesamtpreis (Ware + Versand) final notieren

## Schritt 5 — STOPP vor der Zahlung

**Nicht weitermachen.** Fass mir kurz zusammen:
- Gewählter Lieferant + Variante + Preis
- Lieferadresse (zur Kontrolle)
- Gesamtkosten inkl. Versand
- Erwartete Marge nach Abzug aller Kosten
- Voraussichtliche Lieferzeit

**Warte auf meine ausdrückliche Bestätigung**, bevor irgendein Zahlungsschritt ausgeführt wird. Keine Zahlungsdaten eingeben, keinen "Kaufen/Bezahlen"-Button klicken ohne meine Freigabe.

---

## Schritt 6 — Nach dem Kauf (von mir manuell bestätigt)

Sobald ich Dir sage, dass der Kauf abgeschlossen ist:

1. **AliExpress-Bestellnummer im Bestellungen-Tab eintragen** — nicht vergessen, sonst fehlt später die Zuordnung
2. **AliExpress-Rechnung herunterladen und im Bestellungen-Tab hochladen** (für die Buchhaltung)
3. **Sendungsnummer prüfen, aber nicht erzwingen:** Schau nach, ob AliExpress schon eine Sendungsnummer zeigt.
   - **Falls ja:** direkt im Bestellungen-Tab eintragen (wird dann automatisch an eBay übermittelt)
   - **Falls noch nicht verfügbar** (kommt oft erst nach 1-2 Tagen): **nicht warten, nicht blockieren** — einfach vermerken "Sendungsnummer folgt später", ich trage sie selbst nach, sobald sie da ist (oder unsere automatische Gmail-Erkennung findet sie von selbst)

---

*Effizienz-Hinweis für den Agenten: Arbeite die Schritte zügig und ohne unnötige Zwischenfragen ab — nur bei den explizit markierten STOPP-Punkten (Duplikat-Verdacht, zu geringe Marge, vor der Zahlung) tatsächlich anhalten und nachfragen. Je konsistenter der Ablauf, desto schneller und fehlerärmer wird er bei jeder weiteren Bestellung.*`;

export function renderWorkflowTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(key).join(value);
  }
  return result;
}
