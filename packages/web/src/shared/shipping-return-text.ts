// OFFEN 029 (04.11.2026, Inhaber 09:00): Versand-/Rückgabe-Texte der eBay-Beschreibung aus EINER Stelle (Grundgesetz 8).
//
// Funde (Design-Check 04.11.):
//  R1  eBay zeigt "Kostenloser Rückversand" (Rücknahme-Richtlinie im Konto), unsere Vorlage sagte fest
//      "Rücksendekosten trägt der Käufer" (web/lib/ebay-description.ts, alt Z. 394/395, 439, 677/678).
//  R2  Vorlage sagte fest "3–10 Werktage" (alt Z. 323, 387, 431, 608, 670, 710), eBay zeigt 7–11 Werktage.
//      Dazu ein ungenutzter Text-Ersetzer web/lib/text-helpers.ts ("10–25" → "3-7 Werktage") — gelöscht.
//  R3  "Versand per DHL oder Deutsche Post" (alt Z. 323/388/608/671) — gestrichen, bis der Artikelstandort geklärt ist.
//
// Rücksendekosten/Frist kommen aus der eBay-Rücknahme-Richtlinie des Angebots (returnPolicyId). Ist sie nicht lesbar:
// neutraler Satz, nie eine eigene Kostenangabe.

/** Inhaber 04.11.2026 09:00: überall dieselbe Lieferzeit. Keine zweite Zahl im Code. */
export const DELIVERY_TIME_TEXT = '7–12 Werktage';

/** Merkmal der aktuellen Textfassung — fehlt es in einer gespeicherten Beschreibung, wird sie neu gebaut. */
export const TEXT_VERSION_MARKER = '<!-- stele-texte: OFFEN-029 -->';

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

export const NEUTRAL_RETURN_TEXT = 'R&uuml;cknahme gem&auml;&szlig; den eBay-Angaben zu diesem Angebot';

export interface ReturnTextBlocks {
  boxTitle: string;      // Kachel oben
  boxSub: string;
  tabItems: string[];    // <li>-Inhalte im Reiter "Versand & Retouren"
  agbCost: string;       // Satz in den AGB (Widerruf)
}

/** Texte für Kachel, Reiter und AGB — HTML-Entities wie in der Vorlage. */
export function returnTextBlocks(terms: ReturnTerms | null | undefined): ReturnTextBlocks {
  const known = !!terms && terms.returnsAccepted;
  const days = known && terms!.days ? terms!.days : null;
  const daysText = days ? `${days} Tage R&uuml;ckgaberecht` : null;
  const refund = 'R&uuml;ckerstattung innerhalb von 3–5 Werktagen nach Wareneingang';
  if (known && terms!.costPayer === 'SELLER') {
    return {
      boxTitle: days ? `${days} TAGE R&Uuml;CKGABE` : 'R&Uuml;CKGABE',
      boxSub: 'Kostenloser R&uuml;ckversand<br/>K&auml;uferschutz &uuml;ber eBay',
      tabItems: [
        ...(daysText ? [`<strong>${daysText}</strong> ab Erhalt der Ware`] : []),
        '<strong>Kostenloser R&uuml;ckversand</strong>',
        refund,
      ],
      agbCost: 'Die R&uuml;cksendekosten tr&auml;gt der Verk&auml;ufer (kostenloser R&uuml;ckversand).',
    };
  }
  if (known && terms!.costPayer === 'BUYER') {
    return {
      boxTitle: days ? `${days} TAGE R&Uuml;CKGABE` : 'R&Uuml;CKGABE',
      boxSub: 'Einfache R&uuml;ckgabe<br/>K&auml;uferschutz &uuml;ber eBay',
      tabItems: [
        ...(daysText ? [`<strong>${daysText}</strong> ab Erhalt der Ware`] : []),
        'R&uuml;cksendekosten tr&auml;gt der K&auml;ufer (sofern kein Defekt)',
        'Bei Defekt oder Falschlieferung: R&uuml;cksendekosten werden erstattet',
        refund,
      ],
      agbCost: 'R&uuml;cksendekosten tr&auml;gt der K&auml;ufer.',
    };
  }
  return {
    boxTitle: 'R&Uuml;CKGABE',
    boxSub: `${NEUTRAL_RETURN_TEXT}<br/>K&auml;uferschutz &uuml;ber eBay`,
    tabItems: [NEUTRAL_RETURN_TEXT + ' (Frist und R&uuml;cksendekosten)', refund],
    agbCost: `R&uuml;cksendekosten: ${NEUTRAL_RETURN_TEXT}.`,
  };
}
