import { describe, expect, test } from "bun:test";
import { matchesProductSearch } from "./product-search";

const p71 = { id: 71, title: "Non-stick BBQ Grill Mat", generatedTitle: "Grillmatte antihaft" };
const p171 = { id: 171, title: "Other", generatedTitle: "Anderes Produkt" };
const p205 = { id: 205, title: "11pcs Travel Bottles", generatedTitle: "11-teiliges Reiseflaschen Set" };

describe("matchesProductSearch", () => {
  test("leere Suche zeigt alles", () => {
    expect(matchesProductSearch(p71, "")).toBe(true);
    expect(matchesProductSearch(p71, "   ")).toBe(true);
  });
  test("Nummer trifft genau das Produkt", () => {
    expect(matchesProductSearch(p71, "71")).toBe(true);
    expect(matchesProductSearch(p171, "71")).toBe(false);
    expect(matchesProductSearch(p205, "205")).toBe(true);
  });
  test("stele-Präfix in allen Schreibweisen", () => {
    for (const q of ["stele-71", "STELE-71", "stele 71", "stele71", " stele-71 "]) {
      expect(matchesProductSearch(p71, q)).toBe(true);
      expect(matchesProductSearch(p171, q)).toBe(false);
    }
  });
  test("Titelsuche wie bisher (generiert + Original, ohne Groß/Klein)", () => {
    expect(matchesProductSearch(p71, "grill")).toBe(true);
    expect(matchesProductSearch(p71, "BBQ")).toBe(true);
    expect(matchesProductSearch(p205, "reiseflaschen")).toBe(true);
    expect(matchesProductSearch(p205, "grill")).toBe(false);
  });
  test("Zahl im Titel wird weiter gefunden", () => {
    expect(matchesProductSearch(p205, "11")).toBe(true);
  });
});
