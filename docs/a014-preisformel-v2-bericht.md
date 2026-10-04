# Preisformel v2 — Vergleich alter VK → neuer VK (A-014, NUR LESEN, keine Preisänderung)

Lauf: 2026-10-04T09:11:11.488Z

Formel v2: K = Ware + Versand (1,99 € bei Ware < 10 €) + Einfuhrabgaben (3,57 € bei China); Gewinn = VK × (1 − (15 % + Anzeige) × 1,19) − 0,357 − K;
Rundung ,95 unter dem Rohpreis, bei Gewinn < Boden die nächste ,95 darüber. "neuer VK" ist der Formelpreis je Variante (Varianten-Regel 6c
ist AUS — im Betrieb würde keine Variante allein über die Formel erhöht, außer sie liegt unter dem Boden). "Gewinn alt (v1)" = bis A-014 gültige
Formel (Ware + shippingCost + 4,00 € Zoll bei China) beim heutigen VK; "Gewinn heute (v2)" = echter Gewinn beim heutigen VK nach v2.
"alter VK" = in der DB gespeicherter VK der Variante (variant_sell_prices, sonst alter ebayPrice), sonst der Produkt-VK (sellPrice). Ist je Variante
nichts gespeichert, kann der echte eBay-Preis der Variante abweichen — der Bericht liest nur die DB, nicht eBay.

| Produkt | Variante | Ware | China | Stufe (Ziel/Boden) | alter VK | neuer VK | Δ VK | Gewinn alt (v1) | Gewinn heute (v2) | Gewinn neu (v2) | Anzeige heute |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 70 Edelstahl Waschschüssel Abtropfsieb Küch | 1PCS | 11,69 | ja | C (2,00/1,30) | 23,95 | 22,95 | -1,00 | 2,20 | 2,63 | 1,87 | ok |
| 70 Edelstahl Waschschüssel Abtropfsieb Küch | Gold | 12,39 | ja | C (2,00/1,30) | 23,95 | 23,95 | 0,00 | 1,50 | 1,93 | 1,93 | gelb (unter Ziel) |
| 71 Grillmatte antihaft, wiederverwendbar, h | 2Pcs 50x40cm / China Mainland | 1,00 | ja | C (2,00/1,30) | 13,95 | 10,95 | -3,00 | 5,27 | 3,71 | 1,43 | ok |
| 71 Grillmatte antihaft, wiederverwendbar, h | 2Pcs 33x40cm / China Mainland | 1,00 | ja | C (2,00/1,30) | 12,95 | 10,95 | -2,00 | 4,51 | 2,95 | 1,43 | ok |
| 71 Grillmatte antihaft, wiederverwendbar, h | 4Pcs 50x40cm / China Mainland | 1,00 | ja | C (2,00/1,30) | 17,95 | 10,95 | -7,00 | 8,32 | 6,76 | 1,43 | ok |
| 71 Grillmatte antihaft, wiederverwendbar, h | 4Pcs 33x40cm / China Mainland | 1,00 | ja | C (2,00/1,30) | 14,95 | 10,95 | -4,00 | 6,03 | 4,47 | 1,43 | ok |
| 71 Grillmatte antihaft, wiederverwendbar, h | 5Pcs 50x40cm / China Mainland | 1,94 | ja | C (2,00/1,30) | 18,95 | 12,95 | -6,00 | 8,14 | 6,58 | 2,01 | ok |
| 71 Grillmatte antihaft, wiederverwendbar, h | 5Pcs 33x40cm / China Mainland | 1,00 | ja | C (2,00/1,30) | 15,95 | 10,95 | -5,00 | 6,80 | 5,24 | 1,43 | ok |
| 71 Grillmatte antihaft, wiederverwendbar, h | 6Pcs 50x40cm / China Mainland | 3,28 | ja | C (2,00/1,30) | 20,94 | 13,95 | -6,99 | 8,32 | 6,76 | 1,43 | ok |
| 71 Grillmatte antihaft, wiederverwendbar, h | 6Pcs 33x40cm / China Mainland | 1,00 | ja | C (2,00/1,30) | 16,95 | 10,95 | -6,00 | 7,56 | 6,00 | 1,43 | ok |
| 71 Grillmatte antihaft, wiederverwendbar, h | 1Pc 50x40cm / China Mainland | 1,00 | ja | C (2,00/1,30) | 11,95 | 10,95 | -1,00 | 3,75 | 2,19 | 1,43 | ok |
| 71 Grillmatte antihaft, wiederverwendbar, h | 1Pc 33x40cm / China Mainland | 1,00 | ja | C (2,00/1,30) | 11,95 | 10,95 | -1,00 | 3,75 | 2,19 | 1,43 | ok |
| 77 Grillmatten Schwarz Quadratisch Wiederve | – | 13,39 | nein | C (2,00/1,30) | 20,95 | 19,95 | -1,00 | 2,22 | 2,22 | 1,45 | ok |
| 83 Backpapier Rechteckig 300 Blatt Antihaft | – | 11,34 | nein | C (2,00/1,30) | 25,95 | 17,95 | -8,00 | 8,08 | 8,08 | 1,98 | ok |
| 87 10 x Staubsaugerbeutel für Dreame L10s U | – | 11,61 | nein | C (2,00/1,30) | 23,95 | 17,95 | -6,00 | 6,28 | 6,28 | 1,71 | ok |
| 92 MAYJAM Ätherische Öle für Diffuser & Luf | 20pcs Essential Oils / Germany / 5ml | 18,19 | nein | C (2,00/1,30) | 33,95 | 26,95 | -7,00 | 7,32 | 7,32 | 1,99 | ok |
| 92 MAYJAM Ätherische Öle für Diffuser & Luf | 35pcs Essential Oils / Germany / 5ml | 23,39 | nein | C (2,00/1,30) | 33,95 | 32,95 | -1,00 | 2,12 | 2,12 | 1,36 | ok |
| 95 EUQEE Duftöl Set 6x10ml Kokos Ananas Bub | – | 8,99 | nein | C (2,00/1,30) | 15,95 | 16,95 | +1,00 | 2,81 | 0,82 | 1,58 | ROT (unter Boden) |
| 96 Heißluftfritteuse Backpapier Clips Antih | – | 12,13 | nein | C (2,00/1,30) | 23,95 | 18,95 | -5,00 | 5,76 | 5,76 | 1,95 | ok |
| 97 PHATOIL 100ml Ätherisches Öl Set: Eukaly | Jasmine / Poland | 12,79 | nein | C (2,00/1,30) | 19,95 | 19,95 | 0,00 | 2,05 | 2,05 | 2,05 | ok |
| 97 PHATOIL 100ml Ätherisches Öl Set: Eukaly | Lemongrass / Poland | 10,99 | nein | C (2,00/1,30) | 19,95 | 16,95 | -3,00 | 3,85 | 3,85 | 1,57 | ok |
| 97 PHATOIL 100ml Ätherisches Öl Set: Eukaly | Lavender / Poland | 12,29 | nein | C (2,00/1,30) | 19,95 | 18,95 | -1,00 | 2,55 | 2,55 | 1,79 | ok |
| 97 PHATOIL 100ml Ätherisches Öl Set: Eukaly | Vanilla / Poland | 10,79 | nein | C (2,00/1,30) | 19,95 | 16,95 | -3,00 | 4,05 | 4,05 | 1,77 | ok |
| 97 PHATOIL 100ml Ätherisches Öl Set: Eukaly | Eucalyptus / Poland | 10,69 | nein | C (2,00/1,30) | 19,95 | 16,95 | -3,00 | 4,15 | 4,15 | 1,87 | ok |
| 107 Fersenschutz Gel Polster Blasenpolster H | white Triangle / China Mainland | 3,99 | ja | C (2,00/1,30) | 14,95 | 14,95 | 0,00 | 3,04 | 1,48 | 1,48 | gelb (unter Ziel) |
| 107 Fersenschutz Gel Polster Blasenpolster H | white Ellipse / China Mainland | 2,29 | ja | C (2,00/1,30) | 14,95 | 12,95 | -2,00 | 4,74 | 3,18 | 1,66 | ok |
| 107 Fersenschutz Gel Polster Blasenpolster H | white Triangle / China Mainland | 2,15 | ja | C (2,00/1,30) | 14,95 | 12,95 | -2,00 | 4,88 | 3,32 | 1,80 | ok |
| 107 Fersenschutz Gel Polster Blasenpolster H | white Ellipse / China Mainland | 4,09 | ja | C (2,00/1,30) | 14,95 | 14,95 | 0,00 | 2,94 | 1,38 | 1,38 | gelb (unter Ziel) |
| 110 Achsel Schweißpads Fußpads Deodorant Uns | 01 - 5PCS / One Size | 2,79 | ja | C (2,00/1,30) | 19,95 | 13,95 | -6,00 | 8,05 | 6,49 | 1,92 | ok |
| 110 Achsel Schweißpads Fußpads Deodorant Uns | 01 - 3PCS / One Size | 2,39 | ja | C (2,00/1,30) | 19,95 | 12,95 | -7,00 | 8,45 | 6,89 | 1,56 | ok |
| 110 Achsel Schweißpads Fußpads Deodorant Uns | 02 Mixed - 2Roll / One Size | 8,49 | ja | C (2,00/1,30) | 19,95 | 20,95 | +1,00 | 2,35 | 0,79 | 1,56 | ROT (unter Boden) |
| 110 Achsel Schweißpads Fußpads Deodorant Uns | 02 5cm - 1Roll / One Size | 5,49 | ja | C (2,00/1,30) | 19,95 | 16,95 | -3,00 | 5,35 | 3,79 | 1,51 | ok |
| 110 Achsel Schweißpads Fußpads Deodorant Uns | 01 - 10PCS / One Size | 3,69 | ja | C (2,00/1,30) | 19,95 | 14,95 | -5,00 | 7,15 | 5,59 | 1,78 | ok |
| 110 Achsel Schweißpads Fußpads Deodorant Uns | 02 3.8cm - 1Roll / One Size | 4,59 | ja | C (2,00/1,30) | 19,95 | 15,95 | -4,00 | 6,25 | 4,69 | 1,65 | ok |
| 119 Einweg Frischhaltehauben, Lebensmittelab | 200pcs / China Mainland | 4,79 | ja | C (2,00/1,30) | 14,95 | 15,95 | +1,00 | 2,24 | 0,68 | 1,45 | ROT (unter Boden) |
| 119 Einweg Frischhaltehauben, Lebensmittelab | 100pcs / China Mainland | 3,15 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 3,88 | 2,32 | 1,56 | ok |
| 119 Einweg Frischhaltehauben, Lebensmittelab | 100pcs / China Mainland | 3,39 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 3,64 | 2,08 | 1,32 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 50PCS / 120CM | 11,39 | ja | C (2,00/1,30) | 43,95 | 21,95 | -22,00 | 15,75 | 18,17 | 1,41 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 50PCS / 40-42CM | 1,95 | ja | C (2,00/1,30) | 43,95 | 12,95 | -31,00 | 25,19 | 25,62 | 2,00 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 50PCS / 70CM | 5,39 | ja | C (2,00/1,30) | 43,95 | 16,95 | -27,00 | 21,75 | 22,18 | 1,61 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 100PCS / 47CM | 5,19 | ja | C (2,00/1,30) | 43,95 | 16,95 | -27,00 | 21,95 | 22,38 | 1,81 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 100PCS / 52CM | 6,09 | ja | C (2,00/1,30) | 43,95 | 17,95 | -26,00 | 21,05 | 21,48 | 1,67 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 100PCS / 60CM | 10,49 | ja | C (2,00/1,30) | 43,95 | 20,95 | -23,00 | 16,65 | 19,07 | 1,55 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 50PCS / 47CM | 3,15 | ja | C (2,00/1,30) | 43,95 | 13,95 | -30,00 | 23,99 | 24,42 | 1,56 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 100PCS / 120CM | 25,99 | ja | C (2,00/1,30) | 43,95 | 41,95 | -2,00 | 1,15 | 3,57 | 2,05 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 50PCS / 52CM | 3,49 | ja | C (2,00/1,30) | 43,95 | 14,95 | -29,00 | 23,65 | 24,08 | 1,98 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 100PCS / 70CM | 9,89 | ja | C (2,00/1,30) | 43,95 | 22,95 | -21,00 | 17,25 | 17,68 | 1,68 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 50PCS / 60CM | 5,39 | ja | C (2,00/1,30) | 43,95 | 16,95 | -27,00 | 21,75 | 22,18 | 1,61 | ok |
| 120 Frischhaltehauben für Lebensmittel, Bunt | Light Grey / 100PCS / 40-42CM | 2,89 | ja | C (2,00/1,30) | 43,95 | 13,95 | -30,00 | 24,25 | 24,68 | 1,82 | ok |
| 121 Automatische Bewässerung Tropfbewässerun | 12PCS-Blue | 3,69 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 2,12 | 2,55 | 1,78 | ok |
| 121 Automatische Bewässerung Tropfbewässerun | 12PCS-Green | 3,99 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 1,82 | 2,25 | 1,48 | ok |
| 121 Automatische Bewässerung Tropfbewässerun | 6PCS-Blue | 2,95 | ja | C (2,00/1,30) | 15,95 | 13,95 | -2,00 | 2,86 | 3,29 | 1,76 | ok |
| 121 Automatische Bewässerung Tropfbewässerun | 6PCS-Green | 2,65 | ja | C (2,00/1,30) | 15,95 | 12,95 | -3,00 | 3,16 | 3,59 | 1,30 | ok |
| 121 Automatische Bewässerung Tropfbewässerun | 1PC-Blue | 1,89 | ja | C (2,00/1,30) | 15,95 | 12,95 | -3,00 | 3,92 | 4,35 | 2,06 | ok |
| 121 Automatische Bewässerung Tropfbewässerun | 1PC-Green | 1,89 | ja | C (2,00/1,30) | 15,95 | 12,95 | -3,00 | 3,92 | 4,35 | 2,06 | ok |
| 121 Automatische Bewässerung Tropfbewässerun | 12PCS-MIx | 3,69 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 2,12 | 2,55 | 1,78 | ok |
| 122 Blumen Topf Selbstbewässerung Tropfer Pf | White Set of 4 | 5,49 | ja | C (2,00/1,30) | 19,95 | 16,95 | -3,00 | 3,35 | 3,79 | 1,51 | ok |
| 122 Blumen Topf Selbstbewässerung Tropfer Pf | Green Set of 2 | 3,59 | ja | C (2,00/1,30) | 19,95 | 14,95 | -5,00 | 5,25 | 5,69 | 1,88 | ok |
| 122 Blumen Topf Selbstbewässerung Tropfer Pf | White Set of 2 | 4,09 | ja | C (2,00/1,30) | 19,95 | 14,95 | -5,00 | 4,75 | 5,19 | 1,38 | ok |
| 122 Blumen Topf Selbstbewässerung Tropfer Pf | Green Set of 4 | 5,49 | ja | C (2,00/1,30) | 19,95 | 16,95 | -3,00 | 3,35 | 3,79 | 1,51 | ok |
| 123 Alufolie Frischhaltehaube Einweg elastis | 100PCS(13-38cm) | 11,49 | ja | C (2,00/1,30) | 36,95 | 21,95 | -15,00 | 10,31 | 12,74 | 1,31 | ok |
| 123 Alufolie Frischhaltehaube Einweg elastis | 200PCS(13-38cm) | 19,79 | ja | C (2,00/1,30) | 36,95 | 32,95 | -4,00 | 2,01 | 4,44 | 1,39 | ok |
| 123 Alufolie Frischhaltehaube Einweg elastis | 10PCS(10-28cm) | 2,05 | ja | C (2,00/1,30) | 36,95 | 12,95 | -24,00 | 19,75 | 20,19 | 1,90 | ok |
| 123 Alufolie Frischhaltehaube Einweg elastis | 20PCS(10-28cm) | 2,59 | ja | C (2,00/1,30) | 36,95 | 12,95 | -24,00 | 19,21 | 19,65 | 1,36 | ok |
| 123 Alufolie Frischhaltehaube Einweg elastis | 30PCS(10-28cm) | 4,09 | ja | C (2,00/1,30) | 36,95 | 14,95 | -22,00 | 17,71 | 18,15 | 1,38 | ok |
| 123 Alufolie Frischhaltehaube Einweg elastis | 50PCS(13-38cm) | 5,89 | ja | C (2,00/1,30) | 36,95 | 17,95 | -19,00 | 15,91 | 16,35 | 1,87 | ok |
| 127 Lebensmittelhaube Frischhalteplatte Mehr | Multicolour 100pcs | 3,49 | ja | C (2,00/1,30) | 24,95 | 14,95 | -10,00 | 9,17 | 9,60 | 1,98 | ok |
| 127 Lebensmittelhaube Frischhalteplatte Mehr | Multicolour 50pcs | 2,55 | ja | C (2,00/1,30) | 24,95 | 12,95 | -12,00 | 10,11 | 10,54 | 1,40 | ok |
| 127 Lebensmittelhaube Frischhalteplatte Mehr | White 500pcs | 10,69 | ja | C (2,00/1,30) | 24,95 | 20,95 | -4,00 | 1,97 | 4,39 | 1,35 | ok |
| 127 Lebensmittelhaube Frischhalteplatte Mehr | Multicolour 500pcs | 10,99 | ja | C (2,00/1,30) | 24,95 | 21,95 | -3,00 | 1,67 | 4,09 | 1,81 | ok |
| 129 Wäschebeutel Netzwaschbeutel Wiederverwe | 1PC-30x40CM / China Mainland | 2,15 | ja | C (2,00/1,30) | 20,95 | 12,95 | -8,00 | 7,47 | 7,90 | 1,80 | ok |
| 129 Wäschebeutel Netzwaschbeutel Wiederverwe | S M L-3PCS Set / China Mainland | 5,79 | ja | C (2,00/1,30) | 20,95 | 17,95 | -3,00 | 3,83 | 4,26 | 1,97 | ok |
| 129 Wäschebeutel Netzwaschbeutel Wiederverwe | 1PC-Round-15x16CM / China Mainland | 3,55 | ja | C (2,00/1,30) | 20,95 | 14,95 | -6,00 | 6,07 | 6,50 | 1,92 | ok |
| 129 Wäschebeutel Netzwaschbeutel Wiederverwe | 1PC-50x60CM / China Mainland | 3,09 | ja | C (2,00/1,30) | 20,95 | 13,95 | -7,00 | 6,53 | 6,96 | 1,62 | ok |
| 129 Wäschebeutel Netzwaschbeutel Wiederverwe | 1PC-40x50CM / China Mainland | 2,79 | ja | C (2,00/1,30) | 20,95 | 13,95 | -7,00 | 6,83 | 7,26 | 1,92 | ok |
| 129 Wäschebeutel Netzwaschbeutel Wiederverwe | 4 PCS Set(All) / China Mainland | 7,09 | ja | C (2,00/1,30) | 20,95 | 18,95 | -2,00 | 2,53 | 2,96 | 1,43 | ok |
| 131 Neue Katzenklo Schaufel mit Griff, süß & | pink | 1,09 | ja | C (2,00/1,30) | 13,95 | 10,95 | -3,00 | 3,19 | 3,62 | 1,34 | ok |
| 131 Neue Katzenklo Schaufel mit Griff, süß & | blue | 1,09 | ja | C (2,00/1,30) | 13,95 | 10,95 | -3,00 | 3,19 | 3,62 | 1,34 | ok |
| 131 Neue Katzenklo Schaufel mit Griff, süß & | green | 1,49 | ja | C (2,00/1,30) | 13,95 | 11,95 | -2,00 | 2,79 | 3,22 | 1,70 | ok |
| 131 Neue Katzenklo Schaufel mit Griff, süß & | grey | 1,05 | ja | C (2,00/1,30) | 13,95 | 10,95 | -3,00 | 3,23 | 3,66 | 1,38 | ok |
| 132 Katzenstreuschaufel Set Groß & Klein für | Light White Blue | 4,09 | ja | C (2,00/1,30) | 20,95 | 14,95 | -6,00 | 5,53 | 5,96 | 1,38 | ok |
| 132 Katzenstreuschaufel Set Groß & Klein für | Indigo Pink Base Set | 6,89 | ja | C (2,00/1,30) | 20,95 | 18,95 | -2,00 | 2,73 | 3,16 | 1,63 | ok |
| 132 Katzenstreuschaufel Set Groß & Klein für | White Grey | 4,39 | ja | C (2,00/1,30) | 20,95 | 15,95 | -5,00 | 5,23 | 5,66 | 1,85 | ok |
| 132 Katzenstreuschaufel Set Groß & Klein für | Indigo Pink | 4,49 | ja | C (2,00/1,30) | 20,95 | 15,95 | -5,00 | 5,13 | 5,56 | 1,75 | ok |
| 132 Katzenstreuschaufel Set Groß & Klein für | White Blue Base Set | 6,89 | ja | C (2,00/1,30) | 20,95 | 18,95 | -2,00 | 2,73 | 3,16 | 1,63 | ok |
| 132 Katzenstreuschaufel Set Groß & Klein für | White Gray Base Set | 6,89 | ja | C (2,00/1,30) | 20,95 | 18,95 | -2,00 | 2,73 | 3,16 | 1,63 | ok |
| 137 XXL Vakuumbeutel ohne Pumpe, platzsparen | flat Vacuum Bag S | 3,59 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 2,22 | 2,65 | 1,88 | ok |
| 137 XXL Vakuumbeutel ohne Pumpe, platzsparen | flat Vacuum Bag M | 4,19 | ja | C (2,00/1,30) | 15,95 | 15,95 | 0,00 | 1,62 | 2,05 | 2,05 | ok |
| 137 XXL Vakuumbeutel ohne Pumpe, platzsparen | cubic Vacuum Bag XL | 6,99 | ja | C (2,00/1,30) | 17,95 | 18,95 | +1,00 | 0,34 | 0,77 | 1,53 | ROT (unter Boden) |
| 137 XXL Vakuumbeutel ohne Pumpe, platzsparen | flat Vacuum Bag XL | 5,39 | ja | C (2,00/1,30) | 16,95 | 16,95 | 0,00 | 1,18 | 1,61 | 1,61 | gelb (unter Ziel) |
| 137 XXL Vakuumbeutel ohne Pumpe, platzsparen | cubic Vacuum Bag L | 4,59 | ja | C (2,00/1,30) | 15,95 | 15,95 | 0,00 | 1,22 | 1,65 | 1,65 | gelb (unter Ziel) |
| 138 Müllbeutel mit Henkel, Duft, Extra Stark | 45x50cm / 5PCS | 7,39 | ja | C (2,00/1,30) | 20,95 | 19,95 | -1,00 | 2,23 | 2,66 | 1,89 | ok |
| 138 Müllbeutel mit Henkel, Duft, Extra Stark | 45x50cm / 2PCS | 3,99 | ja | C (2,00/1,30) | 20,95 | 14,95 | -6,00 | 5,63 | 6,06 | 1,48 | ok |
| 138 Müllbeutel mit Henkel, Duft, Extra Stark | 45x50cm / 1PC | 2,79 | ja | C (2,00/1,30) | 20,95 | 13,95 | -7,00 | 6,83 | 7,26 | 1,92 | ok |
| 139 PHATOIL 15 Aromatherapie ätherische Öle  | – | 13,49 | ja | C (2,00/1,30) | 25,95 | 24,95 | -1,00 | 1,93 | 2,36 | 1,59 | ok |
| 140 Ninja Airfryer Zubehör Backblech für AF4 | – | 11,76 | nein | C (2,00/1,30) | 23,95 | 17,95 | -6,00 | 6,13 | 6,13 | 1,56 | ok |
| 141 Achselpads Schweißpads Sommer Unisex Ant | 10pcs / ONE SIZE | 1,99 | ja | C (2,00/1,30) | 23,95 | 12,95 | -11,00 | 9,91 | 10,34 | 1,96 | ok |
| 141 Achselpads Schweißpads Sommer Unisex Ant | 20pcs / ONE SIZE | 2,49 | ja | C (2,00/1,30) | 23,95 | 12,95 | -11,00 | 9,41 | 9,84 | 1,46 | ok |
| 141 Achselpads Schweißpads Sommer Unisex Ant | 40pcs / ONE SIZE | 3,49 | ja | C (2,00/1,30) | 23,95 | 14,95 | -9,00 | 8,41 | 8,84 | 1,98 | ok |
| 141 Achselpads Schweißpads Sommer Unisex Ant | 150pcs / ONE SIZE | 9,29 | ja | C (2,00/1,30) | 23,95 | 21,95 | -2,00 | 2,61 | 3,04 | 1,52 | ok |
| 141 Achselpads Schweißpads Sommer Unisex Ant | 50pcs / ONE SIZE | 3,25 | ja | C (2,00/1,30) | 23,95 | 13,95 | -10,00 | 8,65 | 9,08 | 1,46 | ok |
| 142 Heißluftfritteuse Einweg Papier Backpapi | 50pcs brown | 3,25 | ja | C (2,00/1,30) | 17,95 | 13,95 | -4,00 | 4,08 | 4,51 | 1,46 | ok |
| 142 Heißluftfritteuse Einweg Papier Backpapi | 100pcs brown | 4,99 | ja | C (2,00/1,30) | 17,95 | 16,95 | -1,00 | 2,34 | 2,77 | 2,01 | ok |
| 143 Heißluftfritteuse Einsätze aus Papier, F | – | 2,15 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 2,13 | 2,56 | 1,80 | ok |
| 145 PHATOIL 15ml Ätherische Öle Set für Diff | – | 10,99 | ja | C (2,00/1,30) | 22,95 | 21,95 | -1,00 | 2,14 | 2,57 | 1,81 | ok |
| 147 Alufolie Frischhaltefolie Lebensmittelab | 10PCS | 2,79 | ja | C (2,00/1,30) | 30,95 | 13,95 | -17,00 | 14,45 | 14,88 | 1,92 | ok |
| 147 Alufolie Frischhaltefolie Lebensmittelab | 50PCS | 8,89 | ja | C (2,00/1,30) | 30,95 | 21,95 | -9,00 | 8,35 | 8,78 | 1,92 | ok |
| 147 Alufolie Frischhaltefolie Lebensmittelab | 20PCS | 4,19 | ja | C (2,00/1,30) | 30,95 | 15,95 | -15,00 | 13,05 | 13,48 | 2,05 | ok |
| 147 Alufolie Frischhaltefolie Lebensmittelab | 100PCS | 15,69 | ja | C (2,00/1,30) | 30,95 | 27,95 | -3,00 | 1,55 | 3,97 | 1,68 | ok |
| 148 Große Katzentoilette Schaufel Haustierre | – | 2,09 | ja | C (2,00/1,30) | 14,95 | 12,95 | -2,00 | 2,95 | 3,38 | 1,86 | ok |
| 149 Malbuch Erwachsene 32 Seiten Blumen Mand | – | 4,19 | ja | C (2,00/1,30) | 16,95 | 15,95 | -1,00 | 2,38 | 2,81 | 2,05 | ok |
| 150 8 Rollen biologisch abbaubare Hundekotbe | – | 3,85 | ja | C (2,00/1,30) | 16,95 | 14,95 | -2,00 | 2,72 | 3,15 | 1,62 | ok |
| 151 150x Müllbeutel Hundekotbeutel, Dick, Be | – | 3,29 | ja | C (2,00/1,30) | 15,95 | 13,95 | -2,00 | 2,52 | 2,95 | 1,42 | ok |
| 152 Kühlschrank Kräuterfrische Behälter Gemü | White 1pcs | 5,39 | ja | C (2,00/1,30) | 29,95 | 16,95 | -13,00 | 11,08 | 11,51 | 1,61 | ok |
| 152 Kühlschrank Kräuterfrische Behälter Gemü | Black 1pcs | 5,39 | ja | C (2,00/1,30) | 29,95 | 16,95 | -13,00 | 11,08 | 11,51 | 1,61 | ok |
| 152 Kühlschrank Kräuterfrische Behälter Gemü | Black 1pcs | 5,39 | ja | C (2,00/1,30) | 29,95 | 16,95 | -13,00 | 11,08 | 11,51 | 1,61 | ok |
| 152 Kühlschrank Kräuterfrische Behälter Gemü | Green 1pcs | 5,29 | ja | C (2,00/1,30) | 29,95 | 16,95 | -13,00 | 11,18 | 11,61 | 1,71 | ok |
| 152 Kühlschrank Kräuterfrische Behälter Gemü | Black 3pcs | 14,29 | ja | C (2,00/1,30) | 29,95 | 25,95 | -4,00 | 2,18 | 4,60 | 1,56 | ok |
| 152 Kühlschrank Kräuterfrische Behälter Gemü | White 3pcs | 14,19 | ja | C (2,00/1,30) | 29,95 | 25,95 | -4,00 | 2,28 | 4,70 | 1,66 | ok |
| 152 Kühlschrank Kräuterfrische Behälter Gemü | White 1pcs | 5,79 | ja | C (2,00/1,30) | 29,95 | 17,95 | -12,00 | 10,68 | 11,11 | 1,97 | ok |
| 152 Kühlschrank Kräuterfrische Behälter Gemü | Green 3pcs | 14,19 | ja | C (2,00/1,30) | 29,95 | 25,95 | -4,00 | 2,28 | 4,70 | 1,66 | ok |
| 153 Vorschul-Mathe Arbeitsheft: Zahlen schre | – | 3,89 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 1,92 | 2,35 | 1,58 | ok |
| 155 Kinder Zeichenbuch Malbuch Kindergarten  | traffic | 2,69 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,35 | 2,78 | 2,02 | ok |
| 155 Kinder Zeichenbuch Malbuch Kindergarten  | fruit | 2,95 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,09 | 2,52 | 1,76 | ok |
| 155 Kinder Zeichenbuch Malbuch Kindergarten  | animal | 2,75 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,29 | 2,72 | 1,96 | ok |
| 155 Kinder Zeichenbuch Malbuch Kindergarten  | character | 2,89 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,15 | 2,58 | 1,82 | ok |
| 156 Hundetraining Leckerlibeutel Outdoor Tra | Green | 5,59 | ja | C (2,00/1,30) | 19,95 | 16,95 | -3,00 | 3,26 | 3,69 | 1,41 | ok |
| 156 Hundetraining Leckerlibeutel Outdoor Tra | Rose red | 5,49 | ja | C (2,00/1,30) | 19,95 | 16,95 | -3,00 | 3,36 | 3,79 | 1,51 | ok |
| 156 Hundetraining Leckerlibeutel Outdoor Tra | Black | 5,39 | ja | C (2,00/1,30) | 19,95 | 16,95 | -3,00 | 3,46 | 3,89 | 1,61 | ok |
| 156 Hundetraining Leckerlibeutel Outdoor Tra | Grey | 6,29 | ja | C (2,00/1,30) | 19,95 | 17,95 | -2,00 | 2,56 | 2,99 | 1,47 | ok |
| 157 Backpapier für Ofen Heißluftfritteuse Gr | 20x15cm / 100PCS | 3,35 | ja | C (2,00/1,30) | 31,95 | 13,95 | -18,00 | 14,65 | 15,08 | 1,36 | ok |
| 157 Backpapier für Ofen Heißluftfritteuse Gr | 20x15cm / 200PCS | 5,29 | ja | C (2,00/1,30) | 31,95 | 16,95 | -15,00 | 12,71 | 13,14 | 1,71 | ok |
| 157 Backpapier für Ofen Heißluftfritteuse Gr | 20x15cm / 50PCS | 2,49 | ja | C (2,00/1,30) | 31,95 | 12,95 | -19,00 | 15,51 | 15,94 | 1,46 | ok |
| 157 Backpapier für Ofen Heißluftfritteuse Gr | 40x30cm / 200PCS | 15,59 | ja | C (2,00/1,30) | 31,95 | 27,95 | -4,00 | 2,41 | 4,83 | 1,78 | ok |
| 157 Backpapier für Ofen Heißluftfritteuse Gr | 40x30cm / 50PCS | 5,09 | ja | C (2,00/1,30) | 31,95 | 16,95 | -15,00 | 12,91 | 13,34 | 1,91 | ok |
| 157 Backpapier für Ofen Heißluftfritteuse Gr | 40x30cm / 100PCS | 8,59 | ja | C (2,00/1,30) | 31,95 | 20,95 | -11,00 | 9,41 | 9,84 | 1,46 | ok |
| 159 Katzenbürste Eckbürste Haarentfernung Ma | GRAY | 2,09 | ja | C (2,00/1,30) | 14,95 | 12,95 | -2,00 | 2,95 | 3,38 | 1,86 | ok |
| 159 Katzenbürste Eckbürste Haarentfernung Ma | black | 2,49 | ja | C (2,00/1,30) | 14,95 | 12,95 | -2,00 | 2,55 | 2,98 | 1,46 | ok |
| 159 Katzenbürste Eckbürste Haarentfernung Ma | Pink | 2,69 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,35 | 2,78 | 2,02 | ok |
| 159 Katzenbürste Eckbürste Haarentfernung Ma | Blue | 2,79 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,25 | 2,68 | 1,92 | ok |
| 160 Interaktives Katzenpuzzle Spielzeug Filz | Green-round | 3,85 | ja | C (2,00/1,30) | 17,95 | 14,95 | -3,00 | 3,48 | 3,91 | 1,62 | ok |
| 160 Interaktives Katzenpuzzle Spielzeug Filz | Gray-round | 4,29 | ja | C (2,00/1,30) | 17,95 | 15,95 | -2,00 | 3,04 | 3,47 | 1,95 | ok |
| 160 Interaktives Katzenpuzzle Spielzeug Filz | Green-square | 4,89 | ja | C (2,00/1,30) | 17,95 | 15,95 | -2,00 | 2,44 | 2,87 | 1,35 | ok |
| 160 Interaktives Katzenpuzzle Spielzeug Filz | White-round | 4,39 | ja | C (2,00/1,30) | 17,95 | 15,95 | -2,00 | 2,94 | 3,37 | 1,85 | ok |
| 160 Interaktives Katzenpuzzle Spielzeug Filz | Gray-square | 5,19 | ja | C (2,00/1,30) | 17,95 | 16,95 | -1,00 | 2,14 | 2,57 | 1,81 | ok |
| 160 Interaktives Katzenpuzzle Spielzeug Filz | White-square | 4,89 | ja | C (2,00/1,30) | 17,95 | 15,95 | -2,00 | 2,44 | 2,87 | 1,35 | ok |
| 161 Katzen Tunnel Faltbar Spielzeug Interakt | Small | 5,19 | ja | C (2,00/1,30) | 24,95 | 16,95 | -8,00 | 7,47 | 7,90 | 1,81 | ok |
| 161 Katzen Tunnel Faltbar Spielzeug Interakt | Straight | 7,59 | ja | C (2,00/1,30) | 24,95 | 19,95 | -5,00 | 5,07 | 5,50 | 1,69 | ok |
| 161 Katzen Tunnel Faltbar Spielzeug Interakt | Straight | 6,19 | ja | C (2,00/1,30) | 24,95 | 17,95 | -7,00 | 6,47 | 6,90 | 1,57 | ok |
| 161 Katzen Tunnel Faltbar Spielzeug Interakt | T shape | 8,59 | ja | C (2,00/1,30) | 24,95 | 20,95 | -4,00 | 4,07 | 4,50 | 1,46 | ok |
| 161 Katzen Tunnel Faltbar Spielzeug Interakt | Gray | 9,49 | ja | C (2,00/1,30) | 24,95 | 21,95 | -3,00 | 3,17 | 3,60 | 1,32 | ok |
| 161 Katzen Tunnel Faltbar Spielzeug Interakt | Y Shape | 10,39 | ja | C (2,00/1,30) | 24,95 | 20,95 | -4,00 | 2,27 | 4,69 | 1,65 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 10 | 2,39 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,89 | 2,32 | 1,56 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 11 | 2,39 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,89 | 2,32 | 1,56 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 12 | 2,39 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,89 | 2,32 | 1,56 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 5 | 2,49 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,79 | 2,22 | 1,46 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 6 | 2,39 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,89 | 2,32 | 1,56 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 3 | 2,39 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,89 | 2,32 | 1,56 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 4 | 2,25 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 2,03 | 2,46 | 1,70 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 9 | 2,19 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 2,09 | 2,52 | 1,76 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 7 | 2,49 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,79 | 2,22 | 1,46 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 8 | 2,55 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,73 | 2,16 | 1,40 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 1 | 2,55 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,73 | 2,16 | 1,40 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 2 | 2,59 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,69 | 2,12 | 1,36 | ok |
| 162 Wiederverwendbares Malbuch mit Wasser -  | 1pc pen random | 1,45 | ja | C (2,00/1,30) | 13,95 | 11,95 | -2,00 | 2,83 | 3,26 | 1,74 | ok |
| 163 Dopamine Sweet Accessoires Set: Schleife | 832pcs-No box | 4,89 | ja | C (2,00/1,30) | 17,95 | 15,95 | -2,00 | 2,44 | 2,87 | 1,35 | ok |
| 163 Dopamine Sweet Accessoires Set: Schleife | 100pcs-No box | 1,79 | ja | C (2,00/1,30) | 17,95 | 11,95 | -6,00 | 5,54 | 5,97 | 1,40 | ok |
| 164 Schmetterling Haarspangen Mädchen Doppel | 8pcs | 1,99 | ja | C (2,00/1,30) | 14,95 | 12,95 | -2,00 | 3,05 | 3,48 | 1,96 | ok |
| 164 Schmetterling Haarspangen Mädchen Doppel | 6pcs | 1,85 | ja | C (2,00/1,30) | 14,95 | 11,95 | -3,00 | 3,19 | 3,62 | 1,34 | ok |
| 164 Schmetterling Haarspangen Mädchen Doppel | 12pcs | 2,99 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,05 | 2,48 | 1,72 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | Pink / 5M | 6,19 | ja | C (2,00/1,30) | 19,95 | 17,95 | -2,00 | 2,66 | 3,09 | 1,57 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | 5M / Pink White | 6,59 | ja | C (2,00/1,30) | 19,95 | 18,95 | -1,00 | 2,26 | 2,69 | 1,93 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | Pink / 3M | 4,19 | ja | C (2,00/1,30) | 19,95 | 15,95 | -4,00 | 4,66 | 5,09 | 2,05 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | 5M / Purple | 6,69 | ja | C (2,00/1,30) | 19,95 | 18,95 | -1,00 | 2,16 | 2,59 | 1,83 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | 3M / Pink White | 4,89 | ja | C (2,00/1,30) | 19,95 | 15,95 | -4,00 | 3,96 | 4,39 | 1,35 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | 3M / Purple | 4,89 | ja | C (2,00/1,30) | 19,95 | 15,95 | -4,00 | 3,96 | 4,39 | 1,35 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | green / 5M | 6,09 | ja | C (2,00/1,30) | 19,95 | 17,95 | -2,00 | 2,76 | 3,19 | 1,67 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | 3M / green | 4,79 | ja | C (2,00/1,30) | 19,95 | 15,95 | -4,00 | 4,06 | 4,49 | 1,45 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | Blue / 5M | 6,09 | ja | C (2,00/1,30) | 19,95 | 17,95 | -2,00 | 2,76 | 3,19 | 1,67 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | 3M / Blue | 5,29 | ja | C (2,00/1,30) | 19,95 | 16,95 | -3,00 | 3,56 | 3,99 | 1,71 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | black / 5M | 6,09 | ja | C (2,00/1,30) | 19,95 | 17,95 | -2,00 | 2,76 | 3,19 | 1,67 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | black / 3M | 4,79 | ja | C (2,00/1,30) | 19,95 | 15,95 | -4,00 | 4,06 | 4,49 | 1,45 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | 5M / Pink White | 6,69 | ja | C (2,00/1,30) | 19,95 | 18,95 | -1,00 | 2,16 | 2,59 | 1,83 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | 3M / Pink White | 4,89 | ja | C (2,00/1,30) | 19,95 | 15,95 | -4,00 | 3,96 | 4,39 | 1,35 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | 5M / Purple | 6,69 | ja | C (2,00/1,30) | 19,95 | 18,95 | -1,00 | 2,16 | 2,59 | 1,83 | ok |
| 165 Hundeführleine Nylon 3m 5m für kleine &  | 3M / Purple | 4,89 | ja | C (2,00/1,30) | 19,95 | 15,95 | -4,00 | 3,96 | 4,39 | 1,35 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | GRAY / 3m | 8,29 | ja | C (2,00/1,30) | 32,95 | 20,95 | -12,00 | 10,47 | 10,90 | 1,76 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | black / 5m | 6,99 | ja | C (2,00/1,30) | 32,95 | 18,95 | -14,00 | 11,77 | 12,20 | 1,53 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 3m / black | 14,29 | ja | C (2,00/1,30) | 32,95 | 25,95 | -7,00 | 4,47 | 6,89 | 1,56 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 3m / Pink | 14,29 | ja | C (2,00/1,30) | 32,95 | 25,95 | -7,00 | 4,47 | 6,89 | 1,56 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 5m / Blue | 16,59 | ja | C (2,00/1,30) | 32,95 | 28,95 | -4,00 | 2,17 | 4,59 | 1,54 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 3m / Blue | 14,29 | ja | C (2,00/1,30) | 32,95 | 25,95 | -7,00 | 4,47 | 6,89 | 1,56 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | GRAY / 5m | 9,89 | ja | C (2,00/1,30) | 32,95 | 22,95 | -10,00 | 8,87 | 9,30 | 1,68 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 5m / Pink | 16,59 | ja | C (2,00/1,30) | 32,95 | 28,95 | -4,00 | 2,17 | 4,59 | 1,54 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 3m / Soft pink | 5,29 | ja | C (2,00/1,30) | 32,95 | 16,95 | -16,00 | 13,47 | 13,90 | 1,71 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 5m / Soft pink | 6,59 | ja | C (2,00/1,30) | 32,95 | 18,95 | -14,00 | 12,17 | 12,60 | 1,93 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 3m / Turquoise | 5,29 | ja | C (2,00/1,30) | 32,95 | 16,95 | -16,00 | 13,47 | 13,90 | 1,71 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 5m / Turquoise | 6,69 | ja | C (2,00/1,30) | 32,95 | 18,95 | -14,00 | 12,07 | 12,50 | 1,83 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 3m / Off-white | 5,29 | ja | C (2,00/1,30) | 32,95 | 16,95 | -16,00 | 13,47 | 13,90 | 1,71 | ok |
| 166 3m 5m Hundeleine Nylon stark für kleine  | 5m / Off-white | 6,69 | ja | C (2,00/1,30) | 32,95 | 18,95 | -14,00 | 12,07 | 12,50 | 1,83 | ok |
| 167 Wiederverwendbar Kinder 3D Zauberbuch Za | letter | 2,55 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,73 | 2,16 | 1,40 | ok |
| 167 Wiederverwendbar Kinder 3D Zauberbuch Za | digit | 2,69 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,35 | 2,78 | 2,02 | ok |
| 181 Quilt Aufbewahrungstasche Staubdicht Feu | Navy blue 55x35x25cm | 2,89 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,15 | 2,58 | 1,82 | ok |
| 181 Quilt Aufbewahrungstasche Staubdicht Feu | Beige 55x35x25cm | 2,79 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,25 | 2,68 | 1,92 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | XS / Green | 3,39 | ja | C (2,00/1,30) | 15,95 | 13,95 | -2,00 | 2,42 | 2,85 | 1,32 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | Black / M | 3,19 | ja | C (2,00/1,30) | 15,95 | 13,95 | -2,00 | 2,62 | 3,05 | 1,52 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | M / Green | 4,09 | ja | C (2,00/1,30) | 16,95 | 14,95 | -2,00 | 2,48 | 2,91 | 1,38 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | S / Green | 3,99 | ja | C (2,00/1,30) | 16,95 | 14,95 | -2,00 | 2,58 | 3,01 | 1,48 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | XS / Black | 3,19 | ja | C (2,00/1,30) | 15,95 | 13,95 | -2,00 | 2,62 | 3,05 | 1,52 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | XS / Blue | 3,15 | ja | C (2,00/1,30) | 15,95 | 13,95 | -2,00 | 2,66 | 3,09 | 1,56 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | S / Blue | 3,69 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 2,12 | 2,55 | 1,78 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | M / Blue | 3,85 | ja | C (2,00/1,30) | 16,95 | 14,95 | -2,00 | 2,72 | 3,15 | 1,62 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | Black / S | 3,09 | ja | C (2,00/1,30) | 15,95 | 13,95 | -2,00 | 2,72 | 3,15 | 1,62 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | L / Black | 3,75 | ja | C (2,00/1,30) | 16,95 | 14,95 | -2,00 | 2,82 | 3,25 | 1,72 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | L / Blue | 3,79 | ja | C (2,00/1,30) | 16,95 | 14,95 | -2,00 | 2,78 | 3,21 | 1,68 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | L / Green | 4,29 | ja | C (2,00/1,30) | 16,95 | 15,95 | -1,00 | 2,28 | 2,71 | 1,95 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | L / Green | 4,29 | ja | C (2,00/1,30) | 16,95 | 15,95 | -1,00 | 2,28 | 2,71 | 1,95 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | M / Green | 4,09 | ja | C (2,00/1,30) | 16,95 | 14,95 | -2,00 | 2,48 | 2,91 | 1,38 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | XS / Green | 3,39 | ja | C (2,00/1,30) | 16,95 | 13,95 | -3,00 | 3,18 | 3,61 | 1,32 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | XS / Black | 3,19 | ja | C (2,00/1,30) | 16,95 | 13,95 | -3,00 | 3,38 | 3,81 | 1,52 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | S / Green | 3,99 | ja | C (2,00/1,30) | 16,95 | 14,95 | -2,00 | 2,58 | 3,01 | 1,48 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | XS / Blue | 3,15 | ja | C (2,00/1,30) | 16,95 | 13,95 | -3,00 | 3,42 | 3,85 | 1,56 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | L / Green | 4,29 | ja | C (2,00/1,30) | 16,95 | 15,95 | -1,00 | 2,28 | 2,71 | 1,95 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | XS / Black | 3,19 | ja | C (2,00/1,30) | 16,95 | 13,95 | -3,00 | 3,38 | 3,81 | 1,52 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | S / Green | 3,99 | ja | C (2,00/1,30) | 16,95 | 14,95 | -2,00 | 2,58 | 3,01 | 1,48 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | M / Green | 4,09 | ja | C (2,00/1,30) | 16,95 | 14,95 | -2,00 | 2,48 | 2,91 | 1,38 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | XS / Green | 3,39 | ja | C (2,00/1,30) | 16,95 | 13,95 | -3,00 | 3,18 | 3,61 | 1,32 | ok |
| 189 Katzen Hund Pflege Hängematte Krallenpfl | XS / Blue | 3,15 | ja | C (2,00/1,30) | 16,95 | 13,95 | -3,00 | 3,42 | 3,85 | 1,56 | ok |
| 190 Freihand Leine Hund, Flexi Hüfttasche, R | – | 6,99 | ja | C (2,00/1,30) | 21,95 | 18,95 | -3,00 | 3,39 | 3,82 | 1,53 | ok |
| 195 Einweg Spritzbeutel 100 St. Backen Torte | L 100PCS | 5,99 | ja | C (2,00/1,30) | 17,95 | 17,95 | 0,00 | 1,34 | 1,77 | 1,77 | gelb (unter Ziel) |
| 195 Einweg Spritzbeutel 100 St. Backen Torte | L 50PCS | 3,59 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 2,22 | 2,65 | 1,88 | ok |
| 195 Einweg Spritzbeutel 100 St. Backen Torte | L 20PCS | 2,45 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,83 | 2,26 | 1,50 | ok |
| 195 Einweg Spritzbeutel 100 St. Backen Torte | M100PCS | 5,29 | ja | C (2,00/1,30) | 17,95 | 16,95 | -1,00 | 2,04 | 2,47 | 1,71 | ok |
| 195 Einweg Spritzbeutel 100 St. Backen Torte | M 50PCS | 3,25 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 1,79 | 2,22 | 1,46 | ok |
| 195 Einweg Spritzbeutel 100 St. Backen Torte | M 20PCS | 2,29 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,99 | 2,42 | 1,66 | ok |
| 195 Einweg Spritzbeutel 100 St. Backen Torte | S100PCS | 4,19 | ja | C (2,00/1,30) | 15,95 | 15,95 | 0,00 | 1,62 | 2,05 | 2,05 | ok |
| 195 Einweg Spritzbeutel 100 St. Backen Torte | S 50PCS | 2,69 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,35 | 2,78 | 2,02 | ok |
| 195 Einweg Spritzbeutel 100 St. Backen Torte | S 20PCS | 1,59 | ja | C (2,00/1,30) | 12,95 | 11,95 | -1,00 | 1,93 | 2,36 | 1,60 | ok |
| 196 Fusselrolle Tierhaare wiederverwendbar w | Green | 2,65 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,63 | 2,06 | 1,30 | ok |
| 196 Fusselrolle Tierhaare wiederverwendbar w | Navy | 2,49 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,79 | 2,22 | 1,46 | ok |
| 196 Fusselrolle Tierhaare wiederverwendbar w | Wood color | 2,85 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,19 | 2,62 | 1,86 | ok |
| 196 Fusselrolle Tierhaare wiederverwendbar w | Pink | 2,59 | ja | C (2,00/1,30) | 13,95 | 12,95 | -1,00 | 1,69 | 2,12 | 1,36 | ok |
| 197 100x Teefilter leer Teebeutel zum Befüll | 5x7cm-100pcs | 2,59 | ja | C (2,00/1,30) | 14,95 | 12,95 | -2,00 | 2,45 | 2,88 | 1,36 | ok |
| 197 100x Teefilter leer Teebeutel zum Befüll | 6x8cm-100pcs | 2,85 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,19 | 2,62 | 1,86 | ok |
| 199 Katzenspielzeug Federstab mit Glocke 50c | Purple | 2,85 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,19 | 2,62 | 1,86 | ok |
| 199 Katzenspielzeug Federstab mit Glocke 50c | Yellow | 2,79 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,25 | 2,68 | 1,92 | ok |
| 199 Katzenspielzeug Federstab mit Glocke 50c | Blue | 2,59 | ja | C (2,00/1,30) | 14,95 | 12,95 | -2,00 | 2,45 | 2,88 | 1,36 | ok |
| 199 Katzenspielzeug Federstab mit Glocke 50c | Green | 2,65 | ja | C (2,00/1,30) | 14,95 | 12,95 | -2,00 | 2,39 | 2,82 | 1,30 | ok |
| 199 Katzenspielzeug Federstab mit Glocke 50c | Red | 2,59 | ja | C (2,00/1,30) | 14,95 | 12,95 | -2,00 | 2,45 | 2,88 | 1,36 | ok |
| 207 2 Paar Ohrstecker Edelstahl Zirkonia hyp | E1357b-10 Silver | 6,39 | ja | C (2,00/1,30) | 17,95 | 17,95 | 0,00 | -0,80 | 1,37 | 1,37 | gelb (unter Ziel) |
| 207 2 Paar Ohrstecker Edelstahl Zirkonia hyp | E1357b-9 Silver | 6,09 | ja | C (2,00/1,30) | 17,95 | 17,95 | 0,00 | -0,50 | 1,67 | 1,67 | gelb (unter Ziel) |
| 207 2 Paar Ohrstecker Edelstahl Zirkonia hyp | E1357b-4 Silver | 6,09 | ja | C (2,00/1,30) | 17,95 | 17,95 | 0,00 | -0,50 | 1,67 | 1,67 | gelb (unter Ziel) |
| 207 2 Paar Ohrstecker Edelstahl Zirkonia hyp | E1357b-3 Silver | 6,09 | ja | C (2,00/1,30) | 17,95 | 17,95 | 0,00 | -0,50 | 1,67 | 1,67 | gelb (unter Ziel) |
| 207 2 Paar Ohrstecker Edelstahl Zirkonia hyp | E1357b-2 Silver | 6,09 | ja | C (2,00/1,30) | 17,95 | 17,95 | 0,00 | -0,50 | 1,67 | 1,67 | gelb (unter Ziel) |
| 207 2 Paar Ohrstecker Edelstahl Zirkonia hyp | E1357b-1 Silver | 4,49 | ja | C (2,00/1,30) | 16,95 | 15,95 | -1,00 | 0,34 | 2,51 | 1,75 | ok |
| 207 2 Paar Ohrstecker Edelstahl Zirkonia hyp | E1357b-8 Silver | 6,39 | ja | C (2,00/1,30) | 17,95 | 17,95 | 0,00 | -0,80 | 1,37 | 1,37 | gelb (unter Ziel) |
| 207 2 Paar Ohrstecker Edelstahl Zirkonia hyp | E1357b-7 Silver | 6,09 | ja | C (2,00/1,30) | 17,95 | 17,95 | 0,00 | -0,50 | 1,67 | 1,67 | gelb (unter Ziel) |
| 207 2 Paar Ohrstecker Edelstahl Zirkonia hyp | E1357b-6 Silver | 6,39 | ja | C (2,00/1,30) | 17,95 | 17,95 | 0,00 | -0,80 | 1,37 | 1,37 | gelb (unter Ziel) |
| 207 2 Paar Ohrstecker Edelstahl Zirkonia hyp | E1357b-5 Silver | 5,09 | ja | C (2,00/1,30) | 16,95 | 16,95 | 0,00 | -0,26 | 1,91 | 1,91 | gelb (unter Ziel) |
| 208 2in1 Zeckenzange Set Edelstahl Pinzette  | Black | 2,89 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,15 | 2,58 | 1,82 | ok |
| 208 2in1 Zeckenzange Set Edelstahl Pinzette  | Silver | 2,79 | ja | C (2,00/1,30) | 14,95 | 13,95 | -1,00 | 2,25 | 2,68 | 1,92 | ok |
| 212 Selbstreinigende Hunde Katzen Fellbürste | Gray | 3,65 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 2,16 | 2,59 | 1,82 | ok |
| 212 Selbstreinigende Hunde Katzen Fellbürste | Pink | 3,59 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 2,22 | 2,65 | 1,88 | ok |
| 212 Selbstreinigende Hunde Katzen Fellbürste | Blue | 3,25 | ja | C (2,00/1,30) | 15,95 | 13,95 | -2,00 | 2,56 | 2,99 | 1,46 | ok |
| 215 Küchensieb Edelstahl Nudelsieb Reissieb  | – | 8,89 | ja | C (2,00/1,30) | – | 21,95 | – | – | – | 1,92 | – |
| 216 Auto Handyhalterung Magnetisch Tragbar F | – | 4,29 | ja | C (2,00/1,30) | – | 15,95 | – | – | – | 1,95 | – |
| 217 7 Stufen Laptop Ständer faltbar ABS port | White | 3,49 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 2,32 | 2,75 | 1,98 | ok |
| 217 7 Stufen Laptop Ständer faltbar ABS port | Pink | 4,99 | ja | C (2,00/1,30) | 17,95 | 16,95 | -1,00 | 2,34 | 2,77 | 2,01 | ok |
| 217 7 Stufen Laptop Ständer faltbar ABS port | Black | 3,69 | ja | C (2,00/1,30) | 15,95 | 14,95 | -1,00 | 2,12 | 2,55 | 1,78 | ok |

Zeilen: 269 (Produkte/Varianten); davon mit heutigem VK: 267.
Anzeige beim heutigen VK: 4 rot (Gewinn unter Boden), 15 gelb (unter Ziel, über Boden), 248 ok.
Formelpreis über dem heutigen VK: 4 Zeilen; darunter: 245 Zeilen; gleich: 18.

## Bestandsprodukte mit Zielgewinn 4,50 € (NICHT automatisch umgestellt, bleiben bei Boden 2,00 €)
- keine

## Produkte mit einem Zielgewinn außerhalb der Stufen A–D und 4,50 (Boden 1,00 €)
- keine

## Nicht berechenbar
- keine
