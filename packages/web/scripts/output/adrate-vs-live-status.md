# P-81 Stufe 1: adRate vs. Live-Werbestatus — alle aktiven Produkte

Erzeugt mit `bun --env-file=<repo>/.env scripts/report-adrate-vs-live-status.ts` gegen die
echte Produktions-DB. **Reiner Lesezugriff — nichts geschrieben.**

38 aktive Produkte (ebayStatus="listed").

**Einschränkung, ausdrücklich benannt:** die Spalte "aktuell beworben?" verlangt einen
echten Abruf über die Sell Marketing API (z.B. getAdsByInventoryReference) — aus dieser
Sandbox nicht möglich (kein eBay-Zugriff, s. `scripts/check-marketing-campaigns.ts`).
Diese Spalte bleibt deshalb leer statt erfunden (Grundgesetz Regel 4) — kein "vermutlich
ja/nein".

| SKU | adRate (DB, %) | ebayListingId | aktuell beworben? (eBay live) |
|---|---|---|---|
| stele-70 | 5 | 198611218585 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-71 | 5 | 198601109182 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-77 | 5 | 198601109061 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-83 | 5 | 198601110668 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-87 | 5 | 198611181405 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-92 | 5 | 198601108787 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-95 | 5 | 198601103721 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-96 | 5 | 198601101219 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-97 | 5 | 198601100567 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-107 | 5 | 198601087866 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-110 | 5 | 198601084836 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-119 | 5 | 198601077240 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-120 | 5 | 198562902347 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-121 | 5 | 198601078101 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-122 | 5 | 198601077953 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-123 | 5 | 198601076435 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-127 | 5 | 198601075438 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-129 | 5 | 198601075118 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-131 | 5 | 198601061256 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-132 | 5 | 198601064695 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-137 | 5 | 198589591311 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-138 | 5 | 198601055850 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-139 | 5 | 198601052038 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-140 | 5 | 198601055477 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-141 | 5 | 198601086057 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-142 | 5 | 198601090726 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-143 | 5 | 198601090754 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-145 | 5 | 198601108547 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-147 | 5 | 198609855213 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-148 | 5 | 198611202529 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-149 | 5 | 198611218189 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-150 | 5 | 198622290969 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-151 | 5 | 198622289729 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-152 | 5 | 198625473351 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-153 | 5 | 198638368615 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-155 | 5 | 198638388659 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-156 | 5 | 198641134058 | _(nicht abrufbar — s. Einschränkung oben)_ |
| stele-157 | 5 | 198641130074 | _(nicht abrufbar — s. Einschränkung oben)_ |

Vorkommende adRate-Werte in der DB: 5
Produkte mit adRate=0 ("keine Anzeige" laut neuer Semantik): 0
Produkte mit adRate=NULL (nie explizit gesetzt): 0