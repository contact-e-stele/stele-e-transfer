/**
 * Rechnung/Quittung PDF-Generator (Kleinunternehmer §19 UStG — ohne ausgewiesene MwSt.)
 * Rendert HTML-Vorlage via Playwright zu PDF.
 */
// Nutzt gleiches serverless-kompatibles Chromium-Launch-Muster wie aliexpress.ts (@sparticuz/chromium Fallback)
async function launchChromium() {
  const { chromium: playwrightChromium } = await import('playwright-core');
  let execPath: string | undefined = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  const launchArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

  if (!execPath) {
    try {
      const sparticuzMod = await import('@sparticuz/chromium');
      const { setupLambdaEnvironment } = sparticuzMod;
      const sparticuzChromium = sparticuzMod.default;
      setupLambdaEnvironment();
      execPath = await sparticuzChromium.executablePath();
      launchArgs.push(...sparticuzChromium.args);
    } catch {
      execPath = undefined;
    }
  }

  return playwrightChromium.launch({ headless: true, executablePath: execPath, args: launchArgs });
}

export interface InvoiceData {
  orderId: string;
  orderDate: string;
  buyerName: string;
  buyerAddress: { street?: string; city?: string; postalCode?: string; countryCode?: string };
  lineItems: Array<{ title: string; quantity: number; unitPrice: number }>;
  total: number;
  currency: string;
}

const SELLER = {
  name: 'stele-e-transfer',
  address: 'Am Hochfeld 47',
  city: '65205 Wiesbaden',
  country: 'Deutschland',
};

function buildInvoiceHtml(data: InvoiceData): string {
  const rows = data.lineItems.map(li => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;">${li.title}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:center;">${li.quantity}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;">${li.unitPrice.toFixed(2)} ${data.currency}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #E2E8F0;text-align:right;">${(li.unitPrice * li.quantity).toFixed(2)} ${data.currency}</td>
    </tr>`).join('');

  return `
<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><style>
  body { font-family: 'Helvetica', Arial, sans-serif; color: #0F172A; padding: 40px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .muted { color: #64748B; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th { background: #F8FAFC; padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748B; }
  .total-row td { padding: 10px; font-weight: 700; font-size: 14px; border-top: 2px solid #0F172A; }
  .footer { margin-top: 40px; font-size: 11px; color: #94A3B8; line-height: 1.6; }
</style></head>
<body>
  <h1>Rechnung / Quittung</h1>
  <p class="muted">Bestellnummer: ${data.orderId} · Datum: ${new Date(data.orderDate).toLocaleDateString('de-DE')}</p>

  <div style="display:flex;justify-content:space-between;margin-top:24px;">
    <div>
      <strong>${SELLER.name}</strong><br>
      ${SELLER.address}<br>
      ${SELLER.city}<br>
      ${SELLER.country}
    </div>
    <div style="text-align:right;">
      <strong>${data.buyerName}</strong><br>
      ${data.buyerAddress.street ?? ''}<br>
      ${data.buyerAddress.postalCode ?? ''} ${data.buyerAddress.city ?? ''}<br>
      ${data.buyerAddress.countryCode ?? ''}
    </div>
  </div>

  <table>
    <thead><tr><th>Artikel</th><th style="text-align:center;">Menge</th><th style="text-align:right;">Einzelpreis</th><th style="text-align:right;">Summe</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total-row"><td colspan="3">Gesamtbetrag</td><td style="text-align:right;">${data.total.toFixed(2)} ${data.currency}</td></tr></tfoot>
  </table>

  <div class="footer">
    Gemäß § 19 UStG wird keine Umsatzsteuer berechnet und ausgewiesen (Kleinunternehmerregelung).<br>
    Vielen Dank für Ihren Einkauf bei ${SELLER.name}.
  </div>
</body>
</html>`;
}

// Wiederverwendete Browser-Instanz (verhindert Race Condition/ETXTBSY bei gleichzeitigen Chromium-Starts,
// z.B. wenn Auto-Generierung im Hintergrund läuft während gleichzeitig ein Download angefragt wird)
let browserPromise: ReturnType<typeof launchChromium> | null = null;
let queue: Promise<unknown> = Promise.resolve();

async function getBrowser() {
  if (browserPromise) {
    try {
      const existing = await browserPromise;
      if (existing.isConnected()) return existing;
      browserPromise = null; // Browser wurde geschlossen/ist abgestürzt — neu starten
    } catch {
      browserPromise = null;
    }
  }
  browserPromise = launchChromium();
  try {
    return await browserPromise;
  } catch (e) {
    browserPromise = null;
    throw e;
  }
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  // Sequentiell in Warteschlange ausführen — verhindert parallele Chromium-Launches
  const task = queue.then(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(buildInvoiceHtml(data), { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' } });
      return pdf;
    } finally {
      await page.close();
    }
  });
  queue = task.catch(() => {}); // Fehler sollen die Queue nicht blockieren
  return task;
}
