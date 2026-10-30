import { describe, expect, test } from 'bun:test';
import { bidText, bulkAdRequests, parseBulkAdResponse, pickCpsCampaign } from './campaign-ads';

// Live 29.10.2026 (GET /api/ebay/promoted-status): eine Kampagne 154721036015, RUNNING, COST_PER_SALE, Standard 10 %.
const live = [{ campaignId: '154721036015', campaignName: 'Kampagne 18.11.2025 17:35:52', campaignStatus: 'RUNNING', fundingModel: 'COST_PER_SALE', bidPercentage: 10 }];

describe('Kampagne 5 % (OFFEN 018)', () => {
  test('eine laufende CPS-Kampagne wird gewählt', () => {
    const r = pickCpsCampaign(live);
    expect(r.ok && r.campaign.campaignId).toBe('154721036015');
  });
  test('keine / mehrere / falsche Kampagne → klarer Fehler', () => {
    expect(pickCpsCampaign([]).ok).toBe(false);
    expect(pickCpsCampaign([...live, { ...live[0], campaignId: '2' }]).ok).toBe(false);
    expect(pickCpsCampaign(live, '999').ok).toBe(false);
    expect(pickCpsCampaign([{ ...live[0], campaignStatus: 'PAUSED' }], '154721036015').ok).toBe(false);
  });
  test('5 % ausdrücklich je Anzeige (nicht Kampagnen-Standard 10 %)', () => {
    expect(bidText(5)).toBe('5.0');
    expect(bulkAdRequests(['198754366503', '198754366503', '198755130523'], 5)).toEqual({ requests: [
      { listingId: '198754366503', bidPercentage: '5.0' }, { listingId: '198755130523', bidPercentage: '5.0' },
    ] });
    expect(() => bidText(1)).toThrow();
    expect(() => bidText(Number.NaN)).toThrow();
  });
  test('Antwort je Angebot: ok / schon vorhanden / Fehler', () => {
    const r = parseBulkAdResponse({ responses: [
      { listingId: '1', statusCode: 201, adId: 'a1' },
      { listingId: '2', statusCode: 400, errors: [{ errorId: 35036, message: 'The listing ID already exists in the campaign.' }] },
      { listingId: '3', statusCode: 400, errors: [{ errorId: 35048, message: 'The listing ID is invalid.' }] },
    ] });
    expect(r).toEqual([
      { listingId: '1', ok: true, alreadyExists: false, error: null },
      { listingId: '2', ok: false, alreadyExists: true, error: '35036 The listing ID already exists in the campaign.' },
      { listingId: '3', ok: false, alreadyExists: false, error: '35048 The listing ID is invalid.' },
    ]);
  });
});
