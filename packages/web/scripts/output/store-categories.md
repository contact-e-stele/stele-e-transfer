# P-82: Shop-Kategorien — Abruf fehlgeschlagen

Aufgabe 1 verlangt: "Falls der Endpunkt nicht erreichbar ist ... ausdrücklich sagen statt
einen Workaround zu bauen." Hiermit ausdrücklich gesagt:

```
eBay OAuth failed: 401 {"error":"invalid_client","error_description":"client authentication failed"}
```

Root Cause: `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`/`EBAY_REFRESH_TOKEN` sind in dieser Sandbox
nicht gesetzt (leer in `.env` — geprüft: nur `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` vorhanden).
Der Aufruf scheitert bereits bei `getAccessToken()`, bevor GetStore überhaupt erreicht wird —
derselbe dokumentierte Sandbox-Blocker wie das "401 invalid_client" in PR #97. Kein Workaround
gebaut. Dieses Skript ist bereit und läuft, sobald eBay-Zugangsdaten verfügbar sind (lokal mit
echten Credentials, oder als einmaliger Render-Shell-Task in der Produktionsumgebung).