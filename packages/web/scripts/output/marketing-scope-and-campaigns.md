# P-81 Stufe 1: Marketing-Scope-Status + vorhandene Kampagnen

## Aufgabe 1 — Scope geprüft (Code-Inspektion, nicht Vermutung)

`getOAuthUrl()` UND `getAccessToken()` (vor dieser Änderung, `ebay.ts`) fordern beim
Autorisieren/Refresh exakt drei Scopes an: `sell.inventory`, `sell.account`,
`sell.fulfillment`. `sell.marketing` war NIE Teil der Anfrage — der aktuelle Token hat
diesen Scope NICHT. Ein OAuth-Refresh-Token trägt nur die beim ursprünglichen Consent
gewährten Scopes. **Der Nutzer muss die App einmal neu autorisieren** (`GET /api/ebay/auth`
erneut durchlaufen) — kein Workaround gebaut.

`getOAuthUrl()` fordert ab diesem PR zusätzlich `sell.marketing` an (breiter als nur
`.readonly`, damit eine einzige Neu-Autorisierung für Stufe 1 UND eine spätere
Schreib-Stufe reicht) — wirkt erst NACH einer Neu-Autorisierung.

## Aufgabe 2 — Kampagnen: NICHT abrufbar

Echter Fehlversuch (Grundgesetz Regel 1 — wörtlicher Grund statt "geht nicht"):

```
eBay Marketing-OAuth failed: 401 {"error":"invalid_client","error_description":"client authentication failed"}
```

Root Cause, doppelt bestätigt:
1. `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`/`EBAY_REFRESH_TOKEN` sind in dieser Sandbox
   nicht gesetzt (leer in `.env`) — derselbe Blocker wie bei jedem anderen eBay-Call
   in dieser Umgebung (s. PR #97, #106).
2. Selbst mit gültigen Zugangsdaten würde dieser Aufruf fehlschlagen, weil der
   bestehende Refresh-Token den `sell.marketing`-Scope nicht hat (s. Aufgabe 1) —
   der Nutzer muss zuerst neu autorisieren.

**Kampagnenliste NICHT abrufbar. Keine erfundenen Kampagnen — die Lücke bleibt offen.**
`scripts/check-marketing-campaigns.ts` steht bereit für einen echten Lauf, sobald der
Nutzer neu autorisiert hat.