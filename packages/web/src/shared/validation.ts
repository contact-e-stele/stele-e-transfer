// P-88 Nacharbeit Punkt 4 (20.09.2026): PUT /api/settings/aspect-defaults nahm bisher jeden Wert
// unter "global"/"byCategory.<kat>" ungeprüft an (nur ein `as`-Cast) — eine Zahl, ein Array oder
// ein verschachteltes Objekt landete roh in app_settings und brach getAspectDefaultWithSource()
// (ebay.ts), das dort Record<string,string> erwartet, erst beim nächsten Listing-Versuch.
export function isStringRecord(v: unknown): v is Record<string, string> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    && Object.values(v as Record<string, unknown>).every(x => typeof x === 'string');
}
