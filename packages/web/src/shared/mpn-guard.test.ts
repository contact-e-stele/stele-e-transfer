// P71-B Teil 2, Regel 5: MPN nie AliExpress-Produkt-ID oder Zahl aus sourceUrl.
import { describe, expect, it } from 'bun:test';
import { isForbiddenMpn, safeMpn } from './mpn-guard';

const SOURCE = 'https://www.aliexpress.com/item/1005006123456789.html?spm=a2g0o.productlist.main.1.5b1e';

describe('isForbiddenMpn', () => {
  it('verbietet die AliExpress-Produkt-ID aus der sourceUrl', () => {
    expect(isForbiddenMpn('1005006123456789', SOURCE)).toBe(true);
  });
  it('verbietet einen Wert, der eine Zahl aus der sourceUrl enthält (Präfix/Suffix)', () => {
    expect(isForbiddenMpn('AE-1005006123456789-X', SOURCE)).toBe(true);
  });
  it('verbietet auch ohne sourceUrl jede rein numerische Kette ab 8 Stellen', () => {
    expect(isForbiddenMpn('1005006123456789')).toBe(true);
    expect(isForbiddenMpn('12345678')).toBe(true);
  });
  it('verbietet leeren Wert', () => {
    expect(isForbiddenMpn('   ', SOURCE)).toBe(true);
  });
  it('erlaubt eine echte Herstellernummer', () => {
    expect(isForbiddenMpn('WD-4471B', SOURCE)).toBe(false);
  });
  it('erlaubt kurze Zahl, die nicht in der sourceUrl steht', () => {
    expect(isForbiddenMpn('4471', SOURCE)).toBe(false);
  });
});

describe('safeMpn', () => {
  it('gibt zulässigen MPN getrimmt zurück', () => {
    expect(safeMpn(' WD-4471B ', SOURCE)).toBe('WD-4471B');
  });
  it('gibt undefined für die AliExpress-ID und für undefined', () => {
    expect(safeMpn('1005006123456789', SOURCE)).toBeUndefined();
    expect(safeMpn(undefined, SOURCE)).toBeUndefined();
  });
});
