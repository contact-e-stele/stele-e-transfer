// OFFEN 029 + NACHTRAG + OFFEN 030 (04.11.2026): Versand-/Rückgabe-Angaben der eBay-Beschreibung aus EINER Stelle (Grundgesetz 8).
//
// Funde (Design-Check 04.11.):
//  R1  eBay zeigt "Kostenloser Rückversand" (Rücknahme-Richtlinie im Konto), unsere Vorlage sagte fest
//      "Rücksendekosten trägt der Käufer" (web/lib/ebay-description.ts, alt Z. 394/395, 439, 677/678).
//  R2  Vorlage sagte fest "3–10 Werktage" (alt Z. 323, 387, 431, 608, 670, 710), eBay zeigt 7–11 Werktage.
//      Dazu ein ungenutzter Text-Ersetzer web/lib/text-helpers.ts ("10–25" → "3-7 Werktage") — gelöscht.
//  R3  "Versand per DHL oder Deutsche Post" (alt Z. 323/388/608/671) und Fußzeile "WIESBADEN · DEUTSCHLAND" — gestrichen.
//
// NACHTRAG 029 (Inhaber "A ja, B ja"): Versand + Rücknahme stehen NUR noch in EINER Fußzeile; Kacheln und Reiter
// "Versand & Retouren" entfallen, die AGB verweisen auf die Fußzeile.
// Inhaber 17:45 / OFFEN 030: die Lieferzeit ist keine feste Zahl, sondern kommt je Angebot aus der Herkunft
// (shared/listing-origin.ts). Unbekannt → neutraler Satz, nie eine geratene Zahl.

/** Merkmal der aktuellen Textfassung — fehlt es in einer gespeicherten Beschreibung, wird sie neu gebaut. */
export const TEXT_VERSION_MARKER = '<!-- stele-texte: OFFEN-029b-030 -->';

export const NEUTRAL_DELIVERY_TEXT = 'Lieferzeit gem&auml;&szlig; eBay-Angabe zu diesem Angebot';
export const NEUTRAL_RETURN_TEXT = 'R&uuml;cknahme gem&auml;&szlig; den eBay-Angaben zu diesem Angebot';
/** Verweis für AGB/Fließtext auf die eine Fußzeile. */
export const FOOTER_REFERENCE = 'siehe Fu&szlig;zeile &bdquo;Versand &amp; R&uuml;ckgabe&ldquo; dieses Angebots';

export interface ReturnTerms {
  returnsAccepted: boolean;
  days: number | null;              // Rückgabefrist in Tagen
  costPayer: 'BUYER' | 'SELLER' | null;
}

/** eBay Account API GET /sell/account/v1/return_policy/{id} → ReturnTerms (null = nicht auswertbar). */
export function parseReturnPolicy(json: unknown): ReturnTerms | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as { returnsAccepted?: unknown; returnPeriod?: { value?: unknown; unit?: unknown }; returnShippingCostPayer?: unknown };
  if (typeof j.returnsAccepted !== 'boolean') return null;
  const unit = typeof j.returnPeriod?.unit === 'string' ? j.returnPeriod.unit : '';
  const value = typeof j.returnPeriod?.value === 'number' ? j.returnPeriod.value : null;
  const days = value !== null && unit === 'DAY' ? value : value !== null && unit === 'MONTH' ? value * 30 : null;
  const payer = j.returnShippingCostPayer === 'BUYER' || j.returnShippingCostPayer === 'SELLER' ? j.returnShippingCostPayer : null;
  return { returnsAccepted: j.returnsAccepted, days, costPayer: payer };
}

/** Rückgabe-Teil der Fußzeile — nur aus der eBay-Richtlinie, sonst neutral. */
export function returnFooterText(terms: ReturnTerms | null | undefined): string {
  if (!terms || !terms.returnsAccepted || !terms.costPayer) return NEUTRAL_RETURN_TEXT;
  const cost = terms.costPayer === 'SELLER' ? 'Kostenloser R&uuml;ckversand' : 'R&uuml;cksendekosten tr&auml;gt der K&auml;ufer';
  return terms.days ? `${cost} &middot; ${terms.days} Tage R&uuml;ckgabe` : cost;
}

/** Lieferzeit-Teil der Fußzeile. deliveryTime = z. B. "7–12 Werktage" (aus der Herkunft) oder null. */
export function deliveryFooterText(deliveryTime: string | null | undefined): string {
  return deliveryTime && deliveryTime.trim() ? `Lieferzeit ${deliveryTime.trim()}` : NEUTRAL_DELIVERY_TEXT;
}

/** Die EINE Fußzeile: "Versand & Rückgabe: Lieferzeit … · Kostenloser Rückversand · 30 Tage Rückgabe". Kein Ort, kein Versanddienst. */
export function shippingReturnFooter(deliveryTime: string | null | undefined, terms: ReturnTerms | null | undefined): string {
  return `Versand &amp; R&uuml;ckgabe: ${deliveryFooterText(deliveryTime)} &middot; ${returnFooterText(terms)}`;
}

// Beschreibung v3 (Inhaber 06.11.2026 07:52 "Ja"): Versand · Rückgabe · §19 je eine Zeile in der Fußzeile — aus DIESER Datei
// (dieselben Texte wie oben, gleiche Quelle wie die eBay-Richtlinie). shippingReturnFooter() bleibt für die dunkle Vorlage.
export const USTG19_FOOTER_TEXT = '&sect;19 UStG: Als Kleinunternehmer wird keine Umsatzsteuer berechnet und ausgewiesen';
/** Kommentar-Klammer um die Fußzeile — damit vergleicht das Listen gespeicherte und frische Fußzeile (ebay-description-builder.ts). */
export const FOOTER_BLOCK_START = '<!-- stele-fuss -->';
export const FOOTER_BLOCK_END = '<!-- /stele-fuss -->';

export interface FooterLines { versand: string; rueckgabe: string; ustg19: string }

/** Die drei Zeilen der Fußzeile v3. Unbekannte Lieferzeit/Rücknahme → neutraler Satz, nie eine geratene Zahl. */
export function shippingReturnFooterLines(deliveryTime: string | null | undefined, terms: ReturnTerms | null | undefined): FooterLines {
  return {
    versand: `Versand: ${deliveryFooterText(deliveryTime)}`,
    rueckgabe: `R&uuml;ckgabe: ${returnFooterText(terms)}`,
    ustg19: USTG19_FOOTER_TEXT,
  };
}

// Beschreibung v4 (08.11.2026): Zahlungs-Text — wörtlich aus AGB § 4 der bisherigen Vorlagen herausgezogen (Grundgesetz 8),
// kein neuer Text. Chip = erster Satz, Kasten = beide Sätze.
export const PAYMENT_CHIP_TEXT = 'Zahlung &uuml;ber eBay-Zahlungsabwicklung';
export const PAYMENT_TEXT = `${PAYMENT_CHIP_TEXT}. Der Betrag ist sofort nach Kauf f&auml;llig.`;
