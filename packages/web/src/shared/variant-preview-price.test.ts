import { describe, expect, test } from 'bun:test';
import { variantPreviewPrice } from './variant-preview-price';
describe('variantPreviewPrice (271: gesendet 18,95, Vorschlag 19,95)', () => {
  test('gesendeter VK gewinnt', () => expect(variantPreviewPrice(18.95, 19.95, 6.09)).toBe(18.95));
  test('ohne gesendeten VK → Vorschlag', () => expect(variantPreviewPrice(undefined, 19.95, 6.09)).toBe(19.95));
  test('nur Ali-Preis', () => expect(variantPreviewPrice(null, undefined, 6.09)).toBe(6.09));
  test('nichts → 0', () => expect(variantPreviewPrice(undefined, undefined, undefined)).toBe(0));
});
