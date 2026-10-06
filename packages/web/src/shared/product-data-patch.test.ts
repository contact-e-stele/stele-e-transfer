import { describe, expect, test } from 'bun:test';
import { parseProductDataPatch, readVariantDetails } from './product-data-patch';

const okMeasure = { kind: 'STRETCH', values: [10, 37], source: 'c', location: 'Galeriebild 4' };
const variants = (over: Record<string, unknown> = {}) => ({ 'stele-127-A': { displayNameDe: 'Dehnbar', pieces: 2, measure: okMeasure, ...over } });
const fail = (body: Record<string, unknown>) => { const r = parseProductDataPatch(body); expect(r.ok).toBe(false); return (r as { ok: false; error: string }).error; };

describe('parseProductDataPatch (A-045)', () => {
  test('Texte werden getrimmt; leer/null → null; unbekannte Felder werden ignoriert', () => {
    const r = parseProductDataPatch({ material: '  Silikon ', usageNote: '', usePurpose: null, irgendwas: 1 });
    expect(r).toEqual({ ok: true, fields: { material: 'Silikon', usageNote: null, usePurpose: null } });
  });
  test('Länge: Material über 200 Zeichen → 400-Text', () => {
    expect(fail({ material: 'x'.repeat(201) })).toContain('zu lang');
  });
  test('gültige Varianten-Details werden als JSON gespeichert (v2.3-Beispiel stele-127)', () => {
    const r = parseProductDataPatch({ variantDetails: variants() });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.fields.variantDetails!)).toEqual({ 'stele-127-A': { displayNameDe: 'Dehnbar', pieces: 2, measure: okMeasure } });
  });
  test('Quelle nur a–d', () => {
    expect(fail({ variantDetails: variants({ measure: { ...okMeasure, source: 'e' } }) })).toContain('a, b, c oder d');
    expect(fail({ materialSource: { source: 'z', location: 'x' } })).toContain('a, b, c oder d');
  });
  test('Fundstelle ist Pflicht (auch nur Leerzeichen)', () => {
    expect(fail({ variantDetails: variants({ measure: { ...okMeasure, location: '  ' } }) })).toContain('Fundstelle');
    expect(fail({ materialSource: { source: 'a', location: '' } })).toContain('Fundstelle');
  });
  test('Werte größer 0 und passende Anzahl je Art', () => {
    expect(fail({ variantDetails: variants({ measure: { ...okMeasure, values: [0, 5] } }) })).toContain('größer 0');
    expect(fail({ variantDetails: variants({ measure: { ...okMeasure, values: [-1, 5] } }) })).toContain('größer 0');
    expect(fail({ variantDetails: variants({ measure: { ...okMeasure, kind: 'BTH', values: [30, 20] } }) })).toContain('braucht 3');
    expect(fail({ variantDetails: variants({ measure: { ...okMeasure, values: [37, 10] } }) })).toContain('STRETCH');
  });
  test('Stückzahl ganze Zahl ≥ 1, Anzeigename Pflicht, Art bekannt', () => {
    expect(fail({ variantDetails: variants({ pieces: 0 }) })).toContain('pieces');
    expect(fail({ variantDetails: variants({ pieces: 1.5 }) })).toContain('pieces');
    expect(fail({ variantDetails: variants({ displayNameDe: '' }) })).toContain('displayNameDe');
    expect(fail({ variantDetails: variants({ measure: { ...okMeasure, kind: 'X' } }) })).toContain('kind');
  });
  test('null löscht; leeres Objekt → null; Variante ohne Maß ist erlaubt (Ampel zeigt GELB)', () => {
    expect(parseProductDataPatch({ variantDetails: null, materialSource: null })).toEqual({ ok: true, fields: { variantDetails: null, materialSource: null } });
    expect(parseProductDataPatch({ variantDetails: {} })).toEqual({ ok: true, fields: { variantDetails: null } });
    const r = parseProductDataPatch({ variantDetails: { s1: { displayNameDe: 'Gross', pieces: 1 } } });
    expect(r.ok).toBe(true);
  });
  test('Zoll-Flag und Text werden übernommen, converted nur wenn true', () => {
    const r = parseProductDataPatch({ variantDetails: variants({ measure: { kind: 'D', values: [25.4], source: 'a', location: 'Titel', converted: true, text: '10 Zoll' } }) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.fields.variantDetails!)['stele-127-A'].measure).toEqual({ kind: 'D', values: [25.4], text: '10 Zoll', converted: true, source: 'a', location: 'Titel' });
  });
});

describe('readVariantDetails', () => {
  test('kaputtes JSON / Array / leer → null (kein Absturz)', () => {
    expect(readVariantDetails('{kaputt')).toBeNull();
    expect(readVariantDetails('[1,2]')).toBeNull();
    expect(readVariantDetails(null)).toBeNull();
    expect(readVariantDetails('{"a":{"displayNameDe":"x","pieces":1}}')).toEqual({ a: { displayNameDe: 'x', pieces: 1 } });
  });
});
