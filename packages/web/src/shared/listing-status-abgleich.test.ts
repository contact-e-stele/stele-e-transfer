// A-027: Tests mit den 3 ECHTEN Fällen vom 04.10.2026 (GetItem-Antworten von eBay, nur gelesen) und einem aktiven Listing. Die XML-Texte sind auf
// die relevanten Tags GEKÜRZT (keine Käufer-/Verkäuferdaten), alle Werte stammen unverändert aus den echten Antworten:
//   198601109182 (stele-71)  Completed, EndTime 2026-09-09T20:28:37Z, EndingReason NotAvailable
//   198562902347 (stele-120) Ack Failure, Completed, EndTime 2026-08-28T10:34:45Z, EndingReason OtherListingError, Fehler 21920397 ON_HOLD_FIXABLE
//   198589591311 (stele-137) Ack Failure, Completed, EndTime 2026-08-28T10:35:11Z, EndingReason OtherListingError, Fehler 21920397 ON_HOLD_FIXABLE
//   198601077240 (stele-119) Active, EndTime 2026-10-28T12:14:09Z
import { describe, expect, test } from 'bun:test';
import { parseGetItemStatus, planListingStatusAbgleich, patchForEnded, renderAbgleichMarkdown, type AppListedProduct } from './listing-status-abgleich';

const WARN = '<Errors><ShortMessage>x</ShortMessage><ErrorCode>21915461</ErrorCode><SeverityCode>Warning</SeverityCode></Errors>';
const POLICY = '<Errors><ShortMessage>Dieses Angebot verstößt gegen unseren Grundsatz zu Käufen und Verkäufen außerhalb von eBay.</ShortMessage><ErrorCode>21920397</ErrorCode><SeverityCode>Error</SeverityCode><ErrorParameters ParamID="3"><Value>Grundsatz zu Käufen und Verkäufen außerhalb von eBay</Value></ErrorParameters><ErrorParameters ParamID="4"><Value>ON_HOLD_FIXABLE</Value></ErrorParameters><ErrorClassification>RequestError</ErrorClassification></Errors>';
const xml = (o: { ack: string; status: string; start: string; end: string; reason?: string; policy?: boolean }) =>
  `<?xml version="1.0" encoding="UTF-8"?><GetItemResponse xmlns="urn:ebay:apis:eBLBaseComponents"><Ack>${o.ack}</Ack>${o.policy ? POLICY : ''}${WARN}<Item><ListingDetails><StartTime>${o.start}</StartTime><EndTime>${o.end}</EndTime>${o.reason ? `<EndingReason>${o.reason}</EndingReason>` : ''}</ListingDetails><SellingStatus><ListingStatus>${o.status}</ListingStatus></SellingStatus></Item></GetItemResponse>`;

const X71 = xml({ ack: 'Success', status: 'Completed', start: '2026-08-28T11:38:09.000Z', end: '2026-09-09T20:28:37.000Z', reason: 'NotAvailable' });
const X120 = xml({ ack: 'Failure', status: 'Completed', start: '2026-08-11T07:10:33.000Z', end: '2026-08-28T10:34:45.000Z', reason: 'OtherListingError', policy: true });
const X137 = xml({ ack: 'Failure', status: 'Completed', start: '2026-08-23T09:25:27.000Z', end: '2026-08-28T10:35:11.000Z', reason: 'OtherListingError', policy: true });
const X119 = xml({ ack: 'Success', status: 'Active', start: '2026-08-28T11:14:09.000Z', end: '2026-10-28T12:14:09.000Z' });

const prod = (id: number, listingId: string | null, status: string | null = 'listed'): AppListedProduct => ({ id, title: 'T' + id, ebayStatus: status, ebayListingId: listingId });
const P = [prod(71, '198601109182'), prod(119, '198601077240'), prod(120, '198562902347'), prod(137, '198589591311')];
const infos = () => new Map([
  ['198601109182', parseGetItemStatus(X71)], ['198601077240', parseGetItemStatus(X119)],
  ['198562902347', parseGetItemStatus(X120)], ['198589591311', parseGetItemStatus(X137)],
]);

describe('parseGetItemStatus (echte Werte)', () => {
  test('71: Completed, EndTime, EndingReason NotAvailable, kein Fehler (die Selektor-Warnung 21915461 zählt nicht)', () => {
    expect(parseGetItemStatus(X71)).toMatchObject({ ack: 'Success', listingStatus: 'Completed', endTime: '2026-09-09T20:28:37.000Z', endingReason: 'NotAvailable', errorCode: null, errorHold: null });
  });
  test('120/137: Ack Failure, Completed, OtherListingError, Fehler 21920397 ON_HOLD_FIXABLE', () => {
    expect(parseGetItemStatus(X120)).toMatchObject({ ack: 'Failure', listingStatus: 'Completed', endTime: '2026-08-28T10:34:45.000Z', endingReason: 'OtherListingError', errorCode: '21920397', errorHold: 'ON_HOLD_FIXABLE' });
    expect(parseGetItemStatus(X137).endTime).toBe('2026-08-28T10:35:11.000Z');
  });
  test('119: Active, kein EndingReason', () => {
    expect(parseGetItemStatus(X119)).toMatchObject({ listingStatus: 'Active', endingReason: null, errorCode: null });
  });
});

describe('planListingStatusAbgleich', () => {
  const rows = planListingStatusAbgleich(P, infos());
  test('3 beendete (71/120/137) → mark_ended mit Datum und wörtlichem Grund; aktives 119 → ok', () => {
    expect(rows.map(r => [r.productId, r.ebayStatus, r.action])).toEqual([[71, 'Completed', 'mark_ended'], [119, 'Active', 'ok'], [120, 'Completed', 'mark_ended'], [137, 'Completed', 'mark_ended']]);
    expect(rows[0]).toMatchObject({ endedAt: '2026-09-09T20:28:37.000Z', reason: 'EndingReason NotAvailable' });
    expect(rows[2].reason).toBe('EndingReason OtherListingError + Fehler 21920397 ON_HOLD_FIXABLE');
  });
  test('nicht gelesene/unlesbare Listings und fehlende Listing-ID → check_manually (nie automatisch ändern)', () => {
    const r = planListingStatusAbgleich([prod(1, '111'), prod(2, null), prod(3, '333')], new Map([['333', parseGetItemStatus('<GetItemResponse><Ack>Failure</Ack></GetItemResponse>', 500)]]));
    expect(r.map(x => x.action)).toEqual(['check_manually', 'check_manually', 'check_manually']);
    expect(r[1].ebayStatus).toBe('keine Listing-ID in der App');
    expect(r[2].reason).toContain('HTTP 500');
  });
  test('unbekannter ListingStatus → check_manually; Produkte, die die App nicht als listed führt, werden ignoriert', () => {
    const odd = parseGetItemStatus(xml({ ack: 'Success', status: 'Custom', start: 'a', end: 'b' }));
    const r = planListingStatusAbgleich([prod(5, '555'), prod(6, '666', 'none'), prod(7, '777', 'error')], new Map([['555', odd]]));
    expect(r.map(x => [x.productId, x.action])).toEqual([[5, 'check_manually']]);
  });
  test('patchForEnded: Standard = Status "none", kein Fehlertext, ebayListingId null (wie alle End-Pfade); mit keepListingId bleibt die ID unangetastet', () => {
    expect(patchForEnded()).toEqual({ ebayStatus: 'none', ebayError: null, ebayListingId: null });
    expect(patchForEnded(true)).toEqual({ ebayStatus: 'none', ebayError: null });
    expect('ebayListingId' in patchForEnded(true)).toBe(false);
  });
  test('HTTP 200 mit Ack Failure ohne ListingStatus (Item nicht gefunden) → check_manually, niemals mark_ended', () => {
    const nf = parseGetItemStatus('<GetItemResponse><Ack>Failure</Ack><Errors><ErrorCode>17</ErrorCode><SeverityCode>Error</SeverityCode></Errors></GetItemResponse>', 200);
    const r = planListingStatusAbgleich([prod(9, '999')], new Map([['999', nf]]));
    expect(r[0].action).toBe('check_manually');
    expect(r[0].reason).toContain('Fehler 17');
  });
  test('mehrfach vorkommendes ListingStatus-Tag: erster Treffer zählt (konservativ prüfbar)', () => {
    expect(parseGetItemStatus('<A><ListingStatus>Active</ListingStatus><B><ListingStatus>Completed</ListingStatus></B></A>').listingStatus).toBe('Active');
  });
  test('Markdown: Zählung, deutsches Datum, "nichts geschrieben"', () => {
    const md = renderAbgleichMarkdown(rows, 4, false, '2026-10-04T00:00:00Z');
    expect(md).toContain('TROCKENLAUF — nichts geschrieben');
    expect(md).toContain("App führt 4 Produkte als 'listed'. Bei eBay aktiv: 1, beendet: 3, nicht entscheidbar: 0.");
    expect(md).toContain('| stele-71 | 198601109182 | listed | Completed | 09.09.2026 | EndingReason NotAvailable | mark_ended |');
  });
});
