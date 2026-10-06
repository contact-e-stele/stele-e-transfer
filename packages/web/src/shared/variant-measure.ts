// A-045 (Beschreibung v2, Schritt 1) — Maße je Variante: Anzeige nach Regel D2 und Ampel R8. Reine Funktionen (Grundgesetz 2/8), kein DB-/Netz-Zugriff.
// Quelle der Vorgabe: DESIGN-VORGABE v2.1 + Nachtrag D1 + v2.3 Regel D2 (Inhaber "So, ja." 19:28).
//
// Anzeige (D2): Zahl zuerst, immer cm, deutsches Dezimalkomma:
//   D (Durchmesser)   → "Ø 40 cm"
//   L (Länge)         → "L 150 cm"
//   BTH (B × T × H)   → "30 × 20 × 15 cm"
//   STRETCH (dehnbar) → "↔ 10 – 37 cm"
//   MIXED (gemischt)  → "Ø 10 / 15 / 20 cm"
// Zoll → cm: 1 Zoll = 2,54 cm, Ergebnis auf 1 Nachkommastelle (inchesToCm), die Variante bekommt converted = true.

export const MEASURE_KINDS = ['D', 'L', 'BTH', 'STRETCH', 'MIXED'] as const;
export type MeasureKind = typeof MEASURE_KINDS[number];
export const MEASURE_SOURCES = ['a', 'b', 'c', 'd'] as const;
export type MeasureSource = typeof MEASURE_SOURCES[number];

export interface VariantMeasure {
  kind: MeasureKind;
  values: number[];        // cm
  text?: string;
  converted?: boolean;     // true = aus Zoll umgerechnet
  source: MeasureSource;   // a–d
  location: string;        // Fundstelle, z. B. "Galeriebild 4"
}
export interface VariantDetail {
  displayNameDe: string;
  pieces: number;
  measure?: VariantMeasure | null;
}
export type VariantDetails = Record<string, VariantDetail>;

/** Anzahl Werte je Maß-Art: [min, max]. */
export const MEASURE_VALUE_COUNT: Record<MeasureKind, [number, number]> = {
  D: [1, 1], L: [1, 1], BTH: [3, 3], STRETCH: [2, 2], MIXED: [2, 12],
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** 1 Zoll = 2,54 cm, auf 1 Nachkommastelle gerundet. */
export function inchesToCm(inches: number): number {
  return round1(inches * 2.54);
}

/** Deutsche Zahl: ganze Zahl ohne Nachkommastelle, sonst Dezimalkomma ("25,4"). */
function num(n: number): string {
  const r = round1(n);
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',');
}

/** Anzeige nach D2. Ungültige/leere Werte → null (der Aufrufer zeigt dann "kein Maß gefunden"). */
export function formatMeasure(measure: Pick<VariantMeasure, 'kind' | 'values'> | null | undefined): string | null {
  if (!measure || !Array.isArray(measure.values) || measure.values.length === 0) return null;
  if (!measure.values.every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null;
  const v = measure.values;
  switch (measure.kind) {
    case 'D': return `Ø ${num(v[0])} cm`;
    case 'L': return `L ${num(v[0])} cm`;
    case 'BTH': return v.length === 3 ? `${num(v[0])} × ${num(v[1])} × ${num(v[2])} cm` : null;
    case 'STRETCH': return v.length === 2 ? `↔ ${num(v[0])} – ${num(v[1])} cm` : null;
    case 'MIXED': return v.length >= 2 ? `Ø ${v.map(num).join(' / ')} cm` : null;
    default: return null;
  }
}

export type MeasureAmpelStatus = 'GRUEN' | 'GELB';
export interface MeasureAmpelMissing { skuId: string; reason: string }
export interface MeasureAmpel { status: MeasureAmpelStatus; missing: MeasureAmpelMissing[] }

const hasValidValues = (m: VariantMeasure): boolean => formatMeasure(m) !== null;

/**
 * Ampel R8: GRÜN nur, wenn JEDE Variante ein Maß mit Quelle a–d UND Fundstelle hat; sonst GELB mit Grund je Variante.
 * "S/M/L" ohne cm ist KEIN Maß (keine gültigen Werte). Quelle d gilt nur, wenn der Buchstabe genau so in der
 * Variantenauswahl steht (opts.letterInSelection[skuId] === true). Ohne Varianten (skuIds leer) → GELB (nichts geprüft).
 */
export function measureAmpel(
  variantDetails: VariantDetails | null | undefined,
  skuIds: string[],
  opts: { letterInSelection?: Record<string, boolean> } = {},
): MeasureAmpel {
  const missing: MeasureAmpelMissing[] = [];
  if (skuIds.length === 0) return { status: 'GELB', missing: [{ skuId: '(keine Variante)', reason: 'keine Variante vorhanden' }] };
  for (const skuId of skuIds) {
    const m = variantDetails?.[skuId]?.measure;
    if (!m || !hasValidValues(m)) { missing.push({ skuId, reason: 'kein Maß gefunden' }); continue; }
    if (!MEASURE_SOURCES.includes(m.source)) { missing.push({ skuId, reason: 'Quelle fehlt (a–d)' }); continue; }
    if (!m.location || !m.location.trim()) { missing.push({ skuId, reason: 'Fundstelle fehlt' }); continue; }
    if (m.source === 'd' && opts.letterInSelection?.[skuId] !== true) { missing.push({ skuId, reason: 'Quelle d: Buchstabe steht nicht genau so in der Variantenauswahl' }); continue; }
  }
  return { status: missing.length === 0 ? 'GRUEN' : 'GELB', missing };
}
