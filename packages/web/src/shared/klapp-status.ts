// P-2611-25E: Produkte-Tab auf-/zuklappbar + Lagerort-Feld auffindbar. Reine Regeln (Grundgesetz 2), die Anzeige steht in web/.
import type { ElectricGateResult } from './electric';
import type { OriginLocations } from './origin-shipping';

export type KlappFarbe = 'GRUEN' | 'GELB' | 'ROT' | 'GRAU';
export interface KlappStatus { text: string; farbe: KlappFarbe }

/** Standard ZU; ein Block mit ROT öffnet sich von selbst. */
export function klappDefaultOpen(farbe: KlappFarbe): boolean {
  return farbe === 'ROT';
}

/** Elektro-Block: „kein Elektro-Artikel“ / „offen“ / „Elektro-Sperre“ (ROT) / „Elektro: frei“. Dieselbe Sperre wie beim Listen. */
export function electricKlappStatus(isElectric: number | null | undefined, gate: ElectricGateResult): KlappStatus {
  if (gate.blocked) return { text: gate.message ?? 'Elektro-Sperre', farbe: 'ROT' };
  if (isElectric === 0) return { text: 'kein Elektro-Artikel', farbe: 'GRUEN' };
  if (isElectric === 1) return { text: 'Elektro: alle Nachweise da', farbe: 'GRUEN' };
  return { text: 'offen (nicht entschieden)', farbe: 'GRAU' };
}

/** Länder, die in Einstellungen › Lagerorte immer als Zeile stehen (leer erlaubt). */
export const FIXED_ORIGIN_ROWS = ['DE', 'PL', 'ES', 'FR', 'CZ'] as const;

/** Anzeige-Reihenfolge: feste Länder zuerst, dann weitere gespeicherte (alphabetisch). */
export function originRowsForDisplay(locs: OriginLocations): string[] {
  const fixed: string[] = [...FIXED_ORIGIN_ROWS];
  const extra = Object.keys(locs).filter(k => !fixed.includes(k)).sort();
  return [...fixed, ...extra];
}

/** Hinweis unter dem Feld (Wortlaut aus dem Auftrag). */
export function lagerortHinweis(iso: string): string {
  return `Gilt für alle Produkte mit Herkunft ${iso}. Nur echten Versandort des Lieferanten eintragen, nicht die Hersteller-Adresse.`;
}

/** Aus der Listen-Fehlermeldung (shared/origin-shipping.ts) das Land holen — für den Knopf „Lagerort eintragen“. */
export function lagerortIsoFromError(msg: string | null | undefined): string | null {
  return (msg ?? '').match(/Kein Lagerort für Herkunft ([A-Z]{2})\b/)?.[1] ?? null;
}

/** Sprungziel des Knopfs: Einstellungen, Karte Lagerorte, Zeile <iso> angelegt (nichts gespeichert). */
export function lagerortLink(iso: string): string {
  return `/einstellungen#lagerort-${iso}`;
}

/** Einstellungen: welches Land die Sprungmarke verlangt (#lagerort-DE → DE). */
export function lagerortIsoFromHash(hash: string | null | undefined): string | null {
  return (hash ?? '').match(/^#lagerort-([A-Z]{2})$/)?.[1] ?? null;
}
