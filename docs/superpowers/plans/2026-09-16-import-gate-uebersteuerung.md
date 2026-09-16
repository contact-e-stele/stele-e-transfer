# Import-Gate manuelle Übersteuerung (P-66 Schritt 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Nutzer kann eine fälschliche Compliance-Blockierung beim Import (z.B. Katzen-Futterlabyrinth fälschlich als "Spielzeug" erkannt) für den einzelnen Import bewusst und nachvollziehbar übersteuern, ohne die automatische Erkennung selbst abzuschwächen.

**Architecture:** Erkennung wird um eine feld-/stichwort-genaue Variante ergänzt (neue Funktion neben der bestehenden, die unverändert bleibt). Das Frontend (`lieferanten.tsx`) zeigt bei Blockierung einen Button, der einen Bestätigungsdialog öffnet; die Entscheidung wird als zusätzliches Payload-Feld beim bestehenden Speichern-Aufruf (`POST /api/products`) mitgeschickt und additiv in neuen `products`-Spalten persistiert. Das Produkte-Tab (`produkte.tsx`) zeigt ein Badge mit Tooltip für übersteuerte Produkte.

**Tech Stack:** React (Vite), Hono-API (`packages/web/src/api/index.ts`), Drizzle ORM + Turso/libSQL, bun:test.

## Global Constraints

- Die bestehende automatische Erkennung wird NICHT abgeschaltet oder abgeschwächt — `matchRegulatedCategories()` bleibt unverändert, es kommt nur eine zusätzliche Funktion hinzu.
- `AUTO_PRICE_WRITE_ENABLED`, `ALIEXPRESS_TRACKING_SYNC_ENABLED` und die Preislogik werden nicht angefasst.
- Migration ist rein additiv: nur neue Spalten mit Default, keine bestehende Spalte verändert (Muster: `packages/web/src/db/migrate.ts`, idempotent, `ALTER TABLE ... ADD COLUMN`).
- Draft-PR, kein Merge durch den Ausführenden.
- DB-Migrationen laufen in diesem Projekt automatisch beim Server-Start (`server.ts` ruft `runMigrations()` auf, s. Task 2) — das Ausführen/Starten eines Servers mit dieser Migration gegen die echte (einzige) Turso-DB gilt daher laut Projektregel ("Immer manuell bestätigen lassen") als migrationsauslösende Aktion und braucht vorherige explizite Nutzerbestätigung (siehe Task 6).
- Antwortsprache/Kommentare: Deutsch, passend zum bestehenden Code.

---

### Task 1: Feld-/Stichwort-genaue Erkennung

**Files:**
- Modify: `packages/web/src/shared/regulated-categories.ts`
- Test: `packages/web/src/shared/regulated-categories.test.ts` (neu)

**Interfaces:**
- Produziert: `matchRegulatedCategoriesDetailed(fields: { title: string; description: string }): RegulatedCategoryMatch[]`, `interface RegulatedCategoryMatch { category: RegulatedCategory; keyword: string; field: 'title' | 'description' }`, `COMPLIANCE_OVERRIDE_REASONS: Array<{ value: string; label: string }>`, `complianceOverrideReasonLabel(value: string | null | undefined): string`. Wird von Task 4 (lieferanten.tsx) und Task 5 (produkte.tsx) importiert.
- Bestehendes `matchRegulatedCategories(text: string): RegulatedCategory[]` bleibt unverändert exportiert.

- [ ] **Step 1: Fehlschlagenden Test schreiben**

Neue Datei `packages/web/src/shared/regulated-categories.test.ts`:

```ts
// P-66 Schritt 3 (2026-09-16): Tests für die feld-/stichwort-genaue Erkennung, die den
// Übersteuerungs-Dialog und die verbesserte Blockier-Meldung speist. Live-Fall: Katzen-
// Futterlabyrinth (https://de.aliexpress.com/item/1005009603522097.html) — "Toy" im Titel löst
// die Spielzeug-Kategorie aus, obwohl es Heimtierbedarf ist.
import { describe, expect, test } from 'bun:test';
import { matchRegulatedCategories, matchRegulatedCategoriesDetailed, COMPLIANCE_OVERRIDE_REASONS, complianceOverrideReasonLabel } from './regulated-categories';

describe('matchRegulatedCategoriesDetailed — Feld- und Stichwort-genaue Erkennung', () => {
  test('Katzen-Futterlabyrinth-Fall: "Toy" im Titel wird als Spielzeug erkannt, Feld = title', () => {
    const result = matchRegulatedCategoriesDetailed({
      title: 'Cat Feeder Maze Toy Interactive Slow Feeder Puzzle Bowl',
      description: 'Interactive slow feeding bowl for cats, reduces eating speed.',
    });
    expect(result).toHaveLength(1);
    expect(result[0].category.id).toBe('spielzeug');
    expect(result[0].keyword).toBe('toy');
    expect(result[0].field).toBe('title');
  });

  test('Treffer nur in der Beschreibung liefert field = "description"', () => {
    const result = matchRegulatedCategoriesDetailed({
      title: 'Katzenfutterlabyrinth interaktive Schüssel Edelstahl',
      description: 'Ein kleines Plüschtier ist als Zugabe enthalten.',
    });
    expect(result).toHaveLength(1);
    expect(result[0].category.id).toBe('spielzeug');
    expect(result[0].keyword).toBe('plüschtier');
    expect(result[0].field).toBe('description');
  });

  test('kein Treffer bei unauffälligem Text', () => {
    const result = matchRegulatedCategoriesDetailed({
      title: 'Katzenfutterlabyrinth interaktive Schüssel Edelstahl',
      description: 'Langsame Fütterung, rutschfester Boden, spülmaschinenfest.',
    });
    expect(result).toHaveLength(0);
  });

  test('mehrere Kategorien gleichzeitig werden alle gemeldet', () => {
    const result = matchRegulatedCategoriesDetailed({
      title: 'Baby Toy mit Akku und Ladegerät',
      description: '',
    });
    const ids = result.map(m => m.category.id).sort();
    expect(ids).toEqual(['ce_elektronik', 'spielzeug']);
  });

  test('bestehende matchRegulatedCategories() bleibt unverändert nutzbar', () => {
    const result = matchRegulatedCategories('Dieses Spielzeug ist toll');
    expect(result.map(c => c.id)).toEqual(['spielzeug']);
  });
});

describe('COMPLIANCE_OVERRIDE_REASONS / complianceOverrideReasonLabel', () => {
  test('enthält genau die 4 im Auftrag vorgegebenen Optionen', () => {
    expect(COMPLIANCE_OVERRIDE_REASONS.map(r => r.value)).toEqual([
      'heimtierbedarf', 'lieferant_bekannt', 'kategorie_trifft_nicht_zu', 'sonstiges',
    ]);
    expect(COMPLIANCE_OVERRIDE_REASONS.map(r => r.label)).toEqual([
      'Heimtierbedarf (kein Kinderspielzeug)',
      'Lieferant ist mir bekannt und geprüft',
      'Kategorie trifft nicht zu',
      'Sonstiges (Freitext)',
    ]);
  });

  test('complianceOverrideReasonLabel löst bekannten Slug auf', () => {
    expect(complianceOverrideReasonLabel('heimtierbedarf')).toBe('Heimtierbedarf (kein Kinderspielzeug)');
  });

  test('complianceOverrideReasonLabel liefert Fallback bei unbekanntem/leerem Wert', () => {
    expect(complianceOverrideReasonLabel(null)).toBe('(kein Grund angegeben)');
    expect(complianceOverrideReasonLabel(undefined)).toBe('(kein Grund angegeben)');
  });
});
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cd packages/web && bun test src/shared/regulated-categories.test.ts`
Expected: FAIL — `matchRegulatedCategoriesDetailed is not a function` (bzw. Import-Fehler, da noch nicht exportiert).

- [ ] **Step 3: Implementierung**

Am Ende von `packages/web/src/shared/regulated-categories.ts` (nach der bestehenden `matchRegulatedCategories`-Funktion) ergänzen:

```ts
export interface RegulatedCategoryMatch {
  category: RegulatedCategory;
  keyword: string;
  field: 'title' | 'description';
}

function findKeywordHit(cat: RegulatedCategory, title: string, description: string): { keyword: string; field: 'title' | 'description' } | undefined {
  const titleLower = title.toLowerCase();
  const allKeywords = [...cat.keywordsDe, ...cat.keywordsEn];
  for (const k of allKeywords) {
    if (titleLower.includes(k.toLowerCase())) return { keyword: k, field: 'title' };
  }
  const descLower = description.toLowerCase();
  for (const k of allKeywords) {
    if (descLower.includes(k.toLowerCase())) return { keyword: k, field: 'description' };
  }
  return undefined;
}

// P-66 Schritt 3: wie matchRegulatedCategories(), aber liefert zusätzlich pro Treffer das
// konkrete Stichwort und das Feld (Titel/Beschreibung) — Titel wird vor Beschreibung geprüft.
// Damit können Blockier-Meldung und Übersteuerungs-Dialog konkret zeigen, WAS erkannt wurde,
// statt nur "regulierte Kategorie". matchRegulatedCategories() bleibt unverändert bestehen.
export function matchRegulatedCategoriesDetailed(fields: { title: string; description: string }): RegulatedCategoryMatch[] {
  const matches: RegulatedCategoryMatch[] = [];
  for (const cat of REGULATED_CATEGORIES) {
    const hit = findKeywordHit(cat, fields.title, fields.description);
    if (hit) matches.push({ category: cat, keyword: hit.keyword, field: hit.field });
  }
  return matches;
}

// P-66 Schritt 3: die 4 im Auftrag vorgegebenen Begründungen für eine manuelle Übersteuerung —
// eine Quelle für das Dropdown (lieferanten.tsx) UND das Badge-Tooltip (produkte.tsx).
export const COMPLIANCE_OVERRIDE_REASONS: Array<{ value: string; label: string }> = [
  { value: 'heimtierbedarf', label: 'Heimtierbedarf (kein Kinderspielzeug)' },
  { value: 'lieferant_bekannt', label: 'Lieferant ist mir bekannt und geprüft' },
  { value: 'kategorie_trifft_nicht_zu', label: 'Kategorie trifft nicht zu' },
  { value: 'sonstiges', label: 'Sonstiges (Freitext)' },
];

export function complianceOverrideReasonLabel(value: string | null | undefined): string {
  return COMPLIANCE_OVERRIDE_REASONS.find(r => r.value === value)?.label ?? (value || '(kein Grund angegeben)');
}
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `cd packages/web && bun test src/shared/regulated-categories.test.ts`
Expected: PASS, alle 9 Tests grün.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/shared/regulated-categories.ts packages/web/src/shared/regulated-categories.test.ts
git commit -m "feat: feld-/stichwort-genaue Compliance-Erkennung (P-66 Schritt 3, Basis)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: DB-Schema + additive Migration

**Files:**
- Modify: `packages/web/src/db/schema.ts` (products-Tabelle)
- Modify: `packages/web/src/db/migrate.ts`

**Interfaces:**
- Produziert: neue optionale Felder auf `Product`/`NewProduct` (Drizzle-Inferenz): `complianceOverride: boolean | null`, `complianceOverrideAt: string | null`, `complianceOverrideReason: string | null`, `complianceOverrideReasonText: string | null`, `complianceOverrideCategory: string | null`, `complianceOverrideKeyword: string | null`, `complianceOverrideField: string | null`. Werden von Task 3 (Server-Route) geschrieben und von Task 5 (Frontend) gelesen.

- [ ] **Step 1: Schema ergänzen**

In `packages/web/src/db/schema.ts`, im `products`-Table-Objekt, direkt vor `createdAt: text('created_at')...` (nach der `shipsFrom`-Zeile) einfügen:

```ts
  // P-66 Schritt 3 (2026-09-16): manuelle Übersteuerung der Compliance-Sperre für EINEN Import,
  // wenn die automatische Stichwort-Erkennung falsch lag (z.B. "Toy" im Titel bei einem
  // Heimtierbedarf-Produkt). Additiv, alle Spalten nullable/mit Default — die automatische
  // Erkennung selbst bleibt unverändert, das hier ist nur die Nachweis-Ablage der bewussten
  // Entscheidung (für eine spätere eBay-/Behörden-Rückfrage).
  complianceOverride: integer('compliance_override', { mode: 'boolean' }).default(false),
  complianceOverrideAt: text('compliance_override_at'),
  complianceOverrideReason: text('compliance_override_reason'),       // Slug, siehe COMPLIANCE_OVERRIDE_REASONS (shared/regulated-categories.ts)
  complianceOverrideReasonText: text('compliance_override_reason_text'), // Freitext, nur bei reason = 'sonstiges'
  complianceOverrideCategory: text('compliance_override_category'),   // erkannte Kategorie(n) als Klartext-Label (labelDe), Komma-getrennt falls mehrere
  complianceOverrideKeyword: text('compliance_override_keyword'),     // ausgelöste(s) Stichwort(e), Komma-getrennt falls mehrere
  complianceOverrideField: text('compliance_override_field'),         // 'title' | 'description', Komma-getrennt falls mehrere
```

- [ ] **Step 2: Migration ergänzen**

In `packages/web/src/db/migrate.ts`, im `migrations`-Array direkt vor der schließenden `];` (nach der `store_category_name`-Zeile) einfügen:

```ts
  // P-66 Schritt 3 (2026-09-16): manuelle Übersteuerung der Compliance-Sperre — additiv, alle
  // Spalten nullable/mit Default, keine bestehende Spalte verändert.
  `ALTER TABLE products ADD COLUMN compliance_override INTEGER DEFAULT 0`,
  `ALTER TABLE products ADD COLUMN compliance_override_at TEXT`,
  `ALTER TABLE products ADD COLUMN compliance_override_reason TEXT`,
  `ALTER TABLE products ADD COLUMN compliance_override_reason_text TEXT`,
  `ALTER TABLE products ADD COLUMN compliance_override_category TEXT`,
  `ALTER TABLE products ADD COLUMN compliance_override_keyword TEXT`,
  `ALTER TABLE products ADD COLUMN compliance_override_field TEXT`,
```

- [ ] **Step 3: Server-Typecheck laufen lassen**

Run: `cd packages/web && bun run typecheck:server`
Expected: PASS, keine Fehler in `schema.ts`/`migrate.ts`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/db/schema.ts packages/web/src/db/migrate.ts
git commit -m "feat: additive DB-Spalten fuer Compliance-Uebersteuerung (P-66 Schritt 3)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Server-Route — Override-Felder annehmen, persistieren, loggen

**Files:**
- Modify: `packages/web/src/api/index.ts:1370-1459` (`POST /products`)

**Interfaces:**
- Konsumiert: Drizzle-Felder aus Task 2 (`schema.products.complianceOverride` u.a.).
- Produziert: `POST /api/products` akzeptiert im Body zusätzlich `complianceOverride?: boolean`, `complianceOverrideReason?: string`, `complianceOverrideReasonText?: string | null`, `complianceOverrideCategory?: string`, `complianceOverrideKeyword?: string`, `complianceOverrideField?: string` — wird von Task 4 (`handleSave` in lieferanten.tsx) verwendet.

- [ ] **Step 1: Body-Typ erweitern**

In `packages/web/src/api/index.ts`, im `POST /products`-Handler, den Body-Typ erweitern:

Alt:
```ts
        shipsFrom?: string;
        shippingCost?: number;
      };
```

Neu:
```ts
        shipsFrom?: string;
        shippingCost?: number;
        complianceOverride?: boolean;
        complianceOverrideReason?: string;
        complianceOverrideReasonText?: string | null;
        complianceOverrideCategory?: string;
        complianceOverrideKeyword?: string;
        complianceOverrideField?: string;
      };
```

- [ ] **Step 2: SKU früh berechnen + Log-Zeile bei Override**

Alt:
```ts
      // Titel + Beschreibung parallel generieren (schneller)
      const specs = body.specs ?? {};
      const rawTitle = body.generatedTitle ?? body.title;
```

Neu:
```ts
      // P-66 Schritt 3: SKU früh berechnen (wird für Insert UND für das Override-Log gebraucht) —
      // body.asin ist nur eine synthetische ID (ali_<timestamp>), NICHT die echte AliExpress-ID.
      const aliexpressItemId = (body.sourceUrl ?? body.amazonUrl ?? '').match(/\/item\/(\d+)\.html/)?.[1] ?? null;
      if (body.complianceOverride) {
        console.log(`[Compliance-Override] SKU=${aliexpressItemId ?? '(unbekannt)'} Kategorie=${body.complianceOverrideCategory ?? '-'} Stichwort="${body.complianceOverrideKeyword ?? '-'}" Feld=${body.complianceOverrideField ?? '-'} Grund=${body.complianceOverrideReason ?? '-'}`);
      }

      // Titel + Beschreibung parallel generieren (schneller)
      const specs = body.specs ?? {};
      const rawTitle = body.generatedTitle ?? body.title;
```

- [ ] **Step 3: Update-Zweig (bestehendes Produkt) erweitern**

Alt:
```ts
          shipsFrom: body.shipsFrom ?? undefined,
          shippingCost: body.shippingCost ?? undefined,
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.products.asin, body.asin));
```

Neu:
```ts
          shipsFrom: body.shipsFrom ?? undefined,
          shippingCost: body.shippingCost ?? undefined,
          ...(body.complianceOverride ? {
            complianceOverride: true,
            complianceOverrideAt: new Date().toISOString(),
            complianceOverrideReason: body.complianceOverrideReason ?? undefined,
            complianceOverrideReasonText: body.complianceOverrideReasonText ?? undefined,
            complianceOverrideCategory: body.complianceOverrideCategory ?? undefined,
            complianceOverrideKeyword: body.complianceOverrideKeyword ?? undefined,
            complianceOverrideField: body.complianceOverrideField ?? undefined,
          } : {}),
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.products.asin, body.asin));
```

- [ ] **Step 4: Insert-Zweig (neues Produkt) erweitern**

Alt:
```ts
        shipsFrom: body.shipsFrom ?? null,
        shippingCost: body.shippingCost ?? 0,
        ebayStatus: 'none',
        aliexpressItemId: (body.sourceUrl ?? body.amazonUrl ?? '').match(/\/item\/(\d+)\.html/)?.[1] ?? null,
      }).returning({ id: schema.products.id });
```

Neu:
```ts
        shipsFrom: body.shipsFrom ?? null,
        shippingCost: body.shippingCost ?? 0,
        ebayStatus: 'none',
        aliexpressItemId,
        complianceOverride: body.complianceOverride ?? false,
        complianceOverrideAt: body.complianceOverride ? new Date().toISOString() : null,
        complianceOverrideReason: body.complianceOverrideReason ?? null,
        complianceOverrideReasonText: body.complianceOverrideReasonText ?? null,
        complianceOverrideCategory: body.complianceOverrideCategory ?? null,
        complianceOverrideKeyword: body.complianceOverrideKeyword ?? null,
        complianceOverrideField: body.complianceOverrideField ?? null,
      }).returning({ id: schema.products.id });
```

- [ ] **Step 5: Server-Typecheck laufen lassen**

Run: `cd packages/web && bun run typecheck:server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/index.ts
git commit -m "feat: POST /api/products nimmt Compliance-Override-Felder an + Server-Log (P-66 Schritt 3)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend `lieferanten.tsx` — Klartext-Meldung, Button, Bestätigungsdialog

**Files:**
- Modify: `packages/web/src/web/pages/lieferanten.tsx`

**Interfaces:**
- Konsumiert: `matchRegulatedCategoriesDetailed`, `COMPLIANCE_OVERRIDE_REASONS`, `type RegulatedCategoryMatch` aus Task 1; Server-Payload-Felder aus Task 3.

- [ ] **Step 1: Imports erweitern**

Alt (Zeile 9):
```ts
import { matchRegulatedCategories, type RegulatedCategory } from "../../shared/regulated-categories";
```

Neu:
```ts
import { matchRegulatedCategories, matchRegulatedCategoriesDetailed, COMPLIANCE_OVERRIDE_REASONS, type RegulatedCategory, type RegulatedCategoryMatch } from "../../shared/regulated-categories";
```

Alt (Zeilen 11-15, lucide-react Import):
```ts
import {
  FileText, Copy, Check, Loader, AlertCircle,
  RefreshCw, Package, Link, ChevronLeft,
  TrendingDown, Save, Eye, EyeOff, X, Plus, Trash2,
} from "lucide-react";
```

Neu:
```ts
import {
  FileText, Copy, Check, Loader, AlertCircle,
  RefreshCw, Package, Link, ChevronLeft,
  TrendingDown, Save, Eye, EyeOff, X, Plus, Trash2, Unlock,
} from "lucide-react";
```

- [ ] **Step 2: State für den Bestätigungsdialog ergänzen**

Alt (Zeile 274):
```ts
  const [saveResult, setSaveResult] = useState<{ id?: number; error?: string } | null>(null);
```

Neu:
```ts
  const [saveResult, setSaveResult] = useState<{ id?: number; error?: string } | null>(null);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideReasonText, setOverrideReasonText] = useState("");
```

- [ ] **Step 3: Erkennung auf die detaillierte Funktion umstellen**

Alt (Zeilen 469-475):
```ts
  // ─── P-66 Schritt 2: Compliance-Gate für regulierte Produktgruppen ────────
  const regulatedMatches: RegulatedCategory[] = product
    ? matchRegulatedCategories([product.title, editableTitle, product.description ?? ''].join(' '))
    : [];
  const matchedSupplier = product ? findMatchingSupplier(product.seller, trustedSuppliers) : undefined;
  const supplierVerified = matchedSupplier?.complianceStatus === 'geprueft';
  const complianceBlocked = regulatedMatches.length > 0 && !supplierVerified;
```

Neu:
```ts
  // ─── P-66 Schritt 2/3: Compliance-Gate für regulierte Produktgruppen ──────
  // Schritt 3: matchRegulatedCategoriesDetailed() statt matchRegulatedCategories() — liefert
  // zusätzlich Stichwort + Feld pro Treffer, für die Klartext-Meldung und den Übersteuerungs-
  // Dialog. regulatedMatches bleibt als reine Kategorien-Liste erhalten (bestehende Nutzung
  // unten unverändert).
  const regulatedMatchesDetailed: RegulatedCategoryMatch[] = product
    ? matchRegulatedCategoriesDetailed({ title: [product.title, editableTitle].join(' '), description: product.description ?? '' })
    : [];
  const regulatedMatches: RegulatedCategory[] = regulatedMatchesDetailed.map(m => m.category);
  const matchedSupplier = product ? findMatchingSupplier(product.seller, trustedSuppliers) : undefined;
  const supplierVerified = matchedSupplier?.complianceStatus === 'geprueft';
  const complianceBlocked = regulatedMatches.length > 0 && !supplierVerified;
```

- [ ] **Step 4: `handleSave` um optionalen Override-Parameter erweitern**

Alt (Zeilen 633-674, gekürzt auf die relevanten Zeilen):
```ts
  const handleSave = async () => {
    if (!result || !product) return;
    if (complianceBlocked) return; // P-66: harte Sperre, kein Bypass
    setSaveLoading(true);
    setSaveResult(null);
    try {
      const data = await safeJson<{ id?: number; error?: string }>("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: `ali_${Date.now()}`,
          amazonUrl: urlInput || "manual",
          sourceUrl: urlInput || "manual",
          title: product.title,
          generatedTitle: editableTitle,
          htmlDescription: editableHtml,
          bullets: Object.entries(product.specs).map(([k, v]) => `${k}: ${v}`),
          variants: editedVariants
            .filter(g => g.values.length > 0 && !isSkipVariantGroup(g.name)),
          variantPrices: (product.variantPrices ?? []).map(v => ({
            ...v,
            ebayPrice: parseFloat((variantEbayPrices[v.skuId] ?? "").replace(",", ".")) || undefined,
          })),
          variantContents: Object.keys(variantContents).length > 0 ? variantContents : undefined,
          gpsrRaw: gpsrHersteller.trim() || undefined,
          gpsrHtml: gpsrHersteller.trim() ? `<div class="gpsr-block"><h3>Produktsicherheit (GPSR)</h3><pre>${gpsrHersteller.trim()}</pre></div>` : undefined,
          description: product.description,
          images: visibleImages,
          buyPrice: einkauf || null,
          sellPrice: verkauf || null,
          targetMarginEur: minGewinn,
          adRate: adRate,
          shippingCost: parseFloat(shippingCost.replace(",", ".")) || 0,
          shipsFrom: shipsFromInfo?.country,
          // P-82 Aufgabe 2/5: nur mitschicken, wenn tatsächlich eine Kategorie gewählt wurde —
          // sonst bleiben beide Felder weg (POST /products lässt sie dann null, wie bisher).
          ...(selectedStoreCategoryId ? {
            storeCategoryId: selectedStoreCategoryId,
            storeCategoryName: storeCategories.find(c => c.categoryId === selectedStoreCategoryId)?.fullPath,
          } : {}),
        }),
      });
      setSaveResult(data);
    } catch (e) {
      setSaveResult({ error: e instanceof Error ? e.message : "Fehler" });
    } finally {
      setSaveLoading(false);
    }
  };
```

Neu (nur die geänderten Stellen: Signatur, Sperre, Payload-Erweiterung):
```ts
  const handleSave = async (override?: { reason: string; reasonText: string }) => {
    if (!result || !product) return;
    if (complianceBlocked && !override) return; // P-66: harte Sperre bleibt Standard, nur expliziter Override umgeht sie
    setSaveLoading(true);
    setSaveResult(null);
    try {
      const data = await safeJson<{ id?: number; error?: string }>("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin: `ali_${Date.now()}`,
          amazonUrl: urlInput || "manual",
          sourceUrl: urlInput || "manual",
          title: product.title,
          generatedTitle: editableTitle,
          htmlDescription: editableHtml,
          bullets: Object.entries(product.specs).map(([k, v]) => `${k}: ${v}`),
          variants: editedVariants
            .filter(g => g.values.length > 0 && !isSkipVariantGroup(g.name)),
          variantPrices: (product.variantPrices ?? []).map(v => ({
            ...v,
            ebayPrice: parseFloat((variantEbayPrices[v.skuId] ?? "").replace(",", ".")) || undefined,
          })),
          variantContents: Object.keys(variantContents).length > 0 ? variantContents : undefined,
          gpsrRaw: gpsrHersteller.trim() || undefined,
          gpsrHtml: gpsrHersteller.trim() ? `<div class="gpsr-block"><h3>Produktsicherheit (GPSR)</h3><pre>${gpsrHersteller.trim()}</pre></div>` : undefined,
          description: product.description,
          images: visibleImages,
          buyPrice: einkauf || null,
          sellPrice: verkauf || null,
          targetMarginEur: minGewinn,
          adRate: adRate,
          shippingCost: parseFloat(shippingCost.replace(",", ".")) || 0,
          shipsFrom: shipsFromInfo?.country,
          // P-82 Aufgabe 2/5: nur mitschicken, wenn tatsächlich eine Kategorie gewählt wurde —
          // sonst bleiben beide Felder weg (POST /products lässt sie dann null, wie bisher).
          ...(selectedStoreCategoryId ? {
            storeCategoryId: selectedStoreCategoryId,
            storeCategoryName: storeCategories.find(c => c.categoryId === selectedStoreCategoryId)?.fullPath,
          } : {}),
          // P-66 Schritt 3: nur mitschicken, wenn der Nutzer den Bestätigungsdialog durchlaufen hat.
          ...(override ? {
            complianceOverride: true,
            complianceOverrideReason: override.reason,
            complianceOverrideReasonText: override.reason === 'sonstiges' ? override.reasonText : null,
            complianceOverrideCategory: regulatedMatchesDetailed.map(m => m.category.labelDe).join(', '),
            complianceOverrideKeyword: regulatedMatchesDetailed.map(m => m.keyword).join(', '),
            complianceOverrideField: regulatedMatchesDetailed.map(m => m.field).join(', '),
          } : {}),
        }),
      });
      setSaveResult(data);
    } catch (e) {
      setSaveResult({ error: e instanceof Error ? e.message : "Fehler" });
    } finally {
      setSaveLoading(false);
    }
  };
```

- [ ] **Step 5: Klartext-Meldung, Button und Dialog in der UI ergänzen**

Alt:
```tsx
              {complianceBlocked && (
                <div style={{
                  marginBottom: 14, padding: "12px 14px", borderRadius: 12,
                  background: "#FEF2F2", border: "1.5px solid #FECACA",
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 16, lineHeight: "20px" }}>🚫</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#991B1B" }}>
                        Dieses Produkt gehört möglicherweise zu einer regulierten Kategorie. Lieferant muss erst im Lieferanten-Tab als geprüft markiert werden.
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#B91C1C" }}>
                        Erkannt als: {regulatedMatches.map(m => m.labelDe).join(', ')} — automatische Stichwort-Erkennung, keine rechtsverbindliche Prüfung.
                        {matchedSupplier
                          ? <> Lieferant „{matchedSupplier.shopName}" ist aktuell: <strong>{matchedSupplier.complianceStatus}</strong>.</>
                          : <> Erkannter Verkäufer laut Scrape: <strong>„{product?.seller || '(kein Name erkannt)'}"</strong> — dafür existiert kein Eintrag in „Meine EU-Shops" (P-109: Abgleich prüft Groß-/Kleinschreibung, Leerzeichen und Teilstring, aber keine völlig anderen Schreibweisen). Bitte Schreibweise in „Meine EU-Shops" mit dem hier angezeigten Namen abgleichen oder neu anlegen.</>}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={saveLoading || !!saveResult?.id || complianceBlocked}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 12,
                  border: saveResult?.id ? "1.5px solid #BBF7D0" : "1.5px solid transparent",
                  background: saveResult?.id ? "#F0FDF4" : complianceBlocked ? "#FEE2E2" : saveLoading ? "#E2E8F0" : "#0F172A",
                  color: saveResult?.id ? "#15803D" : complianceBlocked ? "#991B1B" : saveLoading ? "#94A3B8" : "#C9A227",
                  fontWeight: 700, fontSize: 14,
                  cursor: (saveLoading || !!saveResult?.id || complianceBlocked) ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {saveLoading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={16} />}
                {saveLoading ? "Wird gespeichert…" : saveResult?.id ? "Bereits gespeichert" : complianceBlocked ? "Blockiert — Lieferant nicht geprüft" : "In DB speichern"}
              </button>
              {saveResult?.error && (
                <p style={{ margin: "8px 0 0", color: "#DC2626", fontSize: 13, fontWeight: 600 }}>Fehler: {saveResult.error}</p>
              )}
            </div>
```

Neu:
```tsx
              {complianceBlocked && (
                <div style={{
                  marginBottom: 14, padding: "12px 14px", borderRadius: 12,
                  background: "#FEF2F2", border: "1.5px solid #FECACA",
                  display: "flex", flexDirection: "column", gap: 4,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontSize: 16, lineHeight: "20px" }}>🚫</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#991B1B" }}>
                        Dieses Produkt gehört möglicherweise zu einer regulierten Kategorie. Lieferant muss erst im Lieferanten-Tab als geprüft markiert werden.
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: 11, color: "#B91C1C" }}>
                        Erkannt als: {regulatedMatchesDetailed.map(m => `${m.category.labelDe} („${m.keyword}" im ${m.field === 'title' ? 'Titel' : 'Beschreibung'})`).join(', ')} — automatische Stichwort-Erkennung, keine rechtsverbindliche Prüfung.
                        {matchedSupplier
                          ? <> Lieferant „{matchedSupplier.shopName}" ist aktuell: <strong>{matchedSupplier.complianceStatus}</strong>.</>
                          : <> Erkannter Verkäufer laut Scrape: <strong>„{product?.seller || '(kein Name erkannt)'}"</strong> — dafür existiert kein Eintrag in „Meine EU-Shops" (P-109: Abgleich prüft Groß-/Kleinschreibung, Leerzeichen und Teilstring, aber keine völlig anderen Schreibweisen). Bitte Schreibweise in „Meine EU-Shops" mit dem hier angezeigten Namen abgleichen oder neu anlegen.</>}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {complianceBlocked && (
                <button
                  onClick={() => setOverrideDialogOpen(true)}
                  style={{
                    width: "100%", padding: "11px 0", borderRadius: 12, marginBottom: 14,
                    border: "1.5px solid #FCD34D", background: "#FFFBEB", color: "#92400E",
                    fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  }}
                >
                  <Unlock size={15} />
                  Manuell übersteuern und speichern
                </button>
              )}

              <button
                onClick={() => handleSave()}
                disabled={saveLoading || !!saveResult?.id || complianceBlocked}
                style={{
                  width: "100%", padding: "13px 0", borderRadius: 12,
                  border: saveResult?.id ? "1.5px solid #BBF7D0" : "1.5px solid transparent",
                  background: saveResult?.id ? "#F0FDF4" : complianceBlocked ? "#FEE2E2" : saveLoading ? "#E2E8F0" : "#0F172A",
                  color: saveResult?.id ? "#15803D" : complianceBlocked ? "#991B1B" : saveLoading ? "#94A3B8" : "#C9A227",
                  fontWeight: 700, fontSize: 14,
                  cursor: (saveLoading || !!saveResult?.id || complianceBlocked) ? "not-allowed" : "pointer",
                  fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}
              >
                {saveLoading ? <Loader size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Save size={16} />}
                {saveLoading ? "Wird gespeichert…" : saveResult?.id ? "Bereits gespeichert" : complianceBlocked ? "Blockiert — Lieferant nicht geprüft" : "In DB speichern"}
              </button>
              {saveResult?.error && (
                <p style={{ margin: "8px 0 0", color: "#DC2626", fontSize: 13, fontWeight: 600 }}>Fehler: {saveResult.error}</p>
              )}

              {overrideDialogOpen && (
                <div style={{
                  position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
                  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20,
                }}>
                  <div style={{
                    background: "#fff", borderRadius: 20, padding: 28, maxWidth: 480, width: "100%",
                    boxShadow: "0 12px 48px rgba(0,0,0,0.25)", maxHeight: "90vh", overflowY: "auto",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <span style={{ fontWeight: 800, fontSize: 16, color: "#0F172A" }}>Blockierung manuell übersteuern</span>
                      <button onClick={() => setOverrideDialogOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}>
                        <X size={18} color="#64748B" />
                      </button>
                    </div>

                    <p style={{ margin: "0 0 10px", fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
                      Erkannt als: <strong>{regulatedMatchesDetailed.map(m => `${m.category.labelDe} („${m.keyword}" im ${m.field === 'title' ? 'Titel' : 'Beschreibung'})`).join(', ')}</strong>
                    </p>
                    <p style={{ margin: "0 0 16px", fontSize: 13, color: "#334155", lineHeight: 1.5 }}>
                      Erkannter Verkäufername laut Scrape: <strong>„{product?.seller || '(kein Name erkannt)'}"</strong>
                    </p>

                    <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#0F172A", marginBottom: 6 }}>
                      Warum ist die Einstufung falsch?
                    </label>
                    <select
                      value={overrideReason}
                      onChange={e => setOverrideReason(e.target.value)}
                      style={{
                        width: "100%", padding: "10px 12px", fontSize: 13, borderRadius: 10,
                        border: "2px solid #E2E8F0", marginBottom: 10, fontFamily: "inherit", boxSizing: "border-box",
                      }}
                    >
                      <option value="">Bitte wählen…</option>
                      {COMPLIANCE_OVERRIDE_REASONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>

                    {overrideReason === "sonstiges" && (
                      <textarea
                        value={overrideReasonText}
                        onChange={e => setOverrideReasonText(e.target.value)}
                        placeholder="Begründung eintragen…"
                        style={{
                          width: "100%", minHeight: 70, padding: "10px 12px", fontSize: 13, borderRadius: 10,
                          border: "2px solid #E2E8F0", marginBottom: 10, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical",
                        }}
                      />
                    )}

                    <button
                      onClick={() => {
                        handleSave({ reason: overrideReason, reasonText: overrideReasonText });
                        setOverrideDialogOpen(false);
                      }}
                      disabled={!overrideReason || (overrideReason === "sonstiges" && !overrideReasonText.trim())}
                      style={{
                        width: "100%", padding: "13px 0", borderRadius: 12, border: "none", marginTop: 6,
                        background: (!overrideReason || (overrideReason === "sonstiges" && !overrideReasonText.trim())) ? "#E2E8F0" : "#0F172A",
                        color: (!overrideReason || (overrideReason === "sonstiges" && !overrideReasonText.trim())) ? "#94A3B8" : "#C9A227",
                        fontWeight: 700, fontSize: 14, cursor: (!overrideReason || (overrideReason === "sonstiges" && !overrideReasonText.trim())) ? "not-allowed" : "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Verstanden, trotzdem speichern
                    </button>
                  </div>
                </div>
              )}
            </div>
```

- [ ] **Step 6: Frontend-Typecheck laufen lassen**

Run: `cd packages/web && bun run typecheck`
Expected: PASS, keine Fehler in `lieferanten.tsx`.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/web/pages/lieferanten.tsx
git commit -m "feat: Uebersteuerungs-Button + Bestaetigungsdialog im Import-Tab (P-66 Schritt 3)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend `produkte.tsx` — Sichtbarkeit (Badge + Tooltip)

**Files:**
- Modify: `packages/web/src/web/pages/produkte.tsx`

**Interfaces:**
- Konsumiert: `complianceOverrideReasonLabel` aus Task 1; neue Product-Felder aus Task 2 (kommen automatisch über `GET /products`, da die Route `db.select().from(products)` ohne Spaltenliste nutzt).

- [ ] **Step 1: Imports erweitern**

Alt (Zeilen 7-12):
```ts
import {
  Package, ExternalLink, RefreshCw, ShoppingCart,
  Clock, CheckCircle, XCircle, Loader, TrendingUp,
  TrendingDown, AlertTriangle, Search, Trash2, Layers, Plus, X, Eye, ShieldCheck, Edit2,
  FileText, Upload,
} from "lucide-react";
```

Neu:
```ts
import {
  Package, ExternalLink, RefreshCw, ShoppingCart,
  Clock, CheckCircle, XCircle, Loader, TrendingUp,
  TrendingDown, AlertTriangle, Search, Trash2, Layers, Plus, X, Eye, ShieldCheck, Edit2,
  FileText, Upload, Unlock,
} from "lucide-react";
```

Nach der bestehenden Zeile `import { computeMinSellPrice, DEFAULT_PRICING_CONFIG } from "../../shared/pricing";` ergänzen:
```ts
import { complianceOverrideReasonLabel } from "../../shared/regulated-categories";
```

- [ ] **Step 2: `Product`-Interface erweitern**

Alt (Ende des Interface, vor der schließenden `}`):
```ts
  createdAt: string;
  updatedAt: string;
}
```

Neu:
```ts
  complianceOverride: boolean;
  complianceOverrideAt: string | null;
  complianceOverrideReason: string | null;
  complianceOverrideReasonText: string | null;
  complianceOverrideCategory: string | null;
  complianceOverrideKeyword: string | null;
  complianceOverrideField: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Badge zwischen GPSR-Button und Löschen-Button einfügen**

Alt:
```tsx
                {/* GPSR */}
                <button onClick={() => setGpsrModal(product)} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "6px 10px", borderRadius: 8,
                  background: product.gpsrName ? "#F0F9FF" : "#F8FAFC",
                  color: product.gpsrName ? "#0EA5E9" : "#94A3B8",
                  fontSize: 11, fontWeight: 700,
                  border: product.gpsrName ? "1px solid #BAE6FD" : "1px solid #E2E8F0",
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  <ShieldCheck size={11} />
                  {product.gpsrName ? "GPSR ✓" : "GPSR"}
                </button>

                {/* Produkt löschen */}
```

Neu:
```tsx
                {/* GPSR */}
                <button onClick={() => setGpsrModal(product)} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "6px 10px", borderRadius: 8,
                  background: product.gpsrName ? "#F0F9FF" : "#F8FAFC",
                  color: product.gpsrName ? "#0EA5E9" : "#94A3B8",
                  fontSize: 11, fontWeight: 700,
                  border: product.gpsrName ? "1px solid #BAE6FD" : "1px solid #E2E8F0",
                  cursor: "pointer", fontFamily: "inherit",
                }}>
                  <ShieldCheck size={11} />
                  {product.gpsrName ? "GPSR ✓" : "GPSR"}
                </button>

                {/* Compliance-Übersteuerung (P-66 Schritt 3) */}
                {product.complianceOverride && (
                  <span
                    title={`Grund: ${complianceOverrideReasonLabel(product.complianceOverrideReason)}${product.complianceOverrideReasonText ? ` — "${product.complianceOverrideReasonText}"` : ''}\nErkannt als: ${product.complianceOverrideCategory ?? '-'} (Stichwort "${product.complianceOverrideKeyword ?? '-'}" im Feld ${product.complianceOverrideField ?? '-'})\nÜbersteuert am: ${product.complianceOverrideAt ?? '-'}`}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 8,
                      background: "#FFFBEB", color: "#92400E",
                      fontSize: 11, fontWeight: 700, border: "1px solid #FCD34D",
                      fontFamily: "inherit", cursor: "default",
                    }}
                  >
                    <Unlock size={11} />
                    manuell freigegeben
                  </span>
                )}

                {/* Produkt löschen */}
```

- [ ] **Step 4: Frontend-Typecheck laufen lassen**

Run: `cd packages/web && bun run typecheck`
Expected: PASS, keine Fehler in `produkte.tsx`.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/web/pages/produkte.tsx
git commit -m "feat: Badge 'manuell freigegeben' mit Begruendungs-Tooltip im Produkte-Tab (P-66 Schritt 3)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Verifikation, Draft-PR

**Files:** keine Code-Änderungen — nur Ausführung + PR.

- [ ] **Step 1: Vollständigen Typecheck laufen lassen (Frontend + Server)**

Run: `cd packages/web && bun run typecheck && bun run typecheck:server`
Erwartetes ECHTES Ergebnis dokumentieren (nicht behaupten) — exakte Ausgabe in die PR-Beschreibung kopieren.

- [ ] **Step 2: Volle Testsuite laufen lassen**

Run: `cd packages/web && bun test`
Erwartetes ECHTES Ergebnis dokumentieren (Anzahl pass/fail) — exakte Ausgabe in die PR-Beschreibung kopieren. Bestehende Tests müssen weiterhin grün sein (kein neuer Fehlschlag durch diese Änderung).

- [ ] **Step 3: `git diff` gegen `origin/main` gegenprüfen, dass die strikten Grenzen eingehalten sind**

Run: `git diff origin/main --stat` und gezielt `git diff origin/main -- packages/web/src/api/price-monitor.ts packages/web/src/shared/pricing.ts` (müssen LEER sein) sowie `grep -rn "AUTO_PRICE_WRITE_ENABLED\|ALIEXPRESS_TRACKING_SYNC_ENABLED"` auf unveränderte Werte prüfen. Ergebnis wörtlich in die PR-Beschreibung.

- [ ] **Step 4: Nutzer um Bestätigung für Live-Verifikation fragen**

Das Starten des lokalen Dev-Servers (`bun run dev`) führt automatisch `runMigrations()` gegen die konfigurierte (einzige, produktive) Turso-DB aus — das fällt laut Projektregel "Immer manuell bestätigen lassen" unter DB-Migrationen und braucht vorherige explizite Zustimmung des Nutzers, auch wenn additiv/risikoarm. Vor diesem Schritt den Nutzer fragen, ob die Migration jetzt ausgeführt und live mit der echten AliExpress-URL (https://de.aliexpress.com/item/1005009603522097.html) nachgestellt werden soll. Bei Zustimmung: Dev-Server starten, im Browser Lieferanten-Tab öffnen, URL importieren, Blockier-Meldung + Dialog + gespeichertes Badge im Produkte-Tab verifizieren, danach im Render-/Server-Log die `[Compliance-Override]`-Zeile zeigen. Bei fehlender Zustimmung: in der PR-Beschreibung klar benennen, dass die Live-Nachstellung noch aussteht, und stattdessen die exakten Schritte zur Nachstellung dokumentieren (siehe Design-Dokument, Abschnitt "Verifikation").

- [ ] **Step 5: PR-Beschreibung schreiben und Draft-PR öffnen**

PR-Beschreibung MUSS enthalten: (a) Zusammenfassung der Änderung, (b) Nachstellung am Katzen-Futterlabyrinth-Fall (Schritt-für-Schritt, aus dem Design-Dokument übernommen und ggf. um das reale Live-Ergebnis aus Step 4 ergänzt), (c) wörtliche typecheck+Testsuite-Ausgabe aus Step 1/2, (d) Nachweis der strikten Grenzen aus Step 3, (e) Hinweis auf die additive Migration und dass sie automatisch beim nächsten Server-Start/Deploy läuft (Deploy-Risiko-Hinweis, GRUNDGESETZ Regel 10). PR als Draft öffnen, Branch `feat/p66-import-gate-uebersteuerung` gegen `main`. Kein Merge durch den Ausführenden.

- [ ] **Step 6: Design-Dokument-Verweis + Worklog**

`docs/WORKLOG.md` einen neuen Eintrag mit Datum, Claim (dieser Auftrag) und Ergebnis (Branch, PR-Nummer, Kernbefunde) hinzufügen, git add + commit.
