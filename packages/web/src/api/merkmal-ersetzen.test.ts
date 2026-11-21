// AUFSICHT 21.11.2026 12:10: stele-259 Merkmal „Material: Fleece“ → „Wolle“ über die Inventory-API (nicht Seller Hub).
import { describe, expect, test } from 'bun:test';
import { aspectReplacements, applySpecAspectsToListing } from './live-aspects';
import { shortMaterial } from '../shared/material-short';

describe('shortMaterial', () => {
  test('259: erster Eintrag ohne Klammer', () => expect(shortMaterial('Wolle (Futter), PU (Obermaterial), PVC (Sohle)')).toBe('Wolle'));
  test('einfach', () => expect(shortMaterial('Baumwolle')).toBe('Baumwolle'));
  test('leer → null', () => { expect(shortMaterial('')).toBeNull(); expect(shortMaterial(null)).toBeNull(); });
});

describe('aspectReplacements', () => {
  test('vorhandenes Material wird ersetzt', () => {
    expect(aspectReplacements({ Material: ['Fleece'], Marke: ['Markenlos'] }, { Material: 'Wolle' })).toEqual({ Material: { von: 'Fleece', nach: 'Wolle' } });
  });
  test('gleicher Wert (Groß/klein egal) → nichts', () => expect(aspectReplacements({ Material: ['wolle'] }, { Material: 'Wolle' })).toEqual({}));
  test('nicht vorhanden → nichts (Ergänzen ist Sache von aspectAdditions)', () => expect(aspectReplacements({ Marke: ['X'] }, { Material: 'Wolle' })).toEqual({}));
  test('Variations-Achse nie', () => expect(aspectReplacements({ Farbe: ['Schwarz'] }, { Farbe: 'Rot' }, ['Farbe'])).toEqual({}));
});

function fakeEbay(start: { group: Record<string, string[]>; items: Record<string, Record<string, string[]>> }) {
  const state = structuredClone(start);
  const puts: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/offer?sku=')) return new Response(JSON.stringify({ offers: [{ categoryId: '177796' }] }), { status: 200 });
    const g = u.match(/inventory_item_group\/([^?]+)/);
    const i = u.match(/inventory_item\/([^?]+)/);
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      puts.push(decodeURIComponent((g ?? i)![1]));
      if (g) state.group = body.aspects; else state.items[decodeURIComponent(i![1])] = body.product.aspects;
      return new Response(null, { status: 204 });
    }
    if (g) return new Response(JSON.stringify({ aspects: state.group, variesBy: { specifications: [{ name: 'Größe' }] } }), { status: 200 });
    if (i) return new Response(JSON.stringify({ product: { aspects: state.items[decodeURIComponent(i[1])] } }), { status: 200 });
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, state, puts };
}

describe('applySpecAspectsToListing mit replace (Fall 259)', () => {
  const start = () => ({ group: { Material: ['Fleece'], Marke: ['Markenlos'] }, items: { 'stele-259-A': { Material: ['Fleece'], Größe: ['Gr. 1'] }, 'stele-259-B': { Material: ['Fleece'], Größe: ['Gr. 2'] } } });
  const base = { productId: 259, specs: {}, token: 't', baseUrl: 'https://x', itemSkus: ['stele-259-A', 'stele-259-B'], getCategoryAspects: async () => [], replace: { Material: 'Wolle' } };

  test('Vorschau schreibt nichts, zeigt von/nach je Ziel', async () => {
    const e = fakeEbay(start());
    const r = await applySpecAspectsToListing({ ...base, confirm: false, fetchFn: e.f });
    expect(e.puts).toEqual([]);
    expect(r.rows.map(x => x.replaced?.Material?.nach)).toEqual(['Wolle', 'Wolle', 'Wolle']);
  });

  test('confirm: Gruppe + beide Items auf Wolle, zurückgelesen, andere Merkmale bleiben', async () => {
    const e = fakeEbay(start());
    const r = await applySpecAspectsToListing({ ...base, confirm: true, fetchFn: e.f });
    expect(e.puts).toEqual(['stele-259-GROUP', 'stele-259-A', 'stele-259-B']);
    expect(r.rows.every(x => x.written && x.verified)).toBe(true);
    expect(e.state.group).toEqual({ Material: ['Wolle'], Marke: ['Markenlos'] });
    expect(e.state.items['stele-259-A']).toEqual({ Material: ['Wolle'], Größe: ['Gr. 1'] });
  });

  test('ohne replace: vorhandenes Material bleibt (alter Weg unverändert)', async () => {
    const e = fakeEbay(start());
    const r = await applySpecAspectsToListing({ ...base, replace: undefined, confirm: true, fetchFn: e.f });
    expect(e.puts).toEqual([]);
    expect(r.rows.every(x => !x.written)).toBe(true);
  });
});
