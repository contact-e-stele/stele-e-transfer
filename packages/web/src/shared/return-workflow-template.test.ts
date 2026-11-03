// OFFEN 021: Retoure-Workflow kopieren. Fixtures sind ERFUNDENE Musterdaten (Max Mustermann,
// Bestellung 01-23456-78901, Rückgabe 5300000001) — keine echten Käuferdaten im Repo (Datenschutz).
import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_RETURN_WORKFLOW_TEMPLATE, RETURN_CLOSED_WARNING, RETURN_FALLBACK,
  buildReturnWorkflowText, formatEuroDe, isReturnClosed, renderReturnWorkflowTemplate,
  returnWorkflowTextsForOrder, returnWorkflowValues, returnsForOrder,
  type ReturnWorkflowOrder, type ReturnWorkflowReturn,
} from './return-workflow-template';

const NOW = new Date('2026-11-03T09:30:00Z'); // Berlin (MEZ) = 03.11.2026, 10:30

const order: ReturnWorkflowOrder = {
  orderId: '01-23456-78901',
  buyerUsername: 'max_muster_99',
  shippingAddress: { fullName: 'Max Mustermann' },
  lineItems: [{ title: 'Muster-Katzenspielzeug Feder', sku: 'stele-999-RED', quantity: 2 }],
  nettoEinkauf: 7.5,
  localNote: { aliexpressOrderId: '8100000000000001', trackingNumber: 'H1000000000000000001', carrier: 'Hermes', manualBuyPrice: null },
};

const ret: ReturnWorkflowReturn = {
  returnId: '5300000001',
  orderId: '01-23456-78901',
  buyerName: 'max_muster_99',
  reason: 'Passt nicht (Käuferreue)',
  status: 'OPEN',
  createdAt: '2026-11-01T08:00:00Z',
  amount: 19.95,
  currency: 'EUR',
  itemTitle: 'Muster-Katzenspielzeug Feder',
};

describe('formatEuroDe', () => {
  test('deutsches Komma, zwei Stellen', () => {
    expect(formatEuroDe(19.95)).toBe('19,95');
    expect(formatEuroDe(7.5)).toBe('7,50');
    expect(formatEuroDe(null)).toBeNull();
    expect(formatEuroDe(Number.NaN)).toBeNull();
  });
});

describe('buildReturnWorkflowText – Platzhalter-Ersetzung', () => {
  const text = buildReturnWorkflowText(order, ret, DEFAULT_RETURN_WORKFLOW_TEMPLATE, NOW);

  test('Fall-Block mit echten Werten', () => {
    expect(text).toContain('Erzeugt 03.11.2026, 10:30.');
    expect(text).toContain('- Rücksendung Nr: 5300000001 · eBay-Bestellung: 01-23456-78901');
    expect(text).toContain('- Käufer: max_muster_99 (Max Mustermann) · Grund laut eBay: Passt nicht (Käuferreue)');
    expect(text).toContain('- Artikel: Muster-Katzenspielzeug Feder (SKU stele-999-RED) · Menge 2');
    expect(text).toContain('- Gefordert: 19,95 € · eBay-Frist: ' + RETURN_FALLBACK);
    expect(text).toContain('- AliExpress-Bestellnr (aus Notiz): 8100000000000001 · Einkauf: 7,50 € · Hin-Sendung: H1000000000000000001 (Hermes)');
    expect(text).toContain('https://www.ebay.de/rt/ReturnDetails?returnId=5300000001');
    expect(text).toContain('https://www.ebay.de/mesh/ord/details?orderid=01-23456-78901');
    expect(text).toContain('https://www.aliexpress.com/p/order/detail.html?orderId=8100000000000001');
    expect(text).toContain('#Ali8100000000000001');
    expect(text).toContain('"R5300000001 – 01-23456-78901 – <Artikel> stele-999-RED"');
  });

  test('kein Platzhalter bleibt übrig, kein Geschlossen-Hinweis bei OPEN', () => {
    expect(text).not.toMatch(/\{\{\w+\}\}/);
    expect(text.startsWith('# Retoure-Workflow')).toBe(true);
    expect(text).not.toContain(RETURN_CLOSED_WARNING);
  });

  test('Frist wird eingesetzt, wenn eBay sie liefert', () => {
    const t = buildReturnWorkflowText(order, { ...ret, deadline: '2026-11-08T22:59:00Z' }, DEFAULT_RETURN_WORKFLOW_TEMPLATE, NOW);
    expect(t).toContain('eBay-Frist: 08.11.2026, 23:59');
  });

  test('Einkauf: nettoEinkauf fehlt → manuell erfasster Einkauf', () => {
    const v = returnWorkflowValues({ ...order, nettoEinkauf: null, localNote: { ...order.localNote, manualBuyPrice: 12.3 } }, ret, NOW);
    expect(v.buyPrice).toBe('12,30');
  });
});

describe('fehlende Felder → Fallback, nichts erfunden', () => {
  test('ohne Bestellung: nur Rückgabe-Daten, Rest Fallback', () => {
    const t = buildReturnWorkflowText(null, { returnId: '5300000001', orderId: '01-23456-78901' }, DEFAULT_RETURN_WORKFLOW_TEMPLATE, NOW);
    expect(t).toContain(`- Käufer: ${RETURN_FALLBACK} (${RETURN_FALLBACK}) · Grund laut eBay: ${RETURN_FALLBACK}`);
    expect(t).toContain(`- Artikel: ${RETURN_FALLBACK} (SKU ${RETURN_FALLBACK}) · Menge ${RETURN_FALLBACK}`);
    expect(t).toContain(`- Gefordert: ${RETURN_FALLBACK} € · eBay-Frist: ${RETURN_FALLBACK}`);
    expect(t).toContain(`Einkauf: ${RETURN_FALLBACK} € · Hin-Sendung: ${RETURN_FALLBACK} (${RETURN_FALLBACK})`);
    expect(t).toContain('- Rücksendung Nr: 5300000001 · eBay-Bestellung: 01-23456-78901');
    expect(t).not.toMatch(/\{\{\w+\}\}/);
  });

  test('leere Strings und Betrag 0 gelten als fehlend', () => {
    const v = returnWorkflowValues({ ...order, buyerUsername: '  ', localNote: { aliexpressOrderId: '', trackingNumber: null, carrier: null } }, { ...ret, buyerName: '', amount: 0 }, NOW);
    expect(v.buyerUsername).toBeNull();
    expect(v.aliOrderId).toBeNull();
    expect(v.amount).toBeNull();
  });

  test('Käufer-Login aus der Rückgabe, wenn die Bestellung fehlt', () => {
    expect(returnWorkflowValues(null, ret, NOW).buyerUsername).toBe('max_muster_99');
  });

  test('unbekannte Platzhalter bleiben stehen', () => {
    expect(renderReturnWorkflowTemplate('A {{foo}} {{returnId}}', { returnId: '5300000001' })).toBe('A {{foo}} 5300000001');
  });
});

describe('Geschlossen-/Erstattet-Hinweis', () => {
  test.each(['CLOSED', 'REFUNDED'])('%s → Warnzeile ganz oben', (status) => {
    const t = buildReturnWorkflowText(order, { ...ret, status }, DEFAULT_RETURN_WORKFLOW_TEMPLATE, NOW);
    expect(t.split('\n')[0]).toBe('⚠️ Rückgabe bereits erstattet/geschlossen – prüfen');
    expect(t).toContain('# Retoure-Workflow — stele-e-transfer');
  });
  test('OPEN / IN_PROGRESS → kein Hinweis', () => {
    expect(isReturnClosed('OPEN')).toBe(false);
    expect(isReturnClosed('IN_PROGRESS')).toBe(false);
    expect(isReturnClosed(null)).toBe(false);
    expect(isReturnClosed('refunded')).toBe(true);
  });
});

describe('zwei Rücksendungen an einer Bestellung', () => {
  const order2: ReturnWorkflowOrder = {
    ...order,
    lineItems: [
      { title: 'Muster-Katzenspielzeug Feder', sku: 'stele-999-RED', quantity: 1 },
      { title: 'Muster-Kratzbrett', sku: 'stele-998', quantity: 1 },
    ],
  };
  const r1: ReturnWorkflowReturn = { ...ret, returnId: '5300000001', itemTitle: 'Muster-Katzenspielzeug Feder', amount: 9.95, quantity: 1 };
  const r2: ReturnWorkflowReturn = { ...ret, returnId: '5300000002', itemTitle: 'Muster-Kratzbrett', amount: 14.45, status: 'REFUNDED', quantity: 1 };
  const fremd: ReturnWorkflowReturn = { ...ret, returnId: '5300000003', orderId: '02-00000-00000' };

  test('returnsForOrder liefert genau die beiden, ohne Dublette und ohne fremde Bestellung', () => {
    const list = returnsForOrder('01-23456-78901', [r1, fremd, r2, r1]);
    expect(list.map(r => r.returnId)).toEqual(['5300000001', '5300000002']);
    expect(returnsForOrder('', [r1])).toEqual([]);
  });

  test('zwei verschiedene Texte, je Rückgabe der passende Artikel', () => {
    const texts = returnWorkflowTextsForOrder(order2, [r1, fremd, r2], DEFAULT_RETURN_WORKFLOW_TEMPLATE, NOW);
    expect(texts.map(t => t.returnId)).toEqual(['5300000001', '5300000002']);
    expect(texts[0]!.text).not.toBe(texts[1]!.text);
    expect(texts[0]!.text).toContain('- Artikel: Muster-Katzenspielzeug Feder (SKU stele-999-RED) · Menge 1');
    expect(texts[0]!.text).toContain('- Gefordert: 9,95 €');
    expect(texts[0]!.text).not.toContain(RETURN_CLOSED_WARNING);
    expect(texts[1]!.text).toContain('- Artikel: Muster-Kratzbrett (SKU stele-998) · Menge 1');
    expect(texts[1]!.text).toContain('- Gefordert: 14,45 €');
    expect(texts[1]!.text.startsWith(RETURN_CLOSED_WARNING)).toBe(true);
  });

  test('Titel passt zu keiner Position → alle Positionen, Menge summiert', () => {
    const v = returnWorkflowValues(order2, { ...ret, itemTitle: 'anderer Titel', quantity: null }, NOW);
    expect(v.items).toBe('Muster-Katzenspielzeug Feder + Muster-Kratzbrett');
    expect(v.sku).toBe('stele-999-RED, stele-998');
    expect(v.qty).toBe('2');
  });
});
