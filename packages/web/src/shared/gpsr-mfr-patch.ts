// A-008 Teil 3b — Validierung der Herstellerfelder für PATCH /products/:id (rein, testbar; die Route ruft nur diese Funktion).
// Der Hersteller ist ein eigener Block: Land = ISO-2 ohne EU-Zwang (Hersteller sitzen meist in CN), URL nur http(s).
import { normalizeCountryCode, isEmailShape } from './gpsr-parser';

// eBay-Feldlängen (A-006 Antwort 2): Name 100, Straße 180, Ort 64 (hier "PLZ Stadt": 74), E-Mail 180, Telefon 64, URL 250.
const MAX_LEN = { gpsrMfrName: 100, gpsrMfrAddress: 180, gpsrMfrCity: 74, gpsrMfrEmail: 180, gpsrMfrPhone: 64, gpsrMfrUrl: 250 } as const;

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
    if (t.length > MAX_LEN[key]) return { ok: false, error: `"${key}" ist zu lang (max. ${MAX_LEN[key]} Zeichen)` };
    if (key === 'gpsrMfrEmail' && t && !isEmailShape(t)) return { ok: false, error: '"gpsrMfrEmail" ist keine gültige E-Mail-Adresse' };
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
