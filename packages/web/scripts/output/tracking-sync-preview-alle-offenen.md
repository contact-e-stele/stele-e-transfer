# Trockenlauf: Sendungsnummer-Sync über alle offenen Bestellungen

Erzeugt mit `bun --env-file=<repo>/.env scripts/preview-tracking-sync-all.ts` gegen die
echte Produktions-DB und die echte AliExpress-API (`aliexpress.trade.ds.order.get`).
**Reiner Lesezugriff — dryRun:true, es wurde NICHTS geschrieben, kein DB-Update, kein eBay-Call.**

Geprüft: 2 · Sendungsnummer gefunden: 1 · würde geschrieben: 1 (0 tatsächlich, da dry-run) · Fehler: 0

| eBay-Bestellnr. | AliExpress-Bestellnr. | order_status | Sendungsnummer gefunden | Sendungsnummer | würde schreiben |
|---|---|---|---|---|---|
| 27-14918-13809 | 3075188992327211 | FINISH | JA | AP00832504143414 | JA |
| 26-15134-85187 | 3076295709557211 | WAIT_SELLER_SEND_GOODS | nein | – | nein |
