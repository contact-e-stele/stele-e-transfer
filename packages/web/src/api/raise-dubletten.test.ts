import { expect, test } from 'bun:test';
import { planVariantDedupe } from '../shared/variant-dedupe';
import { resolveVariantEntries } from '../shared/variant-resolver';
import { planVariantRaises } from './variant-raise';

// Live-Fund 24.10.2026 (Render-Log 189/229): Dubletten blockierten die Anhebung. maybeRaiseVariants fasst jetzt im Speicher zusammen
// (planVariantDedupe, höchster EK). Echte Werte stele-119 (App 22.10.2026): zweimal "100pcs" (EK 3,25 Lager 6 / EK 4,09 Lager 1992).
const groups = [{ name: 'Varianten ', values: ['200pcs', '100pcs'] }];
const entries = [
  { skuId: '12000050569622128', attrs: { Color: '200pcs', 'Ships From': 'China Mainland' }, price: 5.59, stock: 1954 },
  { skuId: '12000050569622130', attrs: { Color: '100pcs', 'Ships From': 'China Mainland' }, price: 3.25, stock: 6 },
  { skuId: '12000050569622129', attrs: { Color: '100pcs', 'Ships From': 'China Mainland' }, price: 4.09, stock: 1992 },
];

test('ohne Zusammenfassen: Zuordnung mehrdeutig (so blockierte es live)', () => {
  expect(resolveVariantEntries(119, groups, entries).some(r => r.error?.startsWith('Mehrdeutig'))).toBe(true);
});

test('zusammengefasst: eindeutig, 100pcs rechnet mit dem höchsten EK 4,09', () => {
  const d = planVariantDedupe(groups, entries);
  expect(d.ambiguous).toHaveLength(0);
  expect(resolveVariantEntries(119, groups, d.newEntries).some(r => r.error)).toBe(false);
  const e100 = d.newEntries.find(e => e.attrs?.Color === '100pcs');
  expect(e100?.price).toBe(4.09);
  const product = { id: 119, title: 'x', sellPrice: 14.95, buyPrice: 3.25, adRate: 0, shipsFrom: 'China', targetMarginEur: 1.5,
    aliCheckoutFactor: null, aliCheckoutFactorAt: null, ebayStatus: 'listed', ebayListingId: '198601077240',
    variants: JSON.stringify(groups), variantPrices: JSON.stringify(d.newEntries), variantSellPrices: null };
  const raises = planVariantRaises(product as never);
  expect(raises.length).toBeGreaterThan(0);
  expect(new Set(raises.map(r => r.skuId)).size).toBe(raises.length); // je eBay-Variante höchstens eine Anhebung
});
