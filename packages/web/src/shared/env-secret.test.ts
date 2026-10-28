import { describe, expect, test } from 'bun:test';
import { readEnvSecret, requireEnvSecret } from './env-secret';
import { readFileSync } from 'node:fs';

describe('K-016: kein Klartext-Fallback für Geheimnisse', () => {
  test('fehlende/leere Variable → klarer Fehler, kein Ersatzwert', () => {
    expect(readEnvSecret('X', {})).toBeNull();
    expect(readEnvSecret('X', { X: '  ' })).toBeNull();
    expect(() => requireEnvSecret('ALIEXPRESS_APP_SECRET', {})).toThrow('ALIEXPRESS_APP_SECRET fehlt');
    expect(requireEnvSecret('X', { X: 'abc' })).toBe('abc');
  });
  test('Quellcode enthält keinen Fallback hinter ALIEXPRESS_APP_SECRET', () => {
    for (const f of ['src/api/aliexpress-api.ts', 'src/api/aliexpress.ts', 'scripts/probe-ali-logistics-endpoints.ts']) {
      const src = readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
      expect(src).not.toMatch(/ALIEXPRESS_APP_SECRET\s*(\|\||\?\?)\s*['"`]/);
    }
  });
});
