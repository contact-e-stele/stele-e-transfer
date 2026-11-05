import { describe, expect, test } from 'bun:test';
import { mapLimit } from './map-limit';

describe('mapLimit', () => {
  test('Reihenfolge bleibt, höchstens `limit` gleichzeitig', async () => {
    let active = 0, peak = 0;
    const res = await mapLimit([5, 1, 4, 2, 3, 0, 6, 7], 3, async (ms, i) => {
      active++; peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, ms * 3));
      active--;
      return `${i}:${ms}`;
    });
    expect(res).toEqual(['0:5', '1:1', '2:4', '3:2', '4:3', '5:0', '6:6', '7:7']);
    expect(peak).toBe(3);
  });
  test('parallel schneller als nacheinander (43 × 20 ms, limit 8)', async () => {
    const t0 = Date.now();
    await mapLimit(Array.from({ length: 43 }, (_, i) => i), 8, () => new Promise(r => setTimeout(r, 20)));
    expect(Date.now() - t0).toBeLessThan(43 * 20 / 2);
  });
  test('leere Liste', async () => { expect(await mapLimit([], 8, async () => 1)).toEqual([]); });
});
