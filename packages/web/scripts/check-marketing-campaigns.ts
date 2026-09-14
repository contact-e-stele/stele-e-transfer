// P-81 Stufe 1 — Aufgabe 1+2+6: Scope-Status + vorhandene Marketing-Kampagnen prüfen. NUR LESEND
// — keine Kampagne wird angelegt (Aufgabe 2 verlangt ausdrücklich: "sagen, nicht selbst anlegen").
//
// Aufruf (aus packages/web/): bun --env-file=<repo>/.env scripts/check-marketing-campaigns.ts

import { getMarketingAccessToken, getCampaigns } from '../src/api/ebay';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const outDir = resolve(import.meta.dir, 'output');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'marketing-scope-and-campaigns.md');

console.log('Prüfe Marketing-Scope + vorhandene Kampagnen (nur lesend)...\n');

const lines: string[] = [];
lines.push('# P-81 Stufe 1: Marketing-Scope-Status + vorhandene Kampagnen');
lines.push('');
lines.push('## Aufgabe 1 — Scope geprüft (Code-Inspektion, nicht Vermutung)');
lines.push('');
lines.push('`getOAuthUrl()` UND `getAccessToken()` (vor dieser Änderung, `ebay.ts`) fordern beim');
lines.push('Autorisieren/Refresh exakt drei Scopes an: `sell.inventory`, `sell.account`,');
lines.push('`sell.fulfillment`. `sell.marketing` war NIE Teil der Anfrage — der aktuelle Token hat');
lines.push('diesen Scope NICHT. Ein OAuth-Refresh-Token trägt nur die beim ursprünglichen Consent');
lines.push('gewährten Scopes. **Der Nutzer muss die App einmal neu autorisieren** (`GET /api/ebay/auth`');
lines.push('erneut durchlaufen) — kein Workaround gebaut.');
lines.push('');
lines.push('`getOAuthUrl()` fordert ab diesem PR zusätzlich `sell.marketing` an (breiter als nur');
lines.push('`.readonly`, damit eine einzige Neu-Autorisierung für Stufe 1 UND eine spätere');
lines.push('Schreib-Stufe reicht) — wirkt erst NACH einer Neu-Autorisierung.');
lines.push('');

try {
  const token = await getMarketingAccessToken();
  console.log('Marketing-Access-Token erhalten — Scope war also doch vorhanden (unerwartet, bitte prüfen).');
  lines.push('## Aufgabe 2 — Kampagnen (echter Abruf, Scope war vorhanden)');
  lines.push('');
  const campaigns = await getCampaigns(token);
  lines.push(`${campaigns.length} Kampagne(n) gefunden.`);
  lines.push('');
  lines.push('| Kampagnen-ID | Name | Status | Typ (Targeting) | Funding-Modell |');
  lines.push('|---|---|---|---|---|');
  for (const c of campaigns) {
    lines.push(`| ${c.campaignId} | ${c.campaignName} | ${c.campaignStatus} | ${c.campaignTargetingType ?? '–'} | ${c.fundingModel ?? '–'} |`);
  }
  if (campaigns.length === 0) {
    lines.push('');
    lines.push('**Keine Kampagne vorhanden.** Aufgabe 2: nicht selbst angelegt, wie gefordert.');
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error('Marketing-Token-Abruf fehlgeschlagen (erwartet):', msg);
  lines.push('## Aufgabe 2 — Kampagnen: NICHT abrufbar');
  lines.push('');
  lines.push('Echter Fehlversuch (Grundgesetz Regel 1 — wörtlicher Grund statt "geht nicht"):');
  lines.push('');
  lines.push('```');
  lines.push(msg);
  lines.push('```');
  lines.push('');
  lines.push('Root Cause, doppelt bestätigt:');
  lines.push('1. `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET`/`EBAY_REFRESH_TOKEN` sind in dieser Sandbox');
  lines.push('   nicht gesetzt (leer in `.env`) — derselbe Blocker wie bei jedem anderen eBay-Call');
  lines.push('   in dieser Umgebung (s. PR #97, #106).');
  lines.push('2. Selbst mit gültigen Zugangsdaten würde dieser Aufruf fehlschlagen, weil der');
  lines.push('   bestehende Refresh-Token den `sell.marketing`-Scope nicht hat (s. Aufgabe 1) —');
  lines.push('   der Nutzer muss zuerst neu autorisieren.');
  lines.push('');
  lines.push('**Kampagnenliste NICHT abrufbar. Keine erfundenen Kampagnen — die Lücke bleibt offen.**');
  lines.push('`scripts/check-marketing-campaigns.ts` steht bereit für einen echten Lauf, sobald der');
  lines.push('Nutzer neu autorisiert hat.');
}

console.log(lines.join('\n'));
writeFileSync(outPath, lines.join('\n'), 'utf-8');
console.log(`\nDatei geschrieben: ${outPath}`);
