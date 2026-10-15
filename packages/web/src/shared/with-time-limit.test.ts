import { describe, expect, test } from 'bun:test';
import { withTimeLimit, fetchWithTimeout } from './with-time-limit';

describe('withTimeLimit', () => {
  test('hängendes Produkt → timedOut nach dem Limit', async () => {
    const never = new Promise<number>(() => {});
    const t0 = Date.now();
    const r = await withTimeLimit(never, 50);
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
  });
  test('rechtzeitig fertig → Wert', async () => {
    const r = await withTimeLimit(Promise.resolve(7), 1000);
    expect(r).toEqual({ timedOut: false, value: 7 });
  });
  test('Fehler der Arbeit wird weitergereicht', async () => {
    await expect(withTimeLimit(Promise.reject(new Error('x')), 1000)).rejects.toThrow('x');
  });
  test('Stapel mit einem hängenden Produkt läuft weiter (wie Promise.all im Lauf)', async () => {
    const done: number[] = [];
    await Promise.all([1, 2, 3].map(async id => {
      const work = id === 2 ? new Promise<void>(() => {}) : Promise.resolve().then(() => { done.push(id); });
      await withTimeLimit(work, 50);
    }));
    expect(done.sort()).toEqual([1, 3]);
  });
});

describe('fetchWithTimeout', () => {
  test('bricht einen hängenden Aufruf nach dem Limit ab', async () => {
    const hanging = ((_: unknown, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => rej(init.signal!.reason));
    })) as unknown as typeof fetch;
    const f = fetchWithTimeout(50, hanging);
    await expect(f('https://x')).rejects.toBeDefined();
  });
  test('reicht Antwort und Optionen durch', async () => {
    let seen: RequestInit | undefined;
    const ok = (async (_: unknown, init?: RequestInit) => { seen = init; return new Response('ok'); }) as unknown as typeof fetch;
    const r = await fetchWithTimeout(1000, ok)('https://x', { method: 'PUT' });
    expect(await r.text()).toBe('ok');
    expect(seen?.method).toBe('PUT');
    expect(seen?.signal).toBeDefined();
  });
});
