// OFFEN 006 (18.10.2026): einstellbare Import-Regeln in app_settings (KEINE Migration):
//   "min_rating" (Sterne-Sperre, Standard 4,2) und "max_variant_combinations" (höchstens Varianten, Standard 5).
import { eq } from 'drizzle-orm';
import { parseMinRating } from '../shared/rating-gate';
import { parseMaxVariantCombinations } from '../shared/variant-cleanup';

export interface ImportRules { minRating: number; maxVariants: number }

export async function getImportRules(): Promise<ImportRules> {
  try {
    const { db } = await import('../db/index');
    const { appSettings } = await import('../db/schema');
    const [r, v] = await Promise.all([
      db.select().from(appSettings).where(eq(appSettings.key, 'min_rating')).get(),
      db.select().from(appSettings).where(eq(appSettings.key, 'max_variant_combinations')).get(),
    ]);
    return { minRating: parseMinRating(r?.value), maxVariants: parseMaxVariantCombinations(v?.value) };
  } catch {
    return { minRating: parseMinRating(null), maxVariants: parseMaxVariantCombinations(null) };
  }
}

export async function setImportRules(rules: ImportRules): Promise<void> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const now = new Date().toISOString();
  for (const [key, value] of [['min_rating', String(rules.minRating)], ['max_variant_combinations', String(rules.maxVariants)]] as const) {
    await db.insert(appSettings).values({ key, value, updatedAt: now }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now } });
  }
}
