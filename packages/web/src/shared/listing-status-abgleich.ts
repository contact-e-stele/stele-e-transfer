// A-027 (Live-Fund 04.10.2026): Die App führte 61 Produkte als ebayStatus='listed', im Listings-Tab (eBay aktiv) standen nur 58 — stele-71,
// stele-120 und stele-137 waren bei eBay längst beendet (ListingStatus Completed). Folge: Produkte-Tab blendet sie als "live" aus, Listings-Tab
// zeigt sie nicht → niemand kann sie neu listen. REINE Funktionen (kein DB-/eBay-Zugriff): das Skript scripts/listing-status-abgleich.ts liest
// die App-Daten und holt je Listing per Trading-API GetItem den Status (nur GET), diese Datei wertet aus und plant.
//
// Quelle der Wahrheit bei eBay: GetItem → SellingStatus.ListingStatus (Active | Completed | Ended), ListingDetails.EndTime/EndingReason,
// bei Richtlinienverstoß zusätzlich Errors (ErrorCode 21920397 = "Grundsatz zu Käufen und Verkäufen außerhalb von eBay", Parameter
// ON_HOLD_FIXABLE). Die Gründe werden WÖRTLICH aus eBays Antwort übernommen, nichts wird gedeutet oder erfunden.

export interface ItemStatusInfo {
  httpStatus: number;
  ack: string | null;
  listingStatus: string | null;   // Active | Completed | Ended | null (nicht lesbar)
  startTime: string | null;
  endTime: string | null;
  endingReason: string | null;    // z. B. "NotAvailable", "OtherListingError"
  errorCode: string | null;       // erster Fehler mit Severity "Error" (nicht die Selektor-Warnung 21915461)
  errorHold: string | null;       // z. B. "ON_HOLD_FIXABLE" (ErrorParameter 4)
}

const tag = (xml: string, t: string): string | null => xml.match(new RegExp(`<${t}(?:\\s[^>]*)?>([^<]*)</${t}>`))?.[1]?.trim() || null;

export function parseGetItemStatus(xml: string, httpStatus = 200): ItemStatusInfo {
  const blocks = [...xml.matchAll(/<Errors>([\s\S]*?)<\/Errors>/g)].map(m => m[1]);
  const firstError = blocks.find(b => tag(b, 'SeverityCode') === 'Error');
  return {
    httpStatus,
    ack: tag(xml, 'Ack'),
    listingStatus: tag(xml, 'ListingStatus'),
    startTime: tag(xml, 'StartTime'),
    endTime: tag(xml, 'EndTime'),
    endingReason: tag(xml, 'EndingReason'),
    errorCode: firstError ? tag(firstError, 'ErrorCode') : null,
    errorHold: firstError ? (firstError.match(/ParamID="4"[^>]*><Value>([^<]*)</)?.[1]?.trim() || null) : null,
  };
}

export interface AppListedProduct {
  id: number;
  title: string;
  ebayStatus: string | null;
  ebayListingId: string | null;
}

export type ReconcileAction =
  | 'ok'               // bei eBay aktiv — nichts zu tun
  | 'mark_ended'       // bei eBay beendet (Completed/Ended) — App-Status zurücksetzen (nur mit --apply)
  | 'check_manually';  // nicht entscheidbar (keine Listing-ID, GetItem nicht lesbar) — nie automatisch ändern

export interface ReconcileRow {
  productId: number;
  title: string;
  listingId: string | null;
  appStatus: string;
  ebayStatus: string;             // Active | Completed | Ended | nicht lesbar
  endedAt: string | null;
  reason: string | null;          // wörtlich aus eBay
  action: ReconcileAction;
}

export function describeReason(info: ItemStatusInfo): string | null {
  const parts: string[] = [];
  if (info.endingReason) parts.push(`EndingReason ${info.endingReason}`);
  if (info.errorCode) parts.push(`Fehler ${info.errorCode}${info.errorHold ? ' ' + info.errorHold : ''}`);
  return parts.length > 0 ? parts.join(' + ') : null;
}

// Nur Produkte, die die App als 'listed' führt, werden verglichen. infos: Listing-ID → GetItem-Ergebnis (fehlt der Eintrag: nicht gelesen).
export function planListingStatusAbgleich(products: AppListedProduct[], infos: Map<string, ItemStatusInfo>): ReconcileRow[] {
  const rows: ReconcileRow[] = [];
  for (const p of products) {
    if (p.ebayStatus !== 'listed') continue;
    const base = { productId: p.id, title: p.title, listingId: p.ebayListingId, appStatus: 'listed' };
    if (!p.ebayListingId) { rows.push({ ...base, ebayStatus: 'keine Listing-ID in der App', endedAt: null, reason: null, action: 'check_manually' }); continue; }
    const info = infos.get(p.ebayListingId);
    if (!info || !info.listingStatus) {
      rows.push({ ...base, ebayStatus: 'nicht lesbar', endedAt: null, reason: info ? `HTTP ${info.httpStatus}, Ack ${info.ack ?? '–'}${describeReason(info) ? ', ' + describeReason(info) : ''}` : 'GetItem nicht abgefragt', action: 'check_manually' });
      continue;
    }
    if (info.listingStatus === 'Active') { rows.push({ ...base, ebayStatus: 'Active', endedAt: null, reason: null, action: 'ok' }); continue; }
    if (info.listingStatus === 'Completed' || info.listingStatus === 'Ended') {
      rows.push({ ...base, ebayStatus: info.listingStatus, endedAt: info.endTime, reason: describeReason(info), action: 'mark_ended' });
      continue;
    }
    rows.push({ ...base, ebayStatus: info.listingStatus, endedAt: info.endTime, reason: describeReason(info), action: 'check_manually' });
  }
  return rows;
}

// Was bei --apply in die DB geschrieben wird: der vorhandene Status für "nicht mehr gelistet" ('none', wie bei "Beenden" und der
// Auto-Deaktivierung) und kein Fehlertext. ebayListingId bleibt UNVERÄNDERT als Historie (alle Stellen, die den Status 'listed' brauchen,
// sehen das Produkt danach als nicht gelistet; "Bei eBay listen" überschreibt die ID beim Re-Listing).
export function patchForEnded(): { ebayStatus: 'none'; ebayError: null } {
  return { ebayStatus: 'none', ebayError: null };
}

export function renderAbgleichMarkdown(rows: ReconcileRow[], totalListed: number, apply: boolean, generatedAt: string): string {
  const count = (a: ReconcileAction) => rows.filter(r => r.action === a).length;
  const d = (s: string | null) => (s ? s.slice(0, 10).split('-').reverse().join('.') : '–');
  const lines = [
    `# Abgleich App-Status gegen eBay (${apply ? 'APPLY' : 'TROCKENLAUF — nichts geschrieben'})`,
    '',
    `Lauf: ${generatedAt}`,
    `App führt ${totalListed} Produkte als 'listed'. Bei eBay aktiv: ${count('ok')}, beendet: ${count('mark_ended')}, nicht entscheidbar: ${count('check_manually')}.`,
    '',
    '| Produkt | Listing-ID | App-Status | eBay-Status | beendet am | Grund (wörtlich aus eBay) | Aktion |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(r => `| stele-${r.productId} | ${r.listingId ?? '–'} | ${r.appStatus} | ${r.ebayStatus} | ${d(r.endedAt)} | ${r.reason ?? ''} | ${r.action} |`),
  ];
  return lines.join('\n') + '\n';
}
