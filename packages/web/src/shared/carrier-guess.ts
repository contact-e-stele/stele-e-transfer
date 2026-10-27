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
