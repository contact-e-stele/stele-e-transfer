// Automatischer DB-Backup per Email — 3x täglich (08:00, 13:00, 20:00)
// Sendet alle Produkte als CSV-Anhang via Resend API

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

// ─── Email via Resend API ─────────────────────────────────────────────────────

async function sendBackupEmail(csv: string, productCount: number): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('[Backup] RESEND_API_KEY fehlt');
    return;
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('de-DE');
  const timeStr = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const filename = `stele-backup-${now.toISOString().slice(0, 10)}-${now.getHours()}h.csv`;

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
      <p>CSV-Datei im Anhang enthält alle gespeicherten Produkte mit EK/VK Preisen und eBay Status.</p>
      <hr>
      <small style="color:#999">Automatisch generiert · Stele-E-Transfer Backup System</small>
    `,
    attachments: [
      {
        filename,
        content: Buffer.from(csv, 'utf-8').toString('base64'),
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
    const products = await db.select().from(schema.products);
    const csv = productsToCSV(products);
    await sendBackupEmail(csv, products.length);
    return { ok: true, productCount: products.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[Backup] Fehler:', msg);
    return { ok: false, error: msg };
  }
}

// ─── Scheduler — 08:00, 13:00, 20:00 Uhr ────────────────────────────────────

export function startBackupScheduler(): void {
  if (!RESEND_API_KEY) {
    console.warn('[Backup] Kein RESEND_API_KEY — Scheduler deaktiviert');
    return;
  }

  // [Stunde, Minute]
  const BACKUP_TIMES: [number, number][] = [[8, 0], [13, 0], [20, 0], [23, 35]];

  function scheduleNext(): void {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const next = new Date(now);
    const found = BACKUP_TIMES.find(([h, m]) => h * 60 + m > nowMinutes);

    if (found) {
      next.setHours(found[0], found[1], 0, 0);
    } else {
      // nächster Tag, erster Eintrag
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
