// Automatischer DB-Backup per Email — 3x täglich (08:00, 13:00, 20:00)
// Sendet: CSV + vollständiges DB-JSON + RESTORE.md

import { db } from '../db/index';
import * as schema from '../db/schema';

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

async function exportDatabaseJSON(): Promise<string> {
  const [products, priceHistory] = await Promise.all([
    db.select().from(schema.products),
    db.select().from(schema.priceHistory),
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    tables: {
      products: {
        count: products.length,
        rows: products,
      },
      price_history: {
        count: priceHistory.length,
        rows: priceHistory,
      },
    },
  };

  return JSON.stringify(dump, null, 2);
}

// ─── RESTORE.md Generator ─────────────────────────────────────────────────────

function generateRestoreMd(productCount: number, priceHistoryCount: number, dateStr: string): string {
  return `# STELE-E-TRANSFER — Wiederherstellungsanleitung
Backup vom: ${dateStr}
Produkte: ${productCount} | Preis-Einträge: ${priceHistoryCount}

---

## 1. Voraussetzungen

- Node.js 18+ oder Bun installiert
- Git-Zugriff auf: https://github.com/contact-e-stele/stele-e-transfer
- Turso-Konto (kostenlos: https://turso.tech)
- Render-Konto (https://render.com)
- Resend-Konto (https://resend.com)

---

## 2. Umgebungsvariablen (alle benötigt)

Diese Werte in Render → Environment hinterlegen:

\`\`\`
DATABASE_URL=libsql://...turso.io         # Turso DB URL
DATABASE_AUTH_TOKEN=...                    # Turso Auth Token
GEMINI_API_KEY=...                         # Google AI Studio
SCRAPINGANT_API_KEY=...                    # ScrapingAnt
ALIEXPRESS_APP_KEY=535690                  # AliExpress App Key
ALIEXPRESS_APP_SECRET=...                  # AliExpress App Secret
RESEND_API_KEY=...                         # E-Mail Versand
EBAY_APP_ID=...                            # eBay API App ID
EBAY_DEV_ID=...                            # eBay API Dev ID
EBAY_CERT_ID=...                           # eBay API Cert ID
EBAY_USER_TOKEN=...                        # eBay OAuth User Token
NODE_ENV=production
\`\`\`

---

## 3. Fresh Deploy (neue Installation)

\`\`\`bash
# 1. Repository klonen
git clone https://github.com/contact-e-stele/stele-e-transfer
cd stele-e-transfer

# 2. Abhängigkeiten installieren
bun install

# 3. .env Datei erstellen (alle Vars von oben eintragen)
cp .env.example .env
nano .env

# 4. Datenbank Schema erstellen
cd packages/web
bun run db:push

# 5. App lokal starten (Test)
bun run dev
\`\`\`

---

## 4. Datenbank wiederherstellen aus diesem Backup

Die JSON-Datei \`stele-db-${dateStr}.json\` enthält alle Tabellen.

Ich zeige dir die Datei — ich (KI) importiere sie direkt:

\`\`\`bash
# Option A: Skript aus dem Repo verwenden
node scripts/restore-db.js stele-db-${dateStr}.json

# Option B: Manuell via Turso Shell
turso db shell <dein-db-name>
\`\`\`

**ODER:** Einfach die JSON-Datei an mich (die KI) schicken und sagen "Restore".
Ich lese sie aus und füge alle Datensätze direkt per API in die neue DB ein.

---

## 5. Render Deploy (nach Code-Änderungen)

\`\`\`bash
git add .
git commit -m "restore"
git push origin main
# → Render baut automatisch neu (ca. 2-3 Min)
\`\`\`

---

## 6. Wichtige URLs

- App live: https://stele-e-transfer.onrender.com
- GitHub: https://github.com/contact-e-stele/stele-e-transfer
- Turso Dashboard: https://app.turso.tech
- Render Dashboard: https://dashboard.render.com
- Resend Dashboard: https://resend.com/emails

---

*Automatisch generiert · Stele-E-Transfer Backup System*
`;
}

// ─── Email via Resend API ─────────────────────────────────────────────────────

async function sendBackupEmail(
  csv: string,
  dbJson: string,
  restoreMd: string,
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
    subject: `📦 Stele DB Backup — ${dateStr} ${timeStr} (${productCount} Produkte)`,
    html: `
      <h2>📦 Stele-E-Transfer Datenbank Backup</h2>
      <p><strong>Datum:</strong> ${dateStr} ${timeStr}</p>
      <p><strong>Produkte:</strong> ${productCount}</p>
      <p><strong>Preis-Einträge:</strong> ${priceHistoryCount}</p>
      <hr>
      <h3>Anhänge in dieser Mail:</h3>
      <ul>
        <li><strong>stele-backup-${isoDate}-${hourStr}.csv</strong> — Produktliste (Übersicht)</li>
        <li><strong>stele-db-${isoDate}-${hourStr}.json</strong> — Vollständige Datenbank (alle Tabellen)</li>
        <li><strong>stele-restore-guide-${isoDate}.md</strong> — Wiederherstellungsanleitung</li>
      </ul>
      <p style="color:#888">Zum Wiederherstellen: JSON-Datei + Restore-Guide an die KI schicken und "Restore" sagen.</p>
      <hr>
      <small style="color:#999">Automatisch generiert · Stele-E-Transfer Backup System</small>
    `,
    attachments: [
      {
        filename: `stele-backup-${isoDate}-${hourStr}.csv`,
        content: Buffer.from(csv, 'utf-8').toString('base64'),
      },
      {
        filename: `stele-db-${isoDate}-${hourStr}.json`,
        content: Buffer.from(dbJson, 'utf-8').toString('base64'),
      },
      {
        filename: `stele-restore-guide-${isoDate}.md`,
        content: Buffer.from(restoreMd, 'utf-8').toString('base64'),
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
    console.log('[Backup] Starte DB Export...');

    const [products, priceHistoryRows] = await Promise.all([
      db.select().from(schema.products),
      db.select().from(schema.priceHistory),
    ]);

    const now = new Date();
    const dateStr = now.toLocaleDateString('de-DE');

    const csv = productsToCSV(products);
    const dbJson = JSON.stringify({
      exportedAt: now.toISOString(),
      version: '1.0',
      tables: {
        products: { count: products.length, rows: products },
        price_history: { count: priceHistoryRows.length, rows: priceHistoryRows },
      },
    }, null, 2);
    const restoreMd = generateRestoreMd(products.length, priceHistoryRows.length, dateStr);

    await sendBackupEmail(csv, dbJson, restoreMd, products.length, priceHistoryRows.length);
    return { ok: true, productCount: products.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Backup] Fehler:', msg);
    return { ok: false, error: msg };
  }
}

// ─── Scheduler — 08:00, 13:00, 20:00, 23:35 Uhr ─────────────────────────────

export function startBackupScheduler(): void {
  if (!RESEND_API_KEY) {
    console.warn('[Backup] Kein RESEND_API_KEY — Scheduler deaktiviert');
    return;
  }

  const BACKUP_TIMES: [number, number][] = [[8, 0], [13, 0], [20, 0], [23, 35]];

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
  console.log('[Backup] Scheduler gestartet — täglich 08:00, 13:00, 20:00, 23:35 Uhr');
}
