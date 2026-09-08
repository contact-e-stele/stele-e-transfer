# Stele App — Task Board

> Session-Scratchpad für aktuell offene Arbeit. Feature-Historie/Roadmap: `P-UEBERSICHT.md`.
> Architektur-Details: `docs/ARCHITECTURE.md`.

## NOCH OFFEN
0. **P-112 (2026-09-08, Root Cause gefunden, PR #73 gemergt):** Alle bisherigen Fixes (P-109-P-111) hatten am falschen Ort angesetzt (`aliexpress.ts`/`scrapeWithDsApi()`) — der Import-Endpunkt nutzt tatsächlich `getAliProductByApi()` aus `aliexpress-api.ts`, eine dritte, nie berührte Extraktion (`result.store_info?.store_name`). Diagnose-Logging jetzt am richtigen Ort deployed (PR #73). **Wartet auf:** Nutzer scrapt Produkt 1005010280178344 erneut und schickt die `[AliExpress API] P-112-Diagnose:`-Logzeilen aus Render. Danach: numerische Shop-ID gefunden → ID-basierter Abgleich; keine ID → anderer Datenweg (z.B. dedizierter Shop-Info-API-Call).

0b. **P-66-Bypass — manueller Freigabe-Button (2026-09-08, PAUSIERT, keine Entscheidung):** Auftrag: Button "Manuell freigeben" bei der Compliance-Sperre, unabhängig von der (kaputten) Verkäufer-Erkennung, inkl. DB-Flag `manuallyApprovedRegulated`+Zeitstempel. Vor Umsetzung Rückfrage gestellt, da das eine bewusste "kein Bypass"-Entscheidung aus P-66 (GPSR-Haftungsgrund, Commit `3bf9088`) aufheben würde + DB-Migration (CLAUDE.md-Bestätigungspflicht). Nutzer hat die Rückfrage weggeklickt, dann kam Preis-Krise (Punkt 1 unten) dazwischen — **keine Entscheidung getroffen**, nichts umgesetzt. Hängt inhaltlich mit P-112 zusammen: falls die Verkäufer-Erkennung bald tatsächlich funktioniert, braucht es den Bypass evtl. nur als Übergangslösung.

1. **Preis-Krise "Teil 1-4" (2026-09-07/08, AKTIV, ersetzt/erweitert P-27/P-28) — DRINGEND:** Die alte "P-27/P-28 ABGESCHLOSSEN"-Einschätzung unten ist überholt. Auslöser: stele-98-Variante "White 1pcs" verkaufte real mit Verlust (4,69€ VK bei 4,79€ EK, Bestellung 02-15151-11415). Root-Cause-Suche fand DREI unabhängige, echte Preis-Bugs (alle noch **nicht gefixt**, Fix braucht Nutzer-Freigabe — Geld-Logik):
   - **(a) Listing-Erstellung** (`ebay.ts:1249`): `varPriceEntry.ebayPrice ?? varPriceEntry.price ?? input.price` — fällt bei fehlendem `ebayPrice` auf den ROHEN AliExpress-Einkaufspreis zurück, statt einen Preis zu berechnen. Vermutete Ursache für stele-98.
   - **(b) adRate-Default-Inkonsistenz**: Einzelartikel-Preisvorschau/-Anwendung (`index.ts:1173`/`1233`) nutzt `adRate ?? 0`, `computeVariantPriceRows()` (`price-monitor.ts:73`) nutzt `adRate ?? 5` — bei NULL-adRate rechnen beide Pfade mit unterschiedlicher Gebührenrate.
   - **(c) Dritte, unabhängige Formel** in `/products/check-all-prices` ("Alle Preise prüfen"): fester 18%-Satz, kein Sicherheitspuffer, keine Bestellgebühr, falsche Rundung (kein ,95) — UND pusht automatisch ohne Bestätigungs-Vorschau direkt an die eBay-Live-API. Wahrscheinlich Hauptursache der beobachteten wilden Preissprünge (Alufolie +23€, Backpapier -6€ im selben "Preise neu berechnen"-Lauf).
   - Diagnose-Erweiterung gebaut+gepusht (Commit `e7704b7`, **noch kein PR, noch nicht deployed**): `GET /ebay/listings/recalculate-preview` zeigt jetzt pro Zeile buyPrice/versand/zoll/adRate/feeRate/safetyBuffer als `debug`-Feld.
   - **Offene Design-Fragen (Teil 2, neue feste 2,00€-Gewinn-OBERGRENZE statt bisherigem Minimum):** ,95-Rundung beibehalten (Gewinn dann leicht über/unter 2€) oder krumme Cent-Beträge zulassen? Das ist ein Strategie-Wechsel, kein reiner Bugfix — senkt bei margenstarken Produkten die Preise.
   - **Offene Design-Frage (Teil 4, Sicherheitsgate):** Schwellenwert 5€ für "ungewöhnlich groß, bitte einzeln prüfen"-Markierung ok?
   - **Sofort blockiert auf Nutzer:** (1) stele-98-WHITE-1PCS manuell im eBay Seller Hub korrigieren (kein API-Zugriff aus der Sandbox); (2) reale Werte (buyPrice/versand/zoll/adRate) für 2-3 Beispielprodukte (Alufolie, Kühlschrank, Backpapier) ODER die neue Preisvorschau nach Deploy erneut aufrufen, für die exakte Schritt-für-Schritt-Rechnung.
   - Alte P-27/P-28-Detailfunde bleiben als Kontext gültig, siehe Punkt 1b unten (id=137 weiterhin ungeklärt).

1b. **P-27/P-28-Gebührensatz-Check (2026-09-06, Altfunde — durch Punkt 1 oben ergänzt, NICHT mehr "abgeschlossen"):** Nutzer meldete realen Testkauf mit ~20,27% eBay-Gebühr (3,03€/14,95€). Mit expliziter einmaliger Nutzer-Freigabe wurde der echte Produktions-DB-Export (Gmail-Backup 5.9. 23:35 Uhr) ausgewertet:
   - **Gebührensatz-Ergebnis (Katalog-Snapshot vom 5.9.):** ALLE 32 live gelisteten Produkte hatten `adRate=5` (DB-Default) → Formel nahm einheitlich 21,4% Gebühr an — das lag ÜBER den beobachteten 20,27%. Kein katalogweiter Unterpreisungs-Fehler durch den Gebührensatz ALLEIN — aber siehe Punkt 1 oben für die seitdem gefundenen strukturellen Bugs.
   - **Ausreißer: id=137** ("XXL Vakuumbeutel ohne Pumpe") — gespeichert 10,95€, korrekt wären 19,95€ (+9,00€, fast halber Preis!). Root Cause: `lastPriceCheck` stand seit 27.08. fest (9+ Tage) — Cron scheiterte vermutlich durchgehend beim Scraping für dieses eine Produkt. **Weiterhin unkorrigiert, weiterhin riskant — noch offen.**
   - P-27/P-28-Dauerlösung (`calcSellPrice()`/`computeVariantPriceRows()`) ist grundsätzlich korrekt gebaut (Commit `98c0a16`, PR #47) — die jetzt gefundenen Bugs (Punkt 1) liegen in ANDEREN, parallelen Code-Pfaden (Listing-Erstellung, `check-all-prices`), nicht in der Kernformel selbst.
   - **Noch offen:** (a) id=137 manuell korrigieren; (b) pro-Produkt-Sichtbarkeit für "seit N Tagen nicht erfolgreich geprüft" (kein Teil des ursprünglichen Katalogs, nicht ungefragt umgesetzt).
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
