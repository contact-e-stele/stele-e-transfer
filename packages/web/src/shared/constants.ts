// ─── Gemeinsame Konstanten (Backend + Frontend) ───────────────────────────────

// EU-Zollregelung China-Versand (ab 01.07.2026)
// Aktuell: pauschal 3,00 € Zoll pro Sendung bis 150 € Warenwert (Übergangsregelung).
// ACHTUNG: Für Ende 2026 ist zusätzlich eine EU-weite Handling Fee (~2,00 €) geplant,
// die diesen Betrag voraussichtlich auf ca. 5,00 € erhöht (Stand: noch nicht final beschlossen).
// Bei offizieller Bestätigung hier zentral anpassen — wird in api/index.ts + lieferanten.tsx verwendet.
export const CHINA_ZOLL_EUR = 3.00;
