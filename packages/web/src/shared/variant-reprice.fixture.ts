// OFFEN 033 Test-Fixture stele-225 (DB-Backup 05.11.2026 23:35), gemeinsam für shared/ und api/ Tests.
import type { RepriceProduct } from './tier-reprice';

export const BLUE = '12000057817791908', BLACK = '12000057817791906', GRAY = '12000057817791907';
export const GROUPS = [{ name: 'Varianten', values: ['BLAU', 'SCHWARZ', 'GRAU'] }];
export const p225 = (over: Partial<RepriceProduct & { targetMarginEur: number | null }> = {}): RepriceProduct & { targetMarginEur: number | null } => ({
  id: 225, targetMarginEur: 1, /* Ziel 1,00 (Backup) */ variants: JSON.stringify(GROUPS), buyPrice: 12.69, sellPrice: 24.45, shipsFrom: 'China', adRate: 0, isElectric: null,
  aliCheckoutFactor: 0.9733, aliCheckoutFactorAt: new Date().toISOString(),   // frisch → Faktor gilt (≤ 14 Tage)
  variantPrices: JSON.stringify([
    { skuId: BLUE, attrs: { 'Color Name': 'Blue' }, price: 13.59, displayValues: { Varianten: 'BLAU' }, ebayPrice: 23.95 },
    { skuId: BLACK, attrs: { 'Color Name': 'black' }, price: 11.99, displayValues: { Varianten: 'SCHWARZ' }, ebayPrice: 21.45 },
    { skuId: GRAY, attrs: { 'Color Name': 'GRAY' }, price: 11.99, displayValues: { Varianten: 'GRAU' }, ebayPrice: 21.45 },
  ]),
  variantSellPrices: JSON.stringify({ [BLUE]: 26.95, [BLACK]: 24.95, [GRAY]: 24.95 }),
  ...over,
});

