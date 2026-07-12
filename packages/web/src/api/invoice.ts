/**
 * Rechnung/Quittung PDF-Generator (Kleinunternehmer §19 UStG — ohne ausgewiesene MwSt.)
 * Nutzt pdf-lib (kein Browser nötig) — zuverlässig auch bei begrenztem Server-Speicher.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

// Zeilenumbruch für lange Artikeltitel (grobe Zeichen-basierte Schätzung)
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export async function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const dark = rgb(0.06, 0.09, 0.16);
  const muted = rgb(0.4, 0.45, 0.55);
  const marginX = 50;
  let y = 780;

  const drawText = (text: string, x: number, yy: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}) => {
    page.drawText(text, {
      x, y: yy,
      size: opts.size ?? 11,
      font: opts.bold ? fontBold : font,
      color: opts.color ?? dark,
    });
  };

  // Titel
  drawText('Rechnung / Quittung', marginX, y, { size: 20, bold: true });
  y -= 20;
  drawText(`Bestellnummer: ${data.orderId} · Datum: ${new Date(data.orderDate).toLocaleDateString('de-DE')}`, marginX, y, { size: 10, color: muted });
  y -= 40;

  // Verkäufer / Käufer
  drawText(SELLER.name, marginX, y, { bold: true });
  drawText(data.buyerName, 350, y, { bold: true });
  y -= 15;
  drawText(SELLER.address, marginX, y);
  drawText(`${data.buyerAddress.postalCode ?? ''} ${data.buyerAddress.city ?? ''}`.trim(), 350, y);
  y -= 15;
  drawText(SELLER.city, marginX, y);
  drawText(data.buyerAddress.countryCode ?? '', 350, y);
  y -= 15;
  drawText(SELLER.country, marginX, y);
  y -= 40;

  // Tabellenkopf
  drawText('ARTIKEL', marginX, y, { size: 9, bold: true, color: muted });
  drawText('MENGE', 330, y, { size: 9, bold: true, color: muted });
  drawText('EINZELPREIS', 400, y, { size: 9, bold: true, color: muted });
  drawText('SUMME', 490, y, { size: 9, bold: true, color: muted });
  y -= 8;
  page.drawLine({ start: { x: marginX, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.88, 0.9, 0.93) });
  y -= 18;

  // Artikelzeilen
  for (const li of data.lineItems) {
    const lines = wrapText(li.title, 45);
    for (let i = 0; i < lines.length; i++) {
      drawText(lines[i], marginX, y);
      if (i === 0) {
        drawText(String(li.quantity), 330, y);
        drawText(`${li.unitPrice.toFixed(2)} ${data.currency}`, 400, y);
        drawText(`${(li.unitPrice * li.quantity).toFixed(2)} ${data.currency}`, 490, y);
      }
      y -= 16;
    }
    y -= 4;
  }

  y -= 10;
  page.drawLine({ start: { x: marginX, y }, end: { x: 545, y }, thickness: 1.5, color: dark });
  y -= 22;
  drawText('Gesamtbetrag', marginX, y, { bold: true, size: 13 });
  drawText(`${data.total.toFixed(2)} ${data.currency}`, 470, y, { bold: true, size: 13 });

  // Footer
  y = 80;
  drawText('Gemäß § 19 UStG wird keine Umsatzsteuer berechnet und ausgewiesen (Kleinunternehmerregelung).', marginX, y, { size: 9, color: muted });
  y -= 14;
  drawText(`Vielen Dank für Ihren Einkauf bei ${SELLER.name}.`, marginX, y, { size: 9, color: muted });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
