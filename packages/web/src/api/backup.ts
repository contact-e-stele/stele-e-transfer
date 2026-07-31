// Automatischer DB-Backup per Email — 2x täglich (15:00, 23:35) (P-23: Ressourcenverbrauch reduziert)
// Sendet: CSV + vollständiges DB-JSON + Code-ZIP + AGENT-RESTORE.md

import { db } from '../db/index';
import * as schema from '../db/schema';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const BACKUP_TO = 'contact@stele-e-transfer.com';

// ─── CSV Generator ────────────────────────────────────────────────────────────

function productsToCSV(products: typeof schema.products.$inferSelect[]): string {
  const headers = [
    'ID', 'Titel', 'ASIN', 'Quelle URL', 'EK Preis', 'VK Preis',
    'eBay Status', 'eBay Listing ID', 'Preisalarm', 'Erstellt', 'Aktualisiert',
  ];

  const rows = products.map(p => [
    p.id,
    `"${(p.generatedTitle ?? p.title ?? '').replace(/"/g, '""')}"`,
    p.asin ?? '',
    `"${(p.sourceUrl ?? p.amazonUrl ?? '').replace(/"/g, '""')}"`,
    p.buyPrice?.toFixed(2) ?? '',
    p.sellPrice?.toFixed(2) ?? '',
    p.ebayStatus ?? 'none',
    p.ebayListingId ?? '',
    p.priceChanged ? 'Ja' : 'Nein',
    p.createdAt ?? '',
    p.updatedAt ?? '',
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ─── Vollständiger DB-JSON Export ─────────────────────────────────────────────

// Aktuell ungenutzt (runBackup() baut das JSON inline) — als export erhalten, keine funktionierende
// Nutzung entfernt, nur für den Backend-Typecheck (P-25) als absichtlich öffentlich markiert.
export async function exportDatabaseJSON(): Promise<string> {
  const [products, priceHistory] = await Promise.all([
    db.select().from(schema.products),
    db.select().from(schema.priceHistory),
  ]);

  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    version: '2.0',
    tables: {
      products: { count: products.length, rows: products },
      price_history: { count: priceHistory.length, rows: priceHistory },
    },
  }, null, 2);
}

// ─── Code ZIP Generator ───────────────────────────────────────────────────────
// Packt den kompletten src/ Ordner + wichtige Root-Dateien als ZIP

async function generateCodeZip(): Promise<Buffer> {
  // Wir nutzen node:zlib + tar-Format nicht — stattdessen bauen wir ein
  // einfaches ZIP-ähnliches Archiv aus concatenierten Dateien mit Trennzeichen.
  // Echter ZIP via archiver wäre besser, aber archiver ist kein Dependency.
  // Wir verwenden den nativen Ansatz: alle Dateien sammeln, als JSON-Bundle.

  const rootDir = path.resolve(__dirname, '../../../../');
  const srcDir = path.join(rootDir, 'packages/web/src');
  const schemaDir = path.join(rootDir, 'packages/web/drizzle');

  const bundle: Record<string, string> = {};

  // Alle .ts/.tsx Dateien aus src/ sammeln
  function collectFiles(dir: string, relBase: string): void {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relBase, entry.name);
      if (entry.isDirectory()) {
        // node_modules, .git überspringen
        if (['node_modules', '.git', 'dist', '.turbo'].includes(entry.name)) continue;
        collectFiles(fullPath, relPath);
      } else if (/\.(ts|tsx|json|sql|md|html|css|env\.example)$/.test(entry.name)) {
        try {
          bundle[relPath] = fs.readFileSync(fullPath, 'utf-8');
        } catch { /* skip unreadable */ }
      }
    }
  }

  collectFiles(srcDir, 'src');

  // Wichtige Root-Dateien
  const rootFiles = [
    'package.json',
    'packages/web/package.json',
    'packages/web/tsconfig.json',
    'packages/web/drizzle.config.ts',
    'packages/web/vite.config.ts',
  ];
  for (const rel of rootFiles) {
    const full = path.join(rootDir, rel);
    if (fs.existsSync(full)) {
      try { bundle[rel] = fs.readFileSync(full, 'utf-8'); } catch { /* skip */ }
    }
  }

  // Drizzle-Migrations falls vorhanden
  if (fs.existsSync(schemaDir)) collectFiles(schemaDir, 'drizzle');

  const json = JSON.stringify(bundle, null, 2);

  // GZIP komprimieren um Größe zu reduzieren
  const gzip = promisify(zlib.gzip);
  return gzip(Buffer.from(json, 'utf-8'));
}

// ─── AGENT-RESTORE.md Generator ───────────────────────────────────────────────
// KI-lesbare Komplettanleitung — damit die KI OHNE Erklärung alles wiederherstellt

function generateAgentRestoreMd(productCount: number, priceHistoryCount: number, isoDate: string): string {
  return `# STELE-E-TRANSFER — AGENT RESTORE GUIDE
> Diese Datei ist für die KI (Runable / Claude). Zeige sie der KI und sage nur "Restore".
> Die KI liest diese Datei und stellt alles ohne weitere Erklärung wieder her.

Backup-Datum: ${isoDate}
Produkte: ${productCount} | Preis-Einträge: ${priceHistoryCount}

---

## ÜBERBLICK

**App-Name:** STELE-E-TRANSFER  
**Betreiber:** Evgenij Stele, stele-e-transfer (eBay DE), Kleingewerbe §19 UStG, Wiesbaden  
**Zweck:** Dropshipping-App — AliExpress → eigene DB → eBay DE  
**Repo:** https://github.com/contact-e-stele/stele-e-transfer  
**Live-URL:** https://stele-e-transfer.onrender.com  

---

## TECH-STACK

\`\`\`
Monorepo: Bun Workspaces
Backend:  Hono (TypeScript) auf Bun
Frontend: React + Vite + TailwindCSS (SPA)
DB:       Turso (libSQL / SQLite-kompatibel) via Drizzle ORM
Deploy:   Render.com (Web Service, automatisch bei git push)
Email:    Resend API
Scraping: ScrapingAnt API (AliExpress Produkt-Daten)
AI:       Google Gemini API (Titel/Beschreibung generieren)
eBay API: Trading API + Inventory API (OAuth User Token)
\`\`\`

---

## ARCHITEKTUR

\`\`\`
stele-app/
├── packages/
│   └── web/
│       ├── src/
│       │   ├── server.ts          ← Hono Server Entry Point
│       │   ├── db/
│       │   │   ├── index.ts       ← Turso DB Connection
│       │   │   └── schema.ts      ← Drizzle Schema (products, priceHistory)
│       │   ├── api/
│       │   │   ├── index.ts       ← alle API-Routes registriert
│       │   │   ├── aliexpress.ts  ← AliExpress Scraper (ScrapingAnt)
│       │   │   ├── aliexpress-api.ts ← AliExpress DS API (OAuth)
│       │   │   ├── ebay.ts        ← eBay Listing API
│       │   │   ├── price-monitor.ts ← Preis-Überwachung Cron
│       │   │   ├── backup.ts      ← dieser Backup-Service
│       │   │   ├── backup-cron.ts ← Backup CLI runner
│       │   │   ├── mailer.ts      ← Resend E-Mail Wrapper
│       │   │   └── auth.ts        ← Login (einfaches Passwort-Auth)
│       │   └── web/
│       │       ├── pages/
│       │       │   ├── dashboard.tsx   ← Tab 1: Übersicht
│       │       │   ├── lieferanten.tsx ← Tab 2: AliExpress Produkt importieren
│       │       │   ├── produkte.tsx    ← Tab 3: Produktverwaltung
│       │       │   ├── listings.tsx    ← Tab 4: eBay Listings
│       │       │   ├── einstellungen.tsx ← Tab 6: API-Keys etc.
│       │       │   ├── suche.tsx       ← AliExpress Suche
│       │       │   ├── retouren.tsx    ← Retouren-Workflow
│       │       │   └── autods.tsx      ← AutoDS CSV Export
│       │       └── App.tsx / main.tsx / index.html
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── drizzle.config.ts
└── package.json
\`\`\`

---

## DATENBANK-SCHEMA

### Tabelle: products
\`\`\`sql
CREATE TABLE products (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  asin             TEXT NOT NULL UNIQUE,     -- intern: ali_<timestamp>
  source_url       TEXT,                      -- AliExpress URL
  amazon_url       TEXT NOT NULL,             -- legacy alias für source_url
  title            TEXT NOT NULL,             -- Original AliExpress Titel
  generated_title  TEXT NOT NULL,             -- KI-generierter eBay Titel (≤80 Zeichen)
  html_description TEXT NOT NULL,             -- HTML für eBay Vorlage
  bullets          TEXT NOT NULL,             -- JSON Array: Bullet Points
  variants         TEXT NOT NULL,             -- JSON Array: [{name, values[]}]
  description      TEXT,
  images           TEXT,                      -- JSON Array: Bild-URLs
  buy_price        REAL,                      -- Einkaufspreis €
  sell_price       REAL,                      -- Verkaufspreis €
  last_price_check TEXT,                      -- ISO datetime
  price_changed    INTEGER DEFAULT 0,         -- 0=nein, 1=ja (Boolean)
  specs            TEXT,                      -- JSON Object: Produktspezifikationen
  ebay_listing_id  TEXT,
  ebay_status      TEXT DEFAULT 'none',       -- none | listed | error
  ebay_error       TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now'))
);
\`\`\`

### Tabelle: price_history
\`\`\`sql
CREATE TABLE price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL,
  price       REAL NOT NULL,
  source      TEXT DEFAULT 'aliexpress',
  checked_at  TEXT DEFAULT (datetime('now'))
);
\`\`\`

---

## RESTORE-SCHRITTE (KI führt diese durch)

### SCHRITT 1: Code wiederherstellen

Die Datei \`stele-code-DATUM.json.gz\` enthält ALLE Source-Dateien als JSON-Bundle.

\`\`\`bash
# Entpacken
gunzip stele-code-DATUM.json.gz
# → stele-code-DATUM.json enthält { "src/server.ts": "...", "package.json": "...", ... }
\`\`\`

KI liest das JSON und schreibt jede Datei an den richtigen Pfad zurück.

### SCHRITT 2: Abhängigkeiten installieren

\`\`\`bash
cd stele-app
bun install
\`\`\`

### SCHRITT 3: ENV-Variablen setzen (in Render oder .env)

\`\`\`env
DATABASE_URL=libsql://...turso.io
DATABASE_AUTH_TOKEN=...
GEMINI_API_KEY=...
SCRAPINGANT_API_KEY=...
ALIEXPRESS_APP_KEY=535690
ALIEXPRESS_APP_SECRET=...
RESEND_API_KEY=...
EBAY_APP_ID=...
EBAY_DEV_ID=...
EBAY_CERT_ID=...
EBAY_USER_TOKEN=...
ALIEXPRESS_ACCESS_TOKEN=...
NODE_ENV=production
\`\`\`

> WICHTIG: Alle ENV-Werte stehen in Render.com → Umgebungsvariablen. 
> Evgenij muss diese aus Render kopieren und in die neue Instanz eintragen.

### SCHRITT 4: DB-Schema erstellen (neue DB)

\`\`\`bash
cd packages/web
bun run db:push
\`\`\`

### SCHRITT 5: Daten wiederherstellen aus JSON

Die Datei \`stele-db-DATUM.json\` enthält alle Zeilen.
KI importiert sie direkt via Drizzle oder Turso Shell:

\`\`\`bash
# KI schreibt ein restore-script und führt es aus:
bun run scripts/restore-db.ts stele-db-DATUM.json
\`\`\`

### SCHRITT 6: Deploy

\`\`\`bash
git add .
git commit -m "restore: $(date +%Y-%m-%d)"
git push origin main
# → Render baut automatisch (2-3 Min) → App ist live
\`\`\`

---

## WICHTIGE BUSINESS-LOGIK

### Preisformel (eBay)
\`\`\`
Gebühren = 18% (13% eBay + 5% Anzeigen)
Mindestgewinn = 1,60€
sellPrice = buyPrice / (1 - 0.18) + 1.60
\`\`\`

### AliExpress → eBay Workflow
1. URL in "Lieferanten"-Tab eingeben
2. ScrapingAnt scrapt AliExpress Seite
3. Gemini generiert Titel (≤80 Zeichen) + HTML-Beschreibung + Bullets
4. Benutzer prüft + bearbeitet Varianten manuell (Scraper liefert oft keine Varianten)
5. "Bei eBay listen" → eBay Inventory API + Offer erstellen
6. Preis-Cron (täglich) prüft AliExpress-Preis → passt eBay-Preis an

### eBay Listing Details
- Kategorie: wird per eBay API automatisch vorgeschlagen
- Merchant Location: wird automatisch erstellt ("default", Wiesbaden)
- Pflichtaspekte: werden per eBay getItemAspectsForCategory API befüllt
- Varianten-Mapping: farbe→Rahmenfarbe, größe→Größe etc. (VARIANT_GROUP_MAP in ebay.ts)

### Backup-Email
- Von: onboarding@resend.dev
- An: contact@stele-e-transfer.com
- 2x täglich: 15:00, 23:35 Uhr

---

## EXTERNE DIENSTE & ACCOUNTS

| Dienst | URL | Zweck |
|--------|-----|-------|
| Render | render.com | Hosting/Deploy |
| Turso | app.turso.tech | Datenbank |
| Resend | resend.com | E-Mail |
| ScrapingAnt | scrapingant.com | AliExpress Scraping |
| Google AI Studio | aistudio.google.com | Gemini API |
| eBay Developer | developer.ebay.com | eBay API |
| AliExpress Open Platform | open.aliexpress.com | DS API |

---

## BEKANNTE PROBLEME (Stand Backup-Datum)

1. **AliExpress Scraper** — Bot-Schutz blockiert Server-IPs → Varianten oft leer → User trägt manuell ein
2. **shipsFrom-Detection** — Scraper kann Versandort nicht lesen → TODO nach Go-Live
3. **AliExpress DS API** — OAuth access_token noch nicht eingerichtet (ALIEXPRESS_ACCESS_TOKEN in Render setzen)

---

## BEKANNTE FALLSTRICKE — Fehler die uns im Kreis drehen

> Immer zuerst lesen bevor Änderungen gemacht werden!

### HONO basePath('api') — ALLE API-Routen laufen unter /api/...
- Hono ist mit .basePath('api') konfiguriert
- Jede Route app.get('/xyz', ...) ist unter /api/xyz erreichbar — NICHT unter /xyz
- Beispiel: /backup/test ist FALSCH, /api/backup/test ist RICHTIG
- GitHub Actions Cron ruft /api/backup/run auf
- server.ts leitet nur /api/* und /backup/* an Hono weiter

### Template Literals in backup.ts — Backticks NICHT escapen
- Die generateAgentRestoreMd() Funktion ist ein Template Literal
- Der schliessende Backtick am Ende DARF NICHT escaped werden (sonst schliesst der String nie)
- Symptom: Build lokal OK, aber Render crasht mit exit status 1

### server.ts routing — Nur /api/* geht an Hono (Standard)
- Standardmaessig nur: if (url.pathname.startsWith('/api')) an Hono
- Neue Non-API-Routen in Hono brauchen auch Eintrag in server.ts
- Aktuell: /api und /backup werden weitergeleitet

### AliExpress Suche — shipFromCountry NICHT in Suchergebnissen
- ScrapingAnt scrapt de.aliexpress.com Suchergebnisse
- shipFromCountry ist in Suchergebnis-Items NICHT enthalten
- EU-Filter nur beim Import via ds.product.get moeglich

### AliExpress affiliate.product.query — PERMANENT BLOCKIERT
- Fehler: InsufficientPermission
- Nicht fixbar ohne neue AliExpress App-Genehmigung
- Alternative: ScrapingAnt HTML-Scraping (deployed, funktioniert)

### price-monitor.ts — shipsFrom-Fix noch offen
- Wenn Scrape fehlschlaegt: shipsFrom=unbekannt → Produkt wird faelschlich uebersprungen
- Fix: Nur ueberspringen wenn shipsFrom BESTAETIGT = China, nicht bei unbekannt

---

## KI-KONTEXT — Integrations-Status & TODOs

> Dieser Abschnitt hält den KI-Kontext zwischen Sessions aktuell.
> Stand: \${isoDate}

### API-Integrations Status

| Integration | Status | Hinweis |
|-------------|--------|---------|
| eBay Trading/Inventory API | ✅ funktioniert | OAuth User Token, Listings erstellen OK |
| AliExpress DS API \`ds.product.get\` | ✅ funktioniert | Produktdetails per product_id abrufbar |
| AliExpress DS API \`ds.category.get\` | ✅ funktioniert | Kategorien abrufbar |
| AliExpress DS API \`ds.recommend.feed.get\` | ⚠️ liefert 0 Ergebnisse | API antwortet, aber leere Liste |
| AliExpress Affiliate \`affiliate.product.query\` | ❌ BLOCKIERT | InsufficientPermission — nicht fixbar ohne neue AliExpress-Genehmigung |
| AliExpress Suche (ScrapingAnt) | ✅ deployed | Scrapt de.aliexpress.com, extrahiert itemList JSON, 60 Produkte/Suche |
| ScrapingAnt API | ✅ aktiv | Key in Render ENV, für AliExpress HTML-Scraping |
| Gemini API (Google) | ✅ funktioniert | Titel + HTML-Beschreibung + Bullets generieren |
| Resend Email | ✅ funktioniert | contact@stele-e-transfer.com, Backup-Emails laufen |
| Turso DB | ✅ funktioniert | libSQL, Drizzle ORM, tägl. Backup |

### Wichtige Erkenntnisse

- **ScrapingAnt Suche**: shipFromCountry NICHT in Suchergebnissen — nur via \`ds.product.get\` beim Import prüfbar
- **AliExpress OAuth**: \`ALIEXPRESS_ACCESS_TOKEN\` muss in Render gesetzt werden für DS API
- **AliExpress App Key**: \`535690\` — App Status: Online (seit 01.06.2026)
- **Ecomsniper**: gekündigt (2026-06-13) — nicht mehr nutzen
- **AutoDS**: gekündigt (2026-06-28) — nicht mehr nutzen
- **Go-Live**: erreicht am 2026-06-29 ✅

### Aktuelle TODOs (nach Go-Live)

1. **Preisaktualisierung** — Cron-Job: AliExpress-Preis täglich prüfen → DB updaten → eBay-Preis anpassen
2. **Vorschau-Modal editierbar** — Produkte-Tab: Titel-Input + Bullets-Textarea + Speichern → PATCH /products/:id
3. **shipsFrom-Fix in price-monitor.ts** — nur bestätigte China-Produkte überspringen, nicht wenn Scrape fehlgeschlagen
4. **ALIEXPRESS_ACCESS_TOKEN** — in Render.com setzen → DS API vollständig nutzen
5. **eBay Kat-ID Workflow** — Kategorie-ID aus eBay Breadcrumb (_sacat=XXXXX) manuell eintragen
6. **EU-Lager-Filter** — Suche/Import nur EU-Lager (DE + AT + CH + FR + NL + PL + CZ + BE + LU)

### Abonnements

| Tool | Status |
|------|--------|
| AutoDS Starter 400 | ❌ gekündigt (2026-06-28) |
| Ecomsniper | ❌ gekündigt (2026-06-13) |
| ScrapingAnt | ✅ aktiv |
| Trackerbot | ✅ aktiv |

### Letzte wichtige Commits

- \`a6d0605\` — AliExpress Suche via ScrapingAnt scraping (2026-06-30)
- \`3ee2e93\` — Suche-Tab Fallback UI (externe Links bei API-Fehler)
- \`8ff6b9c\` — AliExpress Affiliate API Integration
- \`99364ea\` — ALL Default-Einstellungen

---

*Automatisch generiert · Stele-E-Transfer Backup System v2.0*
`;
}

// ─── Email via Resend API ─────────────────────────────────────────────────────

async function sendBackupEmail(
  csv: string,
  dbJson: string,
  agentRestoreMd: string,
  codeZipBuffer: Buffer,
  productCount: number,
  priceHistoryCount: number
): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('[Backup] RESEND_API_KEY fehlt');
    return;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('de-DE');
  const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const isoDate = now.toISOString().slice(0, 10);
  const hourStr = `${now.getHours()}h`;

  const { Resend } = await import('resend');
  const resend = new Resend(RESEND_API_KEY);

  const result = await resend.emails.send({
    from: 'Stele Backup <onboarding@resend.dev>',
    to: BACKUP_TO,
    subject: `📦 Stele Backup — ${dateStr} ${timeStr} (${productCount} Produkte)`,
    html: `
      <h2>📦 Stele-E-Transfer Vollständiges Backup</h2>
      <p><strong>Datum:</strong> ${dateStr} ${timeStr}</p>
      <p><strong>Produkte:</strong> ${productCount}</p>
      <p><strong>Preis-Einträge:</strong> ${priceHistoryCount}</p>
      <hr>
      <h3>Anhänge in dieser Mail:</h3>
      <ol>
        <li><strong>stele-db-${isoDate}-${hourStr}.json</strong> — Vollständige Datenbank (alle Tabellen, alle Felder)</li>
        <li><strong>stele-backup-${isoDate}-${hourStr}.csv</strong> — Produktliste (menschenlesbare Übersicht)</li>
        <li><strong>stele-code-${isoDate}.json.gz</strong> — Kompletter Source-Code (alle .ts/.tsx Dateien gepackt)</li>
        <li><strong>AGENT-RESTORE-${isoDate}.md</strong> — KI-Wiederherstellungsanleitung (zeige der KI + sage "Restore")</li>
      </ol>
      <hr>
      <h3>🚨 Im Notfall so vorgehen:</h3>
      <ol>
        <li>Alle 4 Dateien aus dieser Mail speichern</li>
        <li>KI öffnen (Runable)</li>
        <li>Alle 4 Dateien hochladen + schreiben: <strong>"Restore"</strong></li>
        <li>KI stellt alles automatisch wieder her</li>
      </ol>
      <hr>
      <small style="color:#999">Automatisch generiert · Stele-E-Transfer Backup System v2.0</small>
    `,
    attachments: [
      {
        filename: `stele-db-${isoDate}-${hourStr}.json`,
        content: Buffer.from(dbJson, 'utf-8').toString('base64'),
      },
      {
        filename: `stele-backup-${isoDate}-${hourStr}.csv`,
        content: Buffer.from(csv, 'utf-8').toString('base64'),
      },
      {
        filename: `stele-code-${isoDate}.json.gz`,
        content: codeZipBuffer.toString('base64'),
      },
      {
        filename: `AGENT-RESTORE-${isoDate}.md`,
        content: Buffer.from(agentRestoreMd, 'utf-8').toString('base64'),
      },
    ],
  });

  if (result.error) {
    throw new Error(`Resend Fehler: ${JSON.stringify(result.error)}`);
  }

  console.log(`[Backup] Email gesendet an ${BACKUP_TO} — ${productCount} Produkte (id: ${result.data?.id})`);
}

// ─── Backup ausführen ─────────────────────────────────────────────────────────

export async function runBackup(): Promise<{ ok: boolean; error?: string; productCount?: number }> {
  try {
    console.log('[Backup] Starte vollständigen Backup...');

    const [products, priceHistoryRows] = await Promise.all([
      db.select().from(schema.products),
      db.select().from(schema.priceHistory),
    ]);

    const now = new Date();
    const isoDate = now.toISOString().slice(0, 10);

    console.log(`[Backup] ${products.length} Produkte, ${priceHistoryRows.length} Preis-Einträge`);

    const csv = productsToCSV(products);
    const dbJson = JSON.stringify({
      exportedAt: now.toISOString(),
      version: '2.0',
      tables: {
        products: { count: products.length, rows: products },
        price_history: { count: priceHistoryRows.length, rows: priceHistoryRows },
      },
    }, null, 2);

    const agentRestoreMd = generateAgentRestoreMd(products.length, priceHistoryRows.length, isoDate);

    console.log('[Backup] Generiere Code-ZIP...');
    const codeZipBuffer = await generateCodeZip();
    console.log(`[Backup] Code-ZIP: ${(codeZipBuffer.length / 1024).toFixed(1)} KB`);

    await sendBackupEmail(csv, dbJson, agentRestoreMd, codeZipBuffer, products.length, priceHistoryRows.length);

    // Zusätzlich zu Google Drive sichern (falls verbunden) — E-Mail bleibt die primäre Sicherung
    try {
      const { isDriveConnected, findOrCreatePath, uploadToDrive } = await import('./drive');
      if (await isDriveConnected()) {
        const hourStr = `${now.getHours()}h`;
        const folderId = await findOrCreatePath(['APP', 'STELE-DS-APP', 'Backups']);
        await uploadToDrive(Buffer.from(dbJson, 'utf-8'), `stele-db-${isoDate}-${hourStr}.json`, 'application/json', folderId);
        await uploadToDrive(Buffer.from(csv, 'utf-8'), `stele-backup-${isoDate}-${hourStr}.csv`, 'text/csv', folderId);
        console.log('[Backup] Zusätzlich auf Google Drive gesichert ✓');
      }
    } catch (driveErr) {
      console.error('[Backup] Drive-Sicherung fehlgeschlagen (E-Mail-Backup bleibt bestehen):', driveErr);
    }

    return { ok: true, productCount: products.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Backup] Fehler:', msg);
    return { ok: false, error: msg };
  }
}

// ─── Scheduler — 15:00, 23:35 Uhr (P-23) ────────────────────────────────────

export function startBackupScheduler(): void {
  if (!RESEND_API_KEY) {
    console.warn('[Backup] Kein RESEND_API_KEY — Scheduler deaktiviert');
    return;
  }

  const BACKUP_TIMES: [number, number][] = [[15, 0], [23, 35]];

  function scheduleNext(): void {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const next = new Date(now);
    const found = BACKUP_TIMES.find(([h, m]) => h * 60 + m > nowMinutes);

    if (found) {
      next.setHours(found[0], found[1], 0, 0);
    } else {
      next.setDate(now.getDate() + 1);
      next.setHours(BACKUP_TIMES[0][0], BACKUP_TIMES[0][1], 0, 0);
    }

    const msUntilNext = next.getTime() - now.getTime();
    console.log(`[Backup] Nächstes Backup um ${next.toLocaleTimeString('de-DE')} (in ${Math.round(msUntilNext / 60000)} Min)`);

    setTimeout(async () => {
      await runBackup();
      scheduleNext();
    }, msUntilNext);
  }

  scheduleNext();
  console.log('[Backup] Scheduler gestartet — täglich 15:00, 23:35 Uhr');
}
