# Vorschau: AliExpress-Sendungsstatus für Bestellung 3076306514497211

Erzeugt mit `bun --env-file=<repo>/.env scripts/preview-tracking-sync.ts 3076306514497211` gegen die echte AliExpress-API.
**Reiner Lesezugriff — es wurde NICHTS geschrieben, kein DB-Update, kein eBay-Call.**

- Zugehörige eBay-Bestellung (aus order_notes, falls vorhanden): 20-15127-76586
- Bisher gespeicherte Sendungsnummer in der DB: _(keine)_

## Ergebnis

| Feld | Wert |
|---|---|
| order_status | WAIT_BUYER_ACCEPT_GOODS |
| logistics_status | SELLER_SEND_GOODS |
| Sendungsnummer gefunden | JA |
| Sendungsnummer | AP00843143208329 |
| Logistik-Dienst (AliExpress-intern, kein eBay-Carrier-Code) | CAINIAO_FULFILLMENT_STD |

**Würde der Cron laufen, würde er `AP00843143208329` in `order_notes.tracking_number` für eBay-Bestellung 20-15127-76586 eintragen — NUR die Sendungsnummer, kein Carrier, kein eBay-Fulfillment-Call.**