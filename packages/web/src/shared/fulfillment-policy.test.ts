// OFFEN 030 Weg B: Prüfung + Body für "Versand aus China" / "Versand aus EU-Lager" — und der eBay-Aufruf (gemockt).
import { describe, expect, test } from 'bun:test';
import {
  ALLOWED_HANDLING_DAYS, buildFulfillmentPolicyBody, checkCreatePolicyRequest, parseFulfillmentPolicies, policiesNamed,
  type FulfillmentPolicyInfo,
} from './fulfillment-policy';
import { createFulfillmentPolicy, fetchFulfillmentPolicies } from '../api/ebay';

// Echter Kontostand 04.11.2026 (Auszug): keine der beiden Richtlinien vorhanden
const LIVE: FulfillmentPolicyInfo[] = [
  { id: '276306574014', name: 'Versand', handlingDays: 10, services: ['DE_Paket'], freeShipping: true },
  { id: '294010673014', name: 'Stele 5d Handling', handlingDays: 5, services: ['DE_DHLPaket'], freeShipping: true },
];

describe('checkCreatePolicyRequest — keine Standardwerte', () => {
  test('China mit Bearbeitungszeit + entschiedenem Service → ok', () => {
    expect(checkCreatePolicyRequest({ origin: 'CN', handlingDays: 3, serviceCode: 'DE_StandardversandAusDemAusland' }, LIVE))
      .toEqual({ ok: true, value: { origin: 'CN', handlingDays: 3, serviceCode: 'DE_StandardversandAusDemAusland' } });
  });
  test('ohne Bearbeitungszeit → nichts angelegt (Inhaber 21:56: erst nach Gegencheck)', () => {
    const r = checkCreatePolicyRequest({ origin: 'CN', serviceCode: 'DE_StandardversandAusDemAusland' }, LIVE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('Bearbeitungszeit fehlt');
  });
  test('Bearbeitungszeit, die eBay nicht anbietet (8, 2.5, "3") → abgelehnt', () => {
    for (const handlingDays of [8, 2.5, '3', -1]) {
      expect(checkCreatePolicyRequest({ origin: 'CN', handlingDays, serviceCode: 'DE_StandardversandAusDemAusland' }, LIVE).ok).toBe(false);
    }
    expect(ALLOWED_HANDLING_DAYS).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 10, 15, 20, 30, 40]);
  });
  test('China nur mit "Standardversand aus dem Ausland" (Entscheidung C) — Sparversand abgelehnt', () => {
    expect(checkCreatePolicyRequest({ origin: 'CN', handlingDays: 3, serviceCode: 'DE_SparversandAusDemAusland' }, LIVE).ok).toBe(false);
    expect(checkCreatePolicyRequest({ origin: 'CN', handlingDays: 3, serviceCode: 'DE_DHLPaket' }, LIVE).ok).toBe(false);
  });
  test('EU: Service muss ausdrücklich gewählt sein (nicht entschieden → kein Standard)', () => {
    expect(checkCreatePolicyRequest({ origin: 'EU', handlingDays: 2 }, LIVE).ok).toBe(false);
    expect(checkCreatePolicyRequest({ origin: 'EU', handlingDays: 2, serviceCode: 'DE_TrackedDeliveryFromAbroad' }, LIVE).ok).toBe(true);
  });
  test('Name schon vorhanden (auch andere Schreibweise) → nichts angelegt, nichts überschrieben', () => {
    const withCn = [...LIVE, { id: '300000000001', name: 'versand aus china', handlingDays: 3, services: [], freeShipping: true }];
    const r = checkCreatePolicyRequest({ origin: 'CN', handlingDays: 3, serviceCode: 'DE_StandardversandAusDemAusland' }, withCn);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('300000000001');
    expect(policiesNamed('Versand aus China', withCn).length).toBe(1);
  });
  test('falsche Herkunft → abgelehnt', () => {
    expect(checkCreatePolicyRequest({ origin: 'DE', handlingDays: 3, serviceCode: 'DE_DHLPaket' }, LIVE).ok).toBe(false);
    expect(checkCreatePolicyRequest(null, LIVE).ok).toBe(false);
  });
});

describe('buildFulfillmentPolicyBody', () => {
  test('China: Name, Service, Bearbeitungszeit, kostenlos, nur Inland', () => {
    const b = buildFulfillmentPolicyBody({ origin: 'CN', handlingDays: 3, serviceCode: 'DE_StandardversandAusDemAusland' });
    expect(b.name).toBe('Versand aus China');
    expect(b.marketplaceId).toBe('EBAY_DE');
    expect(b.handlingTime).toEqual({ value: 3, unit: 'DAY' });
    expect(b.shippingOptions).toEqual([{ optionType: 'DOMESTIC', costType: 'FLAT_RATE', shippingServices: [{ sortOrder: 1, shippingServiceCode: 'DE_StandardversandAusDemAusland', shippingCost: { value: '0.00', currency: 'EUR' }, freeShipping: true, buyerResponsibleForShipping: false }] }]);
    expect(b.globalShipping).toBe(false);
    expect(b.description.length).toBeLessThanOrEqual(250);
  });
  test('EU: Name "Versand aus EU-Lager" + gewählter Service', () => {
    const b = buildFulfillmentPolicyBody({ origin: 'EU', handlingDays: 2, serviceCode: 'DE_TrakPakFromAbroad' });
    expect(b.name).toBe('Versand aus EU-Lager');
    expect(b.shippingOptions[0].shippingServices[0].shippingServiceCode).toBe('DE_TrakPakFromAbroad');
  });
});

describe('eBay-Aufrufe (gemockt)', () => {
  test('fetchFulfillmentPolicies: nur GET, Antwort geparst', async () => {
    const seen: string[] = [];
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${String(u)}`);
      return new Response(JSON.stringify({ fulfillmentPolicies: [{ fulfillmentPolicyId: '276306574014', name: 'Versand', handlingTime: { value: 10, unit: 'DAY' }, shippingOptions: [{ shippingServices: [{ shippingServiceCode: 'DE_Paket', shippingCost: { value: '0.0' }, freeShipping: true }] }] }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await fetchFulfillmentPolicies(f, 'tok')).toEqual([{ id: '276306574014', name: 'Versand', handlingDays: 10, services: ['DE_Paket'], freeShipping: true }]);
    expect(seen).toEqual(['GET https://api.ebay.com/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_DE']);
  });
  test('createFulfillmentPolicy: genau EIN POST mit dem Body, ID zurück', async () => {
    const calls: Array<{ m: string; u: string; b: unknown }> = [];
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ m: init?.method ?? 'GET', u: String(u), b: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ fulfillmentPolicyId: '300000000099' }), { status: 201 });
    }) as unknown as typeof fetch;
    const req = { origin: 'CN' as const, handlingDays: 3, serviceCode: 'DE_StandardversandAusDemAusland' };
    expect(await createFulfillmentPolicy(req, f, 'tok')).toEqual({ fulfillmentPolicyId: '300000000099', name: 'Versand aus China' });
    expect(calls.length).toBe(1);
    expect(calls[0].m).toBe('POST');
    expect(calls[0].u).toBe('https://api.ebay.com/sell/account/v1/fulfillment_policy');
    expect(calls[0].b).toEqual(buildFulfillmentPolicyBody(req));
  });
  test('createFulfillmentPolicy: eBay-Fehler → Fehler mit Status und Text', async () => {
    const f = (async () => new Response('{"errors":[{"errorId":20400}]}', { status: 400 })) as unknown as typeof fetch;
    await expect(createFulfillmentPolicy({ origin: 'CN', handlingDays: 3, serviceCode: 'DE_StandardversandAusDemAusland' }, f, 'tok')).rejects.toThrow('400');
  });
  test('createFulfillmentPolicy: Erfolg ohne ID → Fehler (nicht still als angelegt melden)', async () => {
    const f = (async () => new Response('', { status: 201 })) as unknown as typeof fetch;
    await expect(createFulfillmentPolicy({ origin: 'EU', handlingDays: 2, serviceCode: 'DE_TrakPakFromAbroad' }, f, 'tok')).rejects.toThrow('keine ID');
  });
});

describe('parseFulfillmentPolicies', () => {
  test('ohne Liste → leer', () => { expect(parseFulfillmentPolicies({})).toEqual([]); });
});
