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

// eBay-Verstoßserie 2026-09-28: Impressum/AGB-Tabs (mit der eigenen Kontaktadresse) sind
// eBay-Verkäufereinstellungen, keine Beschreibungsinhalte mehr — die Vorlage darf die eigene
// Adresse jetzt an KEINER Stelle mehr enthalten (s. description-compliance.ts für die harte Prüfung).
describe("buildEbayHTML (dark) — Verstoß-Reparatur Phase 2 + Grundsatzkonform (2026-09-28)", () => {
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

  it("enthält keine Impressum/AGB-Tabs und keine eigene Kontaktadresse mehr", () => {
    expect(html).not.toContain("Impressum");
    expect(html).not.toContain("Allgemeine Gesch&auml;ftsbedingungen");
    expect(html).not.toContain("contact@stele-e-transfer.com");
    expect(html).not.toContain("Widerruf an:");
  });

  it("Versandinformationen (Versandart/-kosten/-zeit als Freitext) sind aus dem Retouren-Tab entfernt, Retouren-Inhalt bleibt", () => {
    expect(html).not.toContain("Versandinformationen");
    expect(html).not.toContain("Kostenloser Versand");
    expect(html).toContain("Retouren &amp; R&uuml;ckgabe");
    expect(html).toContain("30 Tage R&uuml;ckgaberecht");
  });

  it("einspaltige Info-Zeile (KOSTENLOSER VERSAND-Box entfernt, nur noch 30 TAGE RÜCKGABE)", () => {
    expect(html).not.toContain("KOSTENLOSER VERSAND");
    expect(html).not.toContain("width:50%");
    expect(html).not.toContain("width:33%");
    expect(html).toContain("width:100%;vertical-align:top;");
    expect((html.match(/30 TAGE R&Uuml;CKGABE/g) ?? []).length).toBe(1);
  });
});

describe("buildEbayHTMLLight — Verstoß-Reparatur Phase 2 + Grundsatzkonform (2026-09-28)", () => {
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

  it("enthält keine Impressum/AGB-Tabs und keine eigene Kontaktadresse mehr", () => {
    expect(html).not.toContain("Impressum");
    expect(html).not.toContain("Allgemeine Gesch&auml;ftsbedingungen");
    expect(html).not.toContain("contact@stele-e-transfer.com");
    expect(html).not.toContain("Widerruf an:");
  });

  it("Versandinformationen (Versandart/-kosten/-zeit als Freitext) sind aus dem Retouren-Tab entfernt, Retouren-Inhalt bleibt", () => {
    expect(html).not.toContain("Versandinformationen");
    expect(html).not.toContain("Kostenloser Versand");
    expect(html).toContain("Retouren &amp; R&uuml;ckgabe");
    expect(html).toContain("30 Tage R&uuml;ckgaberecht");
  });

  it("einspaltige Info-Zeile (KOSTENLOSER VERSAND-Box entfernt, nur noch 30 TAGE RÜCKGABE)", () => {
    expect(html).not.toContain("KOSTENLOSER VERSAND");
    expect(html).not.toContain("width:50%");
    expect(html).not.toContain("width:33%");
    expect(html).toContain("width:100%;vertical-align:top;");
    expect((html.match(/30 TAGE R&Uuml;CKGABE/g) ?? []).length).toBe(1);
  });
});

describe("Keine Bild-Hotlinks mehr (eBay-Verstoßserie 2026-09-28)", () => {
  it("Varianten-Zeilen zeigen keinen AliExpress-Hotlink mehr, sondern immer den Platzhalter", () => {
    const product: ScrapedProduct = {
      title: "Testartikel mit Varianten",
      skuVariants: [
        { name: "Rot", price: 9.99, imageUrl: "https://ae01.alicdn.com/kf/variant-red.jpg" },
        { name: "Blau", price: 9.99, imageUrl: "https://ae01.alicdn.com/kf/variant-blue.jpg" },
      ],
      bullets: [],
    };
    const html = buildEbayHTMLLight(product);
    expect(html).not.toContain("ae01.alicdn.com");
    expect(html).not.toContain("<img");
  });

  it("Produkt ohne Varianten zeigt kein AliExpress-Hauptbild mehr als Fallback", () => {
    const product: ScrapedProduct = {
      title: "Testartikel ohne Varianten",
      images: ["https://ae01.alicdn.com/kf/main.jpg"],
      bullets: [],
    };
    const html = buildEbayHTMLLight(product);
    expect(html).not.toContain("ae01.alicdn.com");
    expect(html).not.toContain("<img");
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

  it("erzeugt weiterhin eine vollständige Vorlage mit den verbleibenden Pflicht-Tabs (Beschreibung, Retouren)", () => {
    const html = buildEbayHTMLLight(cleanProduct);
    expect(html).toContain("Beschreibung");
    expect(html).toContain("Retouren");
    expect(html).toContain("Praktisches Set für Küche und Aufbewahrung");
  });
});
