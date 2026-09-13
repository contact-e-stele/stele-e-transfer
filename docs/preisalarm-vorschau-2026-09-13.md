# Preisalarm-Vorschau 2026-09-13 (Aufgabe 3, nur Lesen)

Reiner Leselauf, KEIN Schreibzugriff auf die DB, KEIN eBay-Call, KEINE erneute AliExpress-Abfrage — vergleicht ausschließlich das bestehende `price_changed`-Flag (alte Bedingung) gegen `evaluatePriceAlarm()` (neue Bedingung, shared/pricing.ts), beide auf demselben, bereits in der DB gespeicherten Datenstand.

Datenstand: 2026-09-13T17:36:15.791Z (Live-Produktions-DB — der Hintergrund-Cron läuft parallel weiter, ein zweiter Lauf kann daher leicht andere Zahlen liefern).

| SKU | Titel | Typ | Altes Flag | Neues Flag | Änderung | VK | Gewinn (schlechteste Variante) |
|---|---|---|---|---|---|---|---|
| stele-65 | Profi Fernglas 500x25 Weitblick Jagd Wan | Varianten | Alarm | – | wird zurückgesetzt | 73,95 € | 2,00 € |
| stele-66 | 2-in-1 Hautanhänger Entferner, schmerzlo | Varianten | Alarm | – | wird zurückgesetzt | 39,95 € | 3,09 € |
| stele-67 | Silikon Induktionskochfeld Matte Rutschf | Varianten | Alarm | – | wird zurückgesetzt | 21,95 € | 3,50 € |
| stele-70 | Edelstahl Waschschüssel Abtropfsieb Küch | Varianten | Alarm | – | wird zurückgesetzt | 25,95 € | 3,83 € |
| stele-71 | Grillmatte antihaft, wiederverwendbar, h | Varianten | Alarm | – | wird zurückgesetzt | 27,95 € | 3,45 € |
| stele-75 | Heißluftfritteuse Silikon-Magnethalter f | Varianten | Alarm | – | wird zurückgesetzt | 19,95 € | 3,75 € |
| stele-77 | Grillmatten Schwarz Quadratisch Wiederve | Varianten | Alarm | – | wird zurückgesetzt | 21,95 € | 3,68 € |
| stele-78 | Wiederverwendbare Backmatten Antihaft fü | Varianten | Alarm | – | wird zurückgesetzt | 31,95 € | 3,30 € |
| stele-82 | Heißluftfritteuse Einsätze Papier, Fett- | Varianten | Alarm | – | wird zurückgesetzt | 21,95 € | 3,18 € |
| stele-89 | Schmuckschatulle mit Rose & Teddybär – S | Varianten | Alarm | – | wird zurückgesetzt | 17,95 € | 2,28 € |
| stele-92 | MAYJAM Ätherische Öle für Diffuser & Luf | Varianten | Alarm | – | wird zurückgesetzt | 33,95 € | 2,92 € |
| stele-95 | EUQEE Duftöl Set 6x10ml Kokos Ananas Bub | Varianten | Alarm | – | wird zurückgesetzt | 16,95 € | 3,77 € |
| stele-97 | PHATOIL 100ml Ätherisches Öl Set: Eukaly | Varianten | Alarm | – | wird zurückgesetzt | 20,95 € | 3,22 € |
| stele-100 | 15&18 Stk. Blasenpflaster Hydrokolloid G | Varianten | Alarm | – | wird zurückgesetzt | 16,95 € | 3,97 € |
| stele-107 | Fersenschutz Gel Polster Blasenpolster H | Varianten | Alarm | – | wird zurückgesetzt | 14,95 € | 3,34 € |
| stele-110 | Achsel Schweißpads Fußpads Deodorant Uns | Varianten | Alarm | – | wird zurückgesetzt | 19,95 € | 3,15 € |
| stele-119 | Einweg Frischhaltehauben, Lebensmittelab | Varianten | Alarm | – | wird zurückgesetzt | 14,95 € | 3,44 € |
| stele-120 | Frischhaltehauben für Lebensmittel, Bunt | Varianten | Alarm | – | wird zurückgesetzt | 43,95 € | 2,95 € |
| stele-121 | Automatische Bewässerung Tropfbewässerun | Varianten | Alarm | – | wird zurückgesetzt | 16,95 € | 3,22 € |
| stele-122 | Blumen Topf Selbstbewässerung Tropfer Pf | Varianten | Alarm | – | wird zurückgesetzt | 19,95 € | 3,35 € |
| stele-123 | Alufolie Frischhaltehaube Einweg elastis | Varianten | Alarm | – | wird zurückgesetzt | 35,95 € | 3,35 € |
| stele-127 | Lebensmittelhaube Frischhalteplatte Mehr | Varianten | Alarm | – | wird zurückgesetzt | 25,95 € | 3,14 € |
| stele-129 | Wäschebeutel Netzwaschbeutel Wiederverwe | Varianten | Alarm | – | wird zurückgesetzt | 20,95 € | 3,23 € |
| stele-131 | Neue Katzenklo Schaufel mit Griff, süß & | Varianten | Alarm | – | wird zurückgesetzt | 14,95 € | 3,55 € |
| stele-132 | Katzenstreuschaufel Set Groß & Klein für | Varianten | Alarm | – | wird zurückgesetzt | 21,95 € | 3,49 € |
| stele-135 | Platzsparende Vakuumbeutel für Kleidung  | Varianten | Alarm | – | wird zurückgesetzt | 15,95 € | 3,01 € |
| stele-136 | Vakuumbeutel mit Ventil platzsparend für | Varianten | Alarm | – | wird zurückgesetzt | 17,95 € | 3,23 € |
| stele-138 | Müllbeutel mit Henkel, Duft, Extra Stark | Varianten | Alarm | – | wird zurückgesetzt | 20,95 € | 3,43 € |
| stele-139 | PHATOIL 15 Aromatherapie ätherische Öle  | Varianten | Alarm | – | wird zurückgesetzt | 26,95 € | 3,19 € |
| stele-141 | Achselpads Schweißpads Sommer Unisex Ant | Varianten | Alarm | – | wird zurückgesetzt | 23,95 € | 3,71 € |
| stele-142 | Heißluftfritteuse Einweg Papier Backpapi | Varianten | Alarm | – | wird zurückgesetzt | 19,95 € | 4,06 € |
| stele-144 | Alkoholometer Hydrometer Set 0-100% Alko | Varianten | Alarm | – | wird zurückgesetzt | – € | – € |
| stele-145 | PHATOIL 15ml Ätherische Öle Set für Diff | Varianten | Alarm | – | wird zurückgesetzt | 23,95 € | 3,20 € |
| stele-147 | Alufolie Frischhaltefolie Lebensmittelab | Varianten | Alarm | – | wird zurückgesetzt | 30,95 € | 3,05 € |
| stele-148 | Große Katzentoilette Schaufel Haustierre | Varianten | Alarm | – | wird zurückgesetzt | 15,95 € | 3,72 € |
| stele-149 | Malbuch Erwachsene 32 Seiten Blumen Mand | Varianten | Alarm | – | wird zurückgesetzt | 17,95 € | 3,74 € |
| stele-150 | 8 Rollen biologisch abbaubare Hundekotbe | Varianten | Alarm | – | wird zurückgesetzt | 17,95 € | 3,64 € |
| stele-151 | 150x Müllbeutel Hundekotbeutel, Dick, Be | Varianten | Alarm | – | wird zurückgesetzt | 16,95 € | 3,42 € |
| stele-152 | Kühlschrank Kräuterfrische Behälter Gemü | Varianten | Alarm | – | wird zurückgesetzt | 29,95 € | 3,68 € |
| stele-154 | Wiederverwendbare Kinder 3D-Schreiblernh | Varianten | Alarm | – | wird zurückgesetzt | – € | – € |
| stele-155 | Kinder Zeichenbuch Malbuch Kindergarten  | Varianten | Alarm | – | wird zurückgesetzt | – € | – € |
| stele-137 | XXL Vakuumbeutel ohne Pumpe, platzsparen | Varianten | – | Alarm | neu Alarm | 10,95 € | -3,59 € |
| stele-49 | Alu-Schalen 30er Pack für Takeaway, Cate | Einzelartikel | – | – | bleibt kein Alarm | 30,95 € | 7,49 € |
| stele-62 | Aluminium Schalen Einweg Schwerlast Rech | Einzelartikel | – | – | bleibt kein Alarm | 30,95 € | 7,49 € |
| stele-64 | Edelstahl Spritzschutz für Heißluftfritt | Einzelartikel | – | – | bleibt kein Alarm | 22,95 € | 3,61 € |
| stele-83 | Backpapier Rechteckig 300 Blatt Antihaft | Einzelartikel | – | – | bleibt kein Alarm | 29,95 € | 7,67 € |
| stele-85 | Heißluftfritteuse Backpapier, Nicht-kleb | Einzelartikel | – | – | bleibt kein Alarm | 21,95 € | 7,33 € |
| stele-87 | 10 x Staubsaugerbeutel für Dreame L10s U | Einzelartikel | – | – | bleibt kein Alarm | 25,95 € | 7,81 € |
| stele-94 | Frischhaltebehälter Edelstahl Frischbox  | Einzelartikel | – | – | bleibt kein Alarm | 21,95 € | 3,92 € |
| stele-96 | Heißluftfritteuse Backpapier Clips Antih | Einzelartikel | – | – | bleibt kein Alarm | 25,95 € | 7,29 € |
| stele-140 | Ninja Airfryer Zubehör Backblech für AF4 | Einzelartikel | – | – | bleibt kein Alarm | 25,95 € | 7,66 € |
| stele-143 | Heißluftfritteuse Einsätze aus Papier, F | Einzelartikel | – | – | bleibt kein Alarm | 15,95 € | 3,66 € |
| stele-153 | Vorschul-Mathe Arbeitsheft: Zahlen schre | Einzelartikel | – | – | bleibt kein Alarm | 15,95 € | 2,32 € |

## Zusammenfassung
- Produkte gesamt: 53
- Altes Flag (price_changed=true, IST-Zustand): 41
- Neues Flag nach korrigierter Bedingung (Preis unter Mindestpreis): 1
  - davon bleiben Alarm (waren schon korrekt): 0
  - davon sind NEU Alarm (waren vorher fälschlich nicht markiert): 1
- Flags, die auf false zurückgesetzt werden müssten (waren Alarm, sind es nach neuer Bedingung nicht mehr): 41

**Hinweis:** Diese Zahlen sind eine Vorschau auf Basis der zuletzt in der DB gespeicherten Preise — sie werden erst korrekt, sobald der reguläre Preis-Cron (price-monitor.ts, jetzt mit der korrigierten Bedingung) einmal durchgelaufen ist ODER das vorbereitete Reset-Skript (scripts/preisalarm-reset-flags.ts, NICHT ausgeführt) freigegeben und gestartet wird.
