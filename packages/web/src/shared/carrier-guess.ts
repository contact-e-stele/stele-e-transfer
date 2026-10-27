// OFFEN 009 Punkt 2 (27.10.2026): Bestellungen zeigten "Sendung: ? 00340434…", weil die automatische Sendungsnummer-Übernahme
// bewusst keinen Versanddienst setzt (#99). Ableitung NUR aus eindeutigen Nummernformaten — sonst null (nichts raten). REINE Funktionen.
// Werte = Auswahlliste im Bestellungen-Tab (CARRIER_OPTIONS).

/** DHL: 20 Ziffern mit Präfix "00340434" (alle 24 Fälle vom 27.10.); Hermes: "H" + 19 Ziffern. */
export function carrierFromTrackingNumber(tracking: string | null | undefined): 'DHL' | 'Hermes' | null {
  const t = (tracking ?? '').replace(/\s+/g, '').toUpperCase();
  if (/^00340434\d{12}$/.test(t)) return 'DHL';
  if (/^H\d{19}$/.test(t)) return 'Hermes';
  return null;
}

/** eBay shippingCarrierCode → Anzeigename der App; unbekannt → null. */
export function carrierFromEbayCode(code: string | null | undefined): string | null {
  const c = (code ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '');
  const map: Record<string, string> = { DHL: 'DHL', DEUTSCHEPOST: 'DHL', DHLPAKET: 'DHL', HERMES: 'Hermes', HERMESDE: 'Hermes', DPD: 'DPD', GLS: 'GLS', UPS: 'UPS', FEDEX: 'FedEx' };
  return map[c] ?? null;
}

const digitsNoH = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase().replace(/^H(?=\d{19}$)/, '');

/**
 * Meldung an Aufsicht 27.10.2026 18:25 (01-15317-84805, stele-220-BLUE): gespeichert "1003660829824501016" (ohne "H") → Format allein
 * nicht eindeutig, echte Nummer H1003660829824501016 = Hermes. Reihenfolge der Quellen, jeweils nur EINDEUTIG:
 * 1) Format der gespeicherten Nummer, 2) Versanddienst laut eBay-Bestellung, 3) Nummer laut AliExpress-Bestellung (nur wenn sie
 * dieselbe Sendung ist — gleiche Ziffern, "H" egal — und ihr Format eindeutig ist). Sonst null (nichts raten).
 */
export function decideCarrier(input: { local: string | null | undefined; ebayCodes?: Array<string | null | undefined>; aliTracking?: string | null }):
  { carrier: string; source: 'format' | 'ebay' | 'aliexpress' } | null {
  const f = carrierFromTrackingNumber(input.local);
  if (f) return { carrier: f, source: 'format' };
  const e = (input.ebayCodes ?? []).map(carrierFromEbayCode).find(Boolean);
  if (e) return { carrier: e, source: 'ebay' };
  if (input.aliTracking && digitsNoH(input.aliTracking) === digitsNoH(input.local)) {
    const a = carrierFromTrackingNumber(input.aliTracking);
    if (a) return { carrier: a, source: 'aliexpress' };
  }
  return null;
}
