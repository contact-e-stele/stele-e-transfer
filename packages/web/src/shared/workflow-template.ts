// P-94: Zentrale, in der App editierbare Vorlage für den "Workflow kopieren"-Text
// (Bestellungen-Tab). Wird in app_settings (Key "workflow_template") gespeichert und über
// GET/PUT /api/settings/workflow-template gelesen/geschrieben. Diese Konstante ist nur der
// Startinhalt (Seed) — die tatsächlich verwendete Fassung ist die in der DB gespeicherte
// (siehe Einstellungen-Tab), sobald einmal gespeichert wurde.
//
// WICHTIGE REGEL für jede künftige Aktualisierung dieses Texts (auch für Claude Code):
// Neue Version immer gegen die vorherige vergleichen, nur ergänzen/verbessern, niemals
// bestehende Punkte einfach löschen. Grundstruktur (Rolle, Schritte 1-11, Effizienz-Hinweis)
// bleibt erhalten.
//
// P-94-Update (2026-08-31): um die vollständige, vom Nutzer zusammengeführte Checkliste
// erweitert (Coins/Coupons/Cashback/Choice-Listing vor dem Checkout, manuelle eBay-Notiz
// nach dem Kauf — bewusst über die normale eBay-Weboberfläche, nicht per API, siehe P-93
// Teil 1 — Kundennachricht nach Zahlungsbestätigung, "Als verschickt markieren" als eigener
// Schritt, Zustellungs-/Bewertungsbitte-Hinweis, Verbesserungsvorschläge am Ende). Bestehende
// Punkte (Duplikat-Sicherheits-Check, SKU-genauer Preisvergleich, alternative Anbieter,
// Effizienz-Hinweis) blieben erhalten, nur neu einsortiert.
//
// P-94-Update (2026-09-01, nach erstem kompletten Live-Durchlauf Bestellung 10-15108-86230):
// Schritt 3 um Variante-nicht-automatisch-ausgewählt-Hinweis und Stückzahl-/Niedrigbestand-
// Check ergänzt; Schritt 7 Rechnungs-Zeile um "Herunterladen" (statt "E-Mail senden")-Hinweis
// erweitert. Bestehende Punkte unverändert, nur ergänzt. ACHTUNG: greift live erst, sobald
// jemand die Vorlage im Einstellungen-Tab neu speichert (oder erstmals speichert) — solange
// ein gespeicherter app_settings-Eintrag existiert, liefert GET weiter dessen Inhalt statt
// dieses aktualisierten Startinhalts (siehe Kommentar oben, Zeile 4-5).
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

⚠️ Bestell-Workflow – bitte Schritt für Schritt abarbeiten:

## Schritt 1 — Bestellung in der App & bei eBay gegenprüfen

1. Öffne \`stele-e-transfer.onrender.com/bestellungen\`
2. Finde die Bestellung {{ORDER_ID}} (siehe Bestelldaten oben — bereits erfasst)
3. Produkt, Menge, Käufername, Netto-Erwartung: siehe Bestelldaten oben
4. Klick auf den "Zum eBay-Listing"-Link (oder direkt in eBay Seller Hub) → {{EBAY_LISTING_URL}} — bestätige: exakte bestellte Variante, Menge, Verkaufspreis
5. **Wichtiger Sicherheits-Check (Duplikat):** {{SICHERHEITS_CHECK}}

## Schritt 2 — Lieferadresse

1. **NICHT die gespeicherte/zuletzt genutzte AliExpress-Adresse ungeprüft übernehmen** (stammt oft vom vorherigen Kunden) — für diesen Käufer neu anlegen bzw. gegen die Bestelldaten der App prüfen
2. **Lieferadresse des Käufers exakt kopieren** (Straße, Hausnummer, PLZ, Ort, Land) — nicht abtippen, direkt kopieren, um Tippfehler zu vermeiden (siehe Adresse oben, zur eBay-Seite gegenprüfen)

## Schritt 3 — AliExpress-Lieferant analysieren

1. Klick auf "Zum AliExpress-Artikel" → {{ALIEXPRESS_URL}}
2. Falls die Seite beim Öffnen des Links nicht automatisch auf der bestellten Variante landet, aktiv im Bildauswahlbereich die passende Variante anklicken und den Preis danach neu prüfen — der Link führt nicht immer zuverlässig zur richtigen Variante.
3. Prüf: aktueller Preis für die exakt richtige Variante (SKU-Abgleich, nicht nur Produkt)
4. Verfügbare Stückzahl prüfen (steht meist bei der Mengenauswahl, z.B. "Nur noch X übrig"). Bei sehr niedrigem Bestand (weniger als 5 Stück) kurz Rücksprache halten, bevor gekauft wird.
5. **Bewertungs-Check** (wie unsere App-Ampel): Sternebewertung + Anzahl Bewertungen — bei sehr wenigen/schlechten Bewertungen kurz mit mir Rücksprache halten
6. Optional: 1-2 alternative Anbieter desselben Produkts suchen, falls spürbar günstiger UND ähnlich gut bewertet — sonst beim bekannten Lieferanten bleiben (Zuverlässigkeit vor kleiner Ersparnis)

## Schritt 4 — Vor dem Checkout

1. Vorhandene Coins einlösen
2. Shop- und Plattform-Coupons prüfen/kombinieren
3. Cashback-Link (z.B. TopCashback) mit leerem Warenkorb aufrufen, bevor der Artikel in den Warenkorb gelegt wird; Adblocker aus
4. Choice-Listing nur bei kritischem Liefertermin wählen (10-25% teurer, dafür 5-10 statt 15-45 Tage Versand), sonst günstigstes geprüftes Standard-Listing
5. Richtige Variante auswählen, Menge eintragen
6. Lieferadresse aus Schritt 2 eintragen (exakt, nochmal gegenlesen)
7. Versandmethode mit **Sendungsverfolgung** wählen (wichtig für unsere automatische Tracking-Übermittlung an eBay)

## Schritt 5 — Margen-Gegenprüfung

Aktueller AliExpress-Preis + Versandkosten + geschätzte Einfuhrabgaben aus dem AliExpress-Checkout (nicht nur Artikelpreis + Versand!) vs. eBay-Verkaufspreis ({{ORDER_TOTAL}}) — reicht die Marge noch (inkl. eBay-Gebühren, Zoll falls China-Versand)? **Falls die Marge zu gering/negativ ist → STOPP, mich informieren, bevor irgendetwas in den Warenkorb gelegt wird**

## Schritt 6 — STOPP vor der Zahlung

**Nicht weitermachen.** Fass mir kurz zusammen:
- Gewählter Lieferant + Variante + Preis
- Lieferadresse (zur Kontrolle)
- Gesamtkosten inkl. Versand
- Erwartete Marge nach Abzug aller Kosten
- Voraussichtliche Lieferzeit

**Warte auf meine ausdrückliche Bestätigung**, bevor irgendein Zahlungsschritt ausgeführt wird. Keine Zahlungsdaten eingeben, keinen "Kaufen/Bezahlen"-Button klicken ohne meine Freigabe. Die Zahlung führe ich selbst manuell aus.

---

## Schritt 7 — Nach Zahlungsbestätigung (von mir manuell bestätigt)

Sobald ich Dir sage, dass der Kauf abgeschlossen ist:

□ **AliExpress-Bestellnummer im Bestellungen-Tab eintragen** — nicht vergessen, sonst fehlt später die Zuordnung
□ **eBay-Notiz anlegen:** Bestellseite → "Einzelheiten zum Kauf" → "Weitere Aktionen" → "Notiz hinzufügen" → AliExpress-Bestellnr. als Text (über die normale eBay-Weboberfläche, nicht per API)
□ **AliExpress-Rechnung herunterladen und im Bestellungen-Tab hochladen** (für die Buchhaltung) — beim Rechnungs-Download bietet AliExpress oft zwei Optionen ("Herunterladen" und "E-Mail senden") — immer "Herunterladen" wählen, die Datei muss lokal vorliegen, um sie ins Bestellungen-Tab hochzuladen
□ **Kundennachricht per eBay-Nachricht senden:** "Ware wird verpackt, Lieferadresse geprüft, Sendungsnummer folgt nach Versand"

## Schritt 8 — Als verschickt markieren

Bei eBay: führe ich selbst manuell aus, erst nach echtem Versand.

## Schritt 9 — Sendungsnummer

Sobald die echte Sendungsnummer vorliegt: im Bestellungen-Tab eintragen (App übermittelt automatisch an eBay). **Falls noch nicht verfügbar** (kommt oft erst nach 1-2 Tagen): **nicht warten, nicht blockieren** — einfach vermerken "Sendungsnummer folgt später", ich trage sie selbst nach, sobald sie da ist (oder unsere automatische Gmail-Erkennung findet sie von selbst)

## Schritt 10 — Zustellung erkannt

Bewertungsbitte-Entwurf wird erstellt, ich bestätige/versende selbst.

## Schritt 11 — Abschließend

Verbesserungsvorschläge aus diesem Durchlauf kurz benennen.

---

*Effizienz-Hinweis für den Agenten: Arbeite die Schritte zügig und ohne unnötige Zwischenfragen ab — nur bei den explizit markierten STOPP-Punkten (Duplikat-Verdacht, zu geringe Marge, vor der Zahlung) tatsächlich anhalten und nachfragen. Je konsistenter der Ablauf, desto schneller und fehlerärmer wird er bei jeder weiteren Bestellung.*`;

export function renderWorkflowTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(key).join(value);
  }
  return result;
}
