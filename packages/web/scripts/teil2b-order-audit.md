# Preis-Fundament Teil 2B — Formel gegen reale Bestellungen (Pflichtbestandteil #5)

Neue Formel: `Gebühr = (0,15 × Preis + 0,30) × 1,19` (15 % + 0,30 € netto, × 1,19 MwSt-Faktor).

## Datenlage

Der Auftrag verweist auf 13 reale Bestellungen (90 Tage) als Audit-Basis. Im bisherigen Chat
liegen mir konkrete (Preis, real gebuchte Gebühr)-Werte für **6 von 13** dieser Bestellungen vor
(aus der Teil-1-Bestandsaufnahme). Für die übrigen 7 habe ich keine Zahlen — sie sind hier bewusst
**nicht** enthalten, statt erfunden zu werden.

## Ergebnis (6 von 13 Bestellungen)

| Preis (€) | Real gebuchte Gebühr (€) | Formel-Gebühr (€) | Abweichung (Cent) |
|-----------|--------------------------|--------------------|--------------------|
| 4,99 | 1,25 | 1,2477 | +0 |
| 8,95 | 1,91 | 1,9546 | +4 |
| 12,95 | 2,69 | 2,6686 | −2 |
| 14,49 | 2,96 | 2,9435 | −2 |
| 14,95 | 3,03 | 3,0256 | +0 |
| 15,44 | 3,11 | 3,1130 | +0 |

**Durchschnittliche absolute Abweichung: 1,33 Cent** — deutlich innerhalb der im Auftrag genannten
Restunsicherheit von ±0,05 € (5 Cent). Größte Einzelabweichung: 4 Cent (Bestellung 8,95 €).

## Fehlende 7 Bestellungen

Falls die restlichen 7 Bestellungen aus dem 90-Tage-Audit ergänzt werden sollen: `scripts/
export-pricing-comparison.ts` (dieselbe PR) kann als Vorlage für ein analoges Skript dienen, das
echte eBay-Transaktionsdaten (z. B. über die Finances API) gegen die Formel rechnet — dafür wird
allerdings Zugriff auf die echten Bestelldaten benötigt, der aus dieser Sandbox nicht besteht.

*Berechnet mit `bun` — nicht Teil der committeten Testsuite, da die Eingabedaten (reale Bestellungen)
keine Codefixtures sind, sondern vom Nutzer mitgeteilte externe Messwerte.*
