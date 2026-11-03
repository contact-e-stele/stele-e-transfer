// OFFEN 021: Zentrale, in der App editierbare Vorlage für den "Retoure-Workflow kopieren"-Text
// (Bestellungen-Tab und Retouren-Tab). Gleiches Muster wie P-94 (shared/workflow-template.ts):
// gespeichert in app_settings (Key "return_workflow_template", bestehende Key-Value-Tabelle, KEINE
// Migration), gelesen/geschrieben über GET/PUT /api/settings/return-workflow-template, gepflegt im
// Einstellungen-Tab (Abschnitt "Retoure-Workflow"). Diese Konstante ist nur der Startinhalt (Seed).
//
// FESTE REGEL bei jeder künftigen Aktualisierung (wie beim Bestell-Workflow): neue Version immer
// gegen die vorherige vergleichen, nur ergänzen/verbessern, niemals bestehende Punkte löschen.
//
// Nur lesen + Zwischenablage: diese Datei löst keine eBay-/AliExpress-Aktion aus.

/** Startinhalt (wörtlich aus der Vorgabe teilA.md, OFFEN 021). */
export const DEFAULT_RETURN_WORKFLOW_TEMPLATE = `# Retoure-Workflow — stele-e-transfer
Eine Retoure = dieser eine Chat. Erzeugt {{jetzt}}.

## Fall (aus der App, im Browser gegenprüfen)
- Rücksendung Nr: {{returnId}} · eBay-Bestellung: {{orderId}}
- Käufer: {{buyerUsername}} ({{buyerName}}) · Grund laut eBay: {{reason}}
- Artikel: {{items}} (SKU {{sku}}) · Menge {{qty}}
- Gefordert: {{amount}} € · eBay-Frist: {{deadline}}
- AliExpress-Bestellnr (aus Notiz): {{aliOrderId}} · Einkauf: {{buyPrice}} € · Hin-Sendung: {{tracking}} ({{carrier}})
- Links: eBay-Rückgabe https://www.ebay.de/rt/ReturnDetails?returnId={{returnId}} · eBay-Bestellung https://www.ebay.de/mesh/ord/details?orderid={{orderId}} · AliExpress https://www.aliexpress.com/p/order/detail.html?orderId={{aliOrderId}}

## Rolle und Regeln
Du bist Agent 8 Retoure. Lies zuerst: 00 GESETZBUCH (höchste Nummer), WORKFLOW Retoure (höchste GÜLTIG-Version), RETOURE-Dokumente zu {{returnId}} im Fehlerarchiv. Alles nur aus eBay/AliExpress im Browser, nie aus Mails (G3, Gesetz 50 L8).
GELD = INHABER: Erstattung, Teilerstattung, Etikett kaufen, Bezahlen klickt nur der Inhaber.
NIE: AliExpress "Empfang bestätigen" (Gesetz 54) · eBay "Rückerstattung senden/anbieten" vor Schritt 8 · "Bin daran interessiert" (Teilerstattung) · "eBay-Etikett bereitstellen" (kostet) · AliExpress-Knopf "Rückgabe/Auszahlung" bei schon laufender Rückgabe (öffnet neuen Antrag).
Jede Anweisung an den Inhaber: Ort · Klickweg · "NICHT klicken: …". Der Inhaber schickt je Schritt einen Screenshot, du antwortest mit genau dem nächsten Schritt.
Nach jedem Schritt: Dokument "RETOURE {{returnId}} STAND <Datum Uhrzeit>" im Fehlerarchiv (ausführlich). An den Inhaber nur: STATUS · BERICHT kurz · DU MUSST.

## Ablauf (Haken setzen)
[ ] 1 PRÜFEN (Agent)
   1a eBay-Rückgabe: Grund, Kommentar, Fotos, Frist, Menge, Betrag. Zugestellt am / Antrag am → "Tage Zustellung → Antrag: X" (H5).
   1b ALLE Käufernachrichten lesen (Posteingang, Gesendet, Rückgabe-Verlauf) → Wunsch wörtlich: Erstattung / Austausch / Teilerstattung / unklar.
   1c Bestellung: eBay-Einnahmen (Bestelleinnahmen), Notiz, App, AliExpress-Bestellung (Kasse, Status, Lieferant, Choice ja/nein, Paketdienst der Hin-Sendung).
   1d AliExpress-Bewertungen des Artikels: Einzelfall oder Serienfehler. Gleiche Ware schon zurückgekommen? (Beobachter-Befund)
   1e Fall-Ordner unter RETOUREN anlegen: "R{{returnId}} – {{orderId}} – <Artikel> {{sku}}"; Käuferfotos rein.
   1f Rechnung je Option (Euro): Erstattung voll = Bestelleinnahmen zurück (eBay schreibt Gebühren gut) − AliExpress-Erstattung (kleinerer Wert aus Schätzung und Kasse, V7). Belegt 02.11.: voll + voll = 0 €.
   1g Vorlage an Inhaber: Option + Empfehlung (Kunde ist König bis 25 €: K1–K3; über 25 € einzeln K4; Zweifel K6).
[ ] 2 ALIEXPRESS-ANTRAG (Inhaber klickt nach Klickliste)
   Genau EIN Grund im AliExpress-Wortlaut (v2.1 E3): eBay "Passt nicht" → "Die Größe passt mir nicht" ohne Unterpunkt · "Nicht mehr benötigt"/Widerruf → "Nicht mehr benötigt/Widerruf" (Seite Widerrufserklärung, "Confirm withdrawal") · Mangel nur mit Käuferbeleg + 2 Fotos.
   Rücksendung über DENSELBEN Paketdienst wie die Hin-Sendung, "Kein Drucker erforderlich", Erstattung "Ursprüngliche Rückerstattung".
   Teilerstattungs-Angebot: "Nein, danke" (fehlt der Knopf: ignorieren). Geschätzten Rückerstattungsbetrag notieren.
[ ] 3 QR HOLEN (Agent)
   Nach 15 Min., 30 Min., dann halbstündlich. Nur über den Hinweis "Scannen Sie den QR-Code und starten Sie die Rückgabe vor <Datum>". QR-Bild "{{returnId}}_QR.png" in den Fall-Ordner und an den Inhaber. AliExpress-Rückgabefrist notieren.
   Nach 2 Std. kein QR / eBay-Frist heute-morgen / Käufer wartet → Zwischennachricht (Vorlage m).
[ ] 4 EBAY-ETIKETT (Inhaber klickt)
   eBay-Rückgabe → "Rückgabe akzeptieren" → "Etikett hochladen" → QR-Bild → Feld Sendungsnummer leeren, nur Nummer: Hermes "H"+19 Ziffern · DHL 20 Ziffern ab 00340434 (zwischen "RON|" und "|") → Versanddienst Hermes bzw. "DHL" → Weiter. Ergebnis "Wir haben es an den Käufer gesendet".
[ ] 5 KÄUFERNACHRICHT (Agent schreibt, Inhaber sendet bzw. "ja")
   EINE Nachricht mit QR-Bild (Vorlage g3): 1 sicher verpacken, alte Etiketten weg · 2 QR im <Paketdienst>-Shop vorzeigen, "auch in Ihrer eBay-Rückgabe" · 3 nächster Shop mit Adresse/Öffnungszeiten (Google Maps), Abgabe bis AliExpress-Frist minus 1 Tag · 4 Erstattung "nach Eingang der Rücksendung" (siehe C1). Erinnerung (Vorlage h) 3 Tage vor Abgabefrist.
[ ] 6 ABGABE VERFOLGEN (Agent, täglich)
   Sendungsverfolgung Rück-Sendung + AliExpress-Status. Ins STAND: abgegeben am, unterwegs, zugestellt beim Lieferanten.
[ ] 7 ALIEXPRESS-ERSTATTUNG (Agent prüft)
   AliExpress-Bestellung: "Erweiterte Rückerstattung abgeschlossen <Betrag>" bzw. Rückerstattungen-Liste. Betrag mit Schätzung vergleichen (E10). Inhaber bestätigt Kontoeingang.
[ ] 8 EBAY-ERSTATTUNG (Inhaber klickt) – erst wenn 7 erledigt (Gesetz 66)
   eBay-Rückgabe → "Rückerstattung starten" → Betrag prüfen, Abzug 0 → Weiter → "Jetzt rückerstatten". NICHT "Als erhalten markieren", Zahlungsmethode nicht ändern.
   Frist-Notbremse: Ist 7 zwei Tage vor eBay-Frist "Rückerstattung veranlassen bis …" nicht erledigt → Inhaber entscheidet (erstatten oder warten).
[ ] 9 ABSCHLUSS (Agent)
   Screenshot "Rückerstattung eingeleitet" in den Fall-Ordner. Bilanz: Bestelleinnahmen − Rückzahlung + AliExpress-Erstattung − Einkauf. Buchung: AliExpress-Erstattung gegen Wareneingang SKR04 5200, eBay-Erstattung SKR04 4700 (Erlösschmälerung) – Finom-Blöcke "#Ali{{aliOrderId}}" "#Ebay{{orderId}}".
   Keine AliExpress-Lieferantenbewertung für diese Bestellung (Gesetz 63). Rückgabe "geschlossen" bei eBay nachprüfen.
   "RETOURE {{returnId}} FERTIG" mit Bilanz, Tagen (H5), Lernpunkt. Fotos nach 90 Tagen löschen (Inhaber).

## Antwortform
Ein Block: STATUS · BERICHT (kurz) · DU MUSST (nummeriert, mit Ort + Klickweg + NICHT klicken). Käufertexte und Klicklisten je in eigenem Kopier-Block.
`;

/** Ersatztext für jeden Platzhalter ohne Wert — nichts erfinden, sondern nachsehen lassen. */
export const RETURN_FALLBACK = '— in eBay/AliExpress nachsehen';

/** Erste Zeile, wenn die Rückgabe laut eBay schon erstattet/geschlossen ist (Duplikat-Schutz). */
export const RETURN_CLOSED_WARNING = '⚠️ Rückgabe bereits erstattet/geschlossen – prüfen';

/** Felder einer eBay-Rückgabe (Teilmenge von EbayReturn aus api/ebay.ts, GET /api/ebay/returns). */
export interface ReturnWorkflowReturn {
  returnId: string;
  orderId: string;
  buyerName?: string | null;   // eBay liefert hier den Käufer-Login (buyerLoginName)
  reason?: string | null;
  status?: string | null;      // OPEN | IN_PROGRESS | CLOSED | REFUNDED
  createdAt?: string | null;
  amount?: number | null;
  currency?: string | null;
  itemTitle?: string | null;
  quantity?: number | null;    // Rückgabemenge laut eBay, falls geliefert
  deadline?: string | null;    // eBay-Frist (ISO), nur falls eBay sie liefert
}

/** Felder einer Bestellung (Teilmenge des Order-Typs im Bestellungen-Tab, GET /api/ebay/orders). */
export interface ReturnWorkflowOrder {
  orderId: string;
  buyerUsername?: string | null;
  shippingAddress?: { fullName?: string | null } | null;
  lineItems?: ReadonlyArray<{ title: string; sku: string | null; quantity: number }> | null;
  nettoEinkauf?: number | null;
  localNote?: {
    aliexpressOrderId?: string | null;
    trackingNumber?: string | null;
    carrier?: string | null;
    manualBuyPrice?: number | null;
  } | null;
}

/** Betrag deutsch: 19.95 → "19,95"; null/NaN → null. */
export function formatEuroDe(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return n.toFixed(2).replace('.', ',');
}

function fmtDateTimeDe(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Rückgabe gilt als erledigt, wenn eBay CLOSED oder REFUNDED meldet. */
export function isReturnClosed(status: string | null | undefined): boolean {
  const s = (status ?? '').toUpperCase();
  return s === 'CLOSED' || s === 'REFUNDED';
}

/** Zu einer Bestellung genau ihre Rückgaben (eine Bestellung kann mehrere haben; doppelte returnIds nur einmal). */
export function returnsForOrder<R extends { returnId?: string | null; orderId?: string | null }>(
  orderId: string | null | undefined,
  returns: ReadonlyArray<R>,
): R[] {
  const o = (orderId ?? '').trim();
  if (!o) return [];
  const seen = new Set<string>();
  const out: R[] = [];
  for (const r of returns) {
    const id = (r.returnId ?? '').trim();
    if (!id || (r.orderId ?? '').trim() !== o || seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

const txt = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t ? t : null;
};

/** Platzhalter-Werte (null = unbekannt → beim Einsetzen RETURN_FALLBACK). */
export function returnWorkflowValues(
  order: ReturnWorkflowOrder | null | undefined,
  ret: ReturnWorkflowReturn,
  now: Date = new Date(),
): Record<string, string | null> {
  const all = order?.lineItems ?? [];
  // Artikel der Rückgabe: passt der eBay-Artikeltitel genau zu einer Position, nur diese; sonst alle Positionen.
  const wanted = (ret.itemTitle ?? '').trim();
  const matched = wanted ? all.filter(li => li.title.trim() === wanted) : [];
  const items = matched.length > 0 ? matched : all;
  const titles = items.map(li => li.title.trim()).filter(Boolean);
  const skus = items.map(li => (li.sku ?? '').trim()).filter(Boolean);
  const qtyOrder = items.reduce((s, li) => s + (li.quantity || 0), 0);
  const qty = ret.quantity != null && ret.quantity > 0 ? ret.quantity : (qtyOrder > 0 ? qtyOrder : null);
  const buy = order?.nettoEinkauf ?? order?.localNote?.manualBuyPrice ?? null;
  return {
    jetzt: fmtDateTimeDe(now),
    returnId: txt(ret.returnId),
    orderId: txt(ret.orderId) ?? txt(order?.orderId),
    buyerUsername: txt(order?.buyerUsername) ?? txt(ret.buyerName),
    buyerName: txt(order?.shippingAddress?.fullName),
    reason: txt(ret.reason),
    items: titles.length > 0 ? titles.join(' + ') : txt(ret.itemTitle),
    sku: skus.length > 0 ? skus.join(', ') : null,
    qty: qty != null ? String(qty) : null,
    amount: ret.amount != null && ret.amount > 0 ? formatEuroDe(ret.amount) : null,
    deadline: fmtDateTimeDe(ret.deadline),
    aliOrderId: txt(order?.localNote?.aliexpressOrderId),
    buyPrice: formatEuroDe(buy),
    tracking: txt(order?.localNote?.trackingNumber),
    carrier: txt(order?.localNote?.carrier),
  };
}

/** Ersetzt {{name}} durch den Wert; bekannte Platzhalter ohne Wert → RETURN_FALLBACK; unbekannte bleiben stehen. */
export function renderReturnWorkflowTemplate(template: string, values: Record<string, string | null>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? (values[key] ?? RETURN_FALLBACK) : whole);
}

/** Fertiger Text für "Retoure-Workflow kopieren" (je Rückgabe ein eigener Text). */
export function buildReturnWorkflowText(
  order: ReturnWorkflowOrder | null | undefined,
  ret: ReturnWorkflowReturn,
  template: string = DEFAULT_RETURN_WORKFLOW_TEMPLATE,
  now: Date = new Date(),
): string {
  const body = renderReturnWorkflowTemplate(template, returnWorkflowValues(order, ret, now));
  return isReturnClosed(ret.status) ? `${RETURN_CLOSED_WARNING}\n\n${body}` : body;
}

/** Je Bestellung die Liste {returnId, text} — eine Bestellung mit zwei Rückgaben ergibt zwei Knöpfe/Texte. */
export function returnWorkflowTextsForOrder(
  order: ReturnWorkflowOrder,
  returns: ReadonlyArray<ReturnWorkflowReturn>,
  template: string = DEFAULT_RETURN_WORKFLOW_TEMPLATE,
  now: Date = new Date(),
): Array<{ returnId: string; text: string }> {
  return returnsForOrder(order.orderId, returns).map(r => ({ returnId: r.returnId, text: buildReturnWorkflowText(order, r, template, now) }));
}
