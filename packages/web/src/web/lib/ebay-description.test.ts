import { describe, it, expect } from "bun:test";
import { buildEbayHTML, buildEbayHTMLLight, type ScrapedProduct } from "./ebay-description";

// Produkt mit typischem Lieferantentext-Verstoßmuster (Nachbau aus Phase-1-Funden:
// QQ/163/foxmail-Adressen, Telefonmuster, WeChat-Erwähnung, Fremd-Domain-Link).
const productWithThirdPartyContact: ScrapedProduct = {
  title: "Testartikel Backmatte AliExpress 200123456789",
  description:
    "###INTRO### Für Rückfragen kontaktieren Sie uns unter service@zreeshop.com oder per WeChat, Tel. +86 1387654321. Besuchen Sie auch unseren Shop unter https://zreeshop.com/store." +
    "###BULLETS### - Hitzebeständig bis 250°C, ideal für Backofen und Grill\n- Lieferant erreichbar via kontakt2699523@qq.com bei Fragen zur Lieferung" +
    "###OUTRO### Bei Problemen schreiben Sie uns direkt, wir antworten via WhatsApp +34 652 768 898.",
  specs: {
    Material: "Silikon, Kontakt: successservice2@hotmail.com",
    Herkunft: "China, Rückfragen an support@163.com",
  },
  bullets: [],
  images: ["https://ae01.alicdn.com/kf/example.jpg"],
};

const THIRD_PARTY_SNIPPETS = [
  "service@zreeshop.com",
  "zreeshop.com",
  "kontakt2699523@qq.com",
  "successservice2@hotmail.com",
  "support@163.com",
  "1387654321",
  "652 768 898",
  "wechat",
  "whatsapp",
];

const LEGAL_BLOCKS = {
  impressumEmail: "<strong>E-Mail:</strong> contact@stele-e-transfer.com",
  agbAnbieterzeile: "Anbieter: Evgenij Stele, Am Hochfeld 47, 65205 Wiesbaden | E-Mail: contact@stele-e-transfer.com",
};

describe("buildEbayHTML (dark) — Verstoß-Reparatur Phase 2", () => {
  const html = buildEbayHTML(productWithThirdPartyContact);

  it("enthält keinen KUNDENSERVICE-Block mehr", () => {
    expect(html).not.toContain("KUNDENSERVICE");
  });

  it("enthält keine Dritt-Kontakte aus dem Lieferantentext mehr", () => {
    const lower = html.toLowerCase();
    for (const snippet of THIRD_PARTY_SNIPPETS) {
      expect(lower).not.toContain(snippet.toLowerCase());
    }
  });

  it("lässt Impressum, AGB-Anbieterzeile und Widerrufsadresse unverändert (Pflichtangaben)", () => {
    expect(html).toContain(LEGAL_BLOCKS.impressumEmail);
    expect(html).toContain(LEGAL_BLOCKS.agbAnbieterzeile);
    expect(html).toContain("Widerruf an: stele-e-transfer, Am Hochfeld 47, 65205 Wiesbaden, contact@stele-e-transfer.com");
  });

  it("dreispaltige Info-Zeile ist zu einer sauberen Zweispalten-Zeile geworden", () => {
    expect(html).toContain('width:50%;border-right:1px solid #C9A84C;vertical-align:top;');
    expect(html).toContain('width:50%;vertical-align:top;');
    expect(html).not.toContain('width:33%');
    expect((html.match(/KOSTENLOSER VERSAND/g) ?? []).length).toBe(1);
    expect((html.match(/30 TAGE R&Uuml;CKGABE/g) ?? []).length).toBe(1);
  });
});

describe("buildEbayHTMLLight — Verstoß-Reparatur Phase 2", () => {
  const html = buildEbayHTMLLight(productWithThirdPartyContact);

  it("enthält keinen KUNDENSERVICE-Block mehr", () => {
    expect(html).not.toContain("KUNDENSERVICE");
  });

  it("enthält keine Dritt-Kontakte aus dem Lieferantentext mehr", () => {
    const lower = html.toLowerCase();
    for (const snippet of THIRD_PARTY_SNIPPETS) {
      expect(lower).not.toContain(snippet.toLowerCase());
    }
  });

  it("lässt Impressum, AGB-Anbieterzeile und Widerrufsadresse unverändert (Pflichtangaben)", () => {
    expect(html).toContain(LEGAL_BLOCKS.impressumEmail);
    expect(html).toContain(LEGAL_BLOCKS.agbAnbieterzeile);
    expect(html).toContain("Widerruf an: contact@stele-e-transfer.com");
  });

  it("dreispaltige Info-Zeile ist zu einer sauberen Zweispalten-Zeile geworden", () => {
    expect(html).toContain('width:50%;border-right:1px solid #e8d8a0;vertical-align:top;');
    expect(html).not.toContain('width:33%');
    expect((html.match(/KOSTENLOSER VERSAND/g) ?? []).length).toBe(1);
    expect((html.match(/30 TAGE R&Uuml;CKGABE/g) ?? []).length).toBe(1);
  });
});

describe("Regressionsschutz — unauffälliges Produkt bleibt unverändert nutzbar", () => {
  const cleanProduct: ScrapedProduct = {
    title: "Frischhaltedose Edelstahl 3er Set",
    description: "###INTRO### Praktisches Set für Küche und Aufbewahrung.###BULLETS### - Auslaufsicher\n- Spülmaschinenfest###OUTRO### Ideal für Meal Prep.",
    specs: { Material: "Edelstahl", Farbe: "Silber" },
    bullets: [],
    images: ["https://ae01.alicdn.com/kf/example2.jpg"],
  };

  it("erzeugt weiterhin eine vollständige Vorlage mit allen vier Pflicht-Tabs", () => {
    const html = buildEbayHTMLLight(cleanProduct);
    expect(html).toContain("Impressum");
    expect(html).toContain("Allgemeine Gesch&auml;ftsbedingungen");
    expect(html).toContain("Versandinformationen");
    expect(html).toContain("Praktisches Set für Küche und Aufbewahrung");
  });
});
