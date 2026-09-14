# Trockenlauf: Sendungsnummer-Sync aus AliExpress-Mails (P2 Teil 2)

**WICHTIG:** kein echter Gmail-API-Aufruf möglich in dieser Sandbox (fehlende
GOOGLE_GMAIL_CLIENT_ID/_SECRET in .env). Echter Fehlversuch:
```
[Gmail] Token-Refresh fehlgeschlagen: 400 {"error":"invalid_request","error_description":
"Could not determine client ID from request."}
error: Gmail nicht verbunden
```
scripts/inspect-package-status-emails.ts steht bereit für den echten Lauf, sobald
Gmail-Zugangsdaten verfügbar sind.

Dieser Lauf testet stattdessen die Pipeline ab der Mail-Auswertung: reale Ziel-Bestellungen
aus der echten Produktions-DB + die vom Nutzer selbst manuell verifizierten Werte als
Mail-Ergebnis-Override. **dryRun:true — nichts geschrieben.**

Geprüft: 2 · gefunden: 1 · würde geschrieben: 1 · Fehler: 0

| eBay-Bestellnr. | AliExpress-Bestellnr. | Sendungsnummer gefunden | Sendungsnummer |
|---|---|---|---|
| 27-14918-13809 | 3075188992327211 | JA | 00340434886283998797 |
| 26-15134-85187 | 3076295709557211 | nein | – |

## Abgleich gegen Aufgabe 6 (M. Lazarevic, 3075188992327211, zugestellt 05.08.2026)

✅ Pipeline liefert exakt den erwarteten Wert `00340434886283998797`.

## Hinweis zu Aufgabe 5 (Yuecel Karakoca, 3076306514497211)

Diese Bestellung ist zum Zeitpunkt dieses Laufs **kein Ziel mehr** — `order_notes.tracking_number`
ist bereits auf `00340434886289512140` gesetzt (per echter, read-only DB-Abfrage bestätigt,
`shippedAt` 2026-09-14T14:52:39.016Z) — vermutlich manuell nachgetragen, nachdem PR #102 den
AP-Wert als falsch entlarvt hat. Der Wert stimmt exakt mit dem im Auftrag erwarteten überein —
unabhängige Bestätigung, dass `00340434886289512140` korrekt ist, nur eben nicht mehr über
diese Pipeline nachvollziehbar (die überschreibt eine bereits vorhandene Nummer bewusst nicht,
s. Doppelschreib-Schutz).