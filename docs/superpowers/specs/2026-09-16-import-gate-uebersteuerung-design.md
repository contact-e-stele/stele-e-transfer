# Design: Import-Gate manuelle Übersteuerung (P-66 Schritt 3)

## Ausgangslage

Das Compliance-Gate (P-66 Schritt 2) blockiert das Speichern eines importierten
Produkts, wenn Titel oder Beschreibung ein Stichwort einer regulierten
Kategorie enthalten UND der erkannte Lieferant nicht als "geprüft" markiert
ist. Live nachgestellt mit
https://de.aliexpress.com/item/1005009603522097.html (Katzen-Futterlabyrinth):
Titel enthält "Toy", der Verkäufername wird vom Scraper nicht erkannt → der
Nutzer kann den Lieferanten nicht im Lieferanten-Tab freigeben (er hat keinen
Namen, den er suchen könnte) und sitzt fest. Das Gate ist ausschließlich
clientseitig in `lieferanten.tsx`:

- Erkennung: `matchRegulatedCategories()` in
  `packages/web/src/shared/regulated-categories.ts` — verklebt Titel +
  Beschreibung zu einem String, Substring-Match gegen Stichwortlisten pro
  Kategorie. Kein Feld-/Stichwort-Detail im Rückgabewert.
- Gate-Berechnung: `lieferanten.tsx:423-429` (`regulatedMatches`,
  `matchedSupplier`, `supplierVerified`, `complianceBlocked`).
- Harte Sperre: `handleSave` bricht bei `complianceBlocked` sofort ab
  (`lieferanten.tsx:578-580`).
- UI: Warnbox + Button "Blockiert — Lieferant nicht geprüft"
  (`lieferanten.tsx:1931-1967`).
- Speichern läuft über `POST /api/products` (`packages/web/src/api/index.ts:1370`),
  das aktuell keinerlei Compliance-Feld kennt.
- `products`-Tabelle hat keine Compliance-Spalten; `trusted_suppliers.compliance_status`
  ist die einzige Quelle für "geprüft".
- Migrationen: eine einzige append-only Liste in `packages/web/src/db/migrate.ts`
  (`ALTER TABLE ... ADD COLUMN`, idempotent, kein Migrations-Verzeichnis).
- Nur `lieferanten.tsx` nutzt das Gate; `produkte.tsx` und `autods.tsx` rufen
  zwar denselben Scrape-Endpunkt auf, kennen das Gate aber nicht.

## Ziel

Der Nutzer kann eine fälschliche Blockierung *für diesen einen Import*
bewusst und nachvollziehbar übersteuern, ohne dass die automatische
Erkennung selbst verändert oder abgeschwächt wird. Die Entscheidung ist
später — DB und Server-Log — nachweisbar (eBay-Rückfrage, Behörde).

## Bausteine

### 1. Erkennung präzisieren (`regulated-categories.ts`)

Neue Funktion `matchRegulatedCategoriesDetailed(fields: { title: string; description: string })`,
die Titel und Beschreibung **getrennt** prüft und pro Treffer
`{ category, keyword, field: 'title' | 'description' }` liefert (erster
Treffer pro Kategorie, Titel wird vor Beschreibung geprüft). Die bestehende
`matchRegulatedCategories(text)` bleibt als dünner Wrapper erhalten (bisheriges
Verhalten unverändert), damit keine bestehende Logik geschwächt wird.

### 2. Blockier-Meldung im Klartext

Die Warnbox zeigt je Treffer konkret: Stichwort + Feld + Kategorie, z.B.
`"Toy" im Titel gefunden → erkannt als Spielzeug`. Zusätzlich weiterhin den
Lieferanten-Status wie bisher.

### 3. Übersteuerungs-Button + Bestätigungsdialog (`lieferanten.tsx`)

Unter der Warnbox: Button "Manuell übersteuern und speichern" (nur sichtbar
bei `complianceBlocked`). Öffnet ein Overlay-Dialog (gleiches visuelle Muster
wie `GpsrModal` in `produkte.tsx`: fixed backdrop, weiße Box, Rahmen, Schatten)
mit:

- Klartext-Grund (Stichwort/Feld/Kategorie wie oben).
- **Erkannter Verkäufername laut Scrape** (`product.seller`), explizit auch
  wenn leer → dann sichtbar "(kein Name erkannt)". Macht dem Nutzer klar,
  warum der reguläre Weg (Lieferant im Tab freigeben) nicht ging.
- Pflicht-Dropdown "Warum ist die Einstufung falsch?" mit genau den 4
  Optionen aus dem Auftrag (Slugs für DB: `heimtierbedarf`,
  `lieferant_bekannt`, `kategorie_trifft_nicht_zu`, `sonstiges`).
- Freitext-Pflichtfeld, wenn `sonstiges` gewählt.
- Button "Verstanden, trotzdem speichern" — disabled bis Dropdown (und ggf.
  Freitext) ausgefüllt ist.

Bestätigen setzt lokalen Override-State und ruft den bestehenden
Speichern-Flow auf, diesmal mit Override-Daten im Payload. Die
`if (complianceBlocked) return`-Sperre in `handleSave` bleibt für den
Normalfall unverändert — sie wird nur umgangen, wenn explizit ein
Override-Objekt übergeben wird (kein globaler Bypass-Schalter).

### 4. DB — additive Migration

Neue Spalten auf `products` (Anhang an `migrate.ts`, Default NULL/0, wie
bisheriges Muster):

```
compliance_override            INTEGER DEFAULT 0
compliance_override_at         TEXT
compliance_override_reason     TEXT   -- Slug der 4 Optionen
compliance_override_reason_text TEXT  -- Freitext bei "sonstiges"
compliance_override_category   TEXT   -- z.B. "spielzeug"
compliance_override_keyword    TEXT   -- z.B. "Toy"
compliance_override_field      TEXT   -- "title" | "description"
```

Entsprechende Felder in `db/schema.ts` (`products`-Tabelle) ergänzen.
`POST /api/products` (`api/index.ts:1370`) nimmt diese Felder optional
entgegen und schreibt sie nur, wenn im Payload vorhanden — bestehendes
Verhalten ohne Override-Daten ändert sich nicht.

### 5. Server-Log bei Übersteuerung

Wenn `POST /api/products` mit gesetztem `complianceOverride: true` aufgerufen
wird, eine Log-Zeile schreiben (analog zu bestehenden `[Import]`-Logs in
derselben Route), mit: SKU (`aliexpressItemId`, aus der Import-URL
extrahiert — `body.asin` ist nur eine synthetische ID `ali_<timestamp>` und
ungeeignet als SKU), erkannte Kategorie, ausgelöstes Stichwort, Feld,
gewählte Begründung. Beispiel:
`[Compliance-Override] SKU=1005009603522097 Kategorie=spielzeug Stichwort="Toy" Feld=title Grund=heimtierbedarf`.
Nur DB-Nachweis reicht laut Auftrag nicht — auch im Render-Log muss es
auffindbar sein.

### 6. Sichtbarkeit im Produkte-Tab (`produkte.tsx`)

`Product`-Interface um die neuen Felder erweitern. Neues Badge im
Badge-Bereich (gleiches Muster wie GPSR-Badge, Zeile ~1299-1311): sichtbar
wenn `complianceOverride`, Label "manuell freigegeben", natives
`title`-Attribut als Tooltip mit Begründung (+ Freitext falls "sonstiges"),
Stichwort/Feld/Kategorie und Zeitstempel.

## Ausdrücklich unverändert (Grenzen aus dem Auftrag)

- Die automatische Erkennung selbst (Stichwortlisten, Matching-Logik) wird
  nicht abgeschaltet oder abgeschwächt — sie warnt weiterhin bei jedem
  neuen Import, der Override gilt nur für den einen gespeicherten Datensatz.
- `AUTO_PRICE_WRITE_ENABLED`, `ALIEXPRESS_TRACKING_SYNC_ENABLED`, Preislogik:
  nicht angefasst.
- Keine neue serverseitige Hart-Sperre wird eingeführt (das Gate war und
  bleibt clientseitig) — Aufgabe verlangt nur die manuelle
  Übersteuerungsmöglichkeit, keine Verschärfung der Durchsetzung.
- Migration bleibt rein additiv (nur neue Spalten mit Default), passend zum
  bestehenden `migrate.ts`-Muster.

## Tests

- Neue Unit-Tests für `matchRegulatedCategoriesDetailed` (u.a. der
  Katzen-Futterlabyrinth-Fall: "Toy" im Titel → Kategorie "Spielzeug",
  Feld "title").
- Bestehende Testsuite bleibt grün (typecheck + `bun test`).

## Verifikation (für PR-Beschreibung)

Nachstellung mit dem Katzen-Futterlabyrinth
(https://de.aliexpress.com/item/1005009603522097.html): Import starten →
Blockier-Meldung mit "Toy" im Titel → Dialog öffnen → Verkäufername
"(kein Name erkannt)" sichtbar → Begründung "Heimtierbedarf (kein
Kinderspielzeug)" wählen → "Verstanden, trotzdem speichern" → Produkt wird
gespeichert → Produkte-Tab zeigt Badge "manuell freigegeben" mit Begründung
im Tooltip → Render-Log zeigt die Override-Zeile.

## Branch

Neuer Branch von `main`: `feat/p66-import-gate-uebersteuerung` (isoliertes
Git-Worktree unter `.worktrees/feat-import-gate-uebersteuerung`, da im
Hauptarbeitsverzeichnis unzusammenhängende uncommitted Änderungen liegen, die
laut Nutzer nicht angefasst werden sollen). Draft-PR, kein Merge durch mich.
