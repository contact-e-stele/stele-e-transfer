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
    'docs/ARCHITECTURE.md', // P-33: aktuelle Architektur-Doku, damit AGENT-RESTORE.md darauf verweisen kann statt Fakten zu duplizieren
    'P-UEBERSICHT.md',
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

## ARCHITEKTUR, DATENBANK-SCHEMA, INTEGRATIONEN, BEKANNTE SCHWACHSTELLEN

> Diese Angaben standen früher hier hart einprogrammiert und sind mit der Zeit veraltet und
> widersprüchlich zum echten Code geworden (siehe Repo-Thema P-33 — genau diese Datei war der
> Auslöser). Um das nicht zu wiederholen, verweist diese Anleitung ab sofort auf die gepflegte
> Doku statt Fakten zu duplizieren:
>
> **→ \`docs/ARCHITECTURE.md\`** (liegt im beiliegenden Code-ZIP unter genau diesem Pfad)
>
> Dort stehen: Architektur-Diagramm, alle Backend-Routen/Frontend-Tabs, DB-Schema, externe
> Integrationen (eBay, AliExpress, Google Drive, Resend, Gemini), Auth-Modell und bekannte
> Schwachstellen — mit Datumsstempel des letzten manuellen Updates.
>
> Aktuelle Feature-Historie/Roadmap: \`P-UEBERSICHT.md\` (ebenfalls im Code-ZIP).

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

## FALLSTRICK — HONO basePath('api')

- Hono ist mit .basePath('api') konfiguriert — jede Route ist unter /api/xyz erreichbar, NICHT unter /xyz
- server.ts leitet nur /api/* und /backup/* an Hono weiter — neue Non-API-Routen brauchen dort einen eigenen Eintrag
- GitHub Actions Cron ruft /api/backup/run und /api/orders/check auf (mit X-Backup-Key Header, nicht Session-Cookie)

Alles Weitere (Business-Logik, Preisformel, Integrations-Status, TODOs, bekannte Probleme)
siehe \`docs/ARCHITECTURE.md\` im Code-ZIP — wird dort gepflegt statt hier dupliziert.

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

    const [products, priceHistoryRows, trustedSuppliersRows] = await Promise.all([
      db.select().from(schema.products),
      db.select().from(schema.priceHistory),
      db.select().from(schema.trustedSuppliers),
    ]);

    const now = new Date();
    const isoDate = now.toISOString().slice(0, 10);

    console.log(`[Backup] ${products.length} Produkte, ${priceHistoryRows.length} Preis-Einträge, ${trustedSuppliersRows.length} Lieferanten`);

    const csv = productsToCSV(products);
    const dbJson = JSON.stringify({
      exportedAt: now.toISOString(),
      version: '2.0',
      tables: {
        products: { count: products.length, rows: products },
        price_history: { count: priceHistoryRows.length, rows: priceHistoryRows },
        trusted_suppliers: { count: trustedSuppliersRows.length, rows: trustedSuppliersRows },
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
