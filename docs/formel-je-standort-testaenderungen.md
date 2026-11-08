# Formel je Standort — Änderungen an bestehenden Tests (08.11.2026)

Anlass: `computeMinSellPrice` / `profitAtSellPrice` / `netFactor` rechnen den Prozent-Anteil der eBay-Gebühr jetzt mit dem Standort-Faktor S
(China 1,19, sonst 1): F(China) = 0,787585 (0 %) / 0,71678 (5 %), EU unverändert 0,8215 / 0,762. Fixgebühr 0,357 unverändert.
Vor der Anpassung schlugen 146 Tests fehl (Stand WIP-Commit f3a0d19). Danach: `bun test` 1684 pass / 0 fail / 49 skip (inkl. `pricing-location.test.ts`).

Vorgehen (Grundgesetz 3/4/5):
- Jeder neue Erwartungswert wurde mit einer **eigenen, unabhängigen Nachrechnung** (bun-Skript außerhalb des Repos: Formel, Rundung ,45/,95 mit
  Boden − 0,10 / min. 1,00, Kassen-Faktor auf Cent gerundet, Mengenrabatt-Plan, Anzeige-Umschalter) bestimmt und erst dann eingetragen.
- Wo ein Szenario mit den neuen Zahlen nicht mehr eintritt, wurden die **Eingaben** (VK, Ware, Ziel, Prozent) verschoben — Spalte "Eingaben geändert".
- Historische Daten mit Artikelstandort Deutschland, die direkt `computeMinSellPrice`/`profitAtSellPrice` aufrufen: **`ebayLocationFactor: 1`**, Zahlen unverändert.
- Historische Daten hinter höheren Funktionen ohne S-Parameter: neu gerechnet, markiert als **"historische Zahl geändert"**.
- Kein Test und keine Assertion gelöscht (eine Assertion hinzugefügt: p-einfuhr Gegenprobe), keine Genauigkeit gelockert. Keine Nicht-Test-Datei geändert
  (Fixture-Dateien `variant-reprice.fixture.ts`, `auto-lower-fx/*.json` unverändert — Überschreibungen nur im Test).
- Regressions-Beweis: in einer Kopie des Pakets (`/tmp`, nicht im Repo) `IOSS_PROVISION_FACTOR = 1` gesetzt → 103 Tests rot
  (96 der angepassten Tests + 7 aus `pricing-location.test.ts`); im Repo mit 1,19 → 0 rot. Die angepassten Tests unterscheiden also S = 1 von S = 1,19.

## src/shared/pricing-v2.test.ts

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| Hilfsfunktion `v2Price` | neue Option `s` → `ebayLocationFactor` | – (Hilfsfunktion) |
| "Beispiele der Übergabe" (11 Tests: Ware 3,15/3,39/4,79/5,89 Stufe B, Boden-Schleife A, Stufe D, Stufe C inkl. nearest95-Gegenprobe, Stufen A–D, Anzeige 0 %, Ware 12,00, Schwelle 10,00) | Zahlen unverändert, `s: 1` / `ebayLocationFactor: 1` (Kalkulator-Übergabe 04.10.2026, Standort damals DE) | nein (nur S = 1) |
| "16 echte Verkäufe" (`formelGewinn`, 2 Tests) | Zahlen unverändert, `ebayLocationFactor: 1` (historisch) | nein (nur S = 1) |
| evaluatePriceAlarm: "kein Alarm (gelb)" | VK 13,95 → 14,95; Gewinn 1,5629 → 1,6489 | ja, VK +1,00 (13,95 hätte 0,9321 < Boden ergeben) |
| evaluatePriceAlarm: "Gewinn < Boden → Alarm" | VK 11,95 → 12,95; Gewinn 0,0389 → 0,2153 | ja, VK (Szenario "positiv, aber unter Boden"; 11,95 wäre Verlust −0,5015) |
| evaluatePriceAlarm: "Verlust → Alarm" (Ware 3,39) | −0,2011 → −0,7415 | nein |
| computeVariantSellPrices stele-110 China Anker 19,95 | Preise 19,95/16,45/15,45/14,45/13,45/12,95 → 19,95/17,95/16,45/15,45/14,45/13,95; Ankergewinn 1,5949 → 0,6928 | nein |
| "Befund … Einheitspreis 19,95" (stele-110) | Zahlen unverändert, `ebayLocationFactor: 1` (historischer Befund) | nein (nur S = 1) |
| "keine Variante unter Boden C" | – | ja: China-Plan mit Anker 20,95 statt 19,95 (bei 19,95 läge der Anker selbst bei 0,6928; 20,95 → 1,4095) |
| Anker 20,00 | billigere Variante 12,95 → 13,95; Ankergewinn 1,633 → 0,729 | nein |
| Anker mit Verlust (EK 15,00) | Ankergewinn −3,7251 → −4,6272; Variante 12,95 → 13,95 | nein |
| Regel 6c "unter Boden" | Gewinn 0,0389 → −0,5015; neuer VK 14,45 → 14,95 | nein |
| Regel 6c "über Boden" | Gewinn 4,4949 → 3,5928 | nein |

## src/shared/variant-reprice.test.ts (Fixture stele-225, China, Anzeige 0 %, Einfuhr 5,95)

Neue Konstante `VSP_HOCH` = alter VK Blue 28,45 / black + GRAY 26,45 (echter Backup-VK 26,95 / 24,95 + 1,50). Grund: mit S 1,19 bringt beim echten VK keine erlaubte Senkung (≤ 8 %) mehr Gewinn ≥ 1,00. Die Fixture-Datei selbst ist unverändert.

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| Senken ohne Faktor (K-018 c1) | Blue 26,95→25,45 (+2,24→+1,01 ok), black 24,95→23,45 (+2,20→+0,97 abgelehnt) → Blue 28,45→26,95 (+2,51→+1,33 ok), black 26,45→24,45 (+2,53→+0,96 abgelehnt) | ja (alter VK VSP_HOCH, neue Preise) |
| Senken mit/ohne Faktor gleich | Preise 25,45/23,95 → 26,95/24,95; Gewinne [1,01, 1,38] → [1,33, 1,35] | ja (VSP_HOCH) |
| Regel 3 GRAY 22,95 | Gewinn 0,56 → −0,22 (beide Aufrufe) | nein |
| Regel 4 Preis halten | Preise 25,45/23,95 → 26,95/24,95 (black sonst abgelehnt statt ok) | ja (VSP_HOCH) |
| 033b Punkt 1 (Ziel 1,50) | black 23,95 (+1,38)/Blue 25,95 (+1,42) abgelehnt, Blue 26,45 (+1,83) ok → black 24,95 (+1,35)/Blue 26,95 (+1,33) abgelehnt, Blue 27,45 (+1,72) ok | ja (VSP_HOCH, Preise) |
| 033b Punkt 2 | [1,01/1,01, 1,38/1,38] → [1,33/1,33, 1,35/1,35] | ja (VSP_HOCH, Preise 26,95/24,95) |
| Warnung ohne Kassen-Faktor (Anheben 27,45) | Ziel 2,70 → 2,00; mit Faktor 3,01 → 2,08, ohne 2,65 → 1,72 | ja (Ziel; bei 2,70 läge auch "mit Faktor" darunter) |
| anheben ok Blue 27,45 | gewinnNeu 3,01 → 2,08, ohne Faktor 2,65 → 1,72 | nein |
| OFFEN 035 Ziel 3,50 | gewinnAlt 2,60 → 1,69, gewinnNeu 3,01 → 2,08 | nein |
| OFFEN 035 VK unter 1,00 | Blue −0,68→−0,27 / black −0,36→+0,05 → Blue −1,46→−1,07 / black −1,08→−0,69 | nein |
| OFFEN 035 Senken unter Mindestgewinn | Blue 22,45: −1,45 → −2,22 | nein |
| K-018 c1 Senk-Bericht mit = ohne Faktor | – | ja (VSP_HOCH, sonst 0 Kandidaten) |

## src/api/variant-reprice.test.ts (Orchestrierung, Fixture stele-225)

Neue Konstante `VSP_HOCH` (alter VK Blue 28,45 / black + GRAY 26,45, wie oben); Standard-Rücklesen {25,45 / 23,95 / 24,95} → {26,95 / 24,95 / 26,45}.

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| nur geprüfte Auswahl gesendet … GRAY bleibt | Preise Blue 25,45 / black 23,95 / GRAY 25,95 (abgelehnt) → 26,95 / 24,95 / 26,95 (abgelehnt, "nur senken"); gespeichert GRAY 24,95 → 26,45 | ja |
| Teil-Fehler "1 von 2" | Preise 25,45/23,95 → 26,95/24,95 | ja |
| übersprungen zählt nicht | Blue 25,45 → 26,95 | ja |
| Zuordnung nicht eindeutig | Blue 25,45 → 26,95 | ja |
| live ohne sendToEbay / nicht live speichern | Blue 25,45 → 26,95 | ja |
| Rücklesen weicht ab | Blue 25,45 → 26,95, Rücklesewert 26,95 → 28,45 (= alter VK) | ja |
| ohne direction = Senken | Blue 25,45 → 26,95 | ja |

## src/api/variant-raise.test.ts (Fixture 119, China, Anzeige 5 %, Stufe C, Einfuhr 3,57)

Fixture `product119`: **Produkt-VK 14,95 → 15,95 (Eingabe geändert)**. Grund: 200pcs würde mit S 1,19 von 14,95 auf 17,45 (+16,7 %) angehoben = PREISSPRUNG (OFFEN 010, > 15 %) → nie gesendet; die Sende-/Speicher-Tests hätten nichts mehr geprüft. Bei 15,95: +9,4 %, 100pcs bleiben über dem Boden.

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| 200pcs unter dem Boden | alt VK 14,95 → 15,95; Gewinn alt 0,6849 → 0,7256; neuer VK 16,45 → 17,45; Gewinn neu 1,8279 → 1,8008; 100pcs 2,3249/2,0249 → 2,3656/2,0656 | ja (Produkt-VK) |
| Senken nie | v200-VK 15,95 → 16,95 (Gewinn 1,4424; bei 15,95 nur 0,7256 → würde angehoben) | ja |
| Gewinn zwischen Boden und Ziel (Stufe D) | VK 13,95 → 14,95 (Gewinn 1,5629 → 1,6489; 13,95 ergäbe 0,9321 < Boden); Formelpreis im Kommentar 15,45 → 16,45 | ja |
| eigener VK unter Boden (v100a 11,95) | Gewinn 0,0389 → −0,5015 (Kommentar); neuer VK 14,45 → 14,95 | nein |
| Schalter AUS Log | "14.95 → 16.45" → "15.95 → 17.45"; "Gewinn 0.68 → 1.83" → "0.73 → 1.80" | ja (Produkt-VK) |
| Schalter AN | gesendet/gespeichert v200 16,45 → 17,45; Log "15.95 → 17.45" | ja (Produkt-VK) |
| store nur angehobene | v100a-VK 13,95 → 14,95 (13,95 läge unter dem Boden); gespeichert 16,45 → 17,45 | ja |
| nichts unter dem Boden | v200-VK 15,95 → 16,95 | ja |
| teilweise Erfolg | v100a-VK 12,95 → 13,45 (12,95 → 14,95 wäre +15,4 % = Sprung); gespeichert 16,45 → 17,45 | ja |
| OFFEN 010 Preissprung | v100a 11,95 → 14,45 (+21 %) → 11,95 → 14,95 (+25 %); v200 14,95 → 16,45 → 15,95 → 17,45; gespeichert 17,45 | ja (Produkt-VK) |
| ambiguous / failed / error | nur über den neuen Produkt-VK wieder wirksam, keine Zahlen | ja (Produkt-VK) |

## src/shared/tier-reprice.test.ts (stele-218, China, 5 %, Einfuhr 3,57)

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| Stufe A | Roh 13,0013 → 13,8215; VK 13,45 → 13,95; Gewinn 1,3419 → 1,0921; Boden-Beweis "12,95 → 0,9609" → "13,45 × 0,71678 … → 0,7337" | nein |
| Stufe B | Roh 13,6575 → 14,5191; VK 13,45 → 14,45; Gewinn 1,3419 → 1,4505 | nein |
| Stufe C | VK 13,95 → 14,95; Gewinn (Titel) 1,7229 → 1,8089 | nein |
| Stufe D | Roh 15,626 → 16,6118; VK 15,45 → 16,45; Gewinn 2,8659 → 2,8840 | nein |
| alter VK 14,95 | Gewinn 2,4849 → 1,8089 (alte Inline-Anzeige 8,2222 unverändert) | nein |
| Übernahme schreibt nur variant_sell_prices | 6x8 13,45 → 14,45 | nein |
| Gewinn-Spalte = Plan-Gewinn | 6x8 13,45 → 14,45 | nein |
| Einzelartikel Ware 3,15 Stufe C | VK 14,45 → 14,95; Gewinn alt (11,95) 0,0389 → −0,5015; Kommentar Roh 15,4399 / Gewinn 1,6489 | nein |
| A-023 Dubletten 119 | 200pcs 15,95 → 16,95; 100pcs 13,95 → 14,95 | nein |

## src/shared/auto-lower.test.ts (Backup-Fixtures fx228/fx119, Einfuhr 5,95)

Eingabe geändert (JSON-Backups selbst unverändert, Überschreibung im Test über `withVk`): **228 pink VK 20,45 → 21,95**, **119 100pcs VK 16,45 → 16,95**. Grund: mit S 1,19 ist pink bei 20,45 nur +0,57 (kein Kandidat), 100pcs 16,45 ist schon der Formelpreis → keine Senk-Kandidaten, alle Tests hätten nichts mehr geprüft (der Test "c2 … 6,29 → kein Kandidat mehr" lief sogar trivial grün und prüft jetzt wieder echt).

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| Kandidaten (Schwelle Ziel + 0,20) | 228 pink 20,45 → 19,95 (+1,50 → +1,11) → 21,95 → 21,45 (+1,65 → +1,29); 119 100pcs 16,45 → 15,45 (+1,93 → +1,11) → 16,95 → 16,45 (+1,76 → +1,37) | ja (VK) |
| c2 nicht frisch / c3 / Sperren / Preis halten | keine Zahlen; nur über den geänderten VK wieder Kandidat | ja (VK) |
| c4 Multi-Rabatt nicht gesenkt | Prozent 35/36 → 36/37 (bei 35 % blieben 21,45 mit 1,05 je Stück ≥ 1,00); VK 20,45/19,95 → 21,95/21,45; "nur 0.94 €" → "nur 0.90 €" (alt 1,13 je Stück ok) | ja (VK, Prozent) |
| c4 30/31 % gesenkt | 19,95 → 21,45 (1,82 je Stück) | ja (VK) |

## src/api/auto-lower.test.ts (fx228)

Eingabe geändert: pink VK 20,45 → 21,95 (wie oben). Rücklesen 19,95 → 21,45.

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| AUS: Vorschau | pink 20,45 → 19,95 → 21,95 → 21,45 | ja |
| AN: gesendet | newSell 19,95 → 21,45 | ja |
| AN eBay-Fehler; 20-h-Sperre (vor 21 h, nie gesendet; die 6-h-Pause lief vorher trivial grün) | keine Zahlen | ja (VK) |

## src/shared/k006.test.ts

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| Hilfsfunktionen `sell`/`profit` | neuer optionaler Parameter `s` → `ebayLocationFactor` | – |
| K-006 Pflicht-Tests (3 Tests: Ware 11,59 → 20,45; Ware 12,29 → 21,45; Ware 3,15 Stufe B → 13,45) | Zahlen unverändert, `s = 1` (Kalkulator 14.10.2026, Standort DE) | nein (nur S = 1) |
| Toleranzband Stufe B (3 Tests: Preisalarm, Regel 6c, Varianten-Anhebung) | Ware 3,15 → 3,29; VK 13,45 (1,1819) → 14,45 (1,1505); VK 12,95 (0,8009) → 13,95 (0,7921); Anhebung b → 14,45 | ja (mit Ware 3,15 trifft keine ,45/,95-Endung das Band 1,10–1,20) |

## src/shared/k005-faktor.test.ts

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| Formel-Fall Ware 12,19 × 0,9508 (China 5 %, Ziel 1,00) | VK ohne/mit Faktor 22,95/21,95 → 23,95/23,45; Gewinn bei 19,95 −0,9151/−0,3151 → −1,817239/−1,217239 | nein |
| Formel-Fall Ware 9,50 × 0,8 (China 0 %, Ziel 1,50) | VK 20,45/17,95 → 21,45/18,95; Gewinn 0,971925/2,871925 → 0,295321/2,195321 | nein |
| Formel-Fall Ware 13,79 (EU) | unverändert | nein |
| evaluatePriceAlarm reicht Faktor durch | −0,3151 → −1,217239 (Alarm); Faktor 0,6: 1,9749 → 1,072761 (kein Alarm) | nein |
| K-005 Warnhinweis (stele-220, Faktor 0,9409) | VK 20,95 → 21,95; mit Faktor 0,5669 → 0,3363; ohne −0,1531 → −0,3837 | ja (bei 20,95 wäre auch "mit Faktor" negativ, −0,3805) |
| kein Warnhinweis | VK 21,45 (ohne +0,2279) → 22,95 (ohne +0,3331); Kontrolle ohne Faktor 20,95/−0,1531 → 21,95/−0,3837 | ja |
| Listings/Produkte-Anzeige profitWithoutFactor | VK 20,95 → 21,95; 0,5669/−0,1531 → 0,3363/−0,3837 | ja |

## src/shared/k004-formel-v2.test.ts

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| K-004 Pflicht-Tests (5 Fälle, Kalkulator 08.10.2026, echte Verkäufe) | Zahlen unverändert, `ebayLocationFactor: 1` | nein (nur S = 1) |
| Ware 3,15 Stufe B → 13,45 / 1,18 | Zahlen unverändert, S = 1 (Kalkulator-Beispiel) | nein (nur S = 1) |

## src/shared/volume-discount.test.ts

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| stele-220 GRAY 8 %/9 % | Gewinn 2 Stück 3,35 → 2,05; 3 Stück 6,48 → 4,54; Einzelkauf 1,09 → 0,38 (Prozent, Stückpreise, Ersparnis unverändert) | nein |
| stele-223 13 %/14 % | Gewinn 5,95 → 5,01; 11,61 → 10,22 | nein |
| Senkung wegen Boden | Boden 4,10 → 2,60 (Kommentar: 8 % = 2,05 < 2,50 → 6 % = 2,71) | ja (mit 4,10 läge selbst 5 % bei 3,04 < 4,00 → Senkung behebt nichts) |
| Sperre teurer Artikel (99,95/30, Einfuhr 5,95) | Einzelkauf 45,80 → 42,41; 2 Stück 89,70 → 83,26 (41,63 je Stück < 42,41) | nein |
| Regel 6 €/11 € stele-220 GRAY live (Faktor 0,9338) | Einzelkauf 1,39 → 0,59; 2 Stück 4,07 → 2,69; 3 Stück 7,53 → 5,53 (13 %/16 % unverändert) | nein |

## src/shared/target-margin-bulk.test.ts (erfundene Fixtures 1–3 + 119/95)

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| Fixture pGrenze | VK 13,45 / Ware 3,15 (1,1819) → VK 14,45 / Ware 3,29 (1,1505) — Band 1,10–1,20 | ja (erfundene Fixture) |
| Fixture pYellow | VK 13,95 (1,5629) → 14,95 (1,6489), Ware 3,15 | ja (erfundene Fixture) |
| productProfitRows 119 | 0,0389 / 0,6849 → −0,5015 / 0,0089 | nein |
| previewTierChange Stufe A–D (4 Tests) | Zählwerte unverändert; Titel 1,1819 → 1,1505, "13,95-Produkt (1,5629)" → "14,95-Produkt (1,6489)" | ja (über die Fixtures) |

## src/shared/k008-preis-halten.test.ts (Fall stele-220, China, Anzeige 0 %, Stufe A)

Eingaben geändert: GRAY-Ware 11,47 → 11,59; Halte-VK (GRAY, Produkt-VK, Halte-Eintrag) 19,95 → 20,95; Blue 21,95 → 22,45; black 20,95 → 21,45. Grund: mit S 1,19 läge GRAY @ 19,95 bei 0,3153 (< 0,90, Halten nie möglich) und Blue/black würden selbst angehoben (0,8705 / 0,9829).

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| ohne Halten → Anheben | GRAY 19,95 → 20,45 (0,9919) → GRAY 20,95 → 21,45 (0,9829) | ja |
| gehalten | Gewinn 0,9919 → 0,9829 | ja |
| Sicherheitsnetz | Ware 11,60 (0,8619, "nur noch 0.86") → 11,72 (0,8529, "nur noch 0.85"); Anheben 20,45 → 21,45 | ja |
| Preis inzwischen geändert | heute 20,45 statt 19,95 → 21,45 statt 20,95 | ja |
| runVariantRaise gehalten / nur GRAY gehalten | nur Fixture | ja |
| Einzelartikel gehalten | Ware 11,47 / VK 19,95 → 11,59 / 20,95 | ja |

## src/shared/price-report-v2.test.ts (stele-119 Kalkulator-Übergabe 04.10.2026)

**Historische Zahl geändert:** `buildPriceReportRows` nimmt keinen Standort-Faktor entgegen → China-Fixture rechnet mit S 1,19.

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| neuer VK nach Formel v2 (stele-119) | 100pcs 14,45 → 14,95; 200pcs 16,45 → 17,45; Δ [2,5; 1,5] → [3; 2,5] | nein — historische Zahl geändert |
| Gewinn heute (v2) / neu | heute 0,0389 / 0,6849 → −0,5015 / 0,0089; neu 1,9439 / 1,8279 → 1,6489 / 1,8008 (beide weiter rot) | nein — historische Zahl geändert |
| Gewinn alt (v1) 1,5989 / 2,2449 | unverändert (alte Formel v1) | nein |
| Bestandsprodukt 4,50 (erfunden, China) | Formelpreis 26,45 → 28,45; Gewinn neu 4,2279 → 4,4654 (Roh 26,8071 → 28,4983) | nein |
| renderPriceReportMarkdown Zeile 100PCS | "… 14,45 \| +2,50 \| 1,60 \| 0,04 \| 1,94 …" → "… 14,95 \| +3,00 \| 1,60 \| -0,50 \| 1,65 …" | nein |

## src/shared/k014-gelistete-varianten.test.ts (Live-Daten 28.10.2026, Einfuhr 5,95)

Eingaben geändert (Live-VK lagen mit S 1,19 unter dem Boden → die "kein Falschalarm"-Tests hätten Alarm gezeigt): 119 200pcs 22,95 → 23,95, 100pcs 16,45 → 16,95; 189 L/Green 18,95 → 19,95; 107 beide 18,45 → 19,45.

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| stele-119 Erwartet | 1,576425 → 1,585661; ohne Faktor 1,266425 → 1,275661; Anzeige 1,58 → 1,59 | ja |
| stele-189 L/Green | VK 18,95 → 19,95; Inline-Formel jetzt mit `× 1.19` (S) | ja |
| stele-107 | Erwartet 1,57 → 1,45 (gelb) | ja |
| Stufen-Vorschau 119/107 nicht rot | redIds [] unverändert | ja (über die Fixtures) |

## src/shared/article-vk-variants.test.ts (stele-234/235, Einfuhr 5,95)

Mindestpreise mit S 1,19: Brown 23,95 → 25,45, Orange 5PCS 16,95 → 18,45. Artikel-VK der Tests im gleichen Abstand zum Mindestpreis verschoben (Eingabe geändert).

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| 234 nur Brown gesetzt | Artikel-VK 23,95 → 25,45 | ja |
| 235 nur Orange 5PCS | 16,95 → 18,45 | ja |
| unter Mindestpreis | Artikel-VK 22,95 → 24,45; minSell 23,95 → 25,45 | ja |
| vorhandene Einträge bleiben | Artikel-VK 17,45 → 19,45 (10PCS-Bestand 18,95 unverändert) | ja |

## src/shared/ad-rate-switch.test.ts (Freigabe-Tabelle 03.11.2026)

**Historische Zahl geändert:** `planAdRateSwitch` hat keinen S-Parameter (S aus Herkunft). VK alt / EK unverändert, alle `send` bleiben true.

| Zeile | VK neu / Gewinn neu alt → neu |
|---|---|
| 120 50PCS 40-42CM | 13,95/1,27 → 13,95/0,80 |
| 120 50PCS 47CM | 15,95/1,76 → 15,95/1,21 |
| 120 50PCS 52CM | 16,95/2,24 → 15,95/0,87 |
| 120 50PCS 60CM | 18,95/2,18 → 18,95/1,54 |
| 120 50PCS 70CM | 18,95/2,08 → 18,95/1,44 |
| 120 50PCS 120CM | 23,95/2,18 → 23,95/1,37 |
| 120 100PCS 40-42CM | 15,95/1,92 → 15,95/1,37 |
| 120 100PCS 47CM | 18,95/2,18 → 17,95/0,75 |
| 120 100PCS 52CM | 19,95/2,30 → 19,95/1,63 |
| 120 100PCS 60CM | 23,95/1,39 → 23,95/0,58 |
| 120 100PCS 70CM | 23,95/1,99 → 22,95/0,39 |
| 120 100PCS 120CM | 41,95/2,76 → 40,95/0,55 |
| 123 10PCS | 14,95/1,89 → 14,95/1,39 |
| 123 20PCS | 15,95/2,12 → 15,95/1,57 |
| 123 30PCS | 17,95/2,26 → 17,95/1,65 |
| 123 50PCS | 19,95/2,00 → 19,95/1,33 |
| 123 100PCS | 24,95/2,40 → 23,95/0,77 |
| 123 200PCS | 34,95/2,01 → 33,95/0,04 |
| 127 Multicolour 50pcs | 14,95/1,49 → 14,95/0,99 |
| 127 Multicolour 100pcs | 15,95/1,46 → 15,95/0,91 |
| 127 White 500pcs | 22,95/2,16 → 21,95/0,59 |
| 127 Multicolour 500pcs | 22,95/1,86 → 22,95/1,08 |
| 227 Grey | 17,95/1,46 → 17,95/0,85 |
| 0 % → 5 % Grey | Ergebnis 19,95 unverändert; nur Kommentar (19,35 → 19,72) | 

## src/shared/p-einfuhr.test.ts (stele-127 live 24.10.2026, Einfuhr 5,95)

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| mit 5,95 alle 4 angehoben | neue VK 16,95 / 15,95 / 23,95 / 24,45 → 17,95 / 16,95 / 25,45 / 25,95 | nein |
| Gewinn nach Anhebung ≥ 1,00 | oldProfit 100pcs −1,1571 → −1,7879 | nein |
| mit 3,57 nur eine Variante | VK 13,95 / 12,95 / 20,95 / 20,95 → 14,95 / 13,95 / 22,45 / 20,95 (mit S 1,19 wären auch mit 3,57 alle 4 angehoben); neue Gegenprobe-Zeile: mit 5,95 dieselben VK → 4 Anhebungen (zusätzliche Assertion, keine entfernt) | ja |

## src/shared/margin-display.test.ts

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| stele-229 Verlust | −1,3621 → −1,8799; Text "−1,36 € (−11,9 %)" → "−1,88 € (−16,4 %)" | nein |
| Ersatz 229 | VK 14,95 → 15,95; 1,2449 → 1,2856 (Ton 'ok'; 14,95 ergäbe 0,5689 = 'thin') | ja |
| Anzeige 0 % > 5 % | a5 2,3529 → 1,4960 | nein |

## src/shared/electric.test.ts (EAR-Umlage, synthetisches Beispiel Ware 6,00)

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| ohne Umlage | Roh 18,263779527559056 → 19,415999330338458; Mindestpreis 17,95 → 18,95 | nein |
| mit Umlage 1,50 | Roh 20,23228346456693 → 21,50869164876252; Mindestpreis 19,95 → 21,45 | nein |
| Gewinn mit Umlage | Prüf-VK 19,95 → 21,45 (= neuer Mindestpreis): 1,7849 → 1,9579, ohne Umlage 3,2849 → 3,4579; alter Preis 17,95 → 18,95: 0,2609 → 0,1660 | ja (Prüf-VK = neue Mindestpreise, Szenario gleich) |

## src/shared/k009-anzeige-0.test.ts (stele-220)

Eingaben wie k008 geändert (GRAY-Ware 11,59, VK GRAY 20,95 / Blue 22,45 / black 21,45).

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| adRate 0: nur GRAY | GRAY 0,9919 → 0,9829 (Titel); Anhebung 20,45 → 21,45 | ja |
| adRate 5: alle drei | [g 21,95, b 22,95, k 21,95] → [g 23,45, b 24,45, k 23,45] | ja |

## src/shared/pricing.test.ts

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| Plan aus computeVariantSellPrices in die Spalte | v2 12,95 → 13,95 | nein |

## src/shared/aufsicht-006.test.ts (stele-213)

| Test | alt → neu | Eingaben geändert? |
|---|---|---|
| Lager < 5 oder unbekannt → nicht wählbar | geprüfte Farben Yellow/Brown → Gray/Red (mit S 1,19 sind Yellow/Brown nicht mehr unter den besten 5; neue Rangfolge per bun: Gray 1,9753 · White/Blue/Light blue 1,8753 · Red 1,8153) | ja (Testauswahl) |
