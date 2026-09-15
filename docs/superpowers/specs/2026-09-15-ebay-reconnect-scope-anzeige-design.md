# eBay Neu Verbinden + Scope-Anzeige — Design

Datum: 2026-09-15
Branch: `feat/ebay-reconnect-scope-anzeige` (Basis: `origin/main`, enthält PR #107)

## Problem

PR #107 hat `getOAuthUrl()` um den Scope `sell.marketing` erweitert. In den
Einstellungen gibt es beim eBay-Zugang aber keinen Knopf, um die Neu-Autorisierung
auszulösen — nur eine statische Zeile "Verbunden (Refresh Token gesetzt)".

Zusätzlich verifiziert: der bestehende Callback (`GET /api/ebay/callback`)
tauscht den Code zwar erfolgreich gegen Tokens, **speichert den neuen Refresh
Token aber nirgends** — er landet nur im Server-Log. Der laufende Betrieb nutzt
ausschließlich `EBAY_REFRESH_TOKEN` aus der Env-Variable. Ohne Speicherung würde
eine Neu-Autorisierung wirkungslos verpuffen.

## Bestehendes Muster (AliExpress, wird 1:1 übernommen)

AliExpress löst genau dieses Problem bereits über die generische Key-Value-Tabelle
`app_settings`: `saveAliTokens()` schreibt per `onConflictDoUpdate`, `getAliAccessToken()`
liest DB zuerst, Env als Fallback. Keine neue Tabelle, keine Migration nötig.

## Backend-Änderungen (`packages/web/src/api/ebay.ts`)

- `getStoredEbayRefreshToken(): Promise<string | null>` — liest `app_settings`
  Key `ebay_refresh_token`; Fallback `process.env.EBAY_REFRESH_TOKEN`. DB hat Vorrang.
- `saveEbayRefreshToken(refreshToken: string, grantedScopes: string): Promise<void>` —
  schreibt `ebay_refresh_token`, `ebay_refresh_token_scope`, `ebay_refresh_token_updated_at`.
  Wird **nur nach erfolgreichem Code-Exchange** aufgerufen. Schlägt der Exchange fehl
  oder bricht der Nutzer ab, wird diese Funktion nie erreicht — der alte Token (DB
  oder Env) bleibt unverändert nutzbar. Kein Löschen vor erfolgreichem Schreiben.
- `getAccessToken()` und `getMarketingAccessToken()`: nutzen künftig
  `await getStoredEbayRefreshToken()` statt der fixen Modul-Konstante
  `EBAY_REFRESH_TOKEN`.
- `getRequestedScopeList(): string[]` — exportiert die in `getOAuthUrl()` verwendete
  Scope-Liste (Single Source of Truth), damit Callback und UI dieselbe Liste sehen.
- `hasScope(scopeString: string, scopeName: string): boolean` — reine, testbare
  Hilfsfunktion (z. B. `hasScope(scopes, 'sell.marketing')`).

### Warum kein `scope`-Feld aus der Token-Antwort

eBays Token-Exchange-Antwort enthält laut offizieller Doku nur `access_token`,
`refresh_token`, `expires_in`, `refresh_token_expires_in`, `token_type` — kein
`scope`-Feld. eBays Consent-Screen ist alles-oder-nichts: ohne vollständige
Zustimmung gibt es keinen Code. Deshalb gilt: kommt der Callback erfolgreich mit
einem Code zurück, wurde exakt die zu diesem Zeitpunkt angeforderte Scope-Liste
(`getRequestedScopeList()`) gewährt. Diese Liste wird beim erfolgreichen Callback
als "gewährter Scope" gespeichert — keine Vermutung, sondern Konsequenz des
Consent-Modells.

Für einen alten, rein env-basierten Token (gesetzt bevor diese Funktion existierte)
ist der Scope nicht bekannt — er wird nicht geraten, sondern explizit als fehlend
behandelt.

## Neue Route `GET /api/ebay/status`

Analog `/api/aliexpress/status`:

```json
{
  "connected": true,
  "hasRefreshToken": true,
  "scopes": ["sell.inventory", "sell.account", "sell.fulfillment", "sell.marketing"],
  "hasMarketingScope": true,
  "source": "db",
  "updatedAt": "2026-09-15T18:00:00.000Z"
}
```

Bei env-only-Token ohne bekannten Scope: `"scopes": null`, `"hasMarketingScope": false`,
`"source": "env"`.

## Callback-Änderung (`GET /api/ebay/callback`)

Nach erfolgreichem Exchange: `saveEbayRefreshToken(tokens.refresh_token, getRequestedScopeList().join(' '))`,
dann Bestätigungs-HTML-Seite zurückgeben (analog AliExpress-Callback) mit Link
zurück zu `/einstellungen`, statt der aktuellen rohen JSON-Antwort.

## Frontend (`packages/web/src/web/pages/einstellungen.tsx`)

eBay-Karte wird dynamisch wie die AliExpress-Karte:

- `fetch('/api/ebay/status')` beim Laden.
- Badge "Verbunden" / "Nicht verbunden".
- Scope-Chips pro angefordertem Scope (grün = vorhanden, rot = fehlt), inkl.
  explizitem `sell.marketing`-Badge.
- **Bei `scopes === null` (env-Token, Scope unbekannt):** keine neutrale
  "unbekannt"-Anzeige, sondern explizite Warnung:
  „⚠️ Marketing-Zugriff vermutlich nicht vorhanden — bitte neu verbinden."
  Der Nutzer soll sofort erkennen, dass er handeln muss, statt ein neutrales
  Feld falsch als "passt schon" zu lesen.
- Button **„Neu verbinden"** → `window.location.href = '/api/ebay/auth'`
  (identisch zum AliExpress-Muster).

## Grenzen (unverändert)

- Keine Änderung an `AUTO_PRICE_WRITE_ENABLED`, `ALIEXPRESS_TRACKING_SYNC_ENABLED`,
  Preislogik.
- Keine Kampagne wird angelegt, kein Angebot beworben, kein Gebot geändert.
- Keine DB-Migration (bestehende `app_settings`-Tabelle wird um neue Keys erweitert).
- Draft-PR, Nutzer merged selbst.

## Tests

- Unit-Test für `hasScope()` in `packages/web/src/api/ebay.test.ts`.
- typecheck (Frontend + Server) und volle Testsuite; Ergebnis im Klartext in
  die PR-Beschreibung.

## PR-Beschreibung (Pflichtinhalt)

Klare Schritt-für-Schritt-Anleitung, was nach dem Deploy zu klicken ist
(mobil-tauglich, kein Suchen nötig):
1. Einstellungen öffnen → eBay-Karte.
2. „Neu verbinden" klicken.
3. Auf der eBay-Freigabeseite: welche Berechtigungen dort sichtbar sein sollten.
4. Zurück in der App: welche Scope-Chips grün sein sollten (insbesondere
   `sell.marketing`).
