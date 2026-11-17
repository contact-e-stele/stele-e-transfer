// 050 P4: Pflicht-Daten-Vorschlag statt Stopp. Fehlen Material, Maße oder die Hersteller-PLZ, schlägt die App Werte vor —
// nur mit Quelle, nie erfunden. Der Einsteller bestätigt mit einem Klick (gespeichert wird erst dann, mit Quelle/Fundstelle).
// REINE Funktionen (Grundgesetz 2): kein Netz, keine DB.
//  - Material/Maße: aus eBay-Konkurrenzangeboten (Browse API, localizedAspects). Vorgeschlagen wird ein Wert NUR, wenn ihn mindestens
//    2 verschiedene Angebote gleich angeben (Groß/Klein, Leerzeichen egal). Ein einzelnes Angebot reicht nicht (könnte ein anderes Produkt sein).
//  - Hersteller-PLZ: (1) eine eindeutige 6-stellige Zahl in der AliExpress-Herstellerangabe, sonst (2) die Haupt-PLZ der Stadt aus dem
//    Verzeichnis unten, wenn die Stadt in der Herstellerangabe steht. Mehrdeutig (zwei Städte / zwei Zahlen) → kein Vorschlag.

export const MIN_GLEICHE_ANGEBOTE = 2;

/** Haupt-Postleitzahl (Stadt-PLZ) chinesischer Herstellerstädte. NUR belegte Werte (Grundgesetz 4), geprüft 17.11.2026 gegen
 *  chinadiscovery.com (Area & Zip Code), chinaxiantour.com (area-and-zip-codes) und geopostcodes.com (Guangdong-Liste).
 *  Noch NICHT belegt und deshalb nicht enthalten: Dongguan, Foshan, Yiwu, Jinhua, Ningbo, Wenzhou, Xiamen, Quanzhou.
 *  Bewusst weggelassen: Suzhou (zwei Städte dieses Namens: Jiangsu 215000 / Anhui), Zhongshan (häufiger Straßenname „Zhongshan Road“). */
export const CN_STADT_PLZ: Readonly<Record<string, string>> = {
  beijing: '100000', shanghai: '200000', guangzhou: '510000', shenzhen: '518000', hangzhou: '310000',
  shantou: '515000',
};

export interface Competitor { itemId: string; aspects: Record<string, string[]> }
export interface Vorschlag { feld: 'material' | 'masse'; wert: string; aspekt: string; quellen: string[] }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const MATERIAL_KEYS = ['material', 'hauptmaterial', 'obermaterial'];
const MASSE_KEYS = ['maße', 'abmessungen', 'artikellänge', 'länge', 'durchmesser', 'größe (b × h × t)', 'artikelmaße'];

function mehrheit(items: readonly Competitor[], keys: readonly string[]): { wert: string; aspekt: string; quellen: string[] } | null {
  const count = new Map<string, { wert: string; aspekt: string; quellen: Set<string> }>();
  for (const it of items) {
    const seen = new Set<string>();
    for (const [k, vals] of Object.entries(it.aspects)) {
      if (!keys.includes(norm(k))) continue;
      for (const v of vals) {
        const w = v.trim();
        if (!w || w.length > 120) continue;
        const key = `${norm(k)}|${norm(w)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const e = count.get(key) ?? { wert: w, aspekt: k, quellen: new Set<string>() };
        e.quellen.add(it.itemId);
        count.set(key, e);
      }
    }
  }
  const best = [...count.values()].filter(e => e.quellen.size >= MIN_GLEICHE_ANGEBOTE).sort((a, b) => b.quellen.size - a.quellen.size);
  if (best.length === 0) return null;
  if (best.length > 1 && best[1].quellen.size === best[0].quellen.size) return null; // Gleichstand → nichts geraten
  return { wert: best[0].wert, aspekt: best[0].aspekt, quellen: [...best[0].quellen] };
}

/** Material/Maße aus Konkurrenzangeboten — nur, was fehlt, und nur bei ≥ 2 gleichen Angaben. */
export function konkurrenzVorschlaege(items: readonly Competitor[], fehlt: { material: boolean; masse: boolean }): Vorschlag[] {
  const out: Vorschlag[] = [];
  if (fehlt.material) { const m = mehrheit(items, MATERIAL_KEYS); if (m) out.push({ feld: 'material', ...m }); }
  if (fehlt.masse) { const m = mehrheit(items, MASSE_KEYS); if (m) out.push({ feld: 'masse', ...m }); }
  return out;
}

/** Browse-API getItem → Merkmale (localizedAspects). */
export function aspectsFromBrowseItem(item: { localizedAspects?: Array<{ name?: string; value?: string }> } | null | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of item?.localizedAspects ?? []) {
    if (!a?.name || typeof a.value !== 'string') continue;
    out[a.name] = [...(out[a.name] ?? []), ...a.value.split(/\s*,\s*/).filter(Boolean)];
  }
  return out;
}

export interface PlzVorschlag { wert: string; quelle: string; fundstelle: string }
const PLZ_STADT_OK = /^\d{4,6}\s+\S/;

/** Vorschlag für „PLZ Stadt“ des Herstellers, wenn das Feld noch nicht das Format hat. */
export function plzVorschlag(m: { gpsrMfrCity?: string | null; gpsrMfrAddress?: string | null; gpsrRaw?: string | null }): PlzVorschlag | null {
  const city = (m.gpsrMfrCity ?? '').trim();
  if (PLZ_STADT_OK.test(city)) return null;
  const texte: Array<[string, string]> = [['Hersteller-Ort', city], ['Hersteller-Straße', (m.gpsrMfrAddress ?? '').trim()], ['AliExpress-Herstellerangabe (gpsrRaw)', (m.gpsrRaw ?? '').trim()]];
  const stadtIn = (t: string) => Object.keys(CN_STADT_PLZ).filter(s => new RegExp(`\\b${s}\\b`, 'i').test(t));
  // Stadt: zuerst aus Ort/Straße (gehört sicher zum Hersteller), nur dann aus dem Rohtext.
  // Steht im Ort-Feld genau eine Stadt, gilt sie; sonst nur, wenn das Ort-Feld leer ist, aus der Straße (Straßen wie „Beijing Road“ → mehrdeutig → nichts).
  const imOrt = stadtIn(city);
  const staedte = imOrt.length > 0 ? imOrt : (city ? [] : [...new Set(stadtIn(texte[1][1]))]);
  const stadt = staedte.length === 1 ? staedte[0] : null;
  const stadtName = stadt ? stadt[0].toUpperCase() + stadt.slice(1) : (city && !/\d/.test(city) ? city : null);
  // (1) Eindeutige 6-stellige Zahl in Straße/Ort.
  for (const [wo, t] of texte.slice(0, 2)) {
    const zahlen = [...new Set(t.match(/\b\d{6}\b/g) ?? [])];
    if (zahlen.length === 1 && stadtName) return { wert: `${zahlen[0]} ${stadtName}`, quelle: 'AliExpress-Herstellerangabe', fundstelle: `${wo}: „${t.slice(0, 120)}“` };
  }
  // (2) Stadt-Verzeichnis.
  if (stadt) return { wert: `${CN_STADT_PLZ[stadt]} ${stadtName}`, quelle: 'Stadt-PLZ-Verzeichnis (Haupt-PLZ der Stadt)', fundstelle: `Stadt „${stadtName}“ aus der Herstellerangabe` };
  return null;
}
