# P2 FINALE — letzter Trockenlauf vor dem Scharfschalten

Erzeugt mit `bun --env-file=<repo>/.env scripts/preview-tracking-sync-final.ts` gegen die
echte Produktions-DB. **dryRun:true — es wurde NICHTS geschrieben, keine Mail verändert.**

**Echter Gmail-Aufruf in dieser Sandbox fehlgeschlagen:** `Gmail-Aufruf in dieser Sandbox fehlgeschlagen (s. Konsolen-Ausgabe oben: "[Gmail] Token-Refresh fehlgeschlagen: 400 ... Could not determine client ID from request")`

Grund: fehlende `GOOGLE_GMAIL_CLIENT_ID`/`GOOGLE_GMAIL_CLIENT_SECRET` in `.env` dieser
Umgebung (bereits in PR #103/#104 dokumentiert). Tabelle unten zeigt deshalb nur die
reine DB-Zielliste (wer hat eine AliExpress-Nr. ohne Sendungsnummer), OHNE Mail-Abgleich.

| eBay-Bestellnr. | AliExpress-Bestellnr. | Sendungsnummer gefunden | Sendungsnummer |
|---|---|---|---|
| 26-15134-85187 | 3076295709557211 | nein | – |