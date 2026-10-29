// OFFEN 013 (stele-220, 28.10.2026): Schutz gegen versehentliches Beenden und Doppel-Listen.
// Fixtures = Live-Stand 28./29.10.2026: altes Angebot 198712713157 (SKU stele-220-GROUP, beendet 21:09),
// neues 198752857838 (Start 21:10:46), AliExpress-Nr 1005012236402215.
import { describe, expect, test } from 'bun:test';
import { aliItemIdFromUrl, endConfirmSteps, findActiveListingConflict, isAlreadyEndedError, productIdFromSku, shouldUnlinkAfterEnd } from './listing-guard';

const ALI_220 = 'https://www.aliexpress.com/item/1005012236402215.html';

describe('6a – Verknüpfung nur nach bestätigtem Ende lösen', () => {
  test('eBay bestätigt (Ack Success) → lösen', () => {
    expect(shouldUnlinkAfterEnd({ ok: true })).toBe(true);
  });
  test('eBay lehnt ab (z. B. warenbestandsbasiertes Angebot) → NICHT lösen', () => {
    expect(shouldUnlinkAfterEnd({ ok: false, error: 'Dieses Angebot wird über die warenbestandsbasierte Angebotsverwaltung verwaltet.' })).toBe(false);
  });
  test('eBay-Fehler ohne Text → NICHT lösen', () => {
    expect(shouldUnlinkAfterEnd({ ok: false })).toBe(false);
  });
  test('Angebot war schon beendet (Fehler 1047) → lösen', () => {
    expect(isAlreadyEndedError('Die Auktion wurde bereits beendet.')).toBe(true);
    expect(isAlreadyEndedError('The auction has already been closed.')).toBe(true);
    expect(shouldUnlinkAfterEnd({ ok: false, error: 'Die Auktion wurde bereits beendet.' })).toBe(true);
  });
});

describe('6b – nicht doppelt listen', () => {
  test('SKU → Produkt-Nr', () => {
    expect(productIdFromSku('stele-220-GROUP')).toBe(220);
    expect(productIdFromSku('stele-220-GRAY')).toBe(220);
    expect(productIdFromSku('stele-220')).toBe(220);
    expect(productIdFromSku('stele-2200-GROUP')).toBe(2200);
    expect(productIdFromSku('fremd-220')).toBeNull();
    expect(aliItemIdFromUrl(ALI_220)).toBe('1005012236402215');
  });

  test('Vorfall 220: aktives Angebot mit SKU stele-220-GROUP, App-Datensatz entknüpft → Konflikt', () => {
    const c = findActiveListingConflict(
      { id: 220, sourceUrl: ALI_220 },
      [{ itemId: '198712713157', sku: 'stele-220-GROUP' }, { itemId: '198724953739', sku: 'stele-224-GROUP' }],
      [{ id: 220, ebayListingId: null, ebayStatus: 'none', sourceUrl: ALI_220 }],
    );
    expect(c?.itemId).toBe('198712713157');
    expect(c?.reason).toBe('gleiche-sku');
    expect(c?.message).toContain('erst verknüpfen');
  });

  test('stele-2200 löst bei stele-220 keinen Konflikt aus', () => {
    expect(findActiveListingConflict({ id: 220, sourceUrl: null }, [{ itemId: '1', sku: 'stele-2200-GROUP' }], [])).toBeNull();
  });

  test('andere App-Nr mit derselben AliExpress-Nr ist aktiv → Konflikt', () => {
    const c = findActiveListingConflict(
      { id: 250, sourceUrl: ALI_220 },
      [{ itemId: '198752857838', sku: 'stele-220-GROUP' }],
      [
        { id: 220, ebayListingId: '198752857838', ebayStatus: 'listed', sourceUrl: ALI_220 },
        { id: 250, ebayListingId: null, ebayStatus: 'none', sourceUrl: ALI_220 },
      ],
    );
    expect(c?.reason).toBe('gleiche-aliexpress-nr');
    expect(c?.otherProductId).toBe(220);
  });

  test('gleiche AliExpress-Nr, aber deren Angebot ist nicht mehr aktiv → kein Konflikt', () => {
    expect(findActiveListingConflict(
      { id: 250, sourceUrl: ALI_220 },
      [{ itemId: '198724953739', sku: 'stele-224-GROUP' }],
      [{ id: 220, ebayListingId: '198712713157', ebayStatus: 'listed', sourceUrl: ALI_220 }],
    )).toBeNull();
  });

  test('nichts aktiv → frei', () => {
    expect(findActiveListingConflict({ id: 220, sourceUrl: ALI_220 }, [], [])).toBeNull();
  });
});

describe('6c – zweite Bestätigung bei Verkäufen/Beobachtern', () => {
  test('altes 220-Angebot (17 verkauft, 15 Beobachter) → zwei Fragen mit Zahlen', () => {
    const s = endConfirmSteps({ itemId: '198712713157', quantitySold: 17, watchCount: 15 });
    expect(s).toHaveLength(2);
    expect(s[1]).toContain('17× verkauft');
    expect(s[1]).toContain('15 Beobachter');
  });
  test('nur Beobachter → zwei Fragen', () => {
    expect(endConfirmSteps({ itemId: '1', quantitySold: 0, watchCount: 3 })).toHaveLength(2);
  });
  test('ohne Verkäufe/Beobachter → eine Frage', () => {
    expect(endConfirmSteps({ itemId: '1', quantitySold: 0, watchCount: 0 })).toHaveLength(1);
    expect(endConfirmSteps({ itemId: '1' })).toHaveLength(1);
  });
});
