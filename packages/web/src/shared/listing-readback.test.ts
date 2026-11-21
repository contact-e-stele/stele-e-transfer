// Nachzieh-Weg Rücklesen (Fund 243, 20.11.2026): eBay zeigte weiter die alte Vorlage, die App meldete "ok".
import { describe, expect, test } from 'bun:test';
import { compareReadback, parseGetItemContent, visibleText } from './listing-readback';
import { reviseListingDescriptionVerified } from '../api/ebay';

const item = (title: string, desc: string, ack = 'Success') =>
  `<?xml version="1.0"?><GetItemResponse><Ack>${ack}</Ack><Item><ItemID>1</ItemID><Title>${title}</Title><Description>${desc}</Description></Item></GetItemResponse>`;

// Ausschnitt der ALTEN 243-Beschreibung, wie eBay sie am 20.11. noch zeigte (itm.ebaydesc.com, gelesen 10:3x).
const ALT_243 = '&lt;p&gt;Warme Touchscreen-Handschuhe von WRELS f&amp;uuml;r Damen&lt;/p&gt;&lt;li&gt;Gewebetechnik: Tatting&lt;/li&gt;';
const NEU_243 = '<!-- stele-beschreibung: v3 --><p>Warme Touchscreen-Handschuhe f&uuml;r Damen</p><li>Strickart: Feine, dichte Strickstruktur</li>';

describe('visibleText / parseGetItemContent', () => {
  test('Tags, Kommentare, Entities, Leerraum', () => {
    expect(visibleText('<!-- x --><p>Gr&ouml;&szlig;e&nbsp;&middot;  L</p>\n<b>A</b>')).toBe('Größe · L A');
  });
  test('GetItem escaped HTML wird gelesen', () => {
    const g = parseGetItemContent(item('Titel &amp; Co', NEU_243.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/&(?!lt;|gt;)/g, '&amp;')));
    expect(g.title).toBe('Titel & Co');
    expect(visibleText(g.description ?? '')).toBe(visibleText(NEU_243));
  });
});

describe('compareReadback', () => {
  const esc = (h: string) => h.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  test('gleich → ok', () => {
    expect(compareReadback('198755130523', { htmlDescription: NEU_243, title: 'T' }, item('T', esc(NEU_243))).ok).toBe(true);
  });
  test('Fall 243: eBay zeigt alten Text → Fehler mit Angebotsnummer und Stelle', () => {
    const r = compareReadback('198755130523', { htmlDescription: NEU_243 }, item('T', ALT_243));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('198755130523');
    expect(r.error).toContain('NICHT übernommen');
  });
  test('Titel abweichend → Fehler', () => {
    const r = compareReadback('1', { htmlDescription: NEU_243, title: 'Hundeschuhe Winter' }, item('HOLAPET Hundeschuhe Winter', esc(NEU_243)));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Titel');
  });
  test('Ack Failure → Fehler', () => {
    expect(compareReadback('1', { htmlDescription: NEU_243 }, item('T', esc(NEU_243), 'Failure')).ok).toBe(false);
  });
});

describe('reviseListingDescriptionVerified', () => {
  const esc = (h: string) => h.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const okRevise = async () => ({ ok: true });
  const noSleep = { sleep: async () => {}, attempts: 3, delayMs: 0 };
  test('Senden ok + eBay gleich → ok', async () => {
    const r = await reviseListingDescriptionVerified(243, 'X', { htmlDescription: NEU_243 }, async () => ({ httpStatus: 200, xml: item('T', esc(NEU_243)) }), okRevise as never, noSleep);
    expect(r.ok).toBe(true);
  });
  test('Senden ok, eBay zeigt alt (Scheinerfolg 243) → NICHT ok', async () => {
    let calls = 0;
    const r = await reviseListingDescriptionVerified(243, 'X', { htmlDescription: NEU_243 }, async () => { calls++; return { httpStatus: 200, xml: item('T', ALT_243) }; }, okRevise as never, noSleep);
    expect(r.ok).toBe(false);
    expect(calls).toBe(3);
    expect(r.error).toContain('nicht bestätigt');
  });
  test('erst alt, beim 2. Versuch neu → ok', async () => {
    let n = 0;
    const r = await reviseListingDescriptionVerified(243, 'X', { htmlDescription: NEU_243 }, async () => ({ httpStatus: 200, xml: item('T', n++ === 0 ? ALT_243 : esc(NEU_243)) }), okRevise as never, noSleep);
    expect(r.ok).toBe(true);
  });
  test('Senden fehlgeschlagen → Fehler weiter, kein Rücklesen', async () => {
    let calls = 0;
    const r = await reviseListingDescriptionVerified(243, 'X', { htmlDescription: NEU_243 }, async () => { calls++; return { httpStatus: 200, xml: '' }; }, (async () => ({ ok: false, error: 'E' })) as never, noSleep);
    expect(r).toEqual({ ok: false, error: 'E' });
    expect(calls).toBe(0);
  });
  test('GetItem wirft → nicht bestätigt (kein Scheinerfolg)', async () => {
    const r = await reviseListingDescriptionVerified(243, 'X', { htmlDescription: NEU_243 }, async () => { throw new Error('netz'); }, okRevise as never, noSleep);
    expect(r.ok).toBe(false);
  });
});
