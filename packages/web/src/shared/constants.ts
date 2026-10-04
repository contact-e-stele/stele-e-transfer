// ─── Gemeinsame Konstanten (Backend + Frontend) ───────────────────────────────

// Preisformel v2 (A-014, 04.10.2026, Übergabe "Kalkulator – Preisformel v2"): Kosten K = Ware + Versand +
// Einfuhrabgaben, belegt am AliExpress-Beleg 3077135261597211 (Ware 4,79 / Versand 1,99 / Einfuhrabgaben 3,57).
// Ersetzt die frühere Pauschale CHINA_ZOLL_EUR (4,00 €) UND das Produktfeld shippingCost in der Formel.
// ACHTUNG: Für Ende 2026 ist zusätzlich eine EU-weite Handling Fee (~2,00 €) geplant (noch nicht final
// beschlossen) — bei Bestätigung hier zentral anpassen.
export const ALI_VERSAND_EUR = 1.99;          // AliExpress-Versand je Bestellung, wenn Ware < ALI_VERSAND_FREI_AB_EUR
export const ALI_VERSAND_FREI_AB_EUR = 10.00; // ab diesem Warenwert kein Versand (ANNAHME aus 1 Beleg, 27.08.: Ware 10,29 → Nebenkosten 3,57)
export const ALI_EINFUHR_EUR = 3.57;          // Einfuhrabgaben je Bestellung bei shipsFrom China (ANNAHME 3,00 × 1,19, Festwert)

// Margen-Stufen (Inhaber-Entscheid 04.10.2026, 10:21): Zielgewinn + Boden (Gewinn darf nie darunter fallen).
// Ersetzen die bisherigen Auswahl-Stufen 1,50 / 3,00 / 4,50. Reihenfolge = Anzeige-Reihenfolge.
export interface MarginTier { label: string; targetEur: number; floorEur: number }
export const MARGIN_TIERS: readonly MarginTier[] = [
  { label: 'A', targetEur: 1.00, floorEur: 1.00 },
  { label: 'B', targetEur: 1.50, floorEur: 1.20 },
  { label: 'C', targetEur: 2.00, floorEur: 1.30 },
  { label: 'D', targetEur: 3.00, floorEur: 1.50 },
];
// 4,50 € / Boden 2,00 € bestätigt, aber vorerst NICHT zur Auswahl (erst bei höherem Umsatz freischalten).
// Bestehende Produkte mit Zielgewinn 4,50 behalten ihren Wert und rechnen mit diesem Boden.
export const HIDDEN_MARGIN_TIER: MarginTier = { label: '4,50', targetEur: 4.50, floorEur: 2.00 };
// Boden für einen Zielgewinn, der in keiner Stufe vorkommt: nie Gewinn unter 1,00 €.
export const MIN_PROFIT_FLOOR_EUR = 1.00;

// Varianten-Regel 6c (Übergabe v2, Abschnitt 6c): jede Variante einzeln, keine wird über die Formel erhöht —
// AUSSER sie fällt unter den Boden. Nur VORBEREITET (reine Funktion in shared/pricing.ts), im Betrieb AUS,
// bis der Inhaber bestätigt.
export const VARIANT_RULE_6C_ENABLED = false;

// A-019 Teil 2: Preisprüfung hebt bei Varianten-Produkten NUR die Variante an, deren Gewinn unter dem Boden der Stufe liegt (raise-only,
// Formel v2, GET→PUT volles Offer je Variante). Default AUS: bei AUS wird nur geloggt, was angehoben WÜRDE (0 Sende-/Speicher-Aufrufe).
// Einschalten nur durch den Inhaber (Geld-Logik).
export const AUTO_VARIANT_RAISE_ENABLED = false;

// Mindestgewinn pro Verkauf (€) — wird in der Preisempfehlung/automatischer Neuberechnung mit einkalkuliert
// Geaendert von 1,60€ auf 2,00€ am 2026-07-14 auf Wunsch des Users
export const MIN_GEWINN_EUR = 2.00;

// Sicherheitspuffer (€) über dem reinen Mindestgewinn (P-27/P-28, hinzugefuegt 2026-08-27).
// Teil 2C (2026-09-10, "Zielgewinn trifft exakt"): NICHT MEHR VERWENDET. Zusammen mit der
// immer aufwärts rundenden roundUpToX95() sorgte dieser Puffer dafuer, dass aus einem
// gewuenschten Zielgewinn von 2,00€ real 3,50-4,25€ wurden. DEFAULT_PRICING_CONFIG.safetyBufferEur
// (shared/pricing.ts) ist seither fest 0 und referenziert diese Konstante nicht mehr — sie bleibt
// hier nur als Konstante stehen (keine Kalkulation liest sie noch), damit ihre Herkunft/History
// nachvollziehbar bleibt.
export const PRICE_SAFETY_BUFFER_EUR = 1.50;

// Teil 2D (2026-09-10, "Senkungsbremse"), Vorgabe des Nutzers: computeMinSellPrice() liefert eine
// UNTERGRENZE, keinen Zielpreis — automatische Neuberechnungs-Läufe würden ein laufendes Angebot
// sonst in einem einzigen Lauf bis auf diese Untergrenze herunterziehen (real beobachtet:
// stele-141 23,95€→10,95€, stele-110 20,95€→10,95€). Begrenzt darum, um wie viel Prozent ein
// automatisch berechneter Preis GEGENÜBER DEM AKTUELLEN PREIS pro Lauf sinken darf — das Anheben
// bei zu niedrigem Preis bleibt davon unberührt (schützt weiterhin uneingeschränkt vor Verlust).
export const MAX_PRICE_DECREASE_PERCENT = 8;

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

// ─── A-029 (P-E01, Beschluss Inhaber 04.10.2026): Elektro Kat. 5 Kleingeräte ───────────────────────────────────────────
// EAR-Umlage je verkauftem Stück (stiftung ear / Garantie / Entsorgung), wird bei Elektro = ja zu den Kosten K der Preisformel v2 addiert.
// Standard 0,00 — den Betrag legt der Inhaber fest, sobald Gebühr und Garantie bekannt sind (Geld-Logik: nur der Inhaber ändert ihn).
export const EAR_UMLAGE_EUR = 0.00;
// Batterie-Registrierung (BattG) liegt NICHT vor und ist fest AUS: ein Produkt mit Batterie/Akku wird nie gelistet.
// Nur der Inhaber ändert das per ausdrücklichem Beschluss (kein Einstellungsfeld, kein Schalter in der Oberfläche).
export const BATTERY_REGISTRATION_PRESENT = false;
// Start-Liste "Registrierte Gerätearten" (erweiterbar nur durch den Inhaber in den Einstellungen).
export const DEFAULT_REGISTERED_DEVICE_TYPES: string[] = ['Kat. 5 Kleingeräte'];
