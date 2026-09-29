// P71-B Teil 2: der Trockenlauf liefert die echten Trefferzahlen vorher/nachher (Vorschau im Listings-Tab).
import { describe, expect, test } from 'bun:test';
import { refreshOneProductDescription, type DescriptionRefreshDeps, type DescriptionRefreshProduct } from './description-refresh';

const STALE = `<div>
<img src="https://ae01.alicdn.com/kf/a.jpg"><img src="https://ae01.alicdn.com/kf/b.jpg">
<p>contact@stele-e-transfer.com</p><p>contact@stele-e-transfer.com</p>
<p>Lieferzeit 7 Tage</p>
</div>`;

const product: DescriptionRefreshProduct = {
  id: 7,
  ebayListingId: 'ITEM-7',
  title: 'Frischhaltedose Edelstahl 3er Set',
  generatedTitle: 'Frischhaltedose Edelstahl 3er Set',
  description: null,
  generatedDescription: '###INTRO### Praktisches Set für Küche und Aufbewahrung.###BULLETS### - Auslaufsicher\n- Spülmaschinenfest###OUTRO### Ideal für Meal Prep.',
  specs: JSON.stringify({ Material: 'Edelstahl' }),
  variants: null,
  variantContents: null,
  variantPrices: null,
  bullets: JSON.stringify([]),
  images: JSON.stringify(['https://ae01.alicdn.com/kf/example.jpg']),
  htmlDescription: STALE,
} as DescriptionRefreshProduct;

function deps(p: DescriptionRefreshProduct): DescriptionRefreshDeps & { sent: number } {
  const d = {
    sent: 0,
    getProduct: async () => p,
    reviseListingContent: async () => { d.sent++; return { ok: true }; },
    updateProductDescription: async () => {},
  };
  return d;
}

describe('refreshOneProductDescription — Trockenlauf mit Trefferzahlen', () => {
  test('summaryBefore zählt echt (2 gleiche Mails = 2, 2 alicdn-Bilder, 1 Versandangabe), summaryAfter ist 0; nichts gesendet', async () => {
    const d = deps(product);
    const r = await refreshOneProductDescription(7, {}, d);
    if (!r.ok || !r.dryRun) throw new Error('Trockenlauf erwartet');
    expect(r.summaryBefore.email).toBe(2);
    expect(r.summaryBefore.alicdn).toBe(2);
    expect(r.summaryBefore.shipping).toBe(1);
    expect(r.summaryBefore.hosts).toEqual([{ host: 'ae01.alicdn.com', count: 2 }]);
    expect(r.summaryAfter.total).toBe(0);
    expect(r.changed).toBe(true);
    expect(d.sent).toBe(0);
  });

  test('Verstoß im Titel (Versandangabe) → 422, summaryAfter zählt ihn, nichts gesendet', async () => {
    const d = deps({ ...product, generatedTitle: 'Dose Kostenloser Versand' });
    const r = await refreshOneProductDescription(7, { confirm: true }, d);
    if (r.ok) throw new Error('422 erwartet');
    expect(r.httpStatus).toBe(422);
    // 2 = Titel selbst + die Beschreibungs-Überschrift, die der Generator aus generatedTitle baut
    expect(r.summaryAfter?.shipping).toBe(2);
    expect(d.sent).toBe(0);
  });
});
