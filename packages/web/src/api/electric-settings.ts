// A-029 (P-E01): Einstellungen für Elektro Kat. 5 aus app_settings (Key-Value). Nur DB-Zugriff; die Regeln stehen in shared/electric.ts.
// WEEE-Reg.-Nr.: wird NIE vorbelegt oder erfunden — leer, bis der Inhaber sie in den Einstellungen einträgt.
import { eq } from 'drizzle-orm';
import { DEFAULT_REGISTERED_DEVICE_TYPES } from '../shared/constants';
import { normalizeWeeeNr, type ElectricSettings } from '../shared/electric';

export const WEEE_KEY = 'weee_reg_nr';
export const DEVICE_TYPES_KEY = 'weee_registered_device_types';

export async function getElectricSettings(): Promise<ElectricSettings> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const [w] = await db.select().from(appSettings).where(eq(appSettings.key, WEEE_KEY));
  const [d] = await db.select().from(appSettings).where(eq(appSettings.key, DEVICE_TYPES_KEY));
  let types: string[] = DEFAULT_REGISTERED_DEVICE_TYPES;
  if (d?.value) {
    try {
      const parsed = JSON.parse(d.value) as unknown;
      if (Array.isArray(parsed)) types = parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim());
    } catch { /* kaputtes JSON → Start-Liste */ }
  }
  return { weeeRegNr: normalizeWeeeNr(w?.value), registeredDeviceTypes: types };
}

export async function setElectricSettings(input: { weeeRegNr?: string | null; registeredDeviceTypes?: string[] }): Promise<void> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const now = new Date().toISOString();
  const put = async (key: string, value: string) => db.insert(appSettings).values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
  if (input.weeeRegNr !== undefined) await put(WEEE_KEY, normalizeWeeeNr(input.weeeRegNr) ?? '');
  if (input.registeredDeviceTypes !== undefined) await put(DEVICE_TYPES_KEY, JSON.stringify(input.registeredDeviceTypes));
}
