# P2-Korrektur — Aufgabe 1+2: Feldliste + Endpunkt-Suche für die Zusteller-Nummer

Erzeugt am 14.09.2026 mit `scripts/inspect-ali-order-fields.ts` und
`scripts/probe-ali-logistics-endpoints.ts` gegen die echte AliExpress-API.
**Reiner Lesezugriff — nichts geschrieben.**

## Aufgabe 1 — volle Feldliste von `aliexpress.trade.ds.order.get`

Top-Level `result`-Objekt (beide geprüften Bestellungen identisch):

```
child_order_list, gmt_create, logistics_info_list, logistics_status, order_amount,
order_paidtime_string, order_status, pay_timeout_second, store_info, user_order_amount
```

`logistics_info_list.aeop_order_logistics_info[]` — **nur zwei Felder, für beide Bestellungen**:

| Bestellung | logistics_service | logistics_no |
|---|---|---|
| 3076306514497211 | CAINIAO_FULFILLMENT_STD | AP00843143208329 |
| 3075188992327211 | CAINIAO_FULFILLMENT_STD | AP00832504143414 |

Kein Zusteller-Namensfeld, keine Zusteller-Nummer in diesem Endpunkt vorhanden.

## Aufgabe 2 — gesuchter Alternativ-Endpunkt

Empirisch (Parameter-Iteration gegen die echte API, nicht geraten) gefunden: **`aliexpress.logistics.ds.trackinginfo.query`** existiert (Pflichtparameter: `logistics_no`, `to_area`, `service_name`, `origin`, `out_ref`).

Echter Aufruf gegen `3075188992327211` (logistics_no `AP00832504143414`, to_area `DE`, service_name `CAINIAO_FULFILLMENT_STD`, origin `CN`, out_ref `3075188992327211`) liefert:

- `official_website: "https://www.dhl.de/"` — bestätigt: Zusteller ist DHL.
- `details.details[]` — Sendungsereignisse (`event_desc`, `event_date`, `address`), u.a. "Package delivered" 2026-08-05 16:37:20.
- `result_success: true`

**Vollständige, erschöpfend geprüfte Feldliste der Antwort:** `official_website, details, result_success, request_id, _trace_id_` — sonst nichts, auch nicht verschachtelt (`grep` über das komplette rohe JSON nach `00340`/`mail_no`/`tracking`/`waybill` liefert keinen Treffer).

**Ergebnis: die echte Zusteller-Nummer (DHL, hier laut manueller Prüfung `00340434886283998797`) ist über keine der beiden hier getesteten AliExpress-Open-API-Methoden abrufbar.** Sie erscheint laut Auftrag nur auf der Sendungsverfolgungs-WEBSEITE der einzelnen Bestellung (HTML) — vermutlich nur per Browser-Scraping erreichbar. Dieses Projekt hat dafür bereits eine Playwright-Infrastruktur (`aliexpress.ts`), aber nicht für diesen Zweck ausgebaut oder getestet — eigener, separater Auftrag nötig.

## Folge für den Cron

`isAliInternalLogisticsId()` (`aliexpress-api.ts`) filtert AP-Werte konsequent heraus. Da beide bisher beobachteten Bestellungen ausschließlich AP-Werte liefern, liefert `getAliOrderTracking()` für sie `trackingNumber: null` — der Cron schreibt aktuell nichts. `ALIEXPRESS_TRACKING_SYNC_ENABLED` bleibt `false`.
