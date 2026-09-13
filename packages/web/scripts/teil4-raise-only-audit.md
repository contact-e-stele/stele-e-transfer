# Preis-Fundament Teil 4/5 — Nur-Anheben-Audit (Pflichtbestandteil #6)

Erzeugt mit `bun --env-file=<repo>/.env scripts/export-raise-only-audit.ts` gegen die echte
Produktions-DB. Volle Tabelle: `output/raise-only-audit.csv`.

**eBay-Live-Preise nicht abrufbar in dieser Umgebung:** `eBay OAuth failed: 401
{"error":"invalid_client","error_description":"client authentication failed"}` — kein
eBay-Zugriff aus der Sandbox möglich (bekannte, bereits in `CLAUDE.md`/früheren PRs dokumentierte
Einschränkung). Das Skript ist genau für diesen Fall gebaut und fällt automatisch auf den
gespeicherten `product.sellPrice` zurück — alle Zeilen unten haben `Preisquelle=DB-sellPrice`.

## Zahlen (36 Produkte mit `ebayStatus='listed'`)

- **Varianten-Produkte (n/a, nie automatisch bepreist):** 30
- **Nicht-Varianten-Produkte berechnet:** 5 — davon **0 "anheben"**, **5 "nichts tun"**
- **Übersprungen** (kein Einkaufspreis/kein aktueller Preis): 1 (stele-155)

## Einordnung

Die 5 relevanten Nicht-Varianten-Produkte zeigen alle "nichts tun" — deckt sich mit der im Auftrag
beschriebenen Lage ("bei 32 von 34 Produkten liegt der Mindestpreis deutlich unter dem heutigen
Preis"). Die übrigen 30 Listings sind seit Teil 3 Varianten-Produkte und werden vom automatischen
Pfad (`price-monitor.ts checkOne()`) strukturell **nie** mit einem eBay-Preis-Push angefasst —
unabhängig von `AUTO_PRICE_WRITE_ENABLED` und unabhängig von dieser Änderung (siehe Root-Cause-
Abschnitt in der PR-Beschreibung).

**Bemerkenswert:** `stele-123`, das im Auftrag namentlich als Risikobeispiel genannte Produkt
("35,95 → 12,95 EUR"), ist mittlerweile selbst ein Varianten-Produkt — es war also bereits VOR
dieser Änderung strukturell vor einem automatischen Senken geschützt. Die Nur-Anheben-Regel in
diesem PR schützt zusätzlich die 5 verbliebenen Nicht-Varianten-Listings sowie alle künftigen
Nicht-Varianten-Neuimporte.

## Tabelle

| SKU | aktueller Preis | Mindestpreis | Aktion |
|---|---|---|---|
| stele-83 | 29,95 € | 22,95 € | nichts tun |
| stele-87 | 25,95 € | 17,95 € | nichts tun |
| stele-96 | 25,95 € | 18,95 € | nichts tun |
| stele-140 | 25,95 € | 18,95 € | nichts tun |
| stele-143 | 15,95 € | 13,95 € | nichts tun |

(Volle Tabelle inkl. der 30 Varianten-Zeilen und der Skip-Zeile: `output/raise-only-audit.csv`.)
