# Preis-Trockenlauf 2026-09-13

Reiner Leselauf, KEIN Schreibzugriff auf die DB, KEIN eBay-Call. "Heutiger VK" stammt aus der lokalen DB-Spalte `sellPrice` (nicht von der eBay-Live-Notierung, um keinen eBay-Request abzusetzen). Berechnungsgrundlage: `computeMinSellPrice()`/`profitAtSellPrice()` aus `shared/pricing.ts`, DEFAULT_PRICING_CONFIG (15% + 0,30€ eBay-Gebuehr, 19% MwSt), Rundung `nearest95`.

Datenstand: 2026-09-13T16:47:31.323Z (Live-Produktions-DB — der Hintergrund-Cron laeuft parallel weiter, ein zweiter Lauf dieses Skripts kann daher leicht andere Zahlen liefern).

**Wichtig:** Der automatische, unbeaufsichtigte Pfad (`price-monitor.ts checkOne()`, `POST /products/check-all-prices`) schreibt `sellPrice` NUR bei Einzelartikel-Produkten (kein Varianten-Produkt) — bei den 42 Varianten-Produkten aendert die Automatik `sellPrice` nie, unabhaengig von `AUTO_PRICE_WRITE_ENABLED` (siehe Aufgabe 3). Spalte "Automatik betrifft" zeigt das pro Zeile. Zusaetzlich gilt fuer die betroffenen Einzelartikel-Produkte die Anheben-Nur-Regel (`applyRaiseOnly`): der hier gezeigte "neuer Preis" ist der ROHE `computeMinSellPrice()`-Wert, ungeachtet dieser Richtungs-Sperre — sinkt der Wert gegenueber "heutiger VK", wuerde der automatische Pfad ihn tatsaechlich NICHT schreiben (nur beobachten).

| SKU | Titel | Typ | Automatik betrifft | Heute VK | Neu VK | Diff € | Diff % | Gewinn heute | Gewinn neu | Unter Einstand heute |
|---|---|---|---|---|---|---|---|---|---|---|
| stele-87 | 10 x Staubsaugerbeutel für Dreame L10s U | Einzelartikel | ja | 25,95 € | 17,95 € | -8,00 € | -30,8% | 7,81 € | 1,71 € | nein |
| stele-49 | Alu-Schalen 30er Pack für Takeaway, Cate | Einzelartikel | ja | 30,95 € | 23,95 € | -7,00 € | -22,6% | 7,49 € | 2,15 € | nein |
| stele-62 | Aluminium Schalen Einweg Schwerlast Rech | Einzelartikel | ja | 30,95 € | 23,95 € | -7,00 € | -22,6% | 7,49 € | 2,15 € | nein |
| stele-83 | Backpapier Rechteckig 300 Blatt Antihaft | Einzelartikel | ja | 29,95 € | 22,95 € | -7,00 € | -23,4% | 7,67 € | 2,34 € | nein |
| stele-85 | Heißluftfritteuse Backpapier, Nicht-kleb | Einzelartikel | ja | 21,95 € | 14,95 € | -7,00 € | -31,9% | 7,33 € | 1,99 € | nein |
| stele-96 | Heißluftfritteuse Backpapier Clips Antih | Einzelartikel | ja | 25,95 € | 18,95 € | -7,00 € | -27,0% | 7,29 € | 1,95 € | nein |
| stele-140 | Ninja Airfryer Zubehör Backblech für AF4 | Einzelartikel | ja | 25,95 € | 18,95 € | -7,00 € | -27,0% | 7,66 € | 2,32 € | nein |
| stele-94 | Frischhaltebehälter Edelstahl Frischbox  | Einzelartikel | ja | 21,95 € | 18,95 € | -3,00 € | -13,7% | 3,92 € | 1,63 € | nein |
| stele-100 | 15&18 Stk. Blasenpflaster Hydrokolloid G | Varianten | nein | 16,95 € | 13,95 € | -3,00 € | -17,7% | 3,97 € | 1,68 € | nein |
| stele-142 | Heißluftfritteuse Einweg Papier Backpapi | Varianten | nein | 19,95 € | 16,95 € | -3,00 € | -15,0% | 4,06 € | 1,78 € | nein |
| stele-64 | Edelstahl Spritzschutz für Heißluftfritt | Einzelartikel | ja | 22,95 € | 20,95 € | -2,00 € | -8,7% | 3,61 € | 2,09 € | nein |
| stele-67 | Silikon Induktionskochfeld Matte Rutschf | Varianten | nein | 21,95 € | 19,95 € | -2,00 € | -9,1% | 3,50 € | 1,97 € | nein |
| stele-70 | Edelstahl Waschschüssel Abtropfsieb Küch | Varianten | nein | 25,95 € | 23,95 € | -2,00 € | -7,7% | 3,83 € | 2,30 € | nein |
| stele-71 | Grillmatte antihaft, wiederverwendbar, h | Varianten | nein | 27,95 € | 25,95 € | -2,00 € | -7,2% | 3,45 € | 1,93 € | nein |
| stele-75 | Heißluftfritteuse Silikon-Magnethalter f | Varianten | nein | 19,95 € | 17,95 € | -2,00 € | -10,0% | 3,75 € | 2,23 € | nein |
| stele-77 | Grillmatten Schwarz Quadratisch Wiederve | Varianten | nein | 21,95 € | 19,95 € | -2,00 € | -9,1% | 3,68 € | 2,15 € | nein |
| stele-78 | Wiederverwendbare Backmatten Antihaft fü | Varianten | nein | 31,95 € | 29,95 € | -2,00 € | -6,3% | 3,30 € | 1,77 € | nein |
| stele-82 | Heißluftfritteuse Einsätze Papier, Fett- | Varianten | nein | 21,95 € | 19,95 € | -2,00 € | -9,1% | 3,18 € | 1,65 € | nein |
| stele-95 | EUQEE Duftöl Set 6x10ml Kokos Ananas Bub | Varianten | nein | 16,95 € | 14,95 € | -2,00 € | -11,8% | 3,77 € | 2,24 € | nein |
| stele-97 | PHATOIL 100ml Ätherisches Öl Set: Eukaly | Varianten | nein | 20,95 € | 18,95 € | -2,00 € | -9,5% | 3,22 € | 1,69 € | nein |
| stele-107 | Fersenschutz Gel Polster Blasenpolster H | Varianten | nein | 14,95 € | 12,95 € | -2,00 € | -13,4% | 3,34 € | 1,82 € | nein |
| stele-110 | Achsel Schweißpads Fußpads Deodorant Uns | Varianten | nein | 19,95 € | 17,95 € | -2,00 € | -10,0% | 3,15 € | 1,63 € | nein |
| stele-119 | Einweg Frischhaltehauben, Lebensmittelab | Varianten | nein | 14,95 € | 12,95 € | -2,00 € | -13,4% | 3,44 € | 1,92 € | nein |
| stele-121 | Automatische Bewässerung Tropfbewässerun | Varianten | nein | 16,95 € | 14,95 € | -2,00 € | -11,8% | 3,22 € | 1,69 € | nein |
| stele-122 | Blumen Topf Selbstbewässerung Tropfer Pf | Varianten | nein | 19,95 € | 17,95 € | -2,00 € | -10,0% | 3,35 € | 1,83 € | nein |
| stele-123 | Alufolie Frischhaltehaube Einweg elastis | Varianten | nein | 35,95 € | 33,95 € | -2,00 € | -5,6% | 3,35 € | 1,82 € | nein |
| stele-129 | Wäschebeutel Netzwaschbeutel Wiederverwe | Varianten | nein | 20,95 € | 18,95 € | -2,00 € | -9,5% | 3,23 € | 1,70 € | nein |
| stele-131 | Neue Katzenklo Schaufel mit Griff, süß & | Varianten | nein | 14,95 € | 12,95 € | -2,00 € | -13,4% | 3,55 € | 2,03 € | nein |
| stele-132 | Katzenstreuschaufel Set Groß & Klein für | Varianten | nein | 21,95 € | 19,95 € | -2,00 € | -9,1% | 3,49 € | 1,96 € | nein |
| stele-136 | Vakuumbeutel mit Ventil platzsparend für | Varianten | nein | 17,95 € | 15,95 € | -2,00 € | -11,1% | 3,23 € | 1,71 € | nein |
| stele-138 | Müllbeutel mit Henkel, Duft, Extra Stark | Varianten | nein | 20,95 € | 18,95 € | -2,00 € | -9,5% | 3,43 € | 1,90 € | nein |
| stele-139 | PHATOIL 15 Aromatherapie ätherische Öle  | Varianten | nein | 26,95 € | 24,95 € | -2,00 € | -7,4% | 3,19 € | 1,66 € | nein |
| stele-141 | Achselpads Schweißpads Sommer Unisex Ant | Varianten | nein | 23,95 € | 21,95 € | -2,00 € | -8,4% | 3,71 € | 2,19 € | nein |
| stele-143 | Heißluftfritteuse Einsätze aus Papier, F | Einzelartikel | ja | 15,95 € | 13,95 € | -2,00 € | -12,5% | 3,66 € | 2,13 € | nein |
| stele-145 | PHATOIL 15ml Ätherische Öle Set für Diff | Varianten | nein | 23,95 € | 21,95 € | -2,00 € | -8,4% | 3,20 € | 1,68 € | nein |
| stele-148 | Große Katzentoilette Schaufel Haustierre | Varianten | nein | 15,95 € | 13,95 € | -2,00 € | -12,5% | 3,72 € | 2,19 € | nein |
| stele-149 | Malbuch Erwachsene 32 Seiten Blumen Mand | Varianten | nein | 17,95 € | 15,95 € | -2,00 € | -11,1% | 3,74 € | 2,22 € | nein |
| stele-150 | 8 Rollen biologisch abbaubare Hundekotbe | Varianten | nein | 17,95 € | 15,95 € | -2,00 € | -11,1% | 3,64 € | 2,12 € | nein |
| stele-151 | 150x Müllbeutel Hundekotbeutel, Dick, Be | Varianten | nein | 16,95 € | 14,95 € | -2,00 € | -11,8% | 3,42 € | 1,89 € | nein |
| stele-152 | Kühlschrank Kräuterfrische Behälter Gemü | Varianten | nein | 29,95 € | 27,95 € | -2,00 € | -6,7% | 3,68 € | 2,16 € | nein |
| stele-66 | 2-in-1 Hautanhänger Entferner, schmerzlo | Varianten | nein | 39,95 € | 38,95 € | -1,00 € | -2,5% | 3,09 € | 2,33 € | nein |
| stele-92 | MAYJAM Ätherische Öle für Diffuser & Luf | Varianten | nein | 33,95 € | 32,95 € | -1,00 € | -2,9% | 2,92 € | 2,16 € | nein |
| stele-120 | Frischhaltehauben für Lebensmittel, Bunt | Varianten | nein | 43,95 € | 42,95 € | -1,00 € | -2,3% | 2,95 € | 2,19 € | nein |
| stele-127 | Lebensmittelhaube Frischhalteplatte Mehr | Varianten | nein | 25,95 € | 24,95 € | -1,00 € | -3,9% | 3,14 € | 2,37 € | nein |
| stele-135 | Platzsparende Vakuumbeutel für Kleidung  | Varianten | nein | 15,95 € | 14,95 € | -1,00 € | -6,3% | 3,01 € | 2,24 € | nein |
| stele-147 | Alufolie Frischhaltefolie Lebensmittelab | Varianten | nein | 30,95 € | 29,95 € | -1,00 € | -3,2% | 3,05 € | 2,28 € | nein |
| stele-65 | Profi Fernglas 500x25 Weitblick Jagd Wan | Varianten | nein | 73,95 € | 73,95 € | 0,00 € | 0,0% | 2,00 € | 2,00 € | nein |
| stele-89 | Schmuckschatulle mit Rose & Teddybär – S | Varianten | nein | 17,95 € | 17,95 € | 0,00 € | 0,0% | 2,28 € | 2,28 € | nein |
| stele-153 | Vorschul-Mathe Arbeitsheft: Zahlen schre | Einzelartikel | ja | 15,95 € | 15,95 € | 0,00 € | 0,0% | 2,22 € | 2,22 € | nein |
| stele-137 | XXL Vakuumbeutel ohne Pumpe, platzsparen | Varianten | nein | 10,95 € | 17,95 € | 7,00 € | +63,9% | -3,59 € | 1,74 € | ⚠️ ja |
| stele-144 | Alkoholometer Hydrometer Set 0-100% Alko | Varianten | nein | – € | 21,95 € | – | – | – € | 2,06 € | nein |
| stele-154 | Wiederverwendbare Kinder 3D-Schreiblernh | Varianten | nein | – € | 13,95 € | – | – | – € | 1,63 € | nein |
| stele-155 | Kinder Zeichenbuch Malbuch Kindergarten  | Varianten | nein | – € | 13,95 € | – | – | – € | 1,73 € | nein |

## Zusammenfassung
- Produkte gesamt: 53
- Wuerden teurer: 1
- Wuerden guenstiger: 46
- Unveraendert: 3
- Kein bisheriger Verkaufspreis (Erst-Setzung): 3
- Stehen HEUTE unter Einstand (Gewinn heute < 0€, inkl. Gebuehren): 1
