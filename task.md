# Stele App — Task Board

> Session-Scratchpad für aktuell offene Arbeit. Feature-Historie/Roadmap: `P-UEBERSICHT.md`.
> Architektur-Details: `docs/ARCHITECTURE.md`.

## NOCH OFFEN
1. **P-27/P-28-Gebührensatz-Check (2026-09-06, aktiv):** Nutzer meldete realen Testkauf mit ~20,27% eBay-Gebühr (3,03€/14,95€). Befund: `calcSellPrice()` nimmt bei Standard-`adRate=5%` bereits 21,4% an (`(13+adRate)/100×1.19`) — das liegt ÜBER dem beobachteten Wert, also kein offensichtlicher katalogweiter Unterpreisungs-Fehler. Braucht aber Bestätigung anhand des KONKRETEN Testkauf-Produkts (buyPrice/adRate/shipsFrom/sellPrice aus dem Produkte-Tab) — Nutzer hat zugesagt, selbst nachzuschauen, Rückmeldung steht noch aus. WICHTIG: die eigentliche P-27/P-28-Dauerlösung (Varianten-fähige automatische Preisprüfung) ist bereits vollständig gebaut und gemergt (Commit `98c0a16`, PR #47) — alle 5 Kernanforderungen aus einem erneuten `/goal`-Auftrag wurden gegen den Code geprüft und sind bereits erfüllt (siehe Requirement-Audit in der Session vom 2026-09-06). Anforderung 3 ("niedrigsten sicheren Preis") war ein Versehen im Auftragstext — bestätigt: Maximum (höchster Varianten-Mindestpreis) bleibt korrekt, wie bereits implementiert.
2. **eBay "Käufe/Verkäufe außerhalb eBay"-Fehlalarm (2026-09-06, neu entdeckt):** Artikel 198601064695 ("Katzenstreuschaufel Set Groß & Klein") wurde laut Gmail 5× in 2 Tagen (04.-05.09.) von eBay automatisch ausgeblendet wegen vermutetem Verstoß gegen den Grundsatz zu Käufen/Verkäufen außerhalb eBay — vermutlich ein Fehlalarm der automatischen Erkennung (Text/Bild löst fälschlich an). Während ausgeblendet: nicht kaufbar, aber auch keine Angebotsgebühr. Noch nicht untersucht, welcher Listing-Inhalt den Trigger auslöst — separates Thema von P-27/P-28.
3. Live-Test-Bestätigung ausstehend für PR #63 (P-100/P-101, gemergt) — mind. eine der 8 betroffenen Bestellungen (z.B. Caner San) soll nach dem Fix einen Bewertungsbitte-Entwurf oder eine P-99-Warnung zeigen
4. GPSR structured fields — `ae_store_info` liefert nur den Shop-Namen; Hersteller-Adressdaten (Name/Adresse/Stadt/E-Mail/Telefon) werden nicht automatisch aus der API-Antwort geparst → GPSR-Felder bleiben manuelle Pflege im Produkte-Tab
5. Playwright/Chromium auf Render Free Tier (ETXTBSY) — kein Fix möglich ohne Paid Tier, ScrapingAnt trägt den Scraping-Pfad
6. Gemini Overload fallback — läuft, aber intermittierend (503 bei Überlastung, Fallback-Beschreibung greift automatisch)
7. Preis-Cron "Alert bei Änderung" — aktuell nur visuelles Flag (gelber Rahmen in Produkte-Tab), keine aktive Benachrichtigung bei Preissprüngen
8. P-Nummernkollisionen zwischen parallelen Sessions kommen wiederholt vor (u.a. P-90, P-93 doppelt vergeben) — beim Vergeben einer neuen Nummer vorher `P-UEBERSICHT.md` UND `git log --oneline origin/main | grep -i "P-"` gegenprüfen
9. Gmail-DB-Backup-Anhänge (stele-db-*.json) lassen sich aus dieser Sandbox nicht mehr programmatisch dekodieren — der Auto-Mode-Classifier blockiert das Parsen der rohen MIME-Nachricht (auch wenn der Anhang nur Produkt-/Preisdaten ohne Kundendaten enthält). Eine frühere Session (P-27/P-28-Commit) konnte das offenbar noch. Für künftige Live-Verifizierung ggf. den Nutzer um die konkreten Werte bitten statt den vollen Export zu ziehen.

## LETZTE GRÖSSERE ARBEIT (diese Session, chronologisch)
- ✅ P-89 bis P-92: eBay-Pflichtfeld-Fehler (errorId 25002) bei Varianten-Listings behoben, generische Selbstheilung mit Kandidatenliste für unbekannte Pflichtaspekte
- ✅ P-95 (im Auftrag "P-88" genannt, Nummer bereits vergeben): manuelles Eingabefeld im Produkte-Tab für Pflichtfelder, die die Selbstheilung nicht befüllen konnte (Dropdown/Freitext je nach eBay-Werteliste)
- ✅ P-94-Updates: Workflow-Vorlage um "Phase 0 — Session-Start-Rundgang", drei Live-Durchlauf-Ergänzungen (Schritt 3/7) und Schritt-10-Sicherheitshinweis ("NIEMALS automatisch versenden") erweitert
- ✅ P-96/P-97/P-99: Zustellungs-Erkennung für Bewertungsbitten verbreitert (mehr E-Mail-Formulierungen erkannt) + Zeitfallback 21→11 Tage gesenkt (eBay bietet keine Zustellstatus-API, recherchiert) + Warnung statt Vorschlag bei möglicherweise verlorener Sendung (25+ Tage ohne Zustellmail)
- ✅ P-98: eBay-Sendungsnummer-Übermittlung wird jetzt persistent nachverfolgt (`tracking_ebay_submitted`) statt nur per Toast — verhinderte vorher fälschliche "übermittelt"-Anzeige bei eBay-seitigem Fehlschlag
- ✅ P-100/P-101 (PR #63, gemergt): `shippedAt` wird jetzt auch beim normalen Sendungsnummer-Flow gesetzt (nicht nur bei explizitem "Als verschickt markieren"), Bestandsfälle per `updatedAt`-Fallback abgedeckt; eBay-Bestellsync nutzt jetzt expliziten 2-Jahre-Filter statt des impliziten 90-Tage-API-Defaults

Vollständige Commit-Historie: `git log --oneline origin/main` (168 Commits seit Projektstart, laufend gepflegt über PRs).

## ARCHITEKTUR (Kurzfassung — Details in `docs/ARCHITECTURE.md`)
- Shop: stele-e-transfer (eBay DE), Kleingewerbe §19 UStG, Wiesbaden
- Stack: Bun + Hono + React + Turso (libSQL)/Drizzle
- Deploy: Render (auto auf push) → stele-e-transfer.onrender.com
- Preisformel (`price-monitor.ts calcSellPrice()`): `sellPrice = (buyPrice + versand + zoll + MIN_GEWINN + 0.45×1.19) / (1 - (13+adRate)/100×1.19)`, aufgerundet auf ,95
- Mindestgewinn: **2,00 €** (`MIN_GEWINN_EUR`, seit 14.07.2026 — vorher 1,60€)
- China-Zoll: **4,00 €** (`CHINA_ZOLL_EUR`, seit 27.07.2026 — vorher 3,00€)

## BEKANNTE ISSUES
- Playwright/Chromium: ETXTBSY auf Render Free → ScrapingAnt Fallback aktiv
- Gemini 2.5 Flash Lite: gelegentlich überlastet → Fallback-Beschreibung
- `render.yaml` (env: node) und `Dockerfile` (installiert Chrome für Playwright) widersprechen sich — nur `render.yaml` ist laut Render-Konfiguration aktiv

## ENV RENDER
Bestätigt gesetzt (aus vorherigem Stand übernommen, nicht neu verifiziert — kein Render-Dashboard-Zugriff von hier):
- ALIEXPRESS_ACCESS_TOKEN ✅
- EBAY credentials ✅
- SCRAPINGANT_API_KEY ✅

Weitere laut Code erforderlich, Render-Status nicht geprüft: GEMINI_API_KEY, RESEND_API_KEY,
SESSION_SECRET, BACKUP_API_KEY, DATABASE_URL/DATABASE_AUTH_TOKEN (Turso), ALIEXPRESS_APP_KEY/SECRET,
EBAY_APP_ID/DEV_ID/CERT_ID/USER_TOKEN — die App läuft produktiv, was dafür spricht, dass sie gesetzt
sind, aber das ist keine Bestätigung.
