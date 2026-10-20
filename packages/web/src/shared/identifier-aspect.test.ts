import { describe, expect, test } from 'bun:test';
import { isValidGtin, isValidIdentifierValue, fixIdentifierAspects } from './identifier-aspect';

describe('EAN-Merkmal (stele-228, 19.10.2026)', () => {
  test('Kategorie-Nummer 101406 ist keine EAN', () => {
    expect(isValidIdentifierValue('101406')).toBe(false);
  });
  test('gültige GTIN mit Prüfziffer, falsche Prüfziffer abgelehnt', () => {
    expect(isValidGtin('4006381333931')).toBe(true);   // EAN-13
    expect(isValidGtin('4006381333932')).toBe(false);  // Prüfziffer falsch
    expect(isValidGtin('96385074')).toBe(true);        // EAN-8
    expect(isValidGtin('036000291452')).toBe(true);    // UPC-A
  });
  test('Ersatztext bleibt', () => {
    expect(isValidIdentifierValue('Nicht zutreffend')).toBe(true);
    expect(fixIdentifierAspects({ EAN: ['Nicht zutreffend'] }).changed).toEqual([]);
  });
  test('ersetzt nur ungültige Identifikatoren, andere Merkmale unverändert', () => {
    const r = fixIdentifierAspects({ Produktart: ['Wärmflasche'], EAN: ['101406'], Marke: ['Markenlos'] });
    expect(r.aspects).toEqual({ Produktart: ['Wärmflasche'], EAN: ['Nicht zutreffend'], Marke: ['Markenlos'] });
    expect(r.changed).toEqual(['EAN: 101406']);
  });
});

describe('Live-Angebot korrigieren (Mock, stele-228)', () => {
  test('Vorschau schreibt nichts, apply PUTtet Gruppe und Item und liest zurück', async () => {
    const store: Record<string, Record<string, unknown>> = {
      group: { aspects: { EAN: ['101406'], Produktart: ['Wärmflasche'] }, title: 't' },
      item: { product: { aspects: { EAN: ['101406'], Farbe: ['A'] } }, availability: { shipToLocationAvailability: { quantity: 4 } } },
    };
    const puts: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const key = url.includes('inventory_item_group') ? 'group' : 'item';
      if (init?.method === 'PUT') { puts.push(key); store[key] = JSON.parse(String(init.body)); return new Response(null, { status: 204 }); }
      return new Response(JSON.stringify(store[key]), { status: 200 });
    }) as unknown as typeof fetch;
    const { fixListingIdentifierAspects } = await import('../api/identifier-aspect-fix');
    const prev = await fixListingIdentifierAspects({ productId: 228, token: 't', baseUrl: 'https://x', confirm: false, fetchFn: f, itemSkus: ['stele-228-A'] });
    expect(puts).toEqual([]);
    expect(prev.rows.map(r => r.changed)).toEqual([['EAN: 101406'], ['EAN: 101406']]);
    const ap = await fixListingIdentifierAspects({ productId: 228, token: 't', baseUrl: 'https://x', confirm: true, fetchFn: f, itemSkus: ['stele-228-A'] });
    expect(puts).toEqual(['group', 'item']);
    expect(ap.rows.map(r => r.after)).toEqual([['Nicht zutreffend'], ['Nicht zutreffend']]);
    expect((store.item.availability as { shipToLocationAvailability: { quantity: number } }).shipToLocationAvailability.quantity).toBe(4);
  });
});

describe('EAN-Schutz beim Listen und Speichern (Inhaber 20.10.2026)', () => {
  test('productIdentifierFields: ungültige EAN → Ersatztext, gültige bleibt', async () => {
    process.env.TURSO_DATABASE_URL ??= 'file:/tmp/x.db';
    const { productIdentifierFields } = await import('../api/ebay');
    expect(productIdentifierFields('101406')).toEqual({ ean: ['Nicht zutreffend'] });
    expect(productIdentifierFields('4006381333931')).toEqual({ ean: ['4006381333931'] });
    expect(productIdentifierFields(null)).toEqual({ ean: ['Nicht zutreffend'] });
  });
  test('buildAspects und Speichern-Route prüfen die Kennung', () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const { resolve } = require('path') as typeof import('path');
    const ebay = readFileSync(resolve(import.meta.dir, '..', 'api', 'ebay.ts'), 'utf-8');
    expect(ebay).toContain('const fixed = fixIdentifierAspects(aspects);');
    const idx = readFileSync(resolve(import.meta.dir, '..', 'api', 'index.ts'), 'utf-8');
    expect(idx).toContain('ist keine gültige Nummer (8/12/13/14 Ziffern mit Prüfziffer)');
  });
});
