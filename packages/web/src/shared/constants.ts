// ─── Gemeinsame Konstanten (Backend + Frontend) ───────────────────────────────

// EU-Zollregelung China-Versand (ab 01.07.2026)
// Pauschal 4,00 € Zoll pro Sendung bis 150 € Warenwert (Übergangsregelung).
// Am 2026-07-27 von 3,00 € auf 4,00 € angehoben: reale AliExpress-Zölle lagen bei
// manchen Artikeln höher als die bisherige Pauschale (z.B. 3,65€ Einkauf + 1,99€
// Versand → real 3,57€ Zoll statt angenommener 3,00€), wodurch die Gewinn-Vorschau
// in Preise-Tab und Import-Tab zu optimistisch war.
// ACHTUNG: Für Ende 2026 ist zusätzlich eine EU-weite Handling Fee (~2,00 €) geplant,
// die diesen Betrag voraussichtlich weiter erhöht (Stand: noch nicht final beschlossen).
// Bei offizieller Bestätigung hier zentral anpassen — wird in api/index.ts + lieferanten.tsx verwendet.
export const CHINA_ZOLL_EUR = 4.00;

// Mindestgewinn pro Verkauf (€) — wird in der Preisempfehlung/automatischer Neuberechnung mit einkalkuliert
// Geaendert von 1,60€ auf 2,00€ am 2026-07-14 auf Wunsch des Users
export const MIN_GEWINN_EUR = 2.00;

// Sicherheitspuffer (€) über dem reinen Mindestgewinn (P-27/P-28, hinzugefuegt 2026-08-27):
// Der berechnete Mindestpreis ist NICHT mehr die exakte Gewinn-Untergrenze, sondern liegt um
// diesen Betrag darueber. Kleine, kurzzeitig unentdeckte Preis-Drift (z.B. zwischen zwei
// Preis-Check-Laeufen) fuehrt dadurch erstmal nur zu etwas weniger Gewinn statt sofort zu
// echtem Verlust. Wird zentral in calcSellPrice() (price-monitor.ts) sowie in den identischen
// Formel-Kopien in lieferanten.tsx (Mindestpreis-Buttons) addiert.
export const PRICE_SAFETY_BUFFER_EUR = 1.50;

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
