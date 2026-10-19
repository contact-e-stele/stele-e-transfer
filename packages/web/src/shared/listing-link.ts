// Angebot verknüpfen (Inhaber 19.10.2026 "228 verknüpfen"): ein außerhalb der App eingestelltes eBay-Angebot dem App-Produkt zuordnen,
// damit Multi-Rabatt, Preis- und Mengenabgleich es kennen. REINE Prüfung auf der GetItem-Antwort (Trading API, nur lesen).
// Verknüpft wird nur, wenn das Angebot bei eBay aktiv ist und seine Bestandseinheit (SKU) zu genau diesem Produkt gehört:
// "stele-<id>", "stele-<id>-GROUP" oder Varianten-SKUs "stele-<id>-…". Nichts raten: sonst Ablehnung mit Grund.
import { parseGetItemStatus } from './listing-status-abgleich';

export interface LinkCheck {
  ok: boolean;
  reason: string | null;
  listingStatus: string | null;
  itemSku: string | null;
  variantSkus: string[];
  title: string | null;
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function checkListingLink(xml: string, productId: number, httpStatus = 200): LinkCheck {
  const st = parseGetItemStatus(xml, httpStatus);
  const variationsBlock = xml.match(/<Variations>([\s\S]*?)<\/Variations>/)?.[1] ?? '';
  const variantSkus = [...variationsBlock.matchAll(/<Variation>[\s\S]*?<SKU>([^<]*)<\/SKU>/g)].map(m => decode(m[1].trim())).filter(Boolean);
  const head = xml.replace(/<Variations>[\s\S]*?<\/Variations>/, '');
  const itemSku = head.match(/<Item>[\s\S]*?<SKU>([^<]*)<\/SKU>/)?.[1]?.trim() ?? null;
  const title = head.match(/<Title>([^<]*)<\/Title>/)?.[1] ? decode(head.match(/<Title>([^<]*)<\/Title>/)![1]) : null;
  const base: Omit<LinkCheck, 'ok' | 'reason'> = { listingStatus: st.listingStatus, itemSku: itemSku ? decode(itemSku) : null, variantSkus, title };
  if (httpStatus !== 200 || st.ack === 'Failure') return { ok: false, reason: `eBay GetItem nicht lesbar (HTTP ${httpStatus}, Ack ${st.ack ?? '?'}, Fehler ${st.errorCode ?? '?'})`, ...base };
  if (st.listingStatus !== 'Active') return { ok: false, reason: `Angebot ist bei eBay nicht aktiv (Status ${st.listingStatus ?? 'unbekannt'})`, ...base };
  const prefix = `stele-${productId}`;
  const own = (sku: string | null) => !!sku && (sku === prefix || sku.startsWith(`${prefix}-`));
  if (!own(base.itemSku) && !(variantSkus.length > 0 && variantSkus.every(own))) {
    return { ok: false, reason: `Bestandseinheit passt nicht zu stele-${productId} (Angebot: ${base.itemSku ?? 'keine'}${variantSkus.length ? `, Varianten: ${variantSkus.join(', ')}` : ''})`, ...base };
  }
  return { ok: true, reason: null, ...base };
}
