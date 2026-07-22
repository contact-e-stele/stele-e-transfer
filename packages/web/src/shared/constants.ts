// ─── Gemeinsame Konstanten (Backend + Frontend) ───────────────────────────────

// EU-Zollregelung China-Versand (ab 01.07.2026)
// Aktuell: pauschal 3,00 € Zoll pro Sendung bis 150 € Warenwert (Übergangsregelung).
// ACHTUNG: Für Ende 2026 ist zusätzlich eine EU-weite Handling Fee (~2,00 €) geplant,
// die diesen Betrag voraussichtlich auf ca. 5,00 € erhöht (Stand: noch nicht final beschlossen).
// Bei offizieller Bestätigung hier zentral anpassen — wird in api/index.ts + lieferanten.tsx verwendet.
export const CHINA_ZOLL_EUR = 3.00;

// Mindestgewinn pro Verkauf (€) — wird in der Preisempfehlung/automatischer Neuberechnung mit einkalkuliert
// Geaendert von 1,60€ auf 2,00€ am 2026-07-14 auf Wunsch des Users
export const MIN_GEWINN_EUR = 2.00;

// Feste Kategorieliste fuer manuell gespeicherte Shops ("Meine Shops")
// Dient nur der Uebersicht im Suche-Tab-Dropdown (z.B. um zu wissen, wo man zuerst nachschauen sollte)
export const SHOP_CATEGORIES = [
  'Elektronik',
  'Haushalt & Küche',
  'Kleidung & Mode',
  'Beauty & Pflege',
  'Spielzeug',
  'Werkzeug & Auto',
  'Garten & Outdoor',
  'Sonstiges',
] as const;
