# P14 (Plan) — Google Drive Integration

## Ziel
1. Zusätzlicher Backup-Speicherort neben/statt E-Mail (aktuell: Resend E-Mail 3x täglich)
2. Bilder/Rechnungen auf Drive ablegen statt auf unserem Render-Server (dist/uploads, dist/invoices)

## Warum überhaupt sinnvoll?
- E-Mail-Backup ist gut, aber Postfach kann volllaufen / Anhang-Größenlimits bei Resend
- Server-Speicher (dist/uploads) auf Render ist begrenzt und geht bei jedem Neu-Deploy verloren (Ephemeral Storage!) — das ist der eigentlich wichtige Punkt: Bilder/Rechnungen, die lokal auf dem Server liegen, überleben KEINEN Neu-Deploy. Drive würde das dauerhaft lösen.

## Voraussetzungen (muss der User einmalig einrichten)
1. Google Cloud Projekt anlegen (console.cloud.google.com, kostenlos)
2. Google Drive API aktivieren
3. OAuth-Zugangsdaten erstellen (Client-ID + Client-Secret)
4. Einmalige Autorisierung (ähnlich wie bei eBay/AliExpress OAuth-Flow, den wir schon haben) — Refresh-Token wird in Render Umgebungsvariablen hinterlegt

## Technischer Plan
### Backend
- Neues Modul `api/drive.ts` — analog zu `api/ebay.ts` / `api/aliexpress-api.ts`:
  - `getAccessToken()` via Refresh-Token
  - `uploadFile(buffer, filename, mimeType, folderId)` — lädt Datei in einen bestimmten Drive-Ordner hoch
  - `getOrCreateFolder(name)` — z.B. "Stele-Backups", "Stele-Rechnungen", "Stele-Bilder"
- Backup-Job (`backup.ts`) erweitern: nach dem Erstellen der Backup-Datei zusätzlich zu Drive hochladen (E-Mail bleibt bestehen als zweite Absicherung, nicht ersetzt außer User will das anders)
- Bild-Upload-Endpoint (`/api/upload-image`, `/api/upload-file`) erweitern: statt lokal in `dist/uploads` zu speichern, zu Drive hochladen und Drive-Link zurückgeben
- Rechnungs-Generator (`invoice.ts`): PDF zusätzlich zu Drive hochladen statt nur `dist/invoices`

### Migration/Umstellung bestehender Daten
- Bereits hochgeladene Bilder/Rechnungen (aktuell lokal auf Render) müssten nicht zwingend nachträglich migriert werden — ODER einmaliger Migrations-Job, der bestehende Dateien aus `dist/uploads`+`dist/invoices` zu Drive hochlädt (nice-to-have, kein Muss)

### Frontend
- Kaum Änderungen nötig — URLs zu Bildern/Rechnungen zeigen dann auf Drive-Links statt eigene Server-URLs
- Ggf. Einstellungen-Tab: Status-Anzeige "Google Drive verbunden ✓" + letzte Sicherung

## Reihenfolge (wenn wir loslegen)
1. User richtet Google Cloud Projekt + OAuth Credentials ein (mit meiner Anleitung Schritt für Schritt)
2. Ich baue OAuth-Flow + drive.ts Grundfunktionen
3. Backup zusätzlich zu Drive hochladen (einfachster Teil, macht sofort Sinn)
4. Bild-Upload auf Drive umstellen
5. Rechnungs-PDF auf Drive umstellen
6. Optional: alte lokale Dateien nachträglich migrieren

## Offene Fragen für später (wenn User bereit zum Einrichten ist)
- Soll E-Mail-Backup komplett ersetzt werden oder als Doppel-Absicherung neben Drive bleiben?
- Eigener Drive-Ordner-Name/Struktur Wunsch?
- Soll das Google-Konto ein separates "Stele-Backup" Konto sein oder das private/geschäftliche Hauptkonto des Users?
