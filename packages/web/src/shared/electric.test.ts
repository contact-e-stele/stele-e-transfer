// A-029 (P-E01): Tests für Elektro Kat. 5 — Listing-Sperre (jede Bedingung), Nicht-Elektro unverändert, Import-Vorschlag, EAR-Umlage in der Preisformel
// (Beispiel Ware 6,00 / Umlage 1,50 / Stufe C, China, Anzeige 5 % — alle Zahlen mit bun nachgerechnet), WEEE-Format, Patch-/Einstellungs-Validierung, CSV.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  evaluateElectricGate, suggestElectric, earUmlageFor, weeeLineForListing, isValidWeeeNr, normalizeWeeeNr, parseElectricProofs, parseElectricPatch,
  parseElectricSettingsBody, buildElectricSalesCsv, PROOF_KEYS, type ElectricProduct, type ElectricSettings,
} from './electric';
import { computeMinSellPrice, profitAtSellPrice, DEFAULT_PRICING_CONFIG } from './pricing';
import { EAR_UMLAGE_EUR, BATTERY_REGISTRATION_PRESENT, DEFAULT_REGISTERED_DEVICE_TYPES } from './constants';
import { findDescriptionComplianceViolations } from './description-compliance';
import { electricSaleLines, electricSalesCsv } from '../api/electric-export';

const ALL_PROOFS = JSON.stringify(Object.fromEntries(PROOF_KEYS.map(k => [k, { ok: true, note: 'Beleg ' + k }])));
const OK_SETTINGS: ElectricSettings = { weeeRegNr: 'DE12345678', registeredDeviceTypes: ['Kat. 5 Kleingeräte'] };
const OK_PRODUCT: ElectricProduct = { isElectric: 1, electricSuggested: 0, deviceType: 'Kat. 5 Kleingeräte', hasBattery: 0, electricProofs: ALL_PROOFS };

describe('Konstanten (Beschluss Inhaber)', () => {
  test('EAR-Umlage Standard 0,00; Batterie-Registrierung fest AUS; Start-Geräteart nur "Kat. 5 Kleingeräte"', () => {
    expect(EAR_UMLAGE_EUR).toBe(0);
    expect(BATTERY_REGISTRATION_PRESENT).toBe(false);
    expect(DEFAULT_REGISTERED_DEVICE_TYPES).toEqual(['Kat. 5 Kleingeräte']);
  });
});

describe('evaluateElectricGate — jede Sperrbedingung', () => {
  test('alles erfüllt → nicht gesperrt', () => {
    expect(evaluateElectricGate(OK_PRODUCT, OK_SETTINGS)).toEqual({ blocked: false, reasons: [], message: null });
  });
  test('WEEE-Reg.-Nr. in den Einstellungen leer → "Elektro-Sperre: WEEE-Reg.-Nr. fehlt"', () => {
    for (const w of [null, '', '   ']) expect(evaluateElectricGate(OK_PRODUCT, { ...OK_SETTINGS, weeeRegNr: w }).message).toBe('Elektro-Sperre: WEEE-Reg.-Nr. fehlt');
  });
  test('WEEE-Reg.-Nr. mit falschem Format → gesperrt (nicht geraten, nicht korrigiert)', () => {
    expect(evaluateElectricGate(OK_PRODUCT, { ...OK_SETTINGS, weeeRegNr: 'DE1234' }).message).toContain('WEEE-Reg.-Nr. ungültig');
    expect(evaluateElectricGate(OK_PRODUCT, { ...OK_SETTINGS, weeeRegNr: 'XX12345678' }).blocked).toBe(true);
  });
  test('Geräteart leer oder nicht in den registrierten Gerätearten → gesperrt', () => {
    expect(evaluateElectricGate({ ...OK_PRODUCT, deviceType: null }, OK_SETTINGS).message).toBe('Elektro-Sperre: Geräteart fehlt');
    expect(evaluateElectricGate({ ...OK_PRODUCT, deviceType: 'Kat. 3 Bildschirme' }, OK_SETTINGS).message).toBe('Elektro-Sperre: Geräteart "Kat. 3 Bildschirme" nicht registriert');
  });
  test('Batterie/Akku = ja → "Batterie nicht erlaubt" — auch wenn Elektro NICHT bestätigt ist (nie lockern)', () => {
    expect(evaluateElectricGate({ ...OK_PRODUCT, hasBattery: 1 }, OK_SETTINGS).message).toBe('Elektro-Sperre: Batterie nicht erlaubt');
    expect(evaluateElectricGate({ isElectric: 0, hasBattery: true }, OK_SETTINGS).message).toBe('Elektro-Sperre: Batterie nicht erlaubt');
    expect(evaluateElectricGate({ isElectric: null, hasBattery: 1 }, OK_SETTINGS).blocked).toBe(true);
  });
  test('Batterie-Registrierung kann nur über die Konstante/Einstellung (nicht über das Produkt) gelockert werden', () => {
    expect(evaluateElectricGate({ ...OK_PRODUCT, hasBattery: 1 }, { ...OK_SETTINGS, batteryRegistration: true }).blocked).toBe(false);
  });
  test('jeder fehlende Nachweis sperrt einzeln (Häkchen + Beleg nötig)', () => {
    for (const k of PROOF_KEYS) {
      const missing = JSON.parse(ALL_PROOFS); delete missing[k];
      expect(evaluateElectricGate({ ...OK_PRODUCT, electricProofs: JSON.stringify(missing) }, OK_SETTINGS).reasons).toHaveLength(1);
      const noTick = { ...JSON.parse(ALL_PROOFS), [k]: { ok: false, note: 'x' } };
      expect(evaluateElectricGate({ ...OK_PRODUCT, electricProofs: JSON.stringify(noTick) }, OK_SETTINGS).blocked).toBe(true);
      const noNote = { ...JSON.parse(ALL_PROOFS), [k]: { ok: true, note: '  ' } };
      expect(evaluateElectricGate({ ...OK_PRODUCT, electricProofs: JSON.stringify(noNote) }, OK_SETTINGS).blocked).toBe(true);
    }
    expect(evaluateElectricGate({ ...OK_PRODUCT, electricProofs: null }, OK_SETTINGS).reasons).toHaveLength(4);
  });
  test('unbestätigter Import-Vorschlag (isElectric null + Vorschlag) sperrt, bis ja/nein gewählt ist', () => {
    const r = evaluateElectricGate({ isElectric: null, electricSuggested: 1 }, OK_SETTINGS);
    expect(r.message).toBe('Elektro-Sperre: Elektro-Vorschlag nicht bestätigt (bitte Elektro ja/nein wählen)');
    expect(evaluateElectricGate({ isElectric: 0, electricSuggested: 1 }, OK_SETTINGS).blocked).toBe(false); // Inhaber hat "nein" gewählt
  });
  test('mehrere Gründe werden zusammen genannt (Klartext im Fehlerfeld)', () => {
    const r = evaluateElectricGate({ isElectric: 1, deviceType: null, hasBattery: 1 }, { weeeRegNr: null, registeredDeviceTypes: [] });
    expect(r.message).toBe('Elektro-Sperre: Batterie nicht erlaubt; WEEE-Reg.-Nr. fehlt; Geräteart fehlt; Nachweis fehlt: CE-Kennzeichnung; Nachweis fehlt: EU-Konformitätserklärung/RoHS vom Lieferanten; Nachweis fehlt: deutsche Anleitung; Nachweis fehlt: Kennzeichnung durchgestrichene Mülltonne');
  });
  test('NICHT-ELEKTRO bleibt unverändert: nie markiert (Bestandsprodukt), "nein" — auch mit leeren Einstellungen nicht gesperrt', () => {
    const empty: ElectricSettings = { weeeRegNr: null, registeredDeviceTypes: [] };
    for (const p of [{}, { isElectric: null, electricSuggested: 0, hasBattery: 0 }, { isElectric: 0 }, { isElectric: null, electricSuggested: null, hasBattery: null }] as ElectricProduct[]) {
      expect(evaluateElectricGate(p, empty)).toEqual({ blocked: false, reasons: [], message: null });
    }
  });
});

describe('WEEE-Nummer', () => {
  test('Format DE + 8 Ziffern (leer erlaubt), Groß-/Kleinschreibung und Leerzeichen werden normalisiert', () => {
    expect(isValidWeeeNr('DE12345678')).toBe(true);
    expect(isValidWeeeNr(' de12345678 ')).toBe(true);
    expect(isValidWeeeNr('')).toBe(true);
    expect(isValidWeeeNr(null)).toBe(true);
    for (const bad of ['DE1234567', 'DE123456789', 'D12345678', 'DE1234567X', 'AT12345678']) expect(isValidWeeeNr(bad)).toBe(false);
    expect(normalizeWeeeNr(' de12345678 ')).toBe('DE12345678');
  });
  test('Angebotszeile: nur bei bestätigtem Elektro und gültiger Nummer; reiner Text ohne Link/URL/E-Mail (besteht den Compliance-Check)', () => {
    const line = weeeLineForListing(OK_PRODUCT, 'DE12345678');
    expect(line).toBe('WEEE-Reg.-Nr. DE12345678');
    expect(findDescriptionComplianceViolations(`<p>${line}</p>`)).toEqual([]);
    expect(weeeLineForListing({ isElectric: 0 }, 'DE12345678')).toBeNull();
    expect(weeeLineForListing({}, 'DE12345678')).toBeNull();
    expect(weeeLineForListing(OK_PRODUCT, null)).toBeNull();
    expect(weeeLineForListing(OK_PRODUCT, 'DE12')).toBeNull();
  });
});

describe('suggestElectric (nur vorschlagen)', () => {
  test('Wörter aus dem Auftrag werden erkannt (deutsch und englisch)', () => {
    for (const t of ['USB Ladekabel', 'LED Lampe', 'Akku Staubsauger', 'Batterie 9V', 'Knopfzelle CR2032', 'elektrische Zahnbürste', 'Ladegerät schnell', 'Netzteil 12V', 'Ventilator klein', 'Heizdecke', '5000 mAh Power', '12 Volt', '40 Watt', 'Motor 12V', 'Stromkabel', 'rechargeable fan', 'button cell holder', 'cables 2m', 'Mini fans', 'garden lamps', '2 chargers', 'Heaters winter', '12V Pumpe', '3.7V Modul', 'Bluetooth Tracker', 'Wireless Maus', 'Solar Garten', 'Sensor Set', 'Speaker klein', 'Kopfhörer', 'Lautsprecher', 'Steckdose', 'Lüfter 12cm', 'Leuchte', 'Timer 60min']) {
      expect(suggestElectric([t]).suggested).toBe(true);
    }
  });
  test('Nicht-Elektro (auch Beinahe-Treffer) bleibt ohne Vorschlag', () => {
    for (const t of ['Silikon Backmatte', 'Wattestäbchen 200 Stück', 'Haarspange Gold', 'Bleder Kabelbinder-freie Matte'.replace('Kabelbinder-freie ', ''), 'Hundeleine Nylon 5m', 'Reiseflaschen Set 11-teilig', 'Größe 5 V-Ausschnitt weit', 'Fansticker Aufkleber']) {
      expect(suggestElectric([t]).suggested).toBe(false);
    }
  });
  test('mehrere Quellen (Titel, Beschreibung, Merkmale) werden zusammen geprüft; leere/null-Werte stören nicht', () => {
    expect(suggestElectric([null, undefined, 'Haarspange', 'mit LED Licht']).matches).toEqual(['led']);
    expect(suggestElectric(['(LED)-Leiste, 12V']).matches).toEqual(['led', '12v']);
    expect(suggestElectric([null, '']).suggested).toBe(false);
  });
});

describe('EAR-Umlage in der Preisformel v2 (Beispiel Ware 6,00, Umlage 1,50, Stufe C = Ziel 2,00 / Boden 1,30; China, Anzeige 5 %)', () => {
  const base = {
    buyPrice: 6.00, isChinaOrigin: true, ebayFeeRatePercent: DEFAULT_PRICING_CONFIG.ebayFeeRatePercent, ebayFixedFeeEur: DEFAULT_PRICING_CONFIG.ebayFixedFeeEur,
    vatFactor: DEFAULT_PRICING_CONFIG.vatFactor, adRatePercent: 5, targetMarginEur: 2.00, safetyBufferEur: DEFAULT_PRICING_CONFIG.safetyBufferEur, rounding: 'floor95' as const,
  };
  // Handrechnung: K = 6,00 + 1,99 + 3,57 = 11,56 (+ 1,50 = 13,06); f = 1 − 0,20 × 1,19 = 0,762; Fix = 0,30 × 1,19 = 0,357;
  // roh = (K + 2,00 + 0,357)/0,762 → ohne Umlage 18,26 → ,95-Marke darunter 17,95; mit Umlage 20,23 → 19,95.
  test('ohne Umlage (Nicht-Elektro): K = 11,56, Mindestpreis 17,95 — Formel unverändert', () => {
    for (const u of [undefined, 0, earUmlageFor(null), earUmlageFor({ isElectric: 0 }), earUmlageFor({}), earUmlageFor(false, 1.5)]) {
      const r = computeMinSellPrice({ ...base, earUmlageEur: u });
      expect(r.totalCost).toBeCloseTo(11.56, 9);
      expect(r.rawMinSellPrice).toBeCloseTo(18.263779527559056, 9);
      expect(r.minSellPrice).toBe(17.95);
    }
  });
  test('Elektro = ja mit Umlage 1,50: K = 13,06, Mindestpreis 19,95 (statt 17,95)', () => {
    const umlage = earUmlageFor({ isElectric: 1 }, 1.5);
    expect(umlage).toBe(1.5);
    const r = computeMinSellPrice({ ...base, earUmlageEur: umlage });
    expect(r.totalCost).toBeCloseTo(13.06, 9);
    expect(r.rawMinSellPrice).toBeCloseTo(20.23228346456693, 9);
    expect(r.minSellPrice).toBe(19.95);
  });
  test('Gewinn bei 19,95 € mit Umlage = 1,78 € (≥ Boden 1,30); der alte Preis 17,95 € ließe mit Umlage nur 0,26 € (unter dem Boden)', () => {
    const p = { sellPrice: 19.95, buyPrice: 6, isChinaOrigin: true, ebayFeeRatePercent: base.ebayFeeRatePercent, ebayFixedFeeEur: base.ebayFixedFeeEur, vatFactor: base.vatFactor, adRatePercent: 5 };
    expect(profitAtSellPrice({ ...p, earUmlageEur: 1.5 })).toBeCloseTo(1.7849, 4);
    expect(profitAtSellPrice(p)).toBeCloseTo(3.2849, 4); // ohne Umlage unverändert
    expect(profitAtSellPrice({ ...p, sellPrice: 17.95, earUmlageEur: 1.5 })).toBeCloseTo(0.2609, 4);
  });
  test('earUmlageFor: nur bestätigtes Elektro (ja); Standardbetrag ist 0,00; ungültige Beträge → 0', () => {
    expect(earUmlageFor({ isElectric: 1 })).toBe(0); // EAR_UMLAGE_EUR = 0,00 bis der Inhaber den Betrag setzt
    expect(earUmlageFor({ isElectric: true }, 2)).toBe(2);
    expect(earUmlageFor({ isElectric: null, electricSuggested: 1 }, 2)).toBe(0);
    expect(earUmlageFor({ isElectric: 1 }, -1)).toBe(0);
    expect(earUmlageFor({ isElectric: 1 }, NaN)).toBe(0);
  });
});

describe('Verdrahtung (Quelltext-Prüfung, ohne DB/eBay)', () => {
  const read = (p: string) => readFileSync(resolve(import.meta.dir, p), 'utf8');
  const idx = read('../api/index.ts');
  test('/ebay/list: Elektro-Sperre steht VOR dem Bestands-Gate und vor jedem eBay-Aufruf, schreibt Klartext ins Fehlerfeld', () => {
    const gate = idx.indexOf('const electricGate = evaluateElectricGate(product, electricSettings);');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(idx.indexOf('// Bestands-Gate: Varianten ohne bekannten Lagerbestand'));
    expect(gate).toBeLessThan(idx.indexOf('const listingId = await listOnEbay({'));
    expect(idx.slice(gate, gate + 450)).toContain('ebayError: electricGate.message');
  });
  test('Umlage wird an allen Preis-Stellen von Listing/Preisprüfung/Stufenwechsel übergeben', () => {
    expect(idx.split('earUmlageEur: earUmlageFor(product)').length - 1).toBe(5); // Listing-Preis, listOnEbay, Vorschau (Einzel + Rest), Preisprüfung
    expect(read('../api/price-monitor.ts')).toContain('earUmlageEur: earUmlageFor(product)');
    expect(read('../shared/tier-reprice.ts')).toContain('earUmlageEur: earUmlageFor(p.isElectric)');
    expect(read('../api/ebay.ts')).toContain('earUmlageEur: input.earUmlageEur');
  });
  test('Import schlägt Elektro nur vor (electricSuggested), setzt isElectric nie', () => {
    expect(idx).toContain('electricSuggested: suggestElectric(');
    expect(idx).not.toMatch(/isElectric:\s*(1|true)/);
  });
});

describe('Validierung PATCH / Einstellungen', () => {
  const TYPES = ['Kat. 5 Kleingeräte'];
  test('Produktfelder: ja/nein/offen, Batterie, Geräteart nur aus registrierten, Nachweise je { ok, note }', () => {
    expect(parseElectricPatch({ isElectric: true }, TYPES)).toEqual({ ok: true, fields: { isElectric: 1 } });
    expect(parseElectricPatch({ isElectric: false, hasBattery: true }, TYPES)).toEqual({ ok: true, fields: { isElectric: 0, hasBattery: 1 } });
    expect(parseElectricPatch({ isElectric: null }, TYPES)).toEqual({ ok: true, fields: { isElectric: null } });
    expect(parseElectricPatch({ deviceType: 'Kat. 5 Kleingeräte' }, TYPES)).toEqual({ ok: true, fields: { deviceType: 'Kat. 5 Kleingeräte' } });
    expect(parseElectricPatch({ deviceType: '' }, TYPES)).toEqual({ ok: true, fields: { deviceType: null } });
    const pr = parseElectricPatch({ electricProofs: { ce: { ok: true, note: 'CE-Bild' } } }, TYPES);
    expect(pr.ok && JSON.parse(pr.fields.electricProofs as string)).toEqual({ ce: { ok: true, note: 'CE-Bild' } });
  });
  test('ungültige Eingaben werden mit Klartext abgelehnt', () => {
    expect(parseElectricPatch({ isElectric: 'ja' }, TYPES).ok).toBe(false);
    expect(parseElectricPatch({ hasBattery: null }, TYPES).ok).toBe(false);
    const dt = parseElectricPatch({ deviceType: 'Kat. 3' }, TYPES);
    expect(!dt.ok && dt.error).toContain('nicht registriert');
    expect(parseElectricPatch({ electricProofs: { foo: { ok: true, note: '' } } }, TYPES).ok).toBe(false);
    expect(parseElectricPatch({ electricProofs: { ce: { ok: 'ja' } } }, TYPES).ok).toBe(false);
    expect(parseElectricPatch({ electricProofs: [] }, TYPES).ok).toBe(false);
  });
  test('Einstellungen: WEEE-Format, leer erlaubt, Gerätearten dedupliziert; fehlende Felder bleiben unberührt', () => {
    expect(parseElectricSettingsBody({ weeeRegNr: ' de12345678 ' })).toEqual({ ok: true, weeeRegNr: 'DE12345678' });
    expect(parseElectricSettingsBody({ weeeRegNr: '' })).toEqual({ ok: true, weeeRegNr: null });
    expect(parseElectricSettingsBody({ registeredDeviceTypes: [' Kat. 5 Kleingeräte ', 'Kat. 5 Kleingeräte'] })).toEqual({ ok: true, registeredDeviceTypes: ['Kat. 5 Kleingeräte'] });
    expect(parseElectricSettingsBody({})).toEqual({ ok: true });
    expect(parseElectricSettingsBody({ weeeRegNr: 'DE123' }).ok).toBe(false);
    expect(parseElectricSettingsBody({ registeredDeviceTypes: [''] }).ok).toBe(false);
    expect(parseElectricSettingsBody(null).ok).toBe(false);
  });
  test('parseElectricProofs ist tolerant (kaputtes JSON → leer)', () => {
    expect(parseElectricProofs('{kaputt')).toEqual({});
    expect(parseElectricProofs(null)).toEqual({});
  });
});

describe('CSV "Elektro-Verkäufe je Geräteart und Monat"', () => {
  const products = [
    { id: 301, asin: 'ali_1', isElectric: 1, deviceType: 'Kat. 5 Kleingeräte' },
    { id: 302, asin: 'ali_2', isElectric: 0, deviceType: null },
    { id: 303, asin: 'ali_3', isElectric: 1, deviceType: null },
    { id: 304, asin: 'ali_4', isElectric: null, deviceType: null },
  ];
  const orders = [
    { orderId: '11-1', orderDate: '2026-10-03T10:00:00.000Z', lineItems: [{ sku: 'stele-301', quantity: 2 }, { sku: 'stele-302', quantity: 5 }] },
    { orderId: '11-2', orderDate: '2026-10-20T10:00:00.000Z', lineItems: [{ sku: 'stele-301', quantity: 1 }, { sku: 'stele-303', quantity: 1 }] },
    { orderId: '11-3', orderDate: '2026-11-02T10:00:00.000Z', lineItems: [{ sku: 'stele-301-ROT', quantity: 4 }, { sku: 'stele-304', quantity: 9 }, { sku: null, quantity: 1 }] },
  ];
  test('nur bestätigte Elektro-Produkte, je Monat und Geräteart: Stückzahl und Bestellnummern', () => {
    expect(electricSalesCsv(orders, products)).toBe([
      'Monat;Geräteart;Stückzahl;Bestellnummern',
      '2026-10;(ohne Geräteart);1;11-2',
      '2026-10;Kat. 5 Kleingeräte;3;11-1, 11-2',
      '2026-11;Kat. 5 Kleingeräte;4;11-3',
    ].join('\n') + '\n');
  });
  test('Zeitraum-Filter und leere Eingabe (nur Kopfzeile)', () => {
    expect(electricSaleLines(orders, products, '2026-11-01', '2026-11-30').map(l => l.orderId)).toEqual(['11-3']);
    expect(buildElectricSalesCsv([])).toBe('Monat;Geräteart;Stückzahl;Bestellnummern\n');
  });
});
