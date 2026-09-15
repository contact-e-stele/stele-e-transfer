# eBay Neu Verbinden + Scope-Anzeige Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Nutzer kann in den Einstellungen die eBay-App neu autorisieren (Knopf "Neu verbinden"), sieht danach ehrlich, welche Scopes der aktuelle Token trägt und ob `sell.marketing` dabei ist, und der neue Refresh Token wird tatsächlich gespeichert und verwendet (statt nur im Server-Log zu landen).

**Architektur:** Übernimmt 1:1 das bestehende AliExpress-OAuth-Muster (generische `app_settings` Key-Value-Tabelle, DB-Wert hat Vorrang vor Env-Variable, `onConflictDoUpdate`). Neue reine Hilfsfunktionen (`getRequestedScopeList`, `hasScope`) sind isoliert testbar. Die Scope-Liste wird beim erfolgreichen OAuth-Callback gespeichert, nicht geraten — eBays Consent ist alles-oder-nichts, ein erfolgreicher Code-Exchange beweist, dass exakt die angeforderte Liste gewährt wurde (siehe Design-Doc `docs/superpowers/specs/2026-09-15-ebay-reconnect-scope-anzeige-design.md`).

**Tech Stack:** Hono (Server-Routen), Drizzle ORM + libsql (`app_settings`), React (Einstellungen-Seite), bun:test.

## Global Constraints

- Keine Änderung an `AUTO_PRICE_WRITE_ENABLED`, `ALIEXPRESS_TRACKING_SYNC_ENABLED` oder der Preislogik.
- Keine Kampagne wird angelegt, kein Angebot beworben, kein Gebot geändert.
- Keine DB-Migration — `app_settings` existiert bereits (`packages/web/src/db/schema.ts:80`).
- Draft-PR, Nutzer merged selbst (Grundgesetz Regel 13).
- typecheck (Frontend + Server) und volle Testsuite müssen grün sein; Ergebnis im Klartext in die PR-Beschreibung (Grundgesetz Regel 1, 3, 7).
- Alter Refresh Token darf nie gelöscht werden, bevor ein neuer erfolgreich gespeichert ist.
- Bei unbekanntem Scope (env-Token) in der UI explizit warnen: „Marketing-Zugriff vermutlich nicht vorhanden — bitte neu verbinden", nicht neutral „unbekannt" anzeigen.
- PR-Beschreibung muss eine konkrete Klick-Anleitung für nach dem Deploy enthalten (mobil-tauglich).

---

### Task 1: Backend — Scope-Hilfsfunktionen + DB-gestützter Refresh-Token in `ebay.ts`

**Files:**
- Modify: `packages/web/src/api/ebay.ts:16-27` (Konstanten), `:60-95` (`getAccessToken`), `:133-154` (`getOAuthUrl`), `:1984-2014` (`getMarketingScopeList`/`getMarketingAccessToken`)
- Test: `packages/web/src/api/ebay.test.ts` (neue `describe`-Blöcke anhängen)

**Interfaces:**
- Produziert: `getRequestedScopeList(): string[]` (voll-qualifizierte Scope-URLs, exportiert)
- Produziert: `hasScope(scopeString: string, scopeName: string): boolean` (exportiert, rein)
- Produziert: `getStoredEbayRefreshToken(): Promise<string | null>` (exportiert)
- Produziert: `saveEbayRefreshToken(refreshToken: string, grantedScopes: string): Promise<void>` (exportiert; wirft bei DB-Fehler, statt ihn zu schlucken — Aufrufer entscheidet, wie er das meldet)
- Konsumiert (Task 2): alle vier obigen Funktionen aus `./ebay`

- [ ] **Step 1: Failing test für `hasScope()` und `getRequestedScopeList()` schreiben**

An `packages/web/src/api/ebay.test.ts` anhängen (Import-Zeile 2 erweitern: `parseGetStoreResponseXml, buildStoreCategoryBlock, parseGetCampaignsResponse, hasScope, getRequestedScopeList`):

```typescript
describe('getRequestedScopeList', () => {
  test('enthält alle vier benötigten Scopes inkl. sell.marketing', () => {
    const scopes = getRequestedScopeList();
    expect(scopes.some(s => s.endsWith('/sell.inventory'))).toBe(true);
    expect(scopes.some(s => s.endsWith('/sell.account'))).toBe(true);
    expect(scopes.some(s => s.endsWith('/sell.fulfillment'))).toBe(true);
    expect(scopes.some(s => s.endsWith('/sell.marketing'))).toBe(true);
  });
});

describe('hasScope', () => {
  const granted = [
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    'https://api.ebay.com/oauth/api_scope/sell.marketing',
  ].join(' ');

  test('erkennt vorhandenen Scope', () => {
    expect(hasScope(granted, 'sell.marketing')).toBe(true);
  });

  test('erkennt fehlenden Scope (alter Token vor P-81)', () => {
    const oldGrant = [
      'https://api.ebay.com/oauth/api_scope/sell.inventory',
      'https://api.ebay.com/oauth/api_scope/sell.account',
      'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    ].join(' ');
    expect(hasScope(oldGrant, 'sell.marketing')).toBe(false);
  });

  test('leerer Scope-String → immer false', () => {
    expect(hasScope('', 'sell.marketing')).toBe(false);
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd packages/web && bun test ebay.test.ts`
Expected: FAIL — `hasScope` und `getRequestedScopeList` sind nicht exportiert (`is not a function` / Import-Fehler).

- [ ] **Step 3: `getRequestedScopeList()` und `hasScope()` implementieren, `getOAuthUrl()` darauf umstellen**

In `packages/web/src/api/ebay.ts` den bestehenden Kommentarblock + `getOAuthUrl()` (aktuell Zeilen 131-154) ersetzen durch:

```typescript
// ─── OAuth-Scopes für die Neu-Autorisierung ───────────────────────────────────
// Single Source of Truth: getOAuthUrl() UND der Callback (index.ts) verwenden dieselbe
// Liste. eBays Consent-Screen ist alles-oder-nichts — kommt der Callback mit einem Code
// zurück, wurde exakt diese Liste gewährt. Deshalb speichert der Callback nach
// erfolgreichem Exchange (siehe saveEbayRefreshToken unten) genau diese Liste als
// "gewährter Scope", statt ihn zu erraten.
export function getRequestedScopeList(): string[] {
  return [
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
    // P-81 Stufe 1 (2026-09-14): ergänzt, damit eine künftige Neu-Autorisierung durch den
    // Nutzer den Marketing-Scope gleich mitgewährt.
    'https://api.ebay.com/oauth/api_scope/sell.marketing',
  ];
}

// Prüft, ob scopeName (z.B. "sell.marketing") in einem space-separierten Scope-String
// (voll-qualifizierte URLs) enthalten ist.
export function hasScope(scopeString: string, scopeName: string): boolean {
  if (!scopeString) return false;
  return scopeString.split(/\s+/).some(s => s === scopeName || s.endsWith(`/${scopeName}`));
}

// ─── OAuth URL generieren (für User-Auth) ─────────────────────────────────────

export function getOAuthUrl(state: string): string {
  // EBAY_REDIRECT_URI muss die RuName sein (z.B. stele-e-transfe-steleetr-SETDSA-mnigw)
  // NICHT die echte Callback-URL
  const params = new URLSearchParams({
    client_id: EBAY_CLIENT_ID,
    redirect_uri: process.env.EBAY_REDIRECT_URI ?? '',
    response_type: 'code',
    scope: getRequestedScopeList().join(' '),
    state,
  });
  return `${AUTH_URL}/oauth2/authorize?${params.toString()}`;
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `cd packages/web && bun test ebay.test.ts`
Expected: PASS — alle neuen und bestehenden Tests in dieser Datei grün.

- [ ] **Step 5: DB-gestützten Refresh-Token einführen**

In `packages/web/src/api/ebay.ts` ganz oben `eq` importieren (Zeile 4 ergänzen):

```typescript
import { eq } from 'drizzle-orm';
import { computeMinSellPrice, isChinaShipping, DEFAULT_PRICING_CONFIG } from '../shared/pricing';
```

Die Modul-Konstante `EBAY_REFRESH_TOKEN` (aktuell Zeile 18) entfernen:

```typescript
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID ?? '';
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET ?? '';
const EBAY_SANDBOX = process.env.EBAY_SANDBOX === 'true';
```

Direkt nach `getOAuthUrl()` (vor dem `exchangeCodeForToken`-Kommentar) einfügen:

```typescript
// ─── eBay Refresh-Token: DB-gestützt (nach Neu-Autorisierung), Env als Fallback ───────────────
// Identisches Muster zu getAliAccessToken()/saveAliTokens() in aliexpress-api.ts — DB hat
// Vorrang, weil sie den zuletzt per OAuth erhaltenen Token trägt; die Env-Variable bleibt
// Fallback für den Fall, dass nie neu autorisiert wurde. Wird NIE gelöscht, nur überschrieben,
// und nur nach einem erfolgreichen Code-Exchange (siehe Aufrufer in index.ts) — ein
// fehlgeschlagener Exchange erreicht diese Funktion gar nicht, der alte Token bleibt aktiv.
export async function getStoredEbayRefreshToken(): Promise<string | null> {
  try {
    const { db } = await import('../db/index');
    const { appSettings } = await import('../db/schema');
    const row = await db.select().from(appSettings).where(eq(appSettings.key, 'ebay_refresh_token')).get();
    if (row?.value) return row.value;
  } catch { /* DB nicht verfügbar */ }
  if (process.env.EBAY_REFRESH_TOKEN) return process.env.EBAY_REFRESH_TOKEN;
  return null;
}

export async function saveEbayRefreshToken(refreshToken: string, grantedScopes: string): Promise<void> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const now = new Date().toISOString();
  await db.insert(appSettings).values({ key: 'ebay_refresh_token', value: refreshToken, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: refreshToken, updatedAt: now } });
  await db.insert(appSettings).values({ key: 'ebay_refresh_token_scope', value: grantedScopes, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: grantedScopes, updatedAt: now } });
}
```

In `getAccessToken()` (aktuell Zeile 60-95) die Zeile `refresh_token: EBAY_REFRESH_TOKEN,` ersetzen: die Funktionssignatur bleibt async, direkt nach der Cache-Prüfung `const refreshToken = await getStoredEbayRefreshToken() ?? '';` einfügen und im `body: new URLSearchParams({...})` `refresh_token: refreshToken,` verwenden.

In `getMarketingAccessToken()` (aktuell Zeile 1990-2014) dieselbe Änderung: vor dem `fetch`-Aufruf `const refreshToken = await getStoredEbayRefreshToken() ?? '';` einfügen, im Body `refresh_token: refreshToken,` statt `refresh_token: EBAY_REFRESH_TOKEN,`.

- [ ] **Step 6: typecheck:server laufen lassen**

Run: `cd packages/web && bun run typecheck:server`
Expected: Keine Fehler (insbesondere kein "EBAY_REFRESH_TOKEN is not defined" durch übersehene Restverwendung).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/api/ebay.ts packages/web/src/api/ebay.test.ts
git commit -m "$(cat <<'EOF'
feat: eBay Refresh-Token DB-gestuetzt speichern, Scope-Hilfsfunktionen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XZSN7aP4NMsSnsdRtVPGyk
EOF
)"
```

---

### Task 2: Backend — `/ebay/status` Route + Callback speichert Token

**Files:**
- Modify: `packages/web/src/api/index.ts:3` (Import), `:510-526` (`/ebay/auth`, `/ebay/callback`, neue `/ebay/status`)

**Interfaces:**
- Konsumiert: `getRequestedScopeList`, `hasScope`, `getStoredEbayRefreshToken`, `saveEbayRefreshToken` aus `./ebay` (Task 1)
- Produziert: `GET /api/ebay/status` → `{ connected: boolean, hasRefreshToken: boolean, scopes: string[] | null, hasMarketingScope: boolean, source: 'db'|'env'|'none', updatedAt: string | null }` (konsumiert von Task 3)

- [ ] **Step 1: Imports ergänzen**

In `packages/web/src/api/index.ts:3` die bestehende Import-Zeile erweitern (Klammerinhalt ergänzen, nicht ersetzen):

```typescript
import { listOnEbay, suggestCategory, getOAuthUrl, exchangeCodeForToken, getAllSellerListings, reviseListingContent, setAdRate, reviseCategory, getAllOrders, searchReturns, createShippingFulfillment, slugify, prettifyEbayError, extractMissingAspectName, getAspectAllowedValues, getAccessToken, getRecentlyReceivedFeedback, hasAlreadyLeftFeedback, getStoreCategories, getRequestedScopeList, hasScope, saveEbayRefreshToken } from './ebay';
```

(`eq` ist in dieser Datei bereits importiert, `getStoredEbayRefreshToken` wird hier nicht gebraucht — nur in `ebay.ts` selbst.)

- [ ] **Step 2: `/ebay/callback` anpassen — Token wird jetzt gespeichert**

`packages/web/src/api/index.ts:515-526` ersetzen durch:

```typescript
  .get('/ebay/callback', async (c) => {
    const code = c.req.query('code');
    if (!code) return c.json({ error: 'Kein Code' }, 400);
    try {
      const tokens = await exchangeCodeForToken(code);
      const grantedScopes = getRequestedScopeList().join(' ');
      await saveEbayRefreshToken(tokens.refresh_token, grantedScopes);
      return c.html(`
        <html><body style="font-family:sans-serif;padding:40px;background:#111;color:#fff">
          <h2 style="color:#4ADE80">✅ eBay erfolgreich neu verbunden!</h2>
          <p>Der neue Refresh Token wurde gespeichert und wird ab sofort verwendet.</p>
          <br>
          <a href="/einstellungen" style="color:#4ADE80;font-weight:bold">→ Zurück zu den Einstellungen</a>
        </body></html>
      `);
    } catch (e) {
      return c.json({ error: String(e) }, 500);
    }
  })
```

Wichtig: `saveEbayRefreshToken` wird ausschließlich nach erfolgreichem `exchangeCodeForToken` aufgerufen. Schlägt der Exchange fehl (Wurf in `exchangeCodeForToken` oder `saveEbayRefreshToken`), greift der `catch`-Block und es wird nichts gespeichert — der zuvor gültige Token (DB oder Env) bleibt unverändert nutzbar.

- [ ] **Step 3: `/ebay/status` Route ergänzen**

Direkt nach dem `/ebay/callback`-Block (vor dem P-82-Shop-Kategorien-Kommentar) einfügen:

```typescript
  // ─── eBay Verbindungsstatus (für Einstellungen-UI) ────────────────────────────
  .get('/ebay/status', async (c) => {
    let dbToken: string | null = null;
    let scopeValue: string | null = null;
    let updatedAt: string | null = null;
    try {
      const { db: database } = await import('../db/index');
      const { appSettings } = await import('../db/schema');
      const tokenRow = await database.select().from(appSettings).where(eq(appSettings.key, 'ebay_refresh_token')).get();
      const scopeRow = await database.select().from(appSettings).where(eq(appSettings.key, 'ebay_refresh_token_scope')).get();
      if (tokenRow?.value) { dbToken = tokenRow.value; updatedAt = tokenRow.updatedAt ?? null; }
      if (scopeRow?.value) scopeValue = scopeRow.value;
    } catch { /* DB nicht verfügbar */ }

    const source: 'db' | 'env' | 'none' = dbToken ? 'db' : process.env.EBAY_REFRESH_TOKEN ? 'env' : 'none';
    const hasRefreshToken = source !== 'none';
    const scopes = scopeValue ? scopeValue.split(/\s+/).map(s => s.split('/').pop() ?? s) : null;
    const hasMarketingScope = scopeValue ? hasScope(scopeValue, 'sell.marketing') : false;

    return c.json({ connected: hasRefreshToken, hasRefreshToken, scopes, hasMarketingScope, source, updatedAt }, 200);
  })
```

- [ ] **Step 4: typecheck:server laufen lassen**

Run: `cd packages/web && bun run typecheck:server`
Expected: Keine Fehler.

- [ ] **Step 5: End-to-end DB-Verifikation gegen lokale Test-DB (Grundgesetz Regel 1 — echter Lauf statt Annahme)**

`api.ebay.com` ist aus dieser Sandbox nicht erreichbar (Netzwerk-Restriktion) — der komplette OAuth-Redirect-Flow lässt sich hier nicht live durchspielen. Was sich sehr wohl echt prüfen lässt: dass `saveEbayRefreshToken`/`getStoredEbayRefreshToken` tatsächlich in `app_settings` schreiben und lesen, DB-Vorrang vor Env korrekt greift, und ein alter Token nie verschwindet.

Skript unter `<scratchpad>/verify-ebay-token-storage.ts` anlegen (NICHT committen):

```typescript
import { createClient } from '@libsql/client';

const dbPath = process.argv[2] ?? './ebay-token-test.db';
process.env.TURSO_DATABASE_URL = `file:${dbPath}`;

const client = createClient({ url: process.env.TURSO_DATABASE_URL });
await client.execute(`CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
)`);

const { saveEbayRefreshToken, getStoredEbayRefreshToken, hasScope } = await import('../packages/web/src/api/ebay.ts');

// 1) Ohne DB-Eintrag, ohne Env → null
console.log('1) Kein Token gesetzt:', await getStoredEbayRefreshToken());

// 2) Nur Env gesetzt → Env greift
process.env.EBAY_REFRESH_TOKEN = 'alter-env-token-XYZ';
console.log('2) Nur Env gesetzt:', await getStoredEbayRefreshToken());

// 3) Neuer Token per OAuth "gespeichert" → DB hat Vorrang vor Env
await saveEbayRefreshToken('neuer-db-token-ABC', 'https://api.ebay.com/oauth/api_scope/sell.marketing');
const afterSave = await getStoredEbayRefreshToken();
console.log('3) Nach saveEbayRefreshToken (DB sollte Vorrang haben):', afterSave);
console.log('   Alter Env-Wert unverändert?', process.env.EBAY_REFRESH_TOKEN === 'alter-env-token-XYZ');

// 4) hasScope auf den soeben gespeicherten Scope-String
console.log('4) hasScope sell.marketing:', hasScope('https://api.ebay.com/oauth/api_scope/sell.marketing', 'sell.marketing'));

if (afterSave !== 'neuer-db-token-ABC') {
  console.error('FEHLER: DB-Token hat nicht Vorrang vor Env!');
  process.exit(1);
}
console.log('✓ Alle Prüfungen bestanden.');
```

Run: `cd packages/web && bun ../../<scratchpad>/verify-ebay-token-storage.ts /tmp/ebay-token-test.db`
(Pfad zum Scratchpad-Verzeichnis wie in der Umgebungsangabe der Session; Skript danach löschen.)

Erwartete, tatsächlich abzulesende Ausgabe:
```
1) Kein Token gesetzt: null
2) Nur Env gesetzt: alter-env-token-XYZ
3) Nach saveEbayRefreshToken (DB sollte Vorrang haben): neuer-db-token-ABC
   Alter Env-Wert unverändert? true
4) hasScope sell.marketing: true
✓ Alle Prüfungen bestanden.
```

Die tatsächliche Konsolen-Ausgabe dieses Laufs (nicht die obige Erwartung) kommt wörtlich in die PR-Beschreibung.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/index.ts
git commit -m "$(cat <<'EOF'
feat: eBay-Callback speichert Refresh-Token, neue /ebay/status Route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XZSN7aP4NMsSnsdRtVPGyk
EOF
)"
```

---

### Task 3: Frontend — eBay-Karte in `einstellungen.tsx` dynamisch machen

**Files:**
- Modify: `packages/web/src/web/pages/einstellungen.tsx` (Interface-Block oben, `loadStatus`, neue Handler-Funktion, eBay-Karte JSX aktuell Zeilen 207-218)

**Interfaces:**
- Konsumiert: `GET /api/ebay/status` (Task 2) → `{ connected, hasRefreshToken, scopes: string[] | null, hasMarketingScope, source, updatedAt }`
- Konsumiert: `GET /api/ebay/auth` (bestehende Route, unverändert) als Redirect-Ziel

- [ ] **Step 1: State + Typ ergänzen**

Nach dem bestehenden `AliStatus`-Interface (Zeile 3-9) ergänzen:

```typescript
interface EbayStatus {
  connected: boolean;
  hasRefreshToken: boolean;
  scopes: string[] | null;
  hasMarketingScope: boolean;
  source: "db" | "env" | "none";
  updatedAt: string | null;
}
```

Im Komponenten-Body nach `const [driveConnected, setDriveConnected] = useState<boolean | null>(null);` (Zeile 28) ergänzen:

```typescript
  const [ebayStatus, setEbayStatus] = useState<EbayStatus | null>(null);
```

- [ ] **Step 2: `loadStatus()` um eBay-Fetch erweitern**

In `loadStatus` (Zeile 30-41) nach dem bestehenden `fetch("/api/drive/status", ...)`-Block ergänzen:

```typescript
    fetch("/api/ebay/status", { credentials: "include" })
      .then(r => r.json())
      .then(d => setEbayStatus(d as EbayStatus))
      .catch(() => setEbayStatus(null));
```

- [ ] **Step 3: Connect-Handler ergänzen**

Nach `handleAliConnect` (Zeile 45-47) ergänzen:

```typescript
  const handleEbayConnect = () => {
    window.location.href = "/api/ebay/auth";
  };
```

- [ ] **Step 4: eBay-Karte durch dynamische Version ersetzen**

Den kompletten Block `packages/web/src/web/pages/einstellungen.tsx:207-218` (die statische eBay-Karte) ersetzen durch:

```typescript
      {/* eBay Verbindung */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 22 }}>🛒</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#1E293B" }}>eBay API</span>
        </div>
        <p style={{ fontSize: 13, color: "#64748B", margin: "0 0 12px" }}>
          Für Listings, Preisupdate und Bestellungen. Client:{" "}
          <code style={{ background: "#F1F5F9", padding: "1px 6px", borderRadius: 4 }}>steleetr-SETDSAPP-PRD</code>
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <span style={badge(ebayStatus?.connected ?? false)}>
            {ebayStatus?.connected ? "✅ Verbunden" : "❌ Nicht verbunden"}
          </span>
        </div>

        {ebayStatus?.scopes ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {ebayStatus.scopes.map(scope => {
              const isMarketing = scope === "sell.marketing";
              const ok = !isMarketing || ebayStatus.hasMarketingScope;
              return (
                <span key={scope} style={{
                  fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 12,
                  background: ok ? "#DCFCE7" : "#FEF2F2",
                  color: ok ? "#166534" : "#991B1B",
                }}>
                  {scope}{isMarketing ? (ok ? " ✓" : " ✗") : ""}
                </span>
              );
            })}
          </div>
        ) : ebayStatus?.hasRefreshToken ? (
          <div style={{
            marginBottom: 10, background: "#FFF7ED", border: "1px solid #FED7AA",
            borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400E",
          }}>
            ⚠️ <strong>Marketing-Zugriff vermutlich nicht vorhanden — bitte neu verbinden.</strong> Für diesen
            Token (aus einer Umgebungsvariable, vor dieser Funktion gesetzt) sind die Scopes unbekannt.
          </div>
        ) : null}

        <button
          onClick={handleEbayConnect}
          style={{
            background: ebayStatus?.connected ? "#F1F5F9" : "#D97706",
            color: ebayStatus?.connected ? "#64748B" : "#fff",
            border: "none", borderRadius: 8, padding: "8px 18px",
            fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          {ebayStatus?.connected ? "Neu verbinden" : "Mit eBay verbinden"}
        </button>
      </div>
```

- [ ] **Step 5: typecheck (Frontend) laufen lassen**

Run: `cd packages/web && bun run typecheck`
Expected: Keine Fehler.

- [ ] **Step 6: Dev-Server starten und Einstellungen-Seite visuell prüfen**

Run: `cd packages/web && bun run dev` (Hintergrund), dann `/einstellungen` im Browser öffnen (per `run`-Skill oder Playwright, je nachdem was in dieser Session verfügbar ist).
Erwartung, die tatsächlich beobachtet werden muss: eBay-Karte zeigt Scope-Chips (falls DB-Token vorhanden) ODER die orangene Warnung (env-Token ohne bekannten Scope) ODER schlicht "Nicht verbunden" (kein Token) — je nachdem, was der lokale/aktuelle Zustand tatsächlich ist. Button "Neu verbinden" bzw. "Mit eBay verbinden" ist sichtbar und klickbar (Klick selbst nicht ausführen, da er auf `api.ebay.com` umleitet, das aus der Sandbox nicht erreichbar ist — das reale Klicken erfolgt durch den Nutzer nach dem Deploy).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/web/pages/einstellungen.tsx
git commit -m "$(cat <<'EOF'
feat: eBay-Karte in Einstellungen zeigt Scopes + Neu-verbinden-Knopf

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XZSN7aP4NMsSnsdRtVPGyk
EOF
)"
```

---

### Task 4: Verifikation, WORKLOG, Draft-PR

**Files:**
- Modify: `docs/WORKLOG.md` (neuer Eintrag, an bestehende Struktur anhängen — vorher lesen, welches Format die letzten Einträge haben)

- [ ] **Step 1: Volle Testsuite laufen lassen**

Run: `cd packages/web && bun test`
Expected: Alle Tests grün. Tatsächliche Zahl (z.B. "162/162") wörtlich notieren — nicht schätzen (Grundgesetz Regel 3).

- [ ] **Step 2: Beide typecheck-Läufe laufen lassen**

Run: `cd packages/web && bun run typecheck && bun run typecheck:server`
Expected: Beide ohne Fehler. Tatsächliche Ausgabe (oder "keine Ausgabe = Erfolg bei tsc --noEmit") notieren.

- [ ] **Step 3: Strikte Grenzen per grep/diff belegen (Grundgesetz Regel 7)**

Run:
```bash
git diff origin/main --stat
git diff origin/main -- packages/web/src/api/price-monitor.ts packages/web/src/shared/pricing.ts
grep -rn "AUTO_PRICE_WRITE_ENABLED\|ALIEXPRESS_TRACKING_SYNC_ENABLED" packages/web/src/api/index.ts | head
```
Expected: Der `git diff` gegen `price-monitor.ts`/`pricing.ts` ist leer (keine Zeilen). Das tatsächliche `--stat`-Ergebnis (Liste der geänderten Dateien) kommt in die PR.

- [ ] **Step 4: WORKLOG-Eintrag ergänzen**

`docs/WORKLOG.md` öffnen, das Format der letzten 2-3 Einträge lesen, und einen neuen Eintrag im selben Format anhängen, der zusammenfasst: Problem (eBay-Neu-verbinden-Knopf fehlte, Callback speicherte nie), Fund (Callback loggte Token nur, keine DB-Persistenz), Lösung (AliExpress-Muster übernommen), Verifikation (Testzahlen aus Step 1/2, Skript-Ausgabe aus Task 2 Step 5).

- [ ] **Step 5: WORKLOG committen**

```bash
git add docs/WORKLOG.md
git commit -m "$(cat <<'EOF'
docs: WORKLOG-Eintrag eBay Neu-Verbinden + Scope-Anzeige

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XZSN7aP4NMsSnsdRtVPGyk
EOF
)"
```

- [ ] **Step 6: Branch pushen**

Run: `git push -u origin feat/ebay-reconnect-scope-anzeige`

- [ ] **Step 7: Draft-PR erstellen**

Mit `gh pr create --draft`, Base-Branch `main`. PR-Beschreibung MUSS enthalten:

1. Kurze Problem-/Fund-Zusammenfassung (Callback speicherte nie, nur Env-Var wirkte).
2. **Konkrete Klick-Anleitung nach dem Deploy** (mobil-tauglich, keine Suche nötig), z.B.:
   - "1. App öffnen → unten '⚙️ Einst.' antippen."
   - "2. Bei der eBay-Karte auf 'Neu verbinden' tippen."
   - "3. Auf der eBay-Seite: prüfen, dass in der Berechtigungsliste u.a. 'Marketing' bzw. Kampagnen-/Anzeigen-bezogene Rechte auftauchen (zusätzlich zu Inventar/Konto/Versand) — bestätigen."
   - "4. Zurück in der App, Einstellungen erneut öffnen (ggf. neu laden): die eBay-Karte sollte jetzt grüne Scope-Chips zeigen, darunter 'sell.marketing ✓'."
3. Typecheck- und Testsuite-Ergebnis im Klartext (aus Step 1/2).
4. Ausgabe des DB-Verifikationsskripts aus Task 2 Step 5, wörtlich.
5. Ausdrückliche Bestätigung der strikten Grenzen mit Beleg (`git diff --stat`, leerer Diff auf `price-monitor.ts`/`pricing.ts`).
6. Hinweis: Draft-PR, Nutzer merged selbst; danach sollte er den Klick-Flow einmal live durchspielen, da `api.ebay.com` aus der Entwicklungs-/Testumgebung nicht erreichbar war.

## Self-Review-Ergebnis

- **Spec-Abdeckung:** Aufgabe 1 (Knopf) → Task 3. Aufgabe 2 (Scope-Anzeige inkl. sell.marketing) → Task 1 (`hasScope`) + Task 2 (`/ebay/status`) + Task 3 (UI). Aufgabe 3 (Rückkanal prüfen/ergänzen) → Task 1 (`saveEbayRefreshToken`/`getStoredEbayRefreshToken`) + Task 2 (Callback). Aufgabe 4 (alter Token nicht vor neuem gelöscht) → strukturell durch Task 1/2 (nie gelöscht, nur überschrieben, nur nach Erfolg) + explizit in Task 2 Step 5 verifiziert. Aufgabe 5 (Klick-Anleitung) → Task 4 Step 7. Aufgabe 6 (typecheck+Tests in PR) → Task 4 Step 1-3, 7. Nutzer-Ergänzung (explizite Warnung statt "unbekannt") → Task 3 Step 4.
- **Platzhalter-Scan:** keine TBD/TODO; alle Code-Blöcke vollständig.
- **Typkonsistenz:** `EbayStatus`-Feldnamen (`connected`, `hasRefreshToken`, `scopes`, `hasMarketingScope`, `source`, `updatedAt`) identisch zwischen Backend-Route (Task 2) und Frontend-Interface (Task 3). `getRequestedScopeList`/`hasScope`/`getStoredEbayRefreshToken`/`saveEbayRefreshToken` Signaturen identisch zwischen Definition (Task 1) und Verwendung (Task 2).
