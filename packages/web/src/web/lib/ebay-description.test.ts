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

// P71-C (30.09.2026, Vorgabe Inhaber): Vorlage wieder mit 5 Tabs (Beschreibung, Versand & Retouren,
// Impressum, AGB, Produktsicherheit) — aber ohne E-Mail, Telefonnummer und Link im Text.
describe("buildEbayHTML (dark) — Verstoß-Reparatur Phase 2 + Grundsatzkonform (2026-09-28)", () => {
  const BUILD = buildEbayHTML;
  const html = BUILD(productWithThirdPartyContact);

  it("enthält keinen KUNDENSERVICE-Block mehr", () => {
    expect(html).not.toContain("KUNDENSERVICE");
  });

  it("enthält keine Dritt-Kontakte aus dem Lieferantentext mehr", () => {
    const lower = html.toLowerCase();
    for (const snippet of THIRD_PARTY_SNIPPETS) {
      expect(lower).not.toContain(snippet.toLowerCase());
    }
  });

  it("P71-C: alle 5 Tabs vorhanden (Beschreibung, Versand & Retouren, Impressum, AGB, Produktsicherheit)", () => {
    const withGpsr = BUILD({ ...productWithThirdPartyContact, gpsrRaw: "Hersteller: Foo Ltd" });
    for (const label of ["Beschreibung", "Versand &amp; Retouren", "Impressum", "AGB", "Produktsicherheit"]) {
      expect(withGpsr).toContain(`>${label}</label>`);
    }
  });

  it("P71-C Teil 2: Vorlage OHNE gpsrRaw hat trotzdem alle 5 Tabs (Produktsicherheit immer) inkl. CSS für Tab 5", () => {
    const noGpsr = BUILD({ ...productWithThirdPartyContact, gpsrRaw: null });
    for (const label of ["Beschreibung", "Versand &amp; Retouren", "Impressum", "AGB", "Produktsicherheit"]) {
      expect(noGpsr).toContain(`>${label}</label>`);
    }
    expect(noGpsr).toContain('id="stet-t5"');
    expect(noGpsr).toContain('label[for="stet-t5"]');
  });

  it("P71-C: Impressum/AGB/Widerruf ohne E-Mail, Telefon oder Link — Kontakt über eBay-Nachrichten", () => {
    expect(html).toContain("Allgemeine Gesch&auml;ftsbedingungen");
    expect(html).toContain("Widerruf an:");
    expect(html).toContain("Kontakt &uuml;ber eBay-Nachrichten");
    expect(html).not.toContain("@");
    expect(html).not.toContain("http");
    expect(html).not.toContain("alicdn");
    expect(html).not.toContain("ec.europa.eu");
    expect(html).toContain("Wir nehmen nicht an Streitbeilegungsverfahren teil.");
  });

  it("P71-C: Versandinformationen und Kachel KOSTENLOSER VERSAND wieder da, ohne Amazon Logistik", () => {
    expect(html).toContain("Versandinformationen");
    expect(html).toContain("KOSTENLOSER VERSAND");
    expect(html).toContain("Retouren &amp; R&uuml;ckgabe");
    expect(html).not.toContain("Amazon Logistik");
  });
});

describe("buildEbayHTMLLight — Verstoß-Reparatur Phase 2 + Grundsatzkonform (2026-09-28)", () => {
  const BUILD = buildEbayHTMLLight;
  const html = BUILD(productWithThirdPartyContact);

  it("enthält keinen KUNDENSERVICE-Block mehr", () => {
    expect(html).not.toContain("KUNDENSERVICE");
  });

  it("enthält keine Dritt-Kontakte aus dem Lieferantentext mehr", () => {
    const lower = html.toLowerCase();
    for (const snippet of THIRD_PARTY_SNIPPETS) {
      expect(lower).not.toContain(snippet.toLowerCase());
    }
  });

  it("P71-C: alle 5 Tabs vorhanden (Beschreibung, Versand & Retouren, Impressum, AGB, Produktsicherheit)", () => {
    const withGpsr = BUILD({ ...productWithThirdPartyContact, gpsrRaw: "Hersteller: Foo Ltd" });
    for (const label of ["Beschreibung", "Versand &amp; Retouren", "Impressum", "AGB", "Produktsicherheit"]) {
      expect(withGpsr).toContain(`>${label}</label>`);
    }
  });

  it("P71-C Teil 2: Vorlage OHNE gpsrRaw hat trotzdem alle 5 Tabs (Produktsicherheit immer) inkl. CSS für Tab 5", () => {
    const noGpsr = BUILD({ ...productWithThirdPartyContact, gpsrRaw: null });
    for (const label of ["Beschreibung", "Versand &amp; Retouren", "Impressum", "AGB", "Produktsicherheit"]) {
      expect(noGpsr).toContain(`>${label}</label>`);
    }
    expect(noGpsr).toContain('id="stet-l5"');
    expect(noGpsr).toContain('label[for="stet-l5"]');
  });

  it("P71-C: Impressum/AGB/Widerruf ohne E-Mail, Telefon oder Link — Kontakt über eBay-Nachrichten", () => {
    expect(html).toContain("Allgemeine Gesch&auml;ftsbedingungen");
    expect(html).toContain("Widerruf an:");
    expect(html).toContain("Kontakt &uuml;ber eBay-Nachrichten");
    expect(html).not.toContain("@");
    expect(html).not.toContain("http");
    expect(html).not.toContain("alicdn");
    expect(html).not.toContain("ec.europa.eu");
    expect(html).toContain("Wir nehmen nicht an Streitbeilegungsverfahren teil.");
  });

  it("P71-C: Versandinformationen und Kachel KOSTENLOSER VERSAND wieder da, ohne Amazon Logistik", () => {
    expect(html).toContain("Versandinformationen");
    expect(html).toContain("KOSTENLOSER VERSAND");
    expect(html).toContain("Retouren &amp; R&uuml;ckgabe");
    expect(html).not.toContain("Amazon Logistik");
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

  it("erzeugt weiterhin eine vollständige Vorlage (Beschreibung, Versand & Retouren)", () => {
    const html = buildEbayHTMLLight(cleanProduct);
    expect(html).toContain("Beschreibung");
    expect(html).toContain("Retouren");
    expect(html).toContain("Praktisches Set für Küche und Aufbewahrung");
  });
});
