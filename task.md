# Stele App — Overnight Improvements

## Status: IN PROGRESS
Last git: 63b986d

## TODO

### DONE ✅
- Varianten-Tabelle in HTML (Dark+Light)
- attrLabel Fallback 
- eBay-Preise beim Save mitschicken
- Gewinn-Spalte in Produkte-Tab
- Duplicate border key fix
- Dashboard Gewinn-Karte
- Suche→Lieferanten Auto-Import

### IN PROGRESS 🔄
1. Price Monitor: eBay-Preis nach Preisänderung automatisch über API updaten
2. Lieferanten-Tab: Verbesserungen (shipsFrom Badge, GPSR auto-populate)
3. Produkte-Tab: "eBay Listing öffnen" Button + bessere Übersicht
4. Dashboard: Gesamtgewinn aller gelisteten Produkte

## KEY FILES
- /home/user/stele-app/packages/web/src/api/price-monitor.ts
- /home/user/stele-app/packages/web/src/web/pages/lieferanten.tsx
- /home/user/stele-app/packages/web/src/web/pages/produkte.tsx
- /home/user/stele-app/packages/web/src/web/pages/dashboard.tsx
- /home/user/stele-app/packages/web/src/api/index.ts

## DECISIONS
- eBay API: ReviseInventoryStatus (Trading API) für Preisupdate
- adRate: aus localStorage gespeichert (5% default)
- Gewinn-Formel: eBay - eBay*(13+adRate)%*1.19 - 0.45*1.19 - buyPrice
