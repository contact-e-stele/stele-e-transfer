// Bildsuche "gleiche Ware günstiger?" über aliexpress.ds.image.searchV2 (nur Anzeige).
// Reine Funktionen ohne I/O. Die genaue Antwortstruktur von searchV2 ist NICHT belegt —
// das Mapping ist deshalb tolerant (sucht das Produkt-Array, akzeptiert mehrere Feldnamen);
// die echte Antwort wird einmal im Render-Log festgehalten ([AliImage]).
import type { AliSearchHit } from './ali-search';

const ALLOWED_IMAGE_HOST_SUFFIXES = ['alicdn.com', 'aliexpress.com', 'aliexpress-media.com'];

/** Nur https-Bilder von AliExpress-Hosts (Schutz gegen Server-seitiges Abrufen beliebiger URLs). */
export function isAllowedImageUrl(raw: string): boolean {
  try {
    const u = new URL(raw.startsWith('//') ? 'https:' + raw : raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return ALLOWED_IMAGE_HOST_SUFFIXES.some(s => h === s || h.endsWith('.' + s));
  } catch {
    return false;
  }
}

export function normalizeImageUrl(raw: string): string {
  return raw.startsWith('//') ? 'https:' + raw : raw;
}

export type AliImageSearchParsed =
  | { ok: true; hits: AliSearchHit[] }
  | { ok: false; code: string; msg: string };

function pick(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k];
  return undefined;
}

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const ID_KEYS = ['itemId', 'item_id', 'productId', 'product_id'];

/** Erstes Array aus Objekten mit einer Produkt-ID (max. 6 Ebenen tief). */
function findProductArray(node: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 6 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    if (node.length > 0 && node.every(x => x && typeof x === 'object' && ID_KEYS.some(k => (x as Record<string, unknown>)[k] !== undefined))) {
      return node as Record<string, unknown>[];
    }
    for (const x of node) {
      const r = findProductArray(x, depth + 1);
      if (r) return r;
    }
    return null;
  }
  for (const v of Object.values(node as Record<string, unknown>)) {
    const r = findProductArray(v, depth + 1);
    if (r) return r;
  }
  return null;
}

/** Antwort von aliexpress.ds.image.searchV2 → Treffer oder Fehler (code/msg wörtlich). */
export function parseAliImageSearchResponse(data: Record<string, unknown>): AliImageSearchParsed {
  const err = data['error_response'] as Record<string, unknown> | undefined;
  if (err) return { ok: false, code: String(err.code ?? 'unknown'), msg: String(err.msg ?? err.sub_msg ?? '') };

  const resp = Object.entries(data).find(([k]) => /image_?search/i.test(k))?.[1] as Record<string, unknown> | undefined;
  if (!resp || typeof resp !== 'object') return { ok: false, code: 'no_response', msg: JSON.stringify(data).slice(0, 300) };

  const rc = resp.rsp_code ?? resp.code;
  if (rc !== undefined && !['00', '0', '200'].includes(String(rc))) {
    return { ok: false, code: String(rc), msg: String(resp.rsp_msg ?? resp.msg ?? resp.message ?? '') };
  }

  const list = findProductArray(resp) ?? [];
  const hits: AliSearchHit[] = list.map(p => {
    const id = String(pick(p, ID_KEYS));
    let image = String(pick(p, ['itemMainPic', 'item_main_pic', 'product_main_image_url', 'imageUrl', 'image_url']) ?? '');
    if (image.startsWith('//')) image = 'https:' + image;
    let url = String(pick(p, ['itemUrl', 'item_url', 'product_detail_url', 'detail_url']) ?? '');
    if (url.startsWith('//')) url = 'https:' + url;
    if (!url) url = `https://de.aliexpress.com/item/${id}.html`;
    return {
      id,
      title: String(pick(p, ['title', 'subject', 'product_title']) ?? '').trim(),
      image,
      price: num(pick(p, ['targetSalePrice', 'target_sale_price', 'salePrice', 'sale_price', 'price'])),
      shipFrom: '?',
      isEU: false,
      rating: num(pick(p, ['evaluateRate', 'evaluate_rate', 'rating'])),
      sold: Math.round(num(pick(p, ['orders', 'lastest_volume', 'volume', 'sold']))),
      url,
      relevant: true,
    };
  });
  return { ok: true, hits };
}

/** Günstigste zuerst (Preis > 0), Treffer ohne Preis ans Ende; stabil. */
export function cheapestFirst(hits: AliSearchHit[]): AliSearchHit[] {
  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => (a.h.price > 0 ? a.h.price : Infinity) - (b.h.price > 0 ? b.h.price : Infinity) || a.i - b.i)
    .map(x => x.h);
}
