// P2-Korrektur — Aufgabe 2: welcher Endpunkt liefert die Zusteller-Nummer (DHL), falls
// aliexpress.trade.ds.order.get sie NICHT liefert (bestätigt: aeop_order_logistics_info[] enthält
// nur logistics_service + logistics_no, s. scripts/inspect-ali-order-fields.ts). Probiert mehrere
// plausible Methodennamen EMPIRISCH gegen die echte API (Grundgesetz Regel 3/4: nicht raten,
// nachrechnen) — genau wie PR #99 aliexpress.ds.order.get (existierte nicht) gegen
// aliexpress.trade.ds.order.get (existiert) geprüft hat.
//
// SCHREIBT NICHTS.
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/probe-ali-logistics-endpoints.ts

import * as crypto from 'crypto';
import { ensureFreshAliToken, getAliAccessToken } from '../src/api/aliexpress-api';

const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '535690';
const APP_SECRET = process.env.ALIEXPRESS_APP_SECRET || 'Yc9AMgAmeQUB2Kc7hXsZ8qZoXtjOJWkW';
const IOP_ENDPOINT = 'https://api-sg.aliexpress.com/sync';

function iopSign(secret: string, params: Record<string, string>): string {
  const sorted = Object.keys(params).sort().map(k => `${k}${params[k]}`).join('');
  return crypto.createHash('md5').update(`${secret}${sorted}${secret}`, 'utf8').digest('hex').toUpperCase();
}

async function callMethod(method: string, extraParams: Record<string, string>, accessToken: string): Promise<Record<string, unknown>> {
  const params: Record<string, string> = {
    app_key: APP_KEY,
    method,
    timestamp: String(Date.now()),
    format: 'json',
    sign_method: 'md5',
    v: '2.0',
    access_token: accessToken,
    ...extraParams,
  };
  params.sign = iopSign(APP_SECRET, params);
  const res = await fetch(IOP_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20000),
  });
  return await res.json() as Record<string, unknown>;
}

await ensureFreshAliToken();
const accessToken = await getAliAccessToken();
if (!accessToken) {
  console.error('Kein AliExpress-Access-Token verfügbar — Abbruch.');
  process.exit(1);
}

// Reale Bestellung mit bekanntem logistics_no (aus dem Order-Get-Aufruf oben) als Test-Input.
const aliOrderId = '3075188992327211';
const knownLogisticsNo = 'AP00832504143414';

const candidates: Array<{ method: string; params: Record<string, string> }> = [
  { method: 'aliexpress.logistics.ds.trackinginfo.query', params: { logistics_no: knownLogisticsNo, to_area: 'DE', service_name: 'CAINIAO_FULFILLMENT_STD', origin: 'CN', out_ref: aliOrderId } },
];

for (const c of candidates) {
  console.log(`\n================ ${c.method} ================`);
  try {
    const data = await callMethod(c.method, c.params, accessToken);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.log('Fehler:', e);
  }
}

console.log('\nReiner Lesezugriff — es wurde NICHTS geschrieben.');
