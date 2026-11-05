// OFFEN 030 (04.11.2026, PRIO 1) + Inhaber-Entscheidung 17:45: Herkunft ("Versand aus") je Angebot → Lieferzeit.
//
// Quelle: das vorhandene Feld products.shipsFrom (Import) und das Varianten-Merkmal "Ships From"/"Versandort"
// (dieselben Schlüssel wie pricing.ts isChinaOriginForVariant, Grundgesetz 8). Keine zweite Quelle, keine Migration.
//
// Regeln:
//  - Ein Angebot hat genau EINE Herkunft (Gesetzbuch Nr 114). Mischen Varianten China und EU → "mixed" → Listen gesperrt.
//  - Lieferzeit: China 7–12 Werktage (Inhaber 09:00). EU/Deutschland nur mit einem in den Einstellungen hinterlegten Wert —
//    sonst null (neutraler Satz). Nie eine geratene Zahl (Grundgesetz 3/4, Inhaber 17:45).
//  - Unbekannte Herkunft ist hier NICHT China (anders als die Preisformel, die vorsichtig wie China rechnet): für die
//    Anzeige gilt "unbekannt" → neutraler Satz.

import { isEuShipFrom } from './ali-search';

export type OriginKind = 'CN' | 'DE' | 'EU' | 'OTHER' | 'UNKNOWN';

export interface OriginInfo { kind: OriginKind; label: string }

const SHIP_KEYS = ['Ships From', 'Ship From', 'ShipFrom', 'ship_from', 'ships from', 'Versandort', 'Versand aus'];

export function classifyOrigin(raw: string | null | undefined): OriginInfo {
  const v = (raw ?? '').trim();
  const s = v.toLowerCase();
  if (!s || s === 'unknown' || s === 'unbekannt' || s === '?') return { kind: 'UNKNOWN', label: '' };
  if (s.includes('china') || s === 'cn') return { kind: 'CN', label: 'China' };
  if (s === 'de' || s.includes('germany') || s.includes('deutschland')) return { kind: 'DE', label: 'Deutschland' };
  if (isEuShipFrom(v)) return { kind: 'EU', label: v };
  return { kind: 'OTHER', label: v };
}

export interface ListingOrigin {
  kind: OriginKind;           // einheitliche Herkunft des Angebots (UNKNOWN wenn nicht bestimmbar)
  label: string;
  mixed: boolean;             // Varianten aus verschiedenen Ländern → nicht listbar
  perVariant: OriginInfo[];   // je Variante (leer bei Einzelartikel)
}

/** Herkunft des Angebots aus Produkt-Herkunft + Varianten-Merkmal "Ships From". */
export function listingOrigin(productShipsFrom: string | null | undefined, variantAttrs: Array<Record<string, string> | null | undefined>): ListingOrigin {
  const product = classifyOrigin(productShipsFrom);
  const perVariant = variantAttrs.map(attrs => {
    const own = attrs ? SHIP_KEYS.map(k => attrs[k]).find(x => typeof x === 'string' && x.trim()) : undefined;
    return own ? classifyOrigin(own) : product;
  });
  const all = perVariant.length > 0 ? perVariant : [product];
  const keys = new Set(all.map(o => o.kind === 'EU' || o.kind === 'OTHER' ? `${o.kind}:${o.label.toLowerCase()}` : o.kind));
  if (keys.size > 1) return { kind: 'UNKNOWN', label: '', mixed: true, perVariant };
  return { kind: all[0].kind, label: all[0].label, mixed: false, perVariant };
}

/** Lieferzeiten je Herkunft (app_settings "delivery_times"). Nur CN hat einen festen Startwert (Inhaber 09:00). */
export interface DeliveryTimes { CN?: string; DE?: string; EU?: string }
export const DEFAULT_DELIVERY_TIMES: DeliveryTimes = { CN: '7–12 Werktage' };

export function parseDeliveryTimes(raw: string | null | undefined): DeliveryTimes {
  try {
    const j = raw ? JSON.parse(raw) : {};
    const pick = (x: unknown) => (typeof x === 'string' && /\d/.test(x) && x.trim().length <= 40 ? x.trim() : undefined);
    return { ...DEFAULT_DELIVERY_TIMES, ...(pick(j.CN) ? { CN: pick(j.CN) } : {}), ...(pick(j.DE) ? { DE: pick(j.DE) } : {}), ...(pick(j.EU) ? { EU: pick(j.EU) } : {}) };
  } catch {
    return { ...DEFAULT_DELIVERY_TIMES };
  }
}

/** Lieferzeit-Text für das Angebot oder null (→ neutraler Satz in der Fußzeile). */
export function deliveryTimeFor(origin: ListingOrigin, times: DeliveryTimes = DEFAULT_DELIVERY_TIMES): string | null {
  if (origin.mixed) return null;
  if (origin.kind === 'CN') return times.CN ?? null;
  if (origin.kind === 'DE') return times.DE ?? null;
  if (origin.kind === 'EU') return times.EU ?? null;
  return null;
}

/** Sperrtext beim Listen, wenn ein Angebot Varianten aus verschiedenen Ländern mischt (OFFEN 030 Punkt 1c). */
export function mixedOriginError(origin: ListingOrigin): string | null {
  if (!origin.mixed) return null;
  const list = [...new Set(origin.perVariant.map(o => o.label || 'unbekannt'))].join(', ');
  return `Varianten mit unterschiedlicher Herkunft in einem Angebot (${list}) — ein Angebot darf nur einen Versandort haben. Bitte aufteilen oder Varianten abwählen.`;
}
