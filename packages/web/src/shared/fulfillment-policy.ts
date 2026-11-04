// OFFEN 030 – Versandrichtlinien je Herkunft (EINE Stelle für Namen, Lesen und Anlegen; Grundgesetz 8).
//
// ENTSCHEIDUNG Inhaber 04.11.2026 21:56:
//  - Weg B: die App legt die 2 Richtlinien "Versand aus China" und "Versand aus EU-Lager" per Knopf an (Account API).
//  - C: China-Versandservice = "Standardversand aus dem Ausland" (DE_StandardversandAusDemAusland, eBay: 4–10 Werktage).
//  - Bearbeitungszeit wird erst nach Gegencheck der Agenten eingetragen → hier KEIN Standardwert. Ohne Wert kein Anlegen.
// EU-Versandservice ist NICHT entschieden → muss beim Anlegen ausdrücklich gewählt werden (kein Standard).
//
// Quelle Codes/Laufzeiten/erlaubte Bearbeitungszeiten: eBay Seller Hub › Rahmenbedingungen › Versand › Dialog
// "Ersten Versandservice hinzufügen", live gelesen 04.11.2026 (ERGEBNIS 030 Teil 2, Punkt 4).

export const POLICY_NAME_CN = 'Versand aus China';
export const POLICY_NAME_EU = 'Versand aus EU-Lager';

export type PolicyOrigin = 'CN' | 'EU';

/** Bearbeitungszeiten, die das eBay-Formular anbietet (Tage). */
export const ALLOWED_HANDLING_DAYS = [0, 1, 2, 3, 4, 5, 6, 7, 10, 15, 20, 30, 40] as const;

export interface ShippingServiceOption { code: string; label: string; transit: string }

/** China: nur der entschiedene Service (Inhaber 21:56, C). */
export const CN_SERVICES: ShippingServiceOption[] = [
  { code: 'DE_StandardversandAusDemAusland', label: 'Standardversand aus dem Ausland', transit: '4–10 Werktage' },
];

/** EU-Lager: Kandidaten aus der VORLAGE — Auswahl durch den Inhaber, kein Standard. */
export const EU_SERVICES: ShippingServiceOption[] = [
  { code: 'DE_TrackedDeliveryFromAbroad', label: 'Versand mit Nachverfolgung aus dem Ausland', transit: '2–5 Werktage' },
  { code: 'DE_TrakPakFromAbroad', label: 'TrakPak aus dem Ausland', transit: '5–8 Werktage' },
  { code: 'DE_StandardversandAusDemAusland', label: 'Standardversand aus dem Ausland', transit: '4–10 Werktage' },
];

export function policyName(origin: PolicyOrigin): string {
  return origin === 'CN' ? POLICY_NAME_CN : POLICY_NAME_EU;
}

export function servicesFor(origin: PolicyOrigin): ShippingServiceOption[] {
  return origin === 'CN' ? CN_SERVICES : EU_SERVICES;
}

// ─── Lesen ───────────────────────────────────────────────────────────────────

export interface FulfillmentPolicyInfo {
  id: string;
  name: string;
  handlingDays: number | null;
  services: string[];        // shippingServiceCode je Service
  freeShipping: boolean;     // alle Services kostenlos
}

/** GET /sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE → Liste. */
export function parseFulfillmentPolicies(json: unknown): FulfillmentPolicyInfo[] {
  const list = (json as { fulfillmentPolicies?: unknown })?.fulfillmentPolicies;
  if (!Array.isArray(list)) return [];
  return list.flatMap((p: Record<string, unknown>) => {
    const id = typeof p.fulfillmentPolicyId === 'string' ? p.fulfillmentPolicyId : null;
    if (!id) return [];
    const ht = p.handlingTime as { value?: unknown; unit?: unknown } | undefined;
    const handlingDays = typeof ht?.value === 'number' && (ht.unit === 'DAY' || ht.unit === 'BUSINESS_DAY' || ht.unit === undefined) ? ht.value : null;
    const services: Array<{ code: string; free: boolean }> = [];
    for (const o of (Array.isArray(p.shippingOptions) ? p.shippingOptions : []) as Array<{ shippingServices?: Array<Record<string, unknown>> }>) {
      for (const s of o.shippingServices ?? []) {
        const code = typeof s.shippingServiceCode === 'string' ? s.shippingServiceCode : '';
        const cost = (s.shippingCost as { value?: unknown } | undefined)?.value;
        const free = s.freeShipping === true || (cost !== undefined && Number(cost) === 0);
        if (code) services.push({ code, free });
      }
    }
    return [{ id, name: typeof p.name === 'string' ? p.name : '', handlingDays, services: services.map(s => s.code), freeShipping: services.length > 0 && services.every(s => s.free) }];
  });
}

/** Richtlinien mit genau diesem Namen (Groß/klein egal). */
export function policiesNamed(name: string, policies: FulfillmentPolicyInfo[]): FulfillmentPolicyInfo[] {
  return policies.filter(p => p.name.trim().toLowerCase() === name.trim().toLowerCase());
}

// ─── Anlegen (Weg B) ─────────────────────────────────────────────────────────

export interface CreatePolicyRequest { origin: PolicyOrigin; handlingDays: number; serviceCode: string }

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Prüft den Knopf-Auftrag vor jedem eBay-Aufruf. Keine Standardwerte:
 *  - Herkunft CN oder EU,
 *  - Bearbeitungszeit Pflicht und aus der eBay-Liste,
 *  - Service Pflicht und aus der Liste dieser Herkunft,
 *  - es gibt noch KEINE Richtlinie mit diesem Namen (kein Doppel, kein Überschreiben).
 */
export function checkCreatePolicyRequest(body: unknown, existing: FulfillmentPolicyInfo[]): Checked<CreatePolicyRequest> {
  const b = (body ?? {}) as Record<string, unknown>;
  const origin = b.origin === 'CN' || b.origin === 'EU' ? b.origin : null;
  if (!origin) return { ok: false, error: 'Herkunft fehlt: "CN" (Versand aus China) oder "EU" (Versand aus EU-Lager).' };
  const days = typeof b.handlingDays === 'number' && Number.isInteger(b.handlingDays) ? b.handlingDays : null;
  if (days === null) return { ok: false, error: 'Bearbeitungszeit fehlt — sie wird erst nach dem Gegencheck der Agenten eingetragen (Inhaber 21:56). Nichts angelegt.' };
  if (!(ALLOWED_HANDLING_DAYS as readonly number[]).includes(days)) return { ok: false, error: `Bearbeitungszeit ${days} Tage gibt es bei eBay nicht (erlaubt: ${ALLOWED_HANDLING_DAYS.join(', ')}).` };
  const code = typeof b.serviceCode === 'string' ? b.serviceCode : '';
  const allowed = servicesFor(origin);
  if (!allowed.some(s => s.code === code)) return { ok: false, error: `Versandservice fehlt oder ist für ${policyName(origin)} nicht vorgesehen (erlaubt: ${allowed.map(s => `${s.label} = ${s.code}`).join('; ')}).` };
  const dup = policiesNamed(policyName(origin), existing);
  if (dup.length) return { ok: false, error: `"${policyName(origin)}" gibt es schon im eBay-Konto (${dup.map(d => d.id).join(', ')}) — nichts angelegt, nichts überschrieben.` };
  return { ok: true, value: { origin, handlingDays: days, serviceCode: code } };
}

/** Body für POST /sell/account/v1/fulfillment_policy — kostenloser Versand, nur Inland DE (wie alle heutigen Richtlinien). */
export function buildFulfillmentPolicyBody(req: CreatePolicyRequest) {
  const svc = servicesFor(req.origin).find(s => s.code === req.serviceCode)!;
  return {
    name: policyName(req.origin),
    description: `${svc.label} (${svc.transit} laut eBay), Bearbeitung ${req.handlingDays} Tage — angelegt von der App (OFFEN 030, Weg B)`,
    marketplaceId: 'EBAY_DE',
    categoryTypes: [{ name: 'ALL_EXCLUDING_MOTORS_VEHICLES' }],
    handlingTime: { value: req.handlingDays, unit: 'DAY' },
    shippingOptions: [{
      optionType: 'DOMESTIC',
      costType: 'FLAT_RATE',
      shippingServices: [{
        sortOrder: 1,
        shippingServiceCode: req.serviceCode,
        shippingCost: { value: '0.00', currency: 'EUR' },
        freeShipping: true,
        buyerResponsibleForShipping: false,
      }],
    }],
    globalShipping: false,
    pickupDropOff: false,
    localPickup: false,
  };
}
