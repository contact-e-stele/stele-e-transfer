# P-66 Schritt 2: Import-Gate für regulierte Produktgruppen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Import-Flow im Lieferanten-Tab blockieren, wenn Titel/Beschreibung ein Keyword-Muster aus `regulated-categories.ts` trifft UND der zugehörige Lieferant nicht als `geprueft` markiert ist.

**Architecture:** Rein clientseitig in `lieferanten.tsx`. `trustedSuppliers` ist dort bereits als State geladen (aus Schritt 1). `regulated-categories.ts` bekommt jetzt seine erste Matching-Funktion. Kein Backend-/Schema-Change nötig.

**Tech Stack:** React 19, TypeScript (strict).

## Global Constraints

- Hinweistext exakt wie vorgegeben, plus Klarstellung „automatische Keyword-Erkennung, keine rechtsverbindliche Prüfung".
- Kein Bypass/„Trotzdem importieren"-Button für diesen Block (anders als der bestehende Duplikat-Warnhinweis aus P-31) — der einzige Weg durch den Block ist, den Lieferanten im Lieferanten-Tab als `geprueft` zu markieren.
- Block gilt für **beide** Import-Modi (URL-Scrape UND Manuell), nicht nur für den eBay-Listing-Schritt.

## Zentrale Design-Entscheidung: Wie wird der Lieferant einem Import zugeordnet?

`products` hat kein Fremdschlüssel-Feld zu `trusted_suppliers` — die einzige verfügbare Verknüpfung ist der beim AliExpress-Scrape mitgelieferte Shop-Name (`ScrapedProduct.seller`, z.B. „BOBO GO 1 Store"). Ich matche `product.seller` case-insensitive (exakt oder als Teilstring in beide Richtungen) gegen `trustedSuppliers[].shopName`.

**Wichtig — konservativer Default:** Wenn kein Lieferant zugeordnet werden kann (Manueller Modus hat gar keinen `seller`; oder der Shop-Name passt zu keinem gespeicherten Lieferanten), wird das **wie „nicht geprüft" behandelt** — bei Keyword-Treffer wird also auch dann blockiert. Grund: Ohne bekannten, verifizierten Lieferanten gibt es keine Grundlage, den Import bei einem Regulierungs-Verdacht durchzulassen. Das bedeutet in der Praxis: Manuelle Importe mit Keyword-Treffer sind immer blockiert (da nie ein Lieferant zugeordnet werden kann) — das ist beabsichtigt und konsistent mit dem Compliance-Ziel.

## Betroffene Dateien

| Datei | Art | Zweck |
|---|---|---|
| `packages/web/src/shared/regulated-categories.ts` | ÄNDERN | `matchRegulatedCategories()`-Funktion ergänzen |
| `packages/web/src/web/pages/lieferanten.tsx` | ÄNDERN | Lieferanten-Matching, Gate-Logik, Warnhinweis-UI, `handleSave`-Guard |

---

### Task 1: Matching-Funktion in regulated-categories.ts

**Files:**
- Modify: `packages/web/src/shared/regulated-categories.ts`

**Interfaces:**
- Produziert: `matchRegulatedCategories(text: string): RegulatedCategory[]` — wird von `lieferanten.tsx` konsumiert.

- [ ] **Step 1: Funktion anhängen**

Am Ende der Datei einfügen:

```ts
// Reine Substring-Erkennung (case-insensitive) — bewusst simpel, keine NLP/Fuzzy-Logik.
// Gibt alle Kategorien zurück, deren Keywords (DE oder EN) im Text vorkommen.
export function matchRegulatedCategories(text: string): RegulatedCategory[] {
  const lower = text.toLowerCase();
  return REGULATED_CATEGORIES.filter(cat =>
    cat.keywordsDe.some(k => lower.includes(k.toLowerCase())) ||
    cat.keywordsEn.some(k => lower.includes(k.toLowerCase()))
  );
}
```

- [ ] **Step 2: Frontend-Typecheck**

Run: `cd packages/web && bunx tsc --noEmit -p tsconfig.app.json 2>&1 | wc -l`
Expected: `23` (unveränderte Baseline, keine neuen Fehler).

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/shared/regulated-categories.ts
git commit -m "feat: Keyword-Matching für regulierte Produktgruppen (P-66 Schritt 2)"
```

---

### Task 2: Import-Gate in lieferanten.tsx

**Files:**
- Modify: `packages/web/src/web/pages/lieferanten.tsx`

**Interfaces:**
- Konsumiert: `matchRegulatedCategories` (Task 1), `trustedSuppliers` State (bereits vorhanden aus Schritt 1, inkl. `complianceStatus`).

- [ ] **Step 1: Import ergänzen**

Zeile 8 (`import { CHINA_ZOLL_EUR, ...} from "../../shared/constants";`) — direkt danach:

```ts
import { matchRegulatedCategories, type RegulatedCategory } from "../../shared/regulated-categories";
```

- [ ] **Step 2: Lieferanten-Matching-Helper hinzufügen**

Nach `parsePrice()` (vor `export default function Lieferanten()`, aktuell Zeile 120) einfügen:

```ts
// Ordnet den beim Scrape gelieferten Shop-Namen einem gespeicherten Lieferanten zu.
// Simple case-insensitive Gleichheit/Teilstring-Prüfung — kein exaktes ID-Matching möglich,
// da AliExpress-Scrapes keine stabile Store-ID liefern, nur den Anzeigenamen.
function findMatchingSupplier<T extends { shopName: string }>(sellerName: string | undefined, suppliers: T[]): T | undefined {
  if (!sellerName?.trim()) return undefined;
  const needle = sellerName.trim().toLowerCase();
  return suppliers.find(s => {
    const hay = s.shopName.trim().toLowerCase();
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}
```

- [ ] **Step 3: Compliance-Check als Render-Variable berechnen**

Direkt nach der Marge-Berechnung (nach `const margePercent = ...`, aktuell um Zeile 293) einfügen:

```ts
  // ─── P-66 Schritt 2: Compliance-Gate für regulierte Produktgruppen ────────
  const regulatedMatches: RegulatedCategory[] = product
    ? matchRegulatedCategories([product.title, editableTitle, product.description ?? ''].join(' '))
    : [];
  const matchedSupplier = product ? findMatchingSupplier(product.seller, trustedSuppliers) : undefined;
  const supplierVerified = matchedSupplier?.complianceStatus === 'geprueft';
  const complianceBlocked = regulatedMatches.length > 0 && !supplierVerified;
```

- [ ] **Step 4: `handleSave` hart absichern**

In `handleSave` (Zeile 490), erste Zeile im Funktionskörper ergänzen:

```ts
  const handleSave = async () => {
    if (!result || !product) return;
    if (complianceBlocked) return; // P-66: harte Sperre, kein Bypass
    setSaveLoading(true);
```

- [ ] **Step 5: Warnhinweis + Button-Sperre im Render**

Im „In DB speichern"-Block (Zeile 1838-1866) den Button-Bereich ersetzen:

```tsx
            {/* In DB speichern */}
            <div style={{ background: "#fff", borderRadius: 20, padding: 24, boxShadow: "0 2px 16px rgba(0,0,0,0.07)", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "#0F172A", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Save size={18} color="#C9A227" />
                </div>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#0F172A" }}>In DB speichern</span>
                {saveResult?.id && <span style={{ fontSize: 12, color: "#15803D", fontWeight: 600 }}>✓ Gespeichert (ID: {saveResult.id})</span>}
              </div>

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
                        {matchedSupplier && <> Lieferant „{matchedSupplier.shopName}" ist aktuell: <strong>{matchedSupplier.complianceStatus}</strong>.</>}
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

- [ ] **Step 6: Frontend-Typecheck**

Run: `cd packages/web && bunx tsc --noEmit -p tsconfig.app.json 2>&1 | wc -l`
Expected: `23` (unveränderte Baseline).

- [ ] **Step 7: Backend-Typecheck**

Run: `cd packages/web && bun run typecheck:server`
Expected: keine Fehler (keine Backend-Datei geändert, reine Kontrollprüfung).

- [ ] **Step 8: Live-Browser-Test — alle drei Szenarien**

Mit temporären Test-Login-Credentials (wie in Schritt 1) lokalen Dev-Server starten, einloggen, Lieferanten-Tab öffnen:

1. Einen der 3 vorhandenen Test-Lieferanten (`complianceStatus: ungeprueft`) im UI unverändert lassen. Manueller Import mit Titel „Kinderspielzeug Bauklötze" (trifft `spielzeug`-Keywords) → Button muss „Blockiert — Lieferant nicht geprüft" zeigen, `handleSave` darf keinen Request auslösen.
2. Denselben Lieferanten per Editor auf `geprueft` setzen (PATCH-Route aus Schritt 1) → **falls über URL-Scrape mit passendem `seller`-Namen importiert** läuft der Import normal durch. Für den manuellen Modus (kein `seller`) bleibt der Block bestehen (siehe Design-Entscheidung oben) — das ist erwartetes Verhalten, nicht zu verwechseln mit einem Bug.
3. Test-Import mit Titel ohne Keyword-Treffer (z.B. „Deko-Kissenbezug 40x40") → Button ist normal aktiv, unabhängig vom Lieferanten-Status.

Nach dem Test: keine echten Produkte in der Produktions-DB anlegen — Test nur bis zum Beobachten des Button-Zustands durchführen, NICHT tatsächlich auf „In DB speichern" klicken für Szenario 2/3 (das würde einen echten Test-Produkt-Eintrag in der Produktions-DB erzeugen). Alternativ: falls doch geklickt, das Test-Produkt danach per `DELETE` wieder entfernen.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/web/pages/lieferanten.tsx
git commit -m "feat: Import-Gate für regulierte Produktgruppen im Lieferanten-Tab (P-66 Schritt 2)"
```
