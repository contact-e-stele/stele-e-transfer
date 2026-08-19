// Benachrichtigungs-E-Mail bei neuen eBay-Bestellungen — läuft tagsüber (8–22 Uhr Berlin-Zeit)
// alle 120 Minuten, sowohl über einen internen Scheduler (solange der Server wach ist) als auch
// über einen externen GitHub-Actions-Cron (weckt den Render-Free-Dienst und ruft /api/orders/check
// auf) — gleiches Redundanz-Prinzip wie beim bestehenden Backup-E-Mail-Versand (siehe backup.ts).

import { eq } from 'drizzle-orm';
import { db } from '../db/index';
import * as schema from '../db/schema';
import { getAllOrders, type EbayOrder } from './ebay';
import { sendBackupEmail } from './mailer';

const NOTIFY_TO = 'contact@stele-e-transfer.com';
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22; // exklusiv — letzter Check kann z.B. um 21:xx laufen
const THROTTLE_MS = 120 * 60 * 1000; // 120 Minuten
const LAST_CHECK_KEY = 'order_notify_last_check';
const INTERNAL_SCHEDULER_INTERVAL_MS = 30 * 60 * 1000; // prüft alle 30 Min ob ein 120-Min-Slot fällig ist

function isWithinDayWindow(now = new Date()): boolean {
  // Europe/Berlin statt Server-Lokalzeit — Render läuft in UTC, DST wird von Intl automatisch berücksichtigt
  const hour = Number(
    new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(now)
  );
  return hour >= DAY_START_HOUR && hour < DAY_END_HOUR;
}

async function shouldRunNow(now = new Date()): Promise<boolean> {
  const row = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, LAST_CHECK_KEY)).get();
  if (!row?.value) return true;
  const lastCheck = new Date(row.value).getTime();
  if (Number.isNaN(lastCheck)) return true;
  return now.getTime() - lastCheck >= THROTTLE_MS;
}

async function markChecked(now = new Date()): Promise<void> {
  const iso = now.toISOString();
  await db.insert(schema.appSettings).values({ key: LAST_CHECK_KEY, value: iso, updatedAt: iso })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: iso, updatedAt: iso } });
}

function formatAddress(addr: EbayOrder['shippingAddress']): string {
  if (!addr) return 'Keine Lieferadresse übermittelt';
  const lines = [addr.fullName, [addr.addressLine1, addr.addressLine2].filter(Boolean).join(' '), `${addr.postalCode} ${addr.city}`.trim(), addr.countryCode]
    .filter(Boolean);
  return lines.join('\n');
}

function buildEmailText(order: EbayOrder): string {
  const items = order.lineItems.map(li => `  - ${li.quantity}x ${li.title}`).join('\n');
  const buyer = order.shippingAddress?.fullName || order.buyerUsername;
  return [
    `Neue eBay-Bestellung: ${order.orderId}`,
    `Datum: ${order.orderDate}`,
    '',
    `Bestellwert: ${order.total.toFixed(2)} ${order.currency}`,
    '',
    'Artikel:',
    items || '  (keine Artikel-Daten)',
    '',
    `Käufer: ${buyer} (eBay-Nutzername: ${order.buyerUsername})`,
    '',
    'Lieferadresse:',
    formatAddress(order.shippingAddress),
  ].join('\n');
}

async function notifyForOrder(order: EbayOrder): Promise<void> {
  await sendBackupEmail({
    to: NOTIFY_TO,
    subject: `🛒 Neue Bestellung ${order.orderId} — ${order.total.toFixed(2)} ${order.currency}`,
    text: buildEmailText(order),
  });

  const iso = new Date().toISOString();
  await db.insert(schema.orderNotes).values({ ebayOrderId: order.orderId, notificationSentAt: iso, updatedAt: iso })
    .onConflictDoUpdate({ target: schema.orderNotes.ebayOrderId, set: { notificationSentAt: iso, updatedAt: iso } });
}

export async function checkAndNotifyNewOrders(opts: { force?: boolean } = {}): Promise<{ skipped: boolean; reason?: string; checked: number; notified: number }> {
  const now = new Date();

  if (!opts.force) {
    if (!isWithinDayWindow(now)) {
      return { skipped: true, reason: 'outside-day-window', checked: 0, notified: 0 };
    }
    if (!(await shouldRunNow(now))) {
      return { skipped: true, reason: 'throttled', checked: 0, notified: 0 };
    }
  }

  console.log('[OrderNotifier] Prüfe auf neue Bestellungen...');
  const orders = await getAllOrders();

  const notes = await db.select().from(schema.orderNotes).all();
  const notifiedOrderIds = new Set(notes.filter(n => n.notificationSentAt).map(n => n.ebayOrderId));
  const newOrders = orders.filter(o => !notifiedOrderIds.has(o.orderId));

  let notified = 0;
  for (const order of newOrders.slice(0, 20)) { // Sicherheitslimit pro Durchlauf, analog Rechnungs-Auto-Gen
    try {
      await notifyForOrder(order);
      notified++;
    } catch (e) {
      console.error(`[OrderNotifier] Benachrichtigung für ${order.orderId} fehlgeschlagen:`, e);
    }
  }

  await markChecked(now);
  console.log(`[OrderNotifier] Fertig — ${orders.length} Bestellungen geprüft, ${notified} neue benachrichtigt`);
  return { skipped: false, checked: orders.length, notified };
}

export function startOrderNotifier(): void {
  setTimeout(async () => {
    await checkAndNotifyNewOrders().catch(e => console.error('[OrderNotifier] Startup check error:', e));
  }, 5 * 60 * 1000); // 5 Min nach Start — Server muss erst vollständig hochgefahren sein

  setInterval(async () => {
    await checkAndNotifyNewOrders().catch(e => console.error('[OrderNotifier] Interval error:', e));
  }, INTERNAL_SCHEDULER_INTERVAL_MS);

  console.log(`[OrderNotifier] Scheduler aktiv — prüft alle ${INTERNAL_SCHEDULER_INTERVAL_MS / 60000} Min ob ein 120-Min-Slot fällig ist (${DAY_START_HOUR}–${DAY_END_HOUR} Uhr Berlin-Zeit)`);
}
