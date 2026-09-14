# P-82: Trockenlauf — Offer-Payload mit Kategorie (ohne echten eBay-Call)

Reales Produkt aus der Produktions-DB: **stele-49** — "Alu-Schalen 30er Pack für Takeaway, Catering, Haushalt"
`storeCategoryName` aktuell in der DB: _(keine — neue Spalte, noch nicht befüllt)_

## Fall A — Produkt WIE JETZT in der DB (Aufgabe 5: keine Kategorie hinterlegt)

```json
{
  "sku": "stele-49",
  "marketplaceId": "EBAY_DE",
  "format": "FIXED_PRICE",
  "availableQuantity": 3,
  "categoryId": "79720",
  "listingDescription": "(gekürzt für die Vorschau — echte HTML-Beschreibung wird beim Listen verwendet)",
  "pricingSummary": {
    "price": {
      "value": "30.95",
      "currency": "EUR"
    }
  },
  "merchantLocationKey": "default",
  "listingPolicies": "(aus getBusinessPolicies() — echter eBay-Call, hier nicht ausgeführt)",
  "itemSpecifics": "(aus buildAspects() — echter eBay-Call, hier nicht ausgeführt)",
  "productSafety": "(GPSR-Block — reine Produktdaten, kein eBay-Call, hier der Übersichtlichkeit halber weggelassen)"
}
```

**`storeCategoryNames` fehlt im Payload komplett** — kein "Sonstiges"-Ersatzwert, exakt wie in Aufgabe 5 gefordert.

## Fall B — Illustratives Beispiel MIT gesetzter Kategorie

**Wichtig:** `/Wohnen & Möbel` ist hier ein Beispielwert, KEINE echte, live abgerufene
eBay-Kategorie — die echte Kategorieliste ist aus dieser Sandbox nicht abrufbar (s.
`scripts/output/store-categories.md`). Zeigt nur die CODE-PFAD-Logik, nicht echte Daten.

```json
{
  "sku": "stele-49",
  "marketplaceId": "EBAY_DE",
  "format": "FIXED_PRICE",
  "availableQuantity": 3,
  "categoryId": "79720",
  "listingDescription": "(gekürzt für die Vorschau — echte HTML-Beschreibung wird beim Listen verwendet)",
  "pricingSummary": {
    "price": {
      "value": "30.95",
      "currency": "EUR"
    }
  },
  "merchantLocationKey": "default",
  "listingPolicies": "(aus getBusinessPolicies() — echter eBay-Call, hier nicht ausgeführt)",
  "itemSpecifics": "(aus buildAspects() — echter eBay-Call, hier nicht ausgeführt)",
  "productSafety": "(GPSR-Block — reine Produktdaten, kein eBay-Call, hier der Übersichtlichkeit halber weggelassen)",
  "storeCategoryNames": [
    "/Wohnen & Möbel"
  ]
}
```

`storeCategoryNames: ["/Wohnen & Möbel"]` ist jetzt im Payload enthalten.