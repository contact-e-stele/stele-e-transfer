import { describe, expect, test } from 'bun:test';
import { redactTokens } from './aliexpress-api';
import { readFileSync } from 'fs';

// K-012 (Kalkulator 15.10.2026): Tokens nie ins Log.
describe('K-012: Tokens nie im Log', () => {
  test('access_token/refresh_token werden geschwärzt, Fehlertext bleibt', () => {
    const raw = '{"access_token":"50000ABCDEF","refresh_token":"50001XYZ","expires_in":2592000,"code":"0"}';
    const out = redactTokens(raw);
    expect(out).not.toContain('50000ABCDEF');
    expect(out).not.toContain('50001XYZ');
    expect(out).toContain('"access_token":"***');
    expect(out).toContain('"expires_in":2592000');
    expect(redactTokens('{"code":"IllegalRefreshToken","message":"invalid"}')).toBe('{"code":"IllegalRefreshToken","message":"invalid"}');
    expect(redactTokens('accessToken=abc&x=1')).toBe('accessToken=***&x=1');
  });
  test('Quelltext: kein Roh-Body und kein Token-Anfang mehr im Log', () => {
    const ali = readFileSync(new URL('./aliexpress-api.ts', import.meta.url), 'utf-8');
    const idx = readFileSync(new URL('./index.ts', import.meta.url), 'utf-8');
    expect(ali).not.toMatch(/Token (exchange|refresh) HTTP \$\{res\.status\}, Body:/);
    expect(ali).not.toMatch(/console\.[a-z]+\([^)]*rawText\.slice/);
    expect(idx).not.toMatch(/console\.[a-z]+\([^)]*(access_token|refresh_token)\.slice/);
  });
});
