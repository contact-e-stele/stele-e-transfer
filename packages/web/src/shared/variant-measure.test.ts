import { describe, expect, test } from 'bun:test';
import { formatMeasure, inchesToCm, measureAmpel, type VariantDetails, type VariantMeasure } from './variant-measure';

const m = (over: Partial<VariantMeasure>): VariantMeasure => ({ kind: 'D', values: [40], source: 'a', location: 'Titel', ...over });
const detail = (measure: VariantMeasure | null) => ({ displayNameDe: 'Variante', pieces: 1, measure });

describe('formatMeasure (Regel D2)', () => {
  test('echte Beispiele aus v2.3: stele-127 "↔ 10 – 37 cm" (Quelle c, Galeriebild 4), stele-119 "↔ 14 – 29 cm" (Quelle c, Beschreibungsbild 3)', () => {
    expect(formatMeasure({ kind: 'STRETCH', values: [10, 37] })).toBe('↔ 10 – 37 cm');
    expect(formatMeasure({ kind: 'STRETCH', values: [14, 29] })).toBe('↔ 14 – 29 cm');
  });
  test('Aufbau-Beispiele (erfunden, nur Formatierung): Ø, L, Kasten, gemischt', () => {
    expect(formatMeasure({ kind: 'D', values: [40] })).toBe('Ø 40 cm');
    expect(formatMeasure({ kind: 'L', values: [150] })).toBe('L 150 cm');
    expect(formatMeasure({ kind: 'BTH', values: [30, 20, 15] })).toBe('30 × 20 × 15 cm');
    expect(formatMeasure({ kind: 'MIXED', values: [10, 15, 20] })).toBe('Ø 10 / 15 / 20 cm');
  });
  test('Dezimalstellen mit deutschem Komma, ganze Zahlen ohne ",0"', () => {
    expect(formatMeasure({ kind: 'D', values: [25.4] })).toBe('Ø 25,4 cm');
    expect(formatMeasure({ kind: 'L', values: [30.0] })).toBe('L 30 cm');
  });
  test('ungültig → null (kein Raten): leer, 0, negativ, falsche Anzahl, S/M/L ohne cm', () => {
    expect(formatMeasure(null)).toBeNull();
    expect(formatMeasure({ kind: 'D', values: [] })).toBeNull();
    expect(formatMeasure({ kind: 'D', values: [0] })).toBeNull();
    expect(formatMeasure({ kind: 'L', values: [-5] })).toBeNull();
    expect(formatMeasure({ kind: 'BTH', values: [30, 20] })).toBeNull();
    expect(formatMeasure({ kind: 'STRETCH', values: [10] })).toBeNull();
    expect(formatMeasure({ kind: 'MIXED', values: [10] })).toBeNull();
  });
});

describe('inchesToCm (1 Zoll = 2,54 cm, 1 Nachkommastelle) — Werte mit bun nachgerechnet', () => {
  test('16 Zoll = 40,64 → 40,6; 10 Zoll = 25,4; 1,5 Zoll = 3,81 → 3,8; 12 Zoll = 30,48 → 30,5; 5 Zoll = 12,7', () => {
    expect(inchesToCm(16)).toBe(40.6);
    expect(inchesToCm(10)).toBe(25.4);
    expect(inchesToCm(1.5)).toBe(3.8);
    expect(inchesToCm(12)).toBe(30.5);
    expect(inchesToCm(5)).toBe(12.7);
  });
  test('umgerechnetes Maß wird als cm angezeigt', () => {
    expect(formatMeasure({ kind: 'D', values: [inchesToCm(10)] })).toBe('Ø 25,4 cm');
  });
});

describe('measureAmpel (R8)', () => {
  const full: VariantDetails = {
    'stele-127-A': detail(m({ kind: 'STRETCH', values: [10, 37], source: 'c', location: 'Galeriebild 4' })),
    'stele-127-B': detail(m({ kind: 'D', values: [40], source: 'a', location: 'Titel' })),
  };
  test('GRÜN nur, wenn JEDE Variante Maß + Quelle a–d + Fundstelle hat', () => {
    expect(measureAmpel(full, ['stele-127-A', 'stele-127-B'])).toEqual({ status: 'GRUEN', missing: [] });
  });
  test('eine Variante ohne Eintrag → GELB "kein Maß gefunden" je Variante', () => {
    const r = measureAmpel(full, ['stele-127-A', 'stele-127-B', 'stele-127-C']);
    expect(r.status).toBe('GELB');
    expect(r.missing).toEqual([{ skuId: 'stele-127-C', reason: 'kein Maß gefunden' }]);
  });
  test('S/M/L ohne cm ist KEIN Maß (keine Werte) → GELB', () => {
    const d: VariantDetails = { x: detail(m({ kind: 'D', values: [], text: 'S/M/L' })) };
    expect(measureAmpel(d, ['x']).missing).toEqual([{ skuId: 'x', reason: 'kein Maß gefunden' }]);
  });
  test('Fundstelle leer/nur Leerzeichen → GELB; Quelle ungültig → GELB', () => {
    expect(measureAmpel({ x: detail(m({ location: '   ' })) }, ['x']).missing[0].reason).toBe('Fundstelle fehlt');
    expect(measureAmpel({ x: detail(m({ source: 'e' as never })) }, ['x']).missing[0].reason).toBe('Quelle fehlt (a–d)');
  });
  test('Quelle d nur mit Flag "Buchstabe steht genau so in der Variantenauswahl"', () => {
    const d: VariantDetails = { x: detail(m({ source: 'd', location: 'Variantenauswahl L' })) };
    expect(measureAmpel(d, ['x']).status).toBe('GELB');
    expect(measureAmpel(d, ['x'], { letterInSelection: { x: false } }).status).toBe('GELB');
    expect(measureAmpel(d, ['x'], { letterInSelection: { x: true } }).status).toBe('GRUEN');
  });
  test('keine Variante / kein variantDetails → GELB (nichts geprüft)', () => {
    expect(measureAmpel(null, []).status).toBe('GELB');
    expect(measureAmpel(null, ['x']).status).toBe('GELB');
  });
});
