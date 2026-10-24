import { describe, expect, test } from 'bun:test';
import { planAutoAlign, autoAlignUpward, type AlignRow } from './auto-align';

// Echte Werte Render-Log 24.10.2026 20:29: stele-220-GRAY Käufer 23,45 ≠ Angebotsdaten 19,95; stele-224-SCHWARZ 23,95 ≠ 21,45.
describe('planAutoAlign', () => {
  test('Käuferpreis höher → angleichen', () => {
    const p = planAutoAlign([{ sku: 'stele-220-GRAY', buyerPrice: 23.45, offerPrice: 19.95 }, { sku: 'stele-220-BLUE', buyerPrice: 21.95, offerPrice: 21.95 }]);
    expect(p.action).toBe('align');
    expect(p.todo.map(r => r.sku)).toEqual(['stele-220-GRAY']);
  });
  test('eine Variante mit NIEDRIGEREM Käuferpreis → nichts automatisch (keine Senkung festschreiben)', () => {
    const p = planAutoAlign([{ sku: 'a', buyerPrice: 23.45, offerPrice: 19.95 }, { sku: 'b', buyerPrice: 18.95, offerPrice: 19.95 }]);
    expect(p.action).toBe('blocked');
    expect(p.reason).toContain('NIEDRIGER');
  });
  test('Angebotsdaten nicht lesbar → nichts', () => {
    expect(planAutoAlign([{ sku: 'a', buyerPrice: 23.45, offerPrice: null }]).action).toBe('blocked');
  });
  test('alles gleich (Toleranz 0,01) → nichts zu tun', () => {
    expect(planAutoAlign([{ sku: 'a', buyerPrice: 19.95, offerPrice: 19.95 }]).action).toBe('none');
  });
});

describe('autoAlignUpward (gemockt)', () => {
  function deps(initial: AlignRow[], writeOk = true) {
    let rows = initial.map(r => ({ ...r }));
    const writes: Array<[string, number]> = []; const locks: Array<AlignRow[] | null> = []; let adopted = 0;
    return {
      writes, locks, get adopted() { return adopted; },
      d: {
        readRows: async () => rows.map(r => ({ ...r })),
        writeOffer: async (sku: string, price: number) => { writes.push([sku, price]); if (writeOk) rows = rows.map(r => r.sku === sku ? { ...r, offerPrice: price } : r); return { ok: writeOk }; },
        setLock: async (r: AlignRow[] | null) => { locks.push(r); },
        adoptAppPrices: async () => { adopted++; },
        log: () => {},
      },
    };
  }
  test('220: Angebotsdaten auf 23,45, Sperre aufgehoben, App-Preise übernommen', async () => {
    const x = deps([{ sku: 'stele-220-GRAY', buyerPrice: 23.45, offerPrice: 19.95 }]);
    expect(await autoAlignUpward(220, x.d)).toBe('aligned');
    expect(x.writes).toEqual([['stele-220-GRAY', 23.45]]);
    expect(x.locks).toEqual([null]);
    expect(x.adopted).toBe(1);
  });
  test('niedrigerer Käuferpreis: kein Schreiben, keine Sperr-Änderung', async () => {
    const x = deps([{ sku: 'a', buyerPrice: 17.95, offerPrice: 19.95 }]);
    expect(await autoAlignUpward(1, x.d)).toBe('blocked');
    expect(x.writes).toHaveLength(0);
    expect(x.locks).toHaveLength(0);
  });
  test('Schreiben schlägt fehl: Sperre bleibt gesetzt, nichts übernommen', async () => {
    const x = deps([{ sku: 'a', buyerPrice: 23.45, offerPrice: 19.95 }], false);
    expect(await autoAlignUpward(1, x.d)).toBe('partial');
    expect(x.locks[0]).not.toBeNull();
    expect(x.adopted).toBe(0);
  });
});

test('Preisprüfung ruft das automatische Angleichen vor der Prüfung auf', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { resolve } = require('path') as typeof import('path');
  const src = readFileSync(resolve(import.meta.dir, 'price-monitor.ts'), 'utf-8');
  const i = src.indexOf('checked++;\n      // Inhaber 24.10.2026');
  expect(src.slice(i, i + 400)).toContain('await maybeAutoAlign(product)');
});
