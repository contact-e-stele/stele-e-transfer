// A-045 — Validierung der Produktdaten für die Beschreibung v2 (PATCH /products/:id). Rein, testbar; die Route ruft nur diese Funktion.
// Ungültig → { ok:false, error } mit Klartext (die Route antwortet 400). Gespeichert werden JSON-Texte (variantDetails, materialSource).
import { MEASURE_KINDS, MEASURE_SOURCES, MEASURE_VALUE_COUNT, type MeasureKind, type MeasureSource, type VariantDetails } from './variant-measure';

export const PRODUCT_DATA_MAX = { material: 200, usageNote: 200, usePurpose: 300, displayNameDe: 120, location: 200, text: 200, skuId: 120, variants: 200, pieces: 9999 } as const;
export const PRODUCT_DATA_KEYS = ['material', 'usageNote', 'usePurpose', 'variantDetails', 'materialSource'] as const;
export type ProductDataPatchFields = Partial<Record<typeof PRODUCT_DATA_KEYS[number], string | null>>;
type R = { ok: true; fields: ProductDataPatchFields } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseMeasure(skuId: string, m: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const at = `variantDetails["${skuId}"].measure`;
  if (m === null || m === undefined) return { ok: true, value: null };
  if (!isObj(m)) return { ok: false, error: `${at} muss ein Objekt oder null sein` };
  if (!MEASURE_KINDS.includes(m.kind as MeasureKind)) return { ok: false, error: `${at}.kind muss einer von ${MEASURE_KINDS.join(', ')} sein` };
  const kind = m.kind as MeasureKind;
  if (!Array.isArray(m.values) || !m.values.every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) return { ok: false, error: `${at}.values muss eine Liste von Zahlen größer 0 sein (cm)` };
  const [min, max] = MEASURE_VALUE_COUNT[kind];
  if (m.values.length < min || m.values.length > max) return { ok: false, error: `${at}.values: Art ${kind} braucht ${min === max ? min : `${min}–${max}`} Wert(e), erhalten ${m.values.length}` };
  if (kind === 'STRETCH' && (m.values as number[])[0] > (m.values as number[])[1]) return { ok: false, error: `${at}.values: bei STRETCH muss der erste Wert kleiner oder gleich dem zweiten sein` };
  if (!MEASURE_SOURCES.includes(m.source as MeasureSource)) return { ok: false, error: `${at}.source muss a, b, c oder d sein` };
  if (typeof m.location !== 'string' || !m.location.trim()) return { ok: false, error: `${at}.location (Fundstelle) ist Pflicht` };
  if (m.location.trim().length > PRODUCT_DATA_MAX.location) return { ok: false, error: `${at}.location ist zu lang (max. ${PRODUCT_DATA_MAX.location} Zeichen)` };
  if (m.text !== undefined && m.text !== null && (typeof m.text !== 'string' || m.text.length > PRODUCT_DATA_MAX.text)) return { ok: false, error: `${at}.text muss ein Text sein (max. ${PRODUCT_DATA_MAX.text} Zeichen)` };
  if (m.converted !== undefined && typeof m.converted !== 'boolean') return { ok: false, error: `${at}.converted muss true oder false sein` };
  return { ok: true, value: { kind, values: m.values, ...(m.text ? { text: m.text } : {}), ...(m.converted ? { converted: true } : {}), source: m.source, location: m.location.trim() } };
}

export function parseProductDataPatch(body: Record<string, unknown>): R {
  const fields: ProductDataPatchFields = {};
  for (const key of ['material', 'usageNote', 'usePurpose'] as const) {
    if (!(key in body)) continue;
    const v = body[key];
    if (v != null && typeof v !== 'string') return { ok: false, error: `"${key}" muss ein Text oder null sein` };
    const t = typeof v === 'string' ? v.trim() : '';
    if (t.length > PRODUCT_DATA_MAX[key]) return { ok: false, error: `"${key}" ist zu lang (max. ${PRODUCT_DATA_MAX[key]} Zeichen)` };
    fields[key] = t || null;
  }
  if ('materialSource' in body) {
    const v = body.materialSource;
    if (v == null) fields.materialSource = null;
    else {
      if (!isObj(v)) return { ok: false, error: '"materialSource" muss ein Objekt {source, location} oder null sein' };
      if (!MEASURE_SOURCES.includes(v.source as MeasureSource)) return { ok: false, error: '"materialSource.source" muss a, b, c oder d sein' };
      if (typeof v.location !== 'string' || !v.location.trim()) return { ok: false, error: '"materialSource.location" (Fundstelle) ist Pflicht' };
      if (v.location.trim().length > PRODUCT_DATA_MAX.location) return { ok: false, error: `"materialSource.location" ist zu lang (max. ${PRODUCT_DATA_MAX.location} Zeichen)` };
      fields.materialSource = JSON.stringify({ source: v.source, location: v.location.trim() });
    }
  }
  if ('variantDetails' in body) {
    const v = body.variantDetails;
    if (v == null) fields.variantDetails = null;
    else {
      if (!isObj(v)) return { ok: false, error: '"variantDetails" muss ein Objekt {skuId: {...}} oder null sein' };
      const keys = Object.keys(v);
      if (keys.length > PRODUCT_DATA_MAX.variants) return { ok: false, error: `"variantDetails" hat zu viele Varianten (max. ${PRODUCT_DATA_MAX.variants})` };
      const out: Record<string, unknown> = {};
      for (const skuId of keys) {
        if (!skuId.trim() || skuId.length > PRODUCT_DATA_MAX.skuId) return { ok: false, error: `variantDetails: ungültige skuId "${skuId.slice(0, 40)}"` };
        const d = v[skuId];
        if (!isObj(d)) return { ok: false, error: `variantDetails["${skuId}"] muss ein Objekt sein` };
        if (typeof d.displayNameDe !== 'string' || !d.displayNameDe.trim()) return { ok: false, error: `variantDetails["${skuId}"].displayNameDe (deutscher Anzeigename) ist Pflicht` };
        if (d.displayNameDe.trim().length > PRODUCT_DATA_MAX.displayNameDe) return { ok: false, error: `variantDetails["${skuId}"].displayNameDe ist zu lang (max. ${PRODUCT_DATA_MAX.displayNameDe} Zeichen)` };
        if (typeof d.pieces !== 'number' || !Number.isInteger(d.pieces) || d.pieces < 1 || d.pieces > PRODUCT_DATA_MAX.pieces) return { ok: false, error: `variantDetails["${skuId}"].pieces muss eine ganze Zahl von 1 bis ${PRODUCT_DATA_MAX.pieces} sein` };
        const mm = parseMeasure(skuId, d.measure);
        if (!mm.ok) return mm;
        out[skuId] = { displayNameDe: d.displayNameDe.trim(), pieces: d.pieces, ...(mm.value ? { measure: mm.value } : {}) };
      }
      fields.variantDetails = Object.keys(out).length > 0 ? JSON.stringify(out as VariantDetails) : null;
    }
  }
  return { ok: true, fields };
}

/** Liest gespeichertes variant_details tolerant (kaputtes JSON → null, kein Absturz). */
export function readVariantDetails(json: string | null | undefined): VariantDetails | null {
  if (!json) return null;
  try { const v = JSON.parse(json); return isObj(v) ? (v as VariantDetails) : null; } catch { return null; }
}
