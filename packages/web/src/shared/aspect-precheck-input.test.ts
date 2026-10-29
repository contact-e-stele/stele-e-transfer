import { describe, expect, test } from 'bun:test';
import { aspectPrecheckInput } from './aspect-precheck-input';

describe('aspectPrecheckInput (eine Stelle für Listen + Knopf)', () => {
  test('stele-247-Form: Achsen, Variantenmerkmale, manuelle Merkmale, Titel', () => {
    const r = aspectPrecheckInput({
      variants: '[{"name":"Color","values":["black","Blue"]},{"name":"Size","values":["M","L","XL"]}]',
      specs: '{"Material":"POLYESTER"}',
      variantPrices: '[{"skuId":"1","attrs":{"Color":"black","Size":"M"}},{"skuId":"2"}]',
      manualAspects: '{"Farbe":"Mehrfarbig"}', title: 'Handschuhe', generatedTitle: null,
    });
    expect(r.variantGroups.map(g => g.name)).toEqual(['Color', 'Size']);
    expect(r.specs).toEqual({ Material: 'POLYESTER' });
    expect(r.variantAttrsList).toEqual([{ Color: 'black', Size: 'M' }, {}]);
    expect(r.manualAspects).toEqual({ Farbe: 'Mehrfarbig' });
    expect(r.titleSources).toEqual(['Handschuhe']);
  });
  test('kaputtes JSON → leer statt Absturz', () => {
    const r = aspectPrecheckInput({ variants: '{', specs: '[', variantPrices: 'x', manualAspects: '{', title: null, generatedTitle: null });
    expect(r).toEqual({ variantGroups: [], specs: {}, variantAttrsList: [], manualAspects: {}, titleSources: [] });
  });
});
