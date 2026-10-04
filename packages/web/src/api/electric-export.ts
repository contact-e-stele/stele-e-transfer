// A-029 (P-E01) Punkt 6: Elektro-Verkäufe je Geräteart und Monat als CSV — NUR LESEN (eBay-Bestellungen + App-Produkte), keine Meldung an die stiftung ear.
// Zuordnung Bestellposition → Produkt über dieselbe SKU-Logik wie überall (order-matching.ts, Regel 8). Nur bestätigte Elektro-Produkte (isElectric = 1) zählen.
import { buildProductLookups, findProductForSku } from './order-matching';
import { buildElectricSalesCsv, isElectricYes, type ElectricSaleLine } from '../shared/electric';

export interface ExportOrder { orderId: string; orderDate: string; lineItems: Array<{ sku: string | null; quantity: number }> }
export interface ExportProduct { id: number; asin: string | null; isElectric: number | boolean | null; deviceType: string | null }

export const UNKNOWN_DEVICE_TYPE = '(ohne Geräteart)';

export function electricSaleLines(orders: ExportOrder[], products: ExportProduct[], from?: string, to?: string): ElectricSaleLine[] {
  const lookups = buildProductLookups(products);
  const lines: ElectricSaleLine[] = [];
  for (const o of orders) {
    const day = (o.orderDate ?? '').slice(0, 10);
    if (from && day < from) continue;
    if (to && day > to) continue;
    for (const li of o.lineItems) {
      const p = findProductForSku(li.sku, lookups);
      if (!p || !isElectricYes(p)) continue;
      lines.push({ orderId: o.orderId, date: o.orderDate, productId: p.id, deviceType: (p.deviceType ?? '').trim() || UNKNOWN_DEVICE_TYPE, quantity: li.quantity });
    }
  }
  return lines;
}

export const electricSalesCsv = (orders: ExportOrder[], products: ExportProduct[], from?: string, to?: string): string =>
  buildElectricSalesCsv(electricSaleLines(orders, products, from, to));
