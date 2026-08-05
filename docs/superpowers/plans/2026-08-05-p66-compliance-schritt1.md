# P-66 Schritt 1: Compliance-Vorbereitung für Lieferanten Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Regulierte-Produktgruppen-Konstanten anlegen, `trusted_suppliers` um drei Compliance-Felder erweitern (Schema + Migration + API + UI), und die Backup-Logik vollständig auf `trusted_suppliers` ausweiten — noch OHNE Import-Gate/Blockierung.

**Architecture:** Bun-Monorepo, Hono-Backend + React/Vite-Frontend in `packages/web`. DB ist Turso (libSQL) via Drizzle ORM. Migrationen laufen NICHT über `drizzle-kit generate`/`migrate` (kein `drizzle/`-Ordner vorhanden), sondern über eine handgeschriebene, idempotente Statement-Liste in `src/db/migrate.ts`, die bei jedem Serverstart automatisch ausgeführt wird (`server.ts:44 runMigrations()`).

**Tech Stack:** Bun, Hono, Drizzle ORM (sqlite-core), Turso/libSQL, React 19, TypeScript (strict).

## Global Constraints

- Enum-Werte exakt wie vorgegeben, ohne Umlaute: `ungeprueft` (Default), `geprueft`, `abgelehnt`.
- Migration muss idempotent sein (`ALTER TABLE ... ADD COLUMN`, Duplicate-Fehler werden in `runMigrations()` bereits automatisch abgefangen — kein zusätzlicher try/catch nötig).
- Kein Import-Gate/Blockierung in diesem Schritt — die Konstanten-Datei enthält nur Daten, keine Matching-Logik.
- Bestehender Stil beibehalten: Inline-Styles (kein CSS-Framework-Klassenzwang), deutsche Kommentare, deutsche UI-Texte.
- `packages/web` hat kein eigenes `typecheck`-Script — Verifikation läuft über `bunx tsc --noEmit -p tsconfig.app.json` (Frontend) und `bun run typecheck:server` (Backend, nutzt `tsconfig.server.json`).

---

## Betroffene Dateien

| Datei | Art | Zweck |
|---|---|---|
| `packages/web/src/shared/regulated-categories.ts` | NEU | Keyword-/Kategorie-Muster für regulierte Produktgruppen (DE+EN) |
| `packages/web/src/db/schema.ts` | ÄNDERN | 3 neue Spalten in `trustedSuppliers` |
| `packages/web/src/db/migrate.ts` | ÄNDERN | 3 neue `ALTER TABLE`-Statements |
| `packages/web/src/api/index.ts` | ÄNDERN | Neue `PATCH /trusted-suppliers/:id` Route |
| `packages/web/src/web/pages/lieferanten.tsx` | ÄNDERN | Badge, Filter, Bearbeiten-UI in der Lieferantenliste |
| `packages/web/src/api/backup.ts` | ÄNDERN | `trusted_suppliers` vollständig ins Backup-JSON aufnehmen |

## Geplanter Migrationsschritt (Kern des Auftrags)

`trusted_suppliers` bekommt 3 neue, nullable/defaulted Spalten — rein additiv, keine bestehenden Daten betroffen:

```sql
ALTER TABLE trusted_suppliers ADD COLUMN compliance_status TEXT DEFAULT 'ungeprueft';
ALTER TABLE trusted_suppliers ADD COLUMN compliance_docs_verified_at TEXT;
ALTER TABLE trusted_suppliers ADD COLUMN compliance_notes TEXT;
```

Diese Statements werden an `migrate.ts`s bestehende `migrations`-Liste angehängt und laufen automatisch beim nächsten Serverstart (lokal + Render) — zusätzlich verifiziere ich sie manuell gegen die Produktions-DB via `bun --env-file=../../.env run src/db/migrate.ts` (Turso-Credentials liegen in `.env`), bevor ich den Rest umsetze.

---

### Task 1: Konstanten-Datei für regulierte Produktgruppen

**Files:**
- Create: `packages/web/src/shared/regulated-categories.ts`

**Interfaces:**
- Produziert: `REGULATED_CATEGORIES` (Array von `{ id, labelDe, labelEn, keywordsDe: string[], keywordsEn: string[] }`), Typ `RegulatedCategory`. Wird in einem späteren Schritt (Import-Gate) konsumiert — hier nur Daten, keine Matching-Funktion.

- [ ] **Step 1: Datei anlegen**

```ts
// ─── Regulierte Produktgruppen — Keyword-/Kategorie-Muster (P-66) ─────────────
// Reine Datenbasis für die spätere Compliance-Prüfung beim Import (Schritt 2).
// Bewusst KEINE Matching-Logik hier — nur die Muster selbst.

export interface RegulatedCategory {
  id: string;
  labelDe: string;
  labelEn: string;
  keywordsDe: string[];
  keywordsEn: string[];
}

export const REGULATED_CATEGORIES: RegulatedCategory[] = [
  {
    id: 'medizinprodukt',
    labelDe: 'Medizinprodukt',
    labelEn: 'Medical Device',
    keywordsDe: [
      'medizinprodukt', 'medizinisch', 'diagnostik', 'diagnose',
      'blutdruckmessgerät', 'fieberthermometer', 'pulsoximeter',
      'hörgerät', 'orthese', 'prothese', 'inhalator', 'inhalationsgerät',
      'bandage', 'stützstrumpf', 'kompressionsstrumpf', 'ekg', 'blutzuckermessgerät',
    ],
    keywordsEn: [
      'medical device', 'diagnostic', 'diagnosis',
      'blood pressure monitor', 'thermometer', 'pulse oximeter',
      'hearing aid', 'orthosis', 'orthotic', 'prosthesis', 'inhaler', 'nebulizer',
      'bandage', 'compression stocking', 'ecg', 'glucose meter',
    ],
  },
  {
    id: 'psa',
    labelDe: 'Persönliche Schutzausrüstung (PSA)',
    labelEn: 'Personal Protective Equipment (PPE)',
    keywordsDe: [
      'schutzausrüstung', 'atemschutzmaske', 'ffp2', 'ffp3', 'schutzbrille',
      'schutzhandschuhe', 'gehörschutz', 'schutzhelm', 'sicherheitsschuhe',
      'auffanggurt', 'absturzsicherung', 'schutzanzug', 'gasmaske',
    ],
    keywordsEn: [
      'protective equipment', 'respirator mask', 'ffp2', 'ffp3', 'safety glasses',
      'protective gloves', 'ear protection', 'safety helmet', 'safety shoes',
      'safety harness', 'fall protection', 'protective suit', 'gas mask',
    ],
  },
  {
    id: 'ce_elektronik',
    labelDe: 'CE-pflichtige Elektronik',
    labelEn: 'CE-regulated Electronics',
    keywordsDe: [
      'netzteil', 'ladegerät', 'akku', 'lithium-akku', 'powerbank',
      'funkgerät', 'sender', 'empfänger', 'wlan-modul', 'bluetooth-modul',
      'steckdose', 'verlängerungskabel', 'trafo', 'spannungswandler', 'led-treiber',
    ],
    keywordsEn: [
      'power supply', 'charger', 'battery', 'lithium battery', 'power bank',
      'radio transmitter', 'transmitter', 'receiver', 'wifi module', 'bluetooth module',
      'power strip', 'extension cable', 'transformer', 'voltage converter', 'led driver',
    ],
  },
  {
    id: 'kosmetik_wirkversprechen',
    labelDe: 'Kosmetik mit Wirkversprechen',
    labelEn: 'Cosmetics with Efficacy Claims',
    keywordsDe: [
      'anti-aging', 'faltenreduktion', 'hautaufhellend', 'aufhellungscreme',
      'akne-behandlung', 'haarwuchsmittel', 'whitening', 'peeling-säure',
      'retinol', 'hyaluronsäure-serum', 'lifting-creme', 'straffend',
    ],
    keywordsEn: [
      'anti-aging', 'wrinkle reduction', 'skin whitening', 'brightening cream',
      'acne treatment', 'hair growth', 'whitening', 'peeling acid',
      'retinol', 'hyaluronic acid serum', 'lifting cream', 'firming',
    ],
  },
  {
    id: 'spielzeug',
    labelDe: 'Spielzeug',
    labelEn: 'Toys',
    keywordsDe: [
      'spielzeug', 'kinderspielzeug', 'babyspielzeug', 'puppe', 'plüschtier',
      'baukasten', 'kuscheltier', 'kinderfahrzeug', 'rutschauto', 'spielzeugauto',
      'lernspielzeug', 'holzspielzeug', 'kinderschmuck',
    ],
    keywordsEn: [
      'toy', 'kids toy', 'baby toy', 'doll', 'plush toy',
      'building blocks', 'stuffed animal', 'ride-on toy', 'toy car',
      'educational toy', 'wooden toy', 'children jewelry',
    ],
  },
  {
    id: 'nahrungsergaenzung',
    labelDe: 'Nahrungsergänzungsmittel',
    labelEn: 'Dietary Supplements',
    keywordsDe: [
      'nahrungsergänzung', 'nahrungsergänzungsmittel', 'vitamintablette',
      'proteinpulver', 'kapseln', 'diätprodukt', 'abnehmkapseln', 'kollagenpulver',
      'mineralstoffe', 'omega-3-kapseln', 'probiotika',
    ],
    keywordsEn: [
      'dietary supplement', 'food supplement', 'vitamin tablet',
      'protein powder', 'capsules', 'diet product', 'weight loss capsules',
      'collagen powder', 'minerals', 'omega-3 capsules', 'probiotics',
    ],
  },
];
```

- [ ] **Step 2: Frontend-Typecheck laufen lassen zur Syntax-Verifikation**

Run: `cd packages/web && bunx tsc --noEmit -p tsconfig.app.json`
Expected: Keine neuen Fehler durch die neue Datei (sie wird noch nirgends importiert, daher rein syntaktische Prüfung über den Compiler-Durchlauf).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/shared/regulated-categories.ts
git commit -m "feat: Konstanten-Datei für regulierte Produktgruppen anlegen (P-66 Schritt 1)"
```

---

### Task 2: Schema + Migration — Compliance-Felder in trusted_suppliers

**Files:**
- Modify: `packages/web/src/db/schema.ts:73-84`
- Modify: `packages/web/src/db/migrate.ts:89` (vor der schließenden `];`)

**Interfaces:**
- Produziert: `TrustedSupplier.complianceStatus: 'ungeprueft' | 'geprueft' | 'abgelehnt'`, `TrustedSupplier.complianceDocsVerifiedAt: string | null`, `TrustedSupplier.complianceNotes: string | null` — werden von Task 3 (API) und Task 4 (UI) konsumiert.

- [ ] **Step 1: Schema erweitern**

In `schema.ts`, im `trustedSuppliers`-Block (Zeile 73-84), nach `category` einfügen:

```ts
export const trustedSuppliers = sqliteTable('trusted_suppliers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shopName: text('shop_name').notNull(),
  shopUrl: text('shop_url').notNull(),
  aliStoreId: text('ali_store_id'),
  euConfirmed: integer('eu_confirmed', { mode: 'boolean' }).default(true),
  category: text('category'),
  // Compliance-Prüfung (P-66) — noch ohne Import-Gate, nur Erfassung
  complianceStatus: text('compliance_status', { enum: ['ungeprueft', 'geprueft', 'abgelehnt'] })
    .notNull()
    .default('ungeprueft'),
  complianceDocsVerifiedAt: text('compliance_docs_verified_at'), // Datum, an dem Nachweise geprüft wurden
  complianceNotes: text('compliance_notes'), // Freitext-Notiz zur Prüfung
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});
```

- [ ] **Step 2: Migration anhängen**

In `migrate.ts`, in der `migrations`-Liste, nach der Zeile `ALTER TABLE trusted_suppliers ADD COLUMN category TEXT` (Zeile 89) einfügen:

```ts
  // Compliance-Prüfung für Lieferanten (P-66 Schritt 1) — noch kein Import-Gate
  `ALTER TABLE trusted_suppliers ADD COLUMN compliance_status TEXT DEFAULT 'ungeprueft'`,
  `ALTER TABLE trusted_suppliers ADD COLUMN compliance_docs_verified_at TEXT`,
  `ALTER TABLE trusted_suppliers ADD COLUMN compliance_notes TEXT`,
```

- [ ] **Step 3: Migration gegen Produktions-DB ausführen**

Run: `cd packages/web && bun --env-file=../../.env run src/db/migrate.ts`
Expected: Alle drei neuen Statements laufen mit `[migrate] ✓ ...` durch (bereits vorhandene Statements werden übersprungen mit `→ Skip`), kein `✗ FAILED`.

- [ ] **Step 4: Backend-Typecheck**

Run: `cd packages/web && bun run typecheck:server`
Expected: Keine Fehler.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/db/schema.ts packages/web/src/db/migrate.ts
git commit -m "feat: Compliance-Felder in trusted_suppliers ergänzen (P-66 Schritt 1)"
```

---

### Task 3: Backend-API — PATCH-Route für Compliance-Felder

**Files:**
- Modify: `packages/web/src/api/index.ts:2673` (zwischen bestehender `POST /trusted-suppliers` und `DELETE /trusted-suppliers/:id`)

**Interfaces:**
- Konsumiert: `schema.trustedSuppliers` (aus Task 2), `eq` (bereits importiert aus `drizzle-orm`).
- Produziert: `PATCH /api/trusted-suppliers/:id` — Body `{ complianceStatus?: 'ungeprueft'|'geprueft'|'abgelehnt'; complianceDocsVerifiedAt?: string | null; complianceNotes?: string | null }`, Response: aktualisierte Row als JSON.

- [ ] **Step 1: Route einfügen**

Direkt nach dem bestehenden `POST /trusted-suppliers`-Block (vor `app.delete('/trusted-suppliers/:id', ...)`) einfügen:

```ts
app.patch('/trusted-suppliers/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Ungültige ID' }, 400);
  try {
    const body = await c.req.json() as {
      complianceStatus?: 'ungeprueft' | 'geprueft' | 'abgelehnt';
      complianceDocsVerifiedAt?: string | null;
      complianceNotes?: string | null;
    };
    const ALLOWED_STATUS = ['ungeprueft', 'geprueft', 'abgelehnt'];
    if (body.complianceStatus !== undefined && !ALLOWED_STATUS.includes(body.complianceStatus)) {
      return c.json({ error: 'Ungültiger compliance_status' }, 400);
    }
    const { db, schema } = await import('../db/index').then(async m => {
      const s = await import('../db/schema');
      return { db: m.db, schema: s };
    });
    const updates: Record<string, unknown> = {};
    if (body.complianceStatus !== undefined) updates.complianceStatus = body.complianceStatus;
    if (body.complianceDocsVerifiedAt !== undefined) updates.complianceDocsVerifiedAt = body.complianceDocsVerifiedAt;
    if (body.complianceNotes !== undefined) updates.complianceNotes = body.complianceNotes;
    if (Object.keys(updates).length === 0) return c.json({ error: 'Keine Felder zum Aktualisieren' }, 400);
    const result = await db.update(schema.trustedSuppliers).set(updates).where(eq(schema.trustedSuppliers.id, id)).returning();
    if (result.length === 0) return c.json({ error: 'Lieferant nicht gefunden' }, 404);
    return c.json(result[0]);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});
```

- [ ] **Step 2: Backend-Typecheck**

Run: `cd packages/web && bun run typecheck:server`
Expected: Keine Fehler.

- [ ] **Step 3: Manueller Route-Test (lokaler Dev-Server)**

Run: `cd packages/web && bun run dev` (in separatem Terminal), dann:
`curl -X PATCH http://localhost:5173/api/trusted-suppliers/<vorhandene-id> -H "Content-Type: application/json" -d "{\"complianceStatus\":\"geprueft\",\"complianceNotes\":\"Testnotiz\"}"`
Expected: JSON-Response mit aktualisierter Row (`complianceStatus: "geprueft"`, `complianceNotes: "Testnotiz"`).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api/index.ts
git commit -m "feat: PATCH-Route für Lieferanten-Compliance-Felder (P-66 Schritt 1)"
```

---

### Task 4: Frontend — Badge, Filter, Bearbeiten in der Lieferantenliste

**Files:**
- Modify: `packages/web/src/web/pages/lieferanten.tsx:186` (State-Typ), `:203-282` (State + Handler + Filter-Logik), `:579-642` (Render der Lieferantenliste)

**Interfaces:**
- Konsumiert: `PATCH /api/trusted-suppliers/:id` (aus Task 3), `TrustedSupplier`-Feldnamen (`complianceStatus`, `complianceDocsVerifiedAt`, `complianceNotes`) aus Task 2/3.

- [ ] **Step 1: State-Typ erweitern**

Zeile 186 ersetzen:

```ts
  const [trustedSuppliers, setTrustedSuppliers] = useState<Array<{
    id: number; shopName: string; shopUrl: string; aliStoreId: string | null; euConfirmed: boolean; category: string | null;
    complianceStatus: 'ungeprueft' | 'geprueft' | 'abgelehnt'; complianceDocsVerifiedAt: string | null; complianceNotes: string | null;
  }>>([]);
```

- [ ] **Step 2: Bearbeiten- und Filter-State + Handler hinzufügen**

Nach Zeile 194 (`const shopSearch = ...` Block, direkt nach den bestehenden Dropdown-States, vor `useEffect` für Meine Shops laden) einfügen:

```ts
  const [complianceFilter, setComplianceFilter] = useState<'all' | 'ungeprueft' | 'geprueft' | 'abgelehnt'>('all');
  const [editingSupplierId, setEditingSupplierId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ complianceStatus: 'ungeprueft' | 'geprueft' | 'abgelehnt'; complianceDocsVerifiedAt: string; complianceNotes: string }>({
    complianceStatus: 'ungeprueft', complianceDocsVerifiedAt: '', complianceNotes: '',
  });
  const [editSaving, setEditSaving] = useState(false);
```

Nach `handleDeleteShop` (Zeile 246) einfügen:

```ts
  const handleStartEditSupplier = (s: typeof trustedSuppliers[number]) => {
    setEditingSupplierId(s.id);
    setEditDraft({
      complianceStatus: s.complianceStatus,
      complianceDocsVerifiedAt: s.complianceDocsVerifiedAt ?? '',
      complianceNotes: s.complianceNotes ?? '',
    });
  };

  const handleCancelEditSupplier = () => setEditingSupplierId(null);

  const handleSaveSupplierCompliance = async (id: number) => {
    setEditSaving(true);
    try {
      const res = await fetch(`/api/trusted-suppliers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          complianceStatus: editDraft.complianceStatus,
          complianceDocsVerifiedAt: editDraft.complianceDocsVerifiedAt || null,
          complianceNotes: editDraft.complianceNotes || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTrustedSuppliers(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
        setEditingSupplierId(null);
      }
    } finally {
      setEditSaving(false);
    }
  };

  const COMPLIANCE_LABELS: Record<string, string> = { ungeprueft: 'Ungeprüft', geprueft: 'Geprüft', abgelehnt: 'Abgelehnt' };
  const COMPLIANCE_COLORS: Record<string, { bg: string; fg: string }> = {
    ungeprueft: { bg: '#FEF3C7', fg: '#92400E' },
    geprueft: { bg: '#DCFCE7', fg: '#166534' },
    abgelehnt: { bg: '#FEE2E2', fg: '#991B1B' },
  };
```

- [ ] **Step 3: Filter in die bestehende Filterlogik einbauen**

Zeile 269-274 (`const filteredShops = ...`) ersetzen:

```ts
  const filteredShops = trustedSuppliers
    .filter(s => complianceFilter === 'all' || s.complianceStatus === complianceFilter)
    .filter(s =>
      !shopSearchLower ||
      s.shopName.toLowerCase().includes(shopSearchLower) ||
      (s.category ?? "").toLowerCase().includes(shopSearchLower)
    );
```

- [ ] **Step 4: Badge, Filter-Leiste und Bearbeiten-UI im Render einbauen**

Im Dropdown-Content (Zeile 598-606, direkt vor dem Such-Input) Filter-Leiste einfügen:

```tsx
                <div style={{ display: "flex", gap: 4, padding: "8px 10px 0", flexWrap: "wrap" }}>
                  {(["all", "ungeprueft", "geprueft", "abgelehnt"] as const).map(f => (
                    <button
                      key={f}
                      onClick={(e) => { e.stopPropagation(); setComplianceFilter(f); }}
                      style={{
                        padding: "3px 8px", borderRadius: 999, border: "1px solid " + (complianceFilter === f ? "#FF6B00" : "#E2E8F0"),
                        background: complianceFilter === f ? "#FF6B00" : "#fff",
                        color: complianceFilter === f ? "#fff" : "#64748B",
                        fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      {f === "all" ? "Alle" : COMPLIANCE_LABELS[f]}
                    </button>
                  ))}
                </div>
```

Zeile 616-635 (die `groupedShops[groupName].map(s => ...)`-Zeile) ersetzen — Badge zwischen Shop-Namen und Lösch-Button, plus Bearbeiten-Button und ausklappbarer Editor:

```tsx
                      {groupedShops[groupName].map(s => (
                        <div key={s.id}>
                          <div
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "8px 14px", cursor: "pointer",
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#F8FAFC")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          >
                            <span onClick={() => handleSelectShop(s.shopUrl)} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, cursor: "pointer" }}>
                              {s.euConfirmed && <span style={{ color: "#16A34A", fontSize: 12 }}>🇪🇺</span>}
                              <span style={{ fontSize: 13, fontWeight: 600, color: "#0F172A" }}>{s.shopName}</span>
                              <span style={{
                                fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
                                background: COMPLIANCE_COLORS[s.complianceStatus].bg, color: COMPLIANCE_COLORS[s.complianceStatus].fg,
                              }}>
                                {COMPLIANCE_LABELS[s.complianceStatus]}
                              </span>
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleStartEditSupplier(s); }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: "0 2px", fontSize: 13, lineHeight: 1 }}
                              title="Compliance bearbeiten"
                            >✎</button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteShop(s.id); }}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#94A3B8", padding: "0 2px", fontSize: 14, lineHeight: 1 }}
                              title="Entfernen"
                            >×</button>
                          </div>
                          {editingSupplierId === s.id && (
                            <div onClick={(e) => e.stopPropagation()} style={{ padding: "8px 14px 12px", background: "#F8FAFC", display: "flex", flexDirection: "column", gap: 6 }}>
                              <select
                                value={editDraft.complianceStatus}
                                onChange={(e) => setEditDraft(d => ({ ...d, complianceStatus: e.target.value as typeof d.complianceStatus }))}
                                style={{ padding: "6px 8px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" }}
                              >
                                {(["ungeprueft", "geprueft", "abgelehnt"] as const).map(v => <option key={v} value={v}>{COMPLIANCE_LABELS[v]}</option>)}
                              </select>
                              <input
                                type="date"
                                value={editDraft.complianceDocsVerifiedAt}
                                onChange={(e) => setEditDraft(d => ({ ...d, complianceDocsVerifiedAt: e.target.value }))}
                                style={{ padding: "6px 8px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit" }}
                              />
                              <textarea
                                value={editDraft.complianceNotes}
                                onChange={(e) => setEditDraft(d => ({ ...d, complianceNotes: e.target.value }))}
                                placeholder="Notiz zur Prüfung…"
                                rows={2}
                                style={{ padding: "6px 8px", fontSize: 12, border: "1.5px solid #E2E8F0", borderRadius: 8, fontFamily: "inherit", resize: "vertical" }}
                              />
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  onClick={() => handleSaveSupplierCompliance(s.id)}
                                  disabled={editSaving}
                                  style={{ flex: 1, padding: "6px 0", borderRadius: 8, border: "none", background: "#FF6B00", color: "#fff", fontWeight: 700, fontSize: 12, cursor: editSaving ? "default" : "pointer", fontFamily: "inherit" }}
                                >{editSaving ? "Speichert…" : "Speichern"}</button>
                                <button
                                  onClick={handleCancelEditSupplier}
                                  style={{ flex: 1, padding: "6px 0", borderRadius: 8, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
                                >Abbrechen</button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
```

- [ ] **Step 5: Frontend-Typecheck**

Run: `cd packages/web && bunx tsc --noEmit -p tsconfig.app.json`
Expected: Keine Fehler.

- [ ] **Step 6: Manueller Browser-Test**

Run: `cd packages/web && bun run dev`, im Browser Lieferanten-Tab öffnen, "Meine EU-Shops" aufklappen: Filter-Buttons prüfen, ✎ bei einem Shop klicken, Status/Datum/Notiz setzen, "Speichern" klicken, prüfen dass Badge sich aktualisiert.
Expected: Badge zeigt neuen Status, Filter blendet nicht-passende Shops aus, Editor schließt nach Speichern.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/web/pages/lieferanten.tsx
git commit -m "feat: Badge, Filter und Bearbeiten für Lieferanten-Compliance im Lieferanten-Tab (P-66 Schritt 1)"
```

---

### Task 5: Backup — trusted_suppliers vollständig erfassen

**Files:**
- Modify: `packages/web/src/api/backup.ts:546-564` (`runBackup`)

**Interfaces:**
- Konsumiert: `schema.trustedSuppliers` (bereits importiert als `* as schema`).

- [ ] **Step 1: trustedSuppliers in Promise.all + JSON-Export aufnehmen**

Zeile 546-564 ersetzen:

```ts
    const [products, priceHistoryRows, trustedSuppliersRows] = await Promise.all([
      db.select().from(schema.products),
      db.select().from(schema.priceHistory),
      db.select().from(schema.trustedSuppliers),
    ]);

    const now = new Date();
    const isoDate = now.toISOString().slice(0, 10);

    console.log(`[Backup] ${products.length} Produkte, ${priceHistoryRows.length} Preis-Einträge, ${trustedSuppliersRows.length} Lieferanten`);

    const csv = productsToCSV(products);
    const dbJson = JSON.stringify({
      exportedAt: now.toISOString(),
      version: '2.0',
      tables: {
        products: { count: products.length, rows: products },
        price_history: { count: priceHistoryRows.length, rows: priceHistoryRows },
        trusted_suppliers: { count: trustedSuppliersRows.length, rows: trustedSuppliersRows },
      },
    }, null, 2);
```

- [ ] **Step 2: Backend-Typecheck**

Run: `cd packages/web && bun run typecheck:server`
Expected: Keine Fehler.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/api/backup.ts
git commit -m "fix: trusted_suppliers vollständig ins Backup aufnehmen (P-32-Lücke, P-66 Schritt 1)"
```

---

### Task 6: Gesamtverifikation

- [ ] **Step 1: Vollständiger Typecheck (Frontend + Backend)**

Run: `cd packages/web && bunx tsc --noEmit -p tsconfig.app.json && bun run typecheck:server`
Expected: Beide Durchläufe ohne Fehler.

- [ ] **Step 2: Migration erneut gegen Produktions-DB prüfen (idempotent)**

Run: `cd packages/web && bun --env-file=../../.env run src/db/migrate.ts`
Expected: Alle P-66-Statements zeigen `→ Skip (already exists)` (da in Task 2 bereits ausgeführt) — kein `✗ FAILED`.

- [ ] **Step 3: Backup-Erfassung stichprobenartig prüfen**

Kurzer Blick in den geänderten Code aus Task 5 genügt (kein Live-Email-Versand nötig, da `RESEND_API_KEY` in Testumgebung ggf. nicht gesetzt ist) — sicherstellen, dass `trusted_suppliers` im `dbJson.tables`-Objekt auftaucht.

- [ ] **Step 4: Zusammenfassung an den Nutzer**

Kurze Bestätigung: Migration lief sauber, Lieferanten-Tab zeigt/erlaubt Bearbeitung der 3 Felder inkl. Filter, Backup erfasst `trusted_suppliers` vollständig, beide Typechecks grün.
