// K-018 PR B: runAutoLower mit Mocks (kein DB-/eBay-Zugriff) — Schalter AUS = nur Vorschau, AN = genau der Plan wird gesendet (down).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { setAliEinfuhrEur, ALI_EINFUHR_EUR, ALI_EINFUHR_ALT_EUR } from '../shared/constants';
import { runAutoLower, autoLowerEnabled, autoLowerPause } from './auto-lower';
import type { VariantRepriceDeps } from './variant-reprice';
import fx228 from '../shared/auto-lower-fx/fx228.json';

beforeAll(() => setAliEinfuhrEur(ALI_EINFUHR_EUR));
afterAll(() => setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR));

const PINK = '12000045241000885';
const p = { ...(fx228 as Record<string, unknown>), groups: JSON.parse((fx228 as { variants: string }).variants), generatedTitle: 'Trinkflasche', ebayStatus: 'listed' } as never as { id: number; variantPrices: string };
const input = () => ({ products: [p] as never, freshEk: new Map([[228, p.variantPrices]]), changedThisRun: new Set<string>(), held: new Map(), promotions: new Map() });

function mocks() {
  const calls = { send: [] as Array<{ changes: Array<{ skuId: string; newSell: number }>; direction: string }>, store: [] as string[], preview: [] as string[] };
  const d: VariantRepriceDeps = {
    heldSkuIds: async () => new Set(),
    send: async (_id, _g, _e, changes, direction) => { calls.send.push({ changes, direction }); return { resolved: true, results: changes.map(c => ({ skuId: c.skuId, sku: 's', ok: true })) }; },
    store: async (_id, json) => { calls.store.push(json); },
    readBack: async () => ({ ok: true, prices: { [PINK]: 19.95 } }),
  };
  return { d, calls, savePreview: async (j: string) => { calls.preview.push(j); } };
}

describe('runAutoLower', () => {
  test('Schalter: nur "true" schaltet AN, Standard AUS', () => {
    expect(autoLowerEnabled({})).toBe(false);
    expect(autoLowerEnabled({ AUTO_LOWER_ENABLED: '1' })).toBe(false);
    expect(autoLowerEnabled({ AUTO_LOWER_ENABLED: 'true' })).toBe(true);
  });
  test('AUS: nichts gesendet, nichts gespeichert, Vorschau mit 228 pink 20,45 → 19,95 abgelegt', async () => {
    const m = mocks();
    const r = await runAutoLower(input(), { enabled: false, depsFor: () => m.d, savePreview: m.savePreview });
    expect(m.calls.send).toEqual([]);
    expect(m.calls.store).toEqual([]);
    expect(r.plan.senken[0].prices).toEqual({ [PINK]: 19.95 });
    expect(JSON.parse(m.calls.preview[0]).enabled).toBe(false);
  });
  test('AN: genau der Plan wird gesendet (direction down), gespeichert, Ergebnis "sent"', async () => {
    const m = mocks();
    const r = await runAutoLower(input(), { enabled: true, depsFor: () => m.d, savePreview: m.savePreview });
    expect(m.calls.send).toEqual([{ changes: [{ skuId: PINK, newSell: 19.95 }], direction: 'down' }]);
    expect(m.calls.store).toHaveLength(1);
    expect(r.gesendet).toEqual([{ productId: 228, status: 'sent' }]);
  });
  test('AN, eBay-Fehler → nichts gespeichert, Lauf bricht nicht ab', async () => {
    const m = mocks();
    m.d.send = async (_i, _g, _e, ch) => ({ resolved: true, results: ch.map(c => ({ skuId: c.skuId, ok: false, error: 'PUT 500' })) });
    const r = await runAutoLower(input(), { enabled: true, depsFor: () => m.d, savePreview: m.savePreview });
    expect(m.calls.store).toEqual([]);
    expect(r.gesendet[0].status).toBe('send_failed');
  });
});

describe('runAutoLower — höchstens einmal je 20 h (Befund 08.11.: Preislauf nach jedem Neustart)', () => {
  const NOW = new Date('2026-11-08T08:10:00Z');
  test('AN, letztes echtes Senken vor 6 h → Pause: nichts gesendet, lastSentAt bleibt, Grund im Ergebnis', async () => {
    const m = mocks();
    const r = await runAutoLower(input(), { enabled: true, depsFor: () => m.d, savePreview: m.savePreview, now: NOW, lastSentAt: '2026-11-08T02:10:00Z' });
    expect(m.calls.send).toEqual([]);
    expect(m.calls.store).toEqual([]);
    expect(r.lastSentAt).toBe('2026-11-08T02:10:00Z');
    expect(r.pause).toContain('20 h');
  });
  test('AN, letztes echtes Senken vor 21 h → wird gesendet, lastSentAt = jetzt', async () => {
    const m = mocks();
    const r = await runAutoLower(input(), { enabled: true, depsFor: () => m.d, savePreview: m.savePreview, now: NOW, lastSentAt: '2026-11-07T11:10:00Z' });
    expect(m.calls.send).toHaveLength(1);
    expect(r.lastSentAt).toBe(NOW.toISOString());
    expect(r.pause).toBeUndefined();
  });
  test('AN, noch nie gesendet → wird gesendet', async () => {
    const m = mocks();
    const r = await runAutoLower(input(), { enabled: true, depsFor: () => m.d, savePreview: m.savePreview, now: NOW, lastSentAt: null });
    expect(m.calls.send).toHaveLength(1);
    expect(r.lastSentAt).toBe(NOW.toISOString());
  });
  test('AUS → keine Pause-Meldung, lastSentAt unverändert', async () => {
    const m = mocks();
    const r = await runAutoLower(input(), { enabled: false, depsFor: () => m.d, savePreview: m.savePreview, now: NOW, lastSentAt: '2026-11-08T07:00:00Z' });
    expect(r.pause).toBeUndefined();
    expect(r.lastSentAt).toBe('2026-11-08T07:00:00Z');
  });
  test('autoLowerPause rein: Grenze genau 20 h → keine Pause; 19,9 h → Pause; ungültiges Datum → keine Pause', () => {
    expect(autoLowerPause('2026-11-07T12:10:00Z', NOW)).toBeNull();
    expect(autoLowerPause('2026-11-07T12:16:00Z', NOW)).not.toBeNull();
    expect(autoLowerPause('kaputt', NOW)).toBeNull();
  });
});
