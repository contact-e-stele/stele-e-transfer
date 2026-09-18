// P-88 Schritt 1a — Diagnose VOR jedem Code-Umbau (Grundgesetz Regel 1): Statuscode und
// Roh-Antwort von eBays get_item_aspects_for_category für Kategorie 57920 wörtlich loggen.
// Testet BEIDE Token-Typen (User-Token via refresh_token UND App-Token via client_credentials),
// weil ebay.ts:448 den User-Token übergibt, aber unklar ist, ob die Taxonomy API den erlaubt
// (Verdacht: falscher Token-Typ oder fehlender Scope → Fehlerantwort wird in ebay.ts als [] gewertet
// und dauerhaft negativ gecacht, ohne dass der wörtliche Grund je geloggt wurde).
//
// SCHREIBT NICHTS — nur GET-Requests gegen die Taxonomy API.
//
// Läuft NICHT in dieser Sandbox (kein EBAY_CLIENT_ID/SECRET/REFRESH_TOKEN in .env — geprüft,
// nur TURSO_* vorhanden; api.ebay.com liefert daher schon bei getAccessToken() 401 invalid_client).
// Aufruf mit echten Zugangsdaten (lokal oder Render-Shell):
//   bun --env-file=<repo>/.env scripts/diag-aspect-fetch-category-57920.ts

import { getAccessToken, getAppToken } from '../src/api/ebay';

const CATEGORY_ID = process.argv[2] ?? '57920';
const BASE_URL = process.env.EBAY_SANDBOX === 'true' ? 'https://api.sandbox.ebay.com' : 'https://api.ebay.com';
const URL_ = `${BASE_URL}/commerce/taxonomy/v1/category_tree/77/get_item_aspects_for_category?category_id=${CATEGORY_ID}`;

async function probe(label: string, tokenFn: () => Promise<string>) {
  console.log(`\n=== ${label} ===`);
  try {
    const token = await tokenFn();
    console.log('Token erhalten (erste 12 Zeichen):', token.slice(0, 12) + '...');
    const res = await fetch(URL_, { headers: { 'Authorization': `Bearer ${token}`, 'Accept-Language': 'de-DE' } });
    const text = await res.text();
    console.log('Status:', res.status, res.statusText);
    console.log('Roh-Antwort (erste 2000 Zeichen):');
    console.log(text.slice(0, 2000));
  } catch (e) {
    console.log('Fehler VOR dem eigentlichen Aufruf:', e instanceof Error ? e.message : String(e));
  }
}

console.log('URL:', URL_);
await probe('User-Token (getAccessToken / refresh_token-Flow, wie aktuell in ebay.ts:448 verwendet)', getAccessToken);
await probe('App-Token (getAppToken / client_credentials-Flow, für Taxonomy API dokumentiert)', getAppToken);
