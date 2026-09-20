# Design-Vorgabe v1 – STELE-DS-APP

Quelle: Drive-Ordner Design, DESIGN-VORGABE v1 (Ergebnis der Design-Stunde, 20.09.2026).

**Grundregeln:** nur Darstellung, keine Logik. Tabu: Preislogik, DB, Crons, Workflow-Text,
`bestellungen.tsx` und `produkte.tsx` bis PR 112 und P-88 durch sind. Tab-Adressen bleiben gleich.

## 1. Handy zuerst (Mobile-first)
Navigation als Leiste unten mit 5 Symbolen (Übersicht | Sortiment | Listings | Aufträge | Werkzeuge),
große Knöpfe, Karten untereinander. Am PC dieselbe Ansicht breiter (2–3 Spalten). Die Adressen bleiben
unverändert, die Gruppierung betrifft nur die Anzeige.

## 2. Farbwelt: hell UND dunkel
Automatisch nach Handy-Einstellung. Umsetzung: erst hell, dann dunkel.

Markenfarben (gemessen am Originallogo), als CSS-Variablen in `styles.css` (`:root`):

| Token | Wert | Name |
|---|---|---|
| `--stele-black` | #060604 | Tiefschwarz |
| `--stele-anthracite` | #1E1810 | Anthrazit |
| `--stele-gold` | #D6AD63 | Gold hell |
| `--stele-gold-dark` | #A8803D | Gold mittel |
| `--stele-bronze` | #825139 | Bronze |
| `--stele-violet` | #96566B | Violett-Rosé |
| `--stele-cream` | #F9E9D2 | Creme |
| `--stele-bg` | #F9F7F2 | Arbeitsfläche hell (Hintergrund) |

- Kopfleiste und Navigation: Schwarz mit Gold.
- Knöpfe: Gold.
- Arbeitsfläche: hell (Tag) bzw. Anthrazit (Nacht).
- Signalfarben in beiden Modi gleich: Grün = ok, Gelb = prüfen, Rot = Fehler.

## 3. Übersicht (neuer Start-Tab) mit 6 Kacheln
Offene Bestellungen | Sendungsnummer fehlt | Sendungen über 20 Tage | Produkt-Fehler | Preisalarme |
Verbindungen (Token/eBay/Gmail). Später: Listings mit Problem, Retouren.
Farbe: 0 = grau, zu tun = gelb, dringend = rot. Ein Tipp öffnet die gefilterte Liste.

## 4. Listings-Reiter
Alle | Achtung (Preisprüfung > 14 Tage, Preisalarm) | Ohne App | Mit Verkäufen.
„Beendet“ und „Gesperrt“ kommen erst, wenn der eBay-Abgleich stimmt.
Die Einmal-Aktionen wandern nach Werkzeuge.

## 5. Listing-Karte kompakt
Zeile 1: Bild/Titel/Statuspunkt. Zeile 2: VK/Marge %/Verkäufe. Sichtbar nur „eBay“ und „AliExpress“.
Im Menü „⋯“: Bearbeiten, Anzeigentarif, Preis prüfen, Beenden (mit Sicherheitsabfrage).
Ein Tipp auf die Karte zeigt die Details.

## 6. Logo / App-Symbol
Löwenkopf aus `stele_glossy_512.png` auf Schwarz, ohne Schrift (Browser-Tab und Startbildschirm).
Kopfleiste: kleiner Löwe (`logo-header.png`, 32 px) + „STELE“ in Gold.
Das Abzeichen „Made with Runable“ entfällt.

## Umsetzungs-Reihenfolge (je ein Draft-PR, Nutzer mergt, Claude prüft live)
0. Design-Agents installieren
1. Farben hell + Logo/Symbol + Runable-Abzeichen weg + design.md durch v1 ersetzen
2. Dunkler Modus
3. Handy-Leiste unten / Navigation gruppiert (Adressen gleich)
4. Listings: Reiter + kompakte Karten
5. Übersicht-Tab (Zähl-Abfragen liefert App-Arbeit)
6. Import (URL nach oben) + Einstellungen gliedern
7. Bestellungen + Produkte – erst nach PR 112 und P-88

Vor jedem Schritt: kurze Rückmeldung an App-Arbeit, ob Konflikte bestehen.
