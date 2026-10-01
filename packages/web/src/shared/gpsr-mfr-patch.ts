// A-008 Teil 3b — Validierung der Herstellerfelder für PATCH /products/:id (rein, testbar; die Route ruft nur diese Funktion).
// Der Hersteller ist ein eigener Block: Land = ISO-2 ohne EU-Zwang (Hersteller sitzen meist in CN), URL nur http(s).
import { normalizeCountryCode } from './gpsr-parser';

export const MFR_PATCH_TEXT_KEYS = ['gpsrMfrName', 'gpsrMfrAddress', 'gpsrMfrCity', 'gpsrMfrEmail', 'gpsrMfrPhone', 'gpsrMfrUrl'] as const;
export type MfrPatchFields = Partial<Record<typeof MFR_PATCH_TEXT_KEYS[number] | 'gpsrMfrCountry', string | null>>;

export function parseMfrPatch(body: Record<string, unknown>): { ok: true; fields: MfrPatchFields } | { ok: false; error: string } {
  const fields: MfrPatchFields = {};
  for (const key of MFR_PATCH_TEXT_KEYS) {
    if (!(key in body)) continue;
    const v = body[key];
    if (v != null && typeof v !== 'string') return { ok: false, error: `"${key}" muss ein Text oder null sein` };
    const t = typeof v === 'string' ? v.trim() : '';
    if (key === 'gpsrMfrUrl' && t && !/^https?:\/\/\S+$/i.test(t)) return { ok: false, error: '"gpsrMfrUrl" muss mit http:// oder https:// beginnen' };
    fields[key] = t || null;
  }
  if ('gpsrMfrCountry' in body) {
    const v = body.gpsrMfrCountry;
    if (v != null && typeof v !== 'string') return { ok: false, error: '"gpsrMfrCountry" muss ein Text oder null sein' };
    const code = v == null || v === '' ? null : normalizeCountryCode(v);
    if (v && !code) return { ok: false, error: '"gpsrMfrCountry" muss ein zweistelliger Ländercode sein (z. B. CN)' };
    fields.gpsrMfrCountry = code;
  }
  return { ok: true, fields };
}
