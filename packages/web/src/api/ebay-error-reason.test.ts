// 050 P3 (stele-208): eBay 25019 "Cannot revise listing" – der eigentliche Grund steht nur in parameters[].value.
// Fixture = echte Antwort aus dem Render-Log vom 17.11.2026 (publish_by_inventory_item_group stele-208-GROUP → 400).
import { describe, expect, test } from 'bun:test';
import { prettifyEbayError, ebayErrorParameterReason } from './ebay';

const RAW_208 = 'publishOfferByInventoryItemGroup failed: 400 {"errors":[{"errorId":25019,"domain":"API_INVENTORY","subdomain":"Selling","category":"Request","message":"Cannot revise listing. Der Artikel kann weder eingestellt noch bearbeitet werden. Die Artikelbezeichnung und/oder -beschreibung enthalten unter Umständen unzulässige Begriffe oder das Angebot verstößt gegen die eBay-Grundsätze.","parameters":[{"name":"0","value":"Dieser Artikel kann nur im Inland verkauft werden. Der Versand in andere L&auml;nder ist nicht erlaubt. Bevor Sie das Angebot einstellen, m&uuml;ssen Sie die Versandoptionen f&uuml;r Orte au&szlig;erhalb Ihres Landes entfernen.&nbsp;&nbsp;<font color=\\"#757575\\" size=\\"1\\">{e302249-1200402x}</font>"}]}]}';

describe('ebayErrorParameterReason', () => {
  test('stele-208: Inlands-Grund lesbar, ohne HTML/Entities/eBay-Code', () => {
    expect(ebayErrorParameterReason(RAW_208)).toBe(
      'Dieser Artikel kann nur im Inland verkauft werden. Der Versand in andere Länder ist nicht erlaubt. Bevor Sie das Angebot einstellen, müssen Sie die Versandoptionen für Orte außerhalb Ihres Landes entfernen.',
    );
  });

  test('ohne parameters → null', () => {
    expect(ebayErrorParameterReason('x 400 {"errors":[{"errorId":25001,"message":"Irgendwas ist schiefgelaufen hier"}]}')).toBeNull();
  });

  test('kein JSON → null', () => {
    expect(ebayErrorParameterReason('Netzwerkfehler')).toBeNull();
  });

  test('nur Zahlen-Parameter (z. B. SKU-Index) → null', () => {
    expect(ebayErrorParameterReason('{"errors":[{"message":"Fehlermeldung lang genug","parameters":[{"name":"0","value":"12345"}]}]}')).toBeNull();
  });
});

describe('prettifyEbayError mit Grund', () => {
  test('stele-208: Anzeige enthält den eBay-Grund', () => {
    const msg = prettifyEbayError(RAW_208);
    expect(msg.startsWith('eBay-Fehler: Cannot revise listing.')).toBe(true);
    expect(msg).toContain('— Grund laut eBay: Dieser Artikel kann nur im Inland verkauft werden.');
  });

  test('ohne parameters bleibt die Meldung wie bisher', () => {
    expect(prettifyEbayError('{"errors":[{"message":"Das Angebot ist ungültig."}]}')).toBe('eBay-Fehler: Das Angebot ist ungültig.');
  });
});
