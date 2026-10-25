// P-37: reine Logik für die Suche über aliexpress.ds.text.search (Sort-Mapping, Antwort-Mapping,
// Fehlererkennung, Sortierung nach Versandland). Kein I/O — testbar ohne AliExpress-Zugang.

export interface AliSearchHit {
  id: string;
  title: string;
  image: string;
  price: number;
  shipFrom: string;
  isEU: boolean;
  rating: number;
  sold: number;
  url: string;
}

export type AliSearchParsed =
  | { ok: true; hits: AliSearchHit[]; total: number }
  | { ok: false; code: string; msg: string };

const SORT_MAP: Record<string, string> = {
  LAST_VOLUME_DESC: 'orders,desc',
  SALE_PRICE_ASC: 'min_price,asc',
  SALE_PRICE_DESC: 'min_price,desc',
};

/** Frontend-Sortierung → sortBy der API. Unbekannt → Meistverkauft. */
export function mapAliSearchSort(frontendSort: string | undefined): string {
  return SORT_MAP[frontendSort ?? ''] ?? SORT_MAP.LAST_VOLUME_DESC;
}

const EU_SHIP_FROM = ['germany', 'spain', 'france', 'italy', 'poland', 'netherlands', 'czech', 'austria', 'belgium', 'luxembourg', 'sweden', 'portugal', 'hungary'];
const EU_CODES = ['de', 'es', 'fr', 'it', 'pl', 'nl', 'cz', 'at', 'be', 'lu', 'se', 'pt', 'hu'];

export function isEuShipFrom(shipFrom: string): boolean {
  const s = shipFrom.trim().toLowerCase();
  if (!s || s === '?') return false;
  return EU_CODES.includes(s) || EU_SHIP_FROM.some(c => s.includes(c));
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** "95.5%" → 4.8 (Sterne 0–5); bereits ≤5 bleibt unverändert. */
function toRating(v: unknown): number {
  const n = toNumber(v);
  return n > 5 ? Math.round((n / 20) * 10) / 10 : n;
}

/** Antwort von aliexpress.ds.text.search → Treffer oder Fehler (code/msg wörtlich). */
export function parseAliTextSearchResponse(data: Record<string, unknown>): AliSearchParsed {
  const err = data['error_response'] as Record<string, unknown> | undefined;
  if (err) return { ok: false, code: String(err.code ?? 'unknown'), msg: String(err.msg ?? err.sub_msg ?? '') };

  const resp = data['aliexpress_ds_text_search_response'] as Record<string, unknown> | undefined;
  if (!resp) return { ok: false, code: 'no_response', msg: JSON.stringify(data).slice(0, 300) };

  const payload = (resp.data as Record<string, unknown> | undefined) ?? resp;
  const rc = resp.rsp_code ?? payload.rsp_code;
  if (rc !== undefined && String(rc) !== '200') {
    return { ok: false, code: String(rc), msg: String(resp.rsp_msg ?? payload.rsp_msg ?? '') };
  }

  const products = payload.products as unknown;
  let rawList: Record<string, unknown>[] = [];
  if (Array.isArray(products)) rawList = products as Record<string, unknown>[];
  else if (products && typeof products === 'object') {
    const inner = (products as Record<string, unknown>).selection_search_product;
    if (Array.isArray(inner)) rawList = inner as Record<string, unknown>[];
  }

  const hits: AliSearchHit[] = rawList
    .filter(p => p && (p.itemId !== undefined && p.itemId !== null))
    .map(p => {
      const id = String(p.itemId);
      let image = String(p.itemMainPic ?? '');
      if (image.startsWith('//')) image = 'https:' + image;
      let url = String(p.itemUrl ?? '');
      if (url.startsWith('//')) url = 'https:' + url;
      if (!url) url = `https://de.aliexpress.com/item/${id}.html`;
      return {
        id,
        title: String(p.title ?? '').trim(),
        image,
        price: toNumber(p.targetSalePrice ?? p.salePrice),
        shipFrom: '?',
        isEU: false,
        rating: toRating(p.evaluateRate),
        sold: Math.round(toNumber(p.orders)),
        url,
      };
    });

  const total = Math.round(toNumber(payload.totalCount ?? payload.total_count)) || hits.length;
  return { ok: true, hits, total };
}

/** Bei ship_from=DE: EU-Treffer nach oben (stabil), andere bleiben sichtbar. */
export function sortEuFirst(hits: AliSearchHit[], shipFromFilter: string): AliSearchHit[] {
  if (shipFromFilter.toUpperCase() !== 'DE') return hits;
  return [...hits.map((h, i) => ({ h, i }))]
    .sort((a, b) => (Number(b.h.isEU) - Number(a.h.isEU)) || a.i - b.i)
    .map(x => x.h);
}
