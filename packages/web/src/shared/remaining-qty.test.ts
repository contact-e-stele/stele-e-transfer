import { describe, expect, test } from 'bun:test';
import { remainingBySkuFromGetItem, remainingLevel, remainingText } from './remaining-qty';

// Fixture nach dem Live-Fund stele-220 (15.10.2026 20:35): GRAY 0 frei (7 gelistet, 7 verkauft), BLUE 1, BLACK 3.
const variationXml = `<GetItemResponse><Ack>Success</Ack><Item><Variations>
<Variation><SKU>stele-220-GRAY</SKU><StartPrice>19.95</StartPrice><Quantity>7</Quantity><SellingStatus><QuantitySold>7</QuantitySold></SellingStatus></Variation>
<Variation><SKU>stele-220-BLUE</SKU><StartPrice>21.95</StartPrice><Quantity>3</Quantity><SellingStatus><QuantitySold>2</QuantitySold></SellingStatus></Variation>
<Variation><SKU>stele-220-BLACK</SKU><StartPrice>20.95</StartPrice><Quantity>6</Quantity><SellingStatus><QuantitySold>3</QuantitySold></SellingStatus></Variation>
</Variations></Item></GetItemResponse>`;

describe('Restmenge (Plan F)', () => {
  test('Varianten: Quantity − QuantitySold je SKU', () => {
    const m = remainingBySkuFromGetItem(variationXml, 220);
    expect(m.get('stele-220-GRAY')).toBe(0);
    expect(m.get('stele-220-BLUE')).toBe(1);
    expect(m.get('stele-220-BLACK')).toBe(3);
  });
  test('Stufen: 0 rot, 1 gelb, 3 normal, unbekannt', () => {
    expect(remainingLevel(0)).toBe('out');
    expect(remainingLevel(1)).toBe('last');
    expect(remainingLevel(3)).toBe('ok');
    expect(remainingLevel(null)).toBe('unknown');
    expect(remainingText(0)).toBe('AUSVERKAUFT – nachfüllen');
    expect(remainingText(3)).toBe('bei eBay noch 3');
  });
  test('Einzelartikel: verkaufte Menge auf Item-Ebene', () => {
    const xml = `<GetItemResponse><Ack>Success</Ack><Item><StartPrice>9.95</StartPrice><Quantity>5</Quantity><SellingStatus><QuantitySold>2</QuantitySold></SellingStatus></Item></GetItemResponse>`;
    expect(remainingBySkuFromGetItem(xml, 98).get('stele-98')).toBe(3);
  });
  test('ohne QuantitySold → unbekannt, keine geratene Zahl', () => {
    const xml = `<GetItemResponse><Ack>Success</Ack><Item><StartPrice>9.95</StartPrice><Quantity>5</Quantity></Item></GetItemResponse>`;
    expect(remainingBySkuFromGetItem(xml, 98).get('stele-98')).toBeNull();
  });
  test('GetItem fehlgeschlagen → leer (alles unbekannt)', () => {
    const xml = `<GetItemResponse><Ack>Failure</Ack><Errors><LongMessage>Item not found</LongMessage></Errors></GetItemResponse>`;
    expect(remainingBySkuFromGetItem(xml, 98).size).toBe(0);
  });
});
