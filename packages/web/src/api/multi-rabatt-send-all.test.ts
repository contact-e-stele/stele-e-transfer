import { describe, expect, test } from 'bun:test';
import { classifySendAll, MULTI_RABATT_SEND_ALL_MAX } from './multi-rabatt';
import type { VolumeDiscountPlan } from '../shared/volume-discount';

const plan = (p: { 2: number; 3: number } | null, error: string | null = null) => ({ ok: !!p, error, percents: p, tiers: [], singleRows: [], basePrice: null }) as VolumeDiscountPlan;
const sent = (listingId: string, p: { 2: number; 3: number }) => ({ promotionId: 'P', listingId, percents: p, sentAt: '2026-10-19', status: 'RUNNING' });

describe('Multi-Rabatt: alle neu senden (Inhaber 25.10.2026)', () => {
  test('neue Prozent → senden; gleiche → unverändert; keine Aktion → senden', () => {
    const r = classifySendAll([
      { productId: 220, listingId: '198712713157', plan: plan({ 2: 13, 3: 15 }), sent: sent('198712713157', { 2: 7, 3: 8 }) },
      { productId: 127, listingId: '198601075438', plan: plan({ 2: 13, 3: 15 }), sent: sent('198601075438', { 2: 13, 3: 15 }) },
      { productId: 228, listingId: '198728227102', plan: plan({ 2: 10, 3: 12 }), sent: null },
    ]);
    expect(r.map(x => x.aktion)).toEqual(['senden', 'unverändert', 'senden']);
    expect(r[0]).toMatchObject({ neu: { 2: 13, 3: 15 }, bisher: { 2: 7, 3: 8 } });
  });
  test('Aktion eines anderen (alten) Angebots zählt nicht als "bisher"', () => {
    const r = classifySendAll([{ productId: 228, listingId: 'NEU', plan: plan({ 2: 10, 3: 12 }), sent: sent('ALT', { 2: 10, 3: 12 }) }]);
    expect(r[0]).toMatchObject({ aktion: 'senden', bisher: null });
  });
  test('nicht sendbar mit laufender alter Aktion → beenden (Inhaber 25.10., stele-97 EU-Ware); ohne Aktion → nur melden', () => {
    const r = classifySendAll([
      { productId: 97, listingId: 'L97', plan: plan(null, '2 Stück: … bringt jedes Stück weniger als ein Einzelkauf'), sent: sent('L97', { 2: 8, 3: 9 }) },
      { productId: 230, listingId: 'L230', plan: plan(null, 'unter Boden'), sent: null },
    ]);
    expect(r[0].aktion).toBe('beenden');
    expect(r[0].grund).toMatch(/alte Aktion 8 %\/9 % wird beendet/);
    expect(r[1].aktion).toBe('nicht sendbar');
  });
  test('höchstens 15 je Aufruf', () => expect(MULTI_RABATT_SEND_ALL_MAX).toBe(15));
});

describe('eBay 38260: laufende Aktion behält ihr Startdatum (Live-Fund 25.10.2026, 15 Angebote)', () => {
  test('RUNNING: Start/Ende von eBay, Status SCHEDULED, Stufen neu', async () => {
    const { keepRunningPromotionDates } = await import('./multi-rabatt');
    const next = { name: 'Multi-Rabatt stele-70', promotionStatus: 'SCHEDULED', startDate: '2026-10-25T14:40:00.000Z', endDate: '2027-10-25T14:40:00.000Z', discountRules: [{ x: 13 }] };
    const out = keepRunningPromotionDates(next, { promotionStatus: 'RUNNING', startDate: '2026-10-19T08:00:00.000Z', endDate: '2027-10-19T08:00:00.000Z' });
    // Status SCHEDULED (eBay: Pflicht beim Update einer laufenden Aktion; RUNNING → 38240, Live 25.10. 15:46)
    expect(out).toEqual({ ...next, promotionStatus: 'SCHEDULED', startDate: '2026-10-19T08:00:00.000Z', endDate: '2027-10-19T08:00:00.000Z' });
  });
  test('beendete Aktion oder unlesbar → unverändert', async () => {
    const { keepRunningPromotionDates } = await import('./multi-rabatt');
    const next = { promotionStatus: 'SCHEDULED', startDate: 'A' };
    expect(keepRunningPromotionDates(next, { promotionStatus: 'ENDED', startDate: 'B' })).toEqual(next);
    expect(keepRunningPromotionDates(next, {})).toEqual(next);
  });
});

describe('eBay 38232: aktive Aktion ersetzen (pausieren → ändern/neu → fortsetzen/löschen)', () => {
  const mk = (plan: Record<string, number>) => {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const m = init?.method ?? 'GET'; const key = `${m} ${url.replace('https://x/sell/marketing/v1', '')}`; calls.push(key);
      const st = plan[key] ?? 200;
      if (key === 'POST /item_promotion' && st < 300) return new Response('', { status: 201, headers: { location: 'https://x/sell/marketing/v1/item_promotion/NEU' } });
      if (key === 'GET /item_promotion/ALT') return new Response(JSON.stringify({ promotionStatus: 'PAUSED', startDate: 'S', endDate: 'E' }), { status: 200 });
      return new Response(st < 300 ? '' : '{"errors":[{"errorId":1}]}', { status: st });
    }) as unknown as typeof fetch;
    return { f, calls };
  };
  const body = { promotionStatus: 'SCHEDULED', startDate: 'N', endDate: 'NE', discountRules: [] };
  test('pausiert änderbar → ändern + fortsetzen, ID bleibt', async () => {
    const { replaceActivePromotion } = await import('./multi-rabatt');
    const m = mk({});
    const r = await replaceActivePromotion({ base: 'https://x', headers: {}, oldId: 'ALT', body, fetchFn: m.f });
    expect(r).toMatchObject({ ok: true, promotionId: 'ALT' });
    expect(m.calls).toEqual(['POST /promotion/ALT/pause', 'GET /item_promotion/ALT', 'PUT /item_promotion/ALT', 'POST /promotion/ALT/resume']);
  });
  test('auch pausiert nicht änderbar → neue anlegen, erst DANN alte löschen', async () => {
    const { replaceActivePromotion } = await import('./multi-rabatt');
    const m = mk({ 'PUT /item_promotion/ALT': 400 });
    const r = await replaceActivePromotion({ base: 'https://x', headers: {}, oldId: 'ALT', body, fetchFn: m.f });
    expect(r).toMatchObject({ ok: true, promotionId: 'NEU' });
    expect(m.calls.slice(-2)).toEqual(['POST /item_promotion', 'DELETE /item_promotion/ALT']);
  });
  test('neue scheitert → alte wird fortgesetzt, nichts gelöscht', async () => {
    const { replaceActivePromotion } = await import('./multi-rabatt');
    const m = mk({ 'PUT /item_promotion/ALT': 400, 'POST /item_promotion': 409 });
    const r = await replaceActivePromotion({ base: 'https://x', headers: {}, oldId: 'ALT', body, fetchFn: m.f });
    expect(r.ok).toBe(false);
    expect(m.calls).toContain('POST /promotion/ALT/resume');
    expect(m.calls.some(c => c.startsWith('DELETE'))).toBe(false);
  });
  test('Pause scheitert → Abbruch, keine zweite Aktion', async () => {
    const { replaceActivePromotion } = await import('./multi-rabatt');
    const m = mk({ 'POST /promotion/ALT/pause': 400 });
    const r = await replaceActivePromotion({ base: 'https://x', headers: {}, oldId: 'ALT', body, fetchFn: m.f });
    expect(r.ok).toBe(false);
    expect(m.calls).toEqual(['POST /promotion/ALT/pause']);
  });
});

describe('Aktion beenden (pausieren, dann löschen)', () => {
  const mk = (plan: Record<string, number>, status = 'RUNNING') => {
    const calls: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url.replace('https://x/sell/marketing/v1', '')}`; calls.push(key);
      const st = plan[key] ?? 200;
      if (key === 'GET /item_promotion/P' && st === 200) return new Response(JSON.stringify({ promotionStatus: status }), { status: 200 });
      return new Response('', { status: st });
    }) as unknown as typeof fetch;
    return { f, calls };
  };
  test('laufend → pausieren → löschen', async () => {
    const { endPromotion } = await import('./multi-rabatt');
    const m = mk({});
    expect((await endPromotion({ base: 'https://x', headers: {}, promotionId: 'P', fetchFn: m.f })).ok).toBe(true);
    expect(m.calls).toEqual(['GET /item_promotion/P', 'POST /promotion/P/pause', 'DELETE /item_promotion/P']);
  });
  test('Pause scheitert → nichts gelöscht, Fehler', async () => {
    const { endPromotion } = await import('./multi-rabatt');
    const m = mk({ 'POST /promotion/P/pause': 400 });
    const r = await endPromotion({ base: 'https://x', headers: {}, promotionId: 'P', fetchFn: m.f });
    expect(r.ok).toBe(false);
    expect(m.calls.some(c => c.startsWith('DELETE'))).toBe(false);
  });
  test('gibt es nicht mehr (404) → ok', async () => {
    const { endPromotion } = await import('./multi-rabatt');
    const m = mk({ 'GET /item_promotion/P': 404 });
    expect((await endPromotion({ base: 'https://x', headers: {}, promotionId: 'P', fetchFn: m.f })).ok).toBe(true);
  });
});
