# Preis-Fundament Teil 2C — Zielgewinn trifft exakt (Pflichtbestandteile #5/#6)

Formel nach Teil 2C: `rawMinSellPrice = (EK + Versand + Zoll + Zielgewinn + 0 [kein Puffer mehr] + Fixgebühr×1,19) / (1 − Gebührensatz)`,
gerundet mit `roundToNearest95()` (zur nächsten ,95-Marke, auch abwärts — nicht mehr immer aufwärts wie `roundUpToX95()`).

Rückrechnung des TATSÄCHLICHEN Gewinns aus dem berechneten/gerundeten VK:
`Gebühr = VK × (15% + Anzeigentarif%) × 1,19 + 0,30€ × 1,19` · `tatsächlicherGewinn = VK − EK − Versand − Zoll − Gebühr`

Alle Werte unten mit `bun` frisch nachgerechnet (Skript nicht Teil der committeten Testsuite, da
Eingabe reale, vom Nutzer in Teil 1 mitgeteilte AliExpress-Einkaufspreise sind, keine
Code-Fixtures) — versand=0, adRate=5%, kein China-Versand angenommen (reale Werte für diese
konkreten Produkte ohne Live-DB-Zugriff nicht bekannt, siehe `pricing.test.ts`-Header).

## #5 — Zielgewinn 2,00€, mindestens 10 reale Produkte

| Produkt | EK (€) | Zielgewinn (€) | Berechneter VK (€) | Tatsächlicher Gewinn (€) | Abweichung (Cent) |
|---|---|---|---|---|---|
| stele-98 | 4,99 | 2,00 | 9,95 | 2,23 | +23 |
| stele-110-v1 | 2,15 | 2,00 | 5,95 | 2,03 | +3 |
| stele-110-v2 | 2,55 | 2,00 | 5,95 | 1,63 | −37 |
| stele-110-v3 | 3,35 | 2,00 | 7,95 | 2,35 | +35 |
| stele-110-v4 | 4,19 | 2,00 | 8,95 | 2,27 | +27 |
| stele-110-v5 | 4,99 | 2,00 | 9,95 | 2,23 | +23 |
| stele-110-v6 | 7,69 | 2,00 | 12,95 | 1,82 | −18 |
| stele-141-v1 | 1,79 | 2,00 | 4,95 | 1,62 | −38 |
| stele-141-v2 | 2,25 | 2,00 | 5,95 | 1,93 | −7 |
| stele-141-v3 | 2,99 | 2,00 | 6,95 | 1,95 | −5 |

**Größte Einzelabweichung: −38 Cent (stele-141-v1), im Mittel ±21,6 Cent.** Alle 10 Abweichungen
liegen innerhalb des im Auftrag genannten Rahmens von "maximal rund 0,40 EUR" — sie stammen
ausschließlich aus der ,95-Rundung (der Rohpreis vor Rundung träfe den Zielgewinn exakt bis auf
Rundungsfehler im Centbereich; die Rundung zur nächsten ,95-Marke verschiebt das Ergebnis je nach
Lage des Rohwerts um bis zu ±0,475€ vor Rundung, real gemessen hier max. 0,38€). Keine Abweichung
verlangt eine Erklärung außerhalb der Rundung.

## #6 — Zielgewinn 4,00€, mindestens 3 reale Produkte (Beweis: abweichender Wert schlägt durch)

| Produkt | EK (€) | Zielgewinn (€) | Berechneter VK (€) | Tatsächlicher Gewinn (€) | Abweichung (Cent) |
|---|---|---|---|---|---|
| stele-98 | 4,99 | 4,00 | 11,95 | 3,76 | −24 |
| stele-110-v1 | 2,15 | 4,00 | 8,95 | 4,31 | +31 |
| stele-110-v6 | 7,69 | 4,00 | 15,95 | 4,11 | +11 |

Zum Vergleich mit 2,00€-Zielgewinn (obere Tabelle): stele-98 VK steigt von 9,95€ auf 11,95€,
stele-110-v1 von 5,95€ auf 8,95€, stele-110-v6 von 12,95€ auf 15,95€ — der beim Import gewählte
Zielgewinn wirkt sich in der neuen Formel sichtbar und korrekt proportional aus (nicht nur beim
initialen Import-Vorschlag, sondern jetzt in JEDER Aufrufstelle, weil `targetMarginEur` ab dieser
PR aus `product.targetMarginEur` statt dem globalen `MIN_GEWINN_EUR`-Fallback gelesen wird).

## Vergleich zu Teil 2B (Beleg für die behobene Ursache)

Derselbe Rohfall (EK=10€, Versand=2€, adRate=5%, Zielgewinn=2€) vorher/nachher:

| | Sicherheitspuffer | Rundung | Berechneter VK | Tatsächlicher Gewinn |
|---|---|---|---|---|
| Teil 2B (vorher) | +1,50€ | immer aufwärts (up95) | 20,95€ | 3,61€ |
| Teil 2C (nachher) | 0€ | nächste ,95-Marke (nearest95) | 18,95€ | 2,08€ |

**Korrektur (Teil 2D, nachgetragen):** hier standen ursprünglich 4,23€ bzw. 2,23€ — beides falsch,
fälschlich aus der stele-98-Zeile der Tabelle oben übernommen statt für diesen (EK=10€,
Versand=2€)-Rohfall frisch gerechnet. Mit `bun` neu nachgerechnet: 3,61€ bzw. 2,08€ (s.o.).

Genau die im Auftrag beschriebene Differenz: aus einem gewünschten 2,00€-Zielgewinn wurden vorher
real ca. 3,50-4,25€ (siehe Formel-Header, hier konkret 3,61€ — am unteren Rand des genannten
Rahmens, aber weiterhin klar über dem Ziel) — jetzt 2,08€, innerhalb der ,95-Rundungstoleranz.

## Definition "Zielgewinn" — Abgleich mit computeMinSellPrice()

Vorgabe: NETTO IN DER HAND, nach eBay-Verkaufsgebühr, Anzeigentarif, MwSt. auf die Gebühren,
AliExpress-Einkaufspreis, Lieferantenversand und Zollpauschale.

`computeMinSellPrice()` bildet das bereits vollständig ab: `totalCost` enthält EK + Lieferantenversand
+ Zoll (nur bei China-Herkunft), `totalFeeRateGross` enthält eBay-Gebührensatz UND Anzeigentarif
gemeinsam ×`vatFactor` (MwSt. auf die Gebühren), `fixedFeeGross` enthält die eBay-Fixgebühr ×
`vatFactor`. Die Rückrechnung oben (`tatsächlicherGewinn = VK − EK − Versand − Zoll − Gebühr`)
bestätigt das: alle sechs genannten Positionen sind in der Formel vertreten, keine fehlt. Die
einzige Restabweichung ist die ,95-Rundung selbst (siehe oben) — das ist im Auftrag ausdrücklich
als einzig zulässige Abweichungsursache benannt, keine Modellierungslücke.
