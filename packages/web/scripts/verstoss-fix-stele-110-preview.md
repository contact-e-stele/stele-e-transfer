# Verstoß-Reparatur Phase 2 — Testfall stele-110 (Vorher/Nachher)

Erzeugt mit `bun --env-file=<repo>/.env scripts/preview-description-fix.ts 110` gegen die echte
Produktions-DB (Turso). **Es wurde nichts an eBay gesendet** — das Skript liest nur, schreibt
ausschließlich die beiden lokalen Dateien `output/stele-110-vorher.html` und
`output/stele-110-nachher.html`.

Produkt 110 (stele-110): "Achsel Schweißpads Fußpads Deodorant Unsichtbar Tragbar Atmungsaktiv"
eBay-Artikel 198601084836 · Status `listed` · 0 Verkäufe in 90 Tagen (Phase-0/1-Befund).

| | Vorher (aktuell auf eBay) | Nachher (gepatchter Generator) |
|---|---|---|
| Länge | 15.955 Zeichen | 13.855 Zeichen |
| KUNDENSERVICE-Block | **JA** | nein |
| E-Mail-Treffer gesamt | 6 | 3 |
| — davon eigene Adresse (`contact@stele-e-transfer.com`) | 4 | 3 |
| — davon Dritt-Kontakte | **2** (`2699523@qq.com`, `info@apex-ce.com`) | 0 |
| Impressum-E-Mail vorhanden | JA | JA |
| Widerruf-Adresse vorhanden | JA | JA |

Die 2 Dritt-Kontakte im "Vorher" decken sich exakt mit dem Phase-1-Befund für stele-110
(`2699523@qq.com`, `info@apex-ce.com` — aus dem unbereinigten AliExpress-Lieferantentext).

**Pflichtangaben unverändert (c) — der wichtigste Punkt des Auftrags:** Impressum-E-Mail,
AGB-Anbieterzeile und Widerrufsadresse sind in "Nachher" wortgleich vorhanden wie in "Vorher"
(3 verbleibende `contact@stele-e-transfer.com`-Treffer = Impressum + AGB + Widerruf, kein
KUNDENSERVICE mehr). Das reduziert das eBay-Risiko, ohne die Widerrufsbelehrung zu beschädigen.

**Nächster Schritt (nicht Teil dieses Skripts):** manueller Vergleich der beiden HTML-Dateien
(im Browser öffnen oder eBay-Vorschau), danach separate Freigabe zum Hochladen.
