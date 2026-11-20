// Nachzieh-Weg Rücklesen (AUFTRAG Aufsicht an 7 App 20.11.2026 11:25, Fund 243): Die App meldete beim Neusenden der Beschreibung
// "ok", eBay zeigte aber weiter die alte Vorlage (itm.ebaydesc.com/itmdesc/198755130523). Darum: nach jedem Senden bei eBay zurücklesen
// (GetItem, DetailLevel ReturnAll) und "ok" nur bei Gleichheit. Reine Funktionen (Grundgesetz 2): XML lesen + Text vergleichen.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? decodeNamed(n) ?? m);
}

// Nur die in unseren Vorlagen vorkommenden benannten Zeichen (Umlaute, Satzzeichen); unbekannte bleiben stehen.
const NAMED: Record<string, string> = {
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', middot: '·', ndash: '–', mdash: '—',
  bdquo: '„', ldquo: '“', rdquo: '”', sect: '§', euro: '€', times: '×', hellip: '…', copy: '©', reg: '®',
};
function decodeNamed(n: string): string | undefined { return NAMED[n]; }

/** Sichtbarer Text einer HTML-Beschreibung, vergleichbar gemacht (ohne Tags/Kommentare/Style, Entities aufgelöst, Leerraum zusammengefasst). */
export function visibleText(html: string): string {
  const noCdata = html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const stripped = noCdata
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(decodeEntities(stripped)).replace(/\s+/g, ' ').trim();
}

/** Title + Description aus einer GetItem-Antwort (Trading API). null = Feld nicht gefunden. */
export function parseGetItemContent(xml: string): { title: string | null; description: string | null; ack: string | null } {
  const item = xml.match(/<Item>([\s\S]*)<\/Item>/)?.[1] ?? '';
  const ack = xml.match(/<Ack>([^<]*)<\/Ack>/)?.[1] ?? null;
  const title = item.match(/<Title>([\s\S]*?)<\/Title>/)?.[1] ?? null;
  const description = item.match(/<Description>([\s\S]*?)<\/Description>/)?.[1] ?? null;
  return { title: title === null ? null : decodeEntities(title).trim(), description: description === null ? null : decodeEntities(description), ack };
}

export interface ReadbackResult { ok: boolean; error?: string }

/**
 * Vergleicht das Gesendete mit dem, was eBay zurückgibt. Beschreibung: sichtbarer Text gleich. Titel (falls gesendet): exakt gleich
 * (ohne Rand-Leerzeichen). Bei Abweichung kommt die erste abweichende Stelle (je 60 Zeichen) in die Fehlermeldung.
 */
export function compareReadback(itemId: string, sent: { htmlDescription?: string; title?: string }, xml: string): ReadbackResult {
  const got = parseGetItemContent(xml);
  if (got.ack !== 'Success' && got.ack !== 'Warning') return { ok: false, error: `Rücklesen ${itemId}: GetItem Ack=${got.ack ?? 'fehlt'}` };
  if (sent.htmlDescription !== undefined) {
    if (got.description === null) return { ok: false, error: `Rücklesen ${itemId}: keine Beschreibung in GetItem` };
    const a = visibleText(sent.htmlDescription);
    const b = visibleText(got.description);
    if (a !== b) {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return { ok: false, error: `Beschreibung bei eBay NICHT übernommen (Angebot ${itemId}): gesendet "…${a.slice(i, i + 60)}…" · eBay "…${b.slice(i, i + 60)}…"` };
    }
  }
  if (sent.title !== undefined && sent.title.trim() !== (got.title ?? '').trim()) {
    return { ok: false, error: `Titel bei eBay NICHT übernommen (Angebot ${itemId}): gesendet "${sent.title.trim()}" · eBay "${got.title ?? ''}"` };
  }
  return { ok: true };
}
