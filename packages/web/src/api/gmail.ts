/**
 * Gmail-Anbindung (P-84) — liest AliExpress-Logistik-Update-Mails, um Sendungsnummer +
 * Lieferadresse zu extrahieren. OAuth2 (Web-Anwendung) exakt nach dem Muster von drive.ts,
 * eigener Refresh-Token in app_settings (DB) — unabhängig von der Drive-Verbindung.
 *
 * WICHTIG: liefert nur VORSCHLÄGE. Kein automatisches Speichern/Übermitteln — das bleibt
 * bewusst beim Menschen (siehe /gmail/tracking-suggestions in index.ts + bestellungen.tsx).
 */
import { eq } from 'drizzle-orm';
import { isAliInternalLogisticsId } from './aliexpress-api';

const CLIENT_ID = process.env.GOOGLE_GMAIL_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_GMAIL_CLIENT_SECRET ?? '';
const REDIRECT_URI = process.env.GOOGLE_GMAIL_REDIRECT_URI ?? 'https://stele-e-transfer.onrender.com/api/gmail/callback';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ─── OAuth: Autorisierungs-URL ─────────────────────────────────────────────────
export function getGmailOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',   // wichtig: liefert einen refresh_token
    prompt: 'consent',        // erzwingt erneuten Consent -> garantiert refresh_token bei jedem Connect
    scope: 'https://www.googleapis.com/auth/gmail.readonly',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// Authorization Code → Access + Refresh Token
async function exchangeGmailCodeForToken(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gmail token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

// ─── Token-Speicherung (DB, wie Drive/AliExpress) ─────────────────────────────
async function saveGmailTokens(accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const now = new Date().toISOString();
  const expiresAt = Date.now() + expiresIn * 1000;
  await db.insert(appSettings).values({ key: 'gmail_access_token', value: accessToken, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: accessToken, updatedAt: now } });
  await db.insert(appSettings).values({ key: 'gmail_refresh_token', value: refreshToken, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: refreshToken, updatedAt: now } });
  await db.insert(appSettings).values({ key: 'gmail_token_expires', value: String(expiresAt), updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(expiresAt), updatedAt: now } });
}

export async function handleGmailCallback(code: string): Promise<void> {
  const tokens = await exchangeGmailCodeForToken(code);
  await saveGmailTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
}

// ─── Gueltigen Access-Token holen (auto-refresh bei Bedarf) ────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getGmailAccessToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const refreshRow = await db.select().from(appSettings).where(eq(appSettings.key, 'gmail_refresh_token')).get();
  if (!refreshRow?.value) return null; // noch nicht verbunden

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshRow.value,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    console.error('[Gmail] Token-Refresh fehlgeschlagen:', res.status, await res.text());
    return null;
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

export async function isGmailConnected(): Promise<boolean> {
  const token = await getGmailAccessToken();
  return !!token;
}

// ─── AliExpress-Logistik-Mail parsen ───────────────────────────────────────────
// Struktur laut echten Beispiel-Mails (P-84), Betreff:
//   "Packstück {Sendungsnummer} hat die Abflugregion verlassen"
// Body enthält u.a. (Klartext-Zeilen, Datenschutz-Platzhalter "Evgenij Stele" für den
// Kontoinhaber-Namen, aber Straße/Ort/Telefon sind die ECHTE Käufer-Lieferadresse):
//   Versand nach:
//   {Straße}, {Hausnummer}
//   {Ort}, {Bundesland}
//   Evgenij Stele ({Telefonnummer})
//
// P-106-Nachbesserung (Live-Fund 2026-09-03, Bestellung Hoffmann): AliExpress verschickt
// dieselben Mail-Typen je nach Bestellung auf DEUTSCH ODER ENGLISCH (Locale offenbar pro
// Bestellung verschieden, nicht pro Konto — bestätigt an zwei echten Fällen: Hoffmanns
// komplette Mail-Kette auf Englisch "Package X: left the departure region" / "Package X has
// been delivered" / Anschriftsblock "Ship to", Engels Kette auf Deutsch wie oben beschrieben).
// Bisher wurden NUR die deutschen Formulierungen erkannt — die englischen Mails wurden von
// Betreff-Regex UND Adress-Anker ("Versand nach:") komplett verpasst, mit echtem Produktiv-HTML
// verifiziert (parseDeliveryEmail() lieferte null für Hoffmanns echte "has been delivered"-Mail).
// Jetzt beide Sprachvarianten unterstützt, sowohl bei den Regex als auch beim serverseitigen
// Gmail-Suchbegriff (siehe searchAndParseEmails() unten).
export interface TrackingEmailMatch {
  trackingNumber: string;
  street: string;       // "Straße, Hausnummer" — unnormalisiert, wie in der Mail
  city: string;          // nur der Ort-Teil (vor dem Komma), ohne Bundesland
  postalCode: string | null; // nur gesetzt falls die Ort-Zeile mit einer 5-stelligen PLZ beginnt
  phone: string | null;
  emailDate: string;
}

// Gemeinsamer Block, der in beiden AliExpress-Logistik-Mail-Typen (P-84 "Abflugregion
// verlassen" UND P-85 "wurde zugestellt") identisch vorkommt:
//   Versand nach:
//   {Straße}, {Hausnummer}
//   {Ort}, {Bundesland}
//   Evgenij Stele ({Telefonnummer})
function parseVersandNachBlock(bodyText: string): { street: string; city: string; postalCode: string | null; phone: string | null } | null {
  const lines = bodyText.split(/\r?\n/).map(l => l.trim());
  const anchorIdx = lines.findIndex(l => /^(versand nach|ship to):?$/i.test(l));
  if (anchorIdx === -1) return null;
  const nextLines = lines.slice(anchorIdx + 1).filter(l => l.length > 0).slice(0, 3);
  if (nextLines.length < 3) return null;
  const [streetLine, cityLine, nameLine] = nextLines;

  const cityParts = cityLine.split(',').map(s => s.trim());
  const plzMatch = cityParts[0]?.match(/^(\d{5})\s+(.+)$/);
  const postalCode = plzMatch ? plzMatch[1] : null;
  const city = plzMatch ? plzMatch[2] : (cityParts[0] ?? '');

  const phoneMatch = nameLine.match(/\(([^)]+)\)/);
  const phone = phoneMatch ? phoneMatch[1].trim() : null;

  if (!streetLine || !city) return null;
  return { street: streetLine, city, postalCode, phone };
}

export function parseTrackingEmail(subject: string, bodyText: string): TrackingEmailMatch | null {
  const subjectMatch =
    subject.match(/Packstück\s+(\S+)\s+hat die Abflugregion verlassen/i) ??
    subject.match(/Package\s+([^\s:]+):?\s*(?:has\s+)?left the departure\s+(?:region|country)/i);
  if (!subjectMatch) return null;
  const address = parseVersandNachBlock(bodyText);
  if (!address) return null;
  return { trackingNumber: subjectMatch[1], ...address, emailDate: '' };
}

// ─── P-85/P-96: Zustellbestätigungs-Mail parsen ───────────────────────────────
// P-96: eBay liefert keinen abfragbaren Zustellstatus per API (recherchiert — Sell Fulfillment
// API kennt nur, was wir selbst als Tracking eintragen; ein echter "DELIVERED"-Status existiert
// nur in der Post-Order-Return-API für Käufer-RÜCKSENDUNGEN, nicht für die ursprüngliche
// Lieferung). Einzige verfügbare Quelle bleibt die AliExpress-Mail — aber die bisherige Regex
// verlangte exakt die Wortfolge "wurde zugestellt" im Betreff, was echte Zustellungen verpasst
// hat, wenn AliExpress abweichend formuliert (z.B. "wurde erfolgreich zugestellt", "ist
// zugestellt worden"). Jetzt breiter: "Paket X" gefolgt von "zugestellt" irgendwo in den
// nächsten ~40 Zeichen — weiterhin AUSGESCHLOSSEN bleibt die Vorstufe "wird ... zugestellt"
// (noch nicht final), die separat geprüft wird.
export interface DeliveryEmailMatch {
  trackingNumber: string;
  street: string;
  city: string;
  postalCode: string | null;
  phone: string | null;
  emailDate: string;
}

export function parseDeliveryEmail(subject: string, bodyText: string): DeliveryEmailMatch | null {
  if (/\bwird\b[^.\n]{0,40}?\bzugestellt\b/i.test(subject)) return null; // "wird (X) zugestellt" = noch nicht final
  if (/\bis out for delivery\b/i.test(subject)) return null; // EN-Vorstufe, analog "wird zugestellt"
  const subjectMatch =
    subject.match(/Paket\s+(\S+)[^.\n]{0,40}?\bzugestellt\b/i) ??
    subject.match(/Package\s+([^\s:]+)[^.\n]{0,40}?\bdelivered\b/i);
  if (!subjectMatch) return null;
  const address = parseVersandNachBlock(bodyText);
  if (!address) return null;
  return { trackingNumber: subjectMatch[1], ...address, emailDate: '' };
}

// ─── P2 Teil 2 (2026-09-14): Paket-Status-Mail parsen — Zusteller-Nummer + AliExpress-Bestellnr. ──
// Grund (s. PR #102, Korrektur): die AliExpress-API liefert unter logistics_no nur AliExpress'
// EIGENE interne Sendungs-ID (Präfix "AP"), nicht die echte DHL-Nummer. Die DHL-Nummer kommt aber
// per Mail — Betreff-Muster laut Auftrag (mehrere Status-Varianten, gemeinsamer Präfix "Package
// <Nummer>"): "Package 00340434886289512140: at customs", "... has cleared customs",
// "... in your country/region". ANDERS als parseTrackingEmail()/parseDeliveryEmail() oben matcht
// dieser Parser NICHT auf einen festen Status-Suffix, sondern auf JEDEN "Package <Nummer>"-Betreff
// dieses Absenders — die konkrete Statusphrase ist für die Nummer irrelevant.
//
// P2-Teil-2-Nachbesserung (2026-09-14, Live-Fund im echten Postfach): AliExpress verschickt diese
// Serie je nach Bestellung/Sprache in STARK unterschiedlichem Wortlaut, deutsch UND englisch —
// "Package <Nummer>" traf nur die englischen Varianten, alle acht echten Mails zur Bestellung
// 3075188992327211 waren deutsch und wurden dadurch übersehen. Belegte echte Betreffzeilen:
//   "Paket 00340434886283998797 wurde zugestellt"
//   "Packstück 00340434886283998797: mit lokalem Kurier"
//   "Packstück 00340434886283998797: beim Zoll"
//   "Zollabfertigung für 00340434886283998797 wurde beendet"
//   "Package 00340434886289512140 has cleared customs"
//   "Package 00340434886289512140: at customs"
// Der Parser matcht deshalb NICHT mehr auf ein einleitendes Wort — er zieht jede zusammenhängende
// Ziffernfolge ab 10 Stellen aus dem Betreff und filtert sie über looksLikeCarrierTrackingNumber()/
// isAliInternalLogisticsId(). Das einleitende Wort (Package/Paket/Packstück/"Zollabfertigung für"/…)
// spielt dadurch keine Rolle mehr. Einziger verbleibender Filter: der Absender
// (transaction@notice.aliexpress.com, s. searchRecentPackageStatusEmails() unten) — ein
// Betreff-Suchbegriff entfällt bewusst, weil kein gemeinsames Wort mehr über alle Sprachvarianten
// hinweg existiert.
//
// Die AliExpress-Bestellnr. steckt NICHT im Betreff, sondern im Query-Parameter `o_ids=` der
// Tracking-Links im Mail-Body — und zwar NUR im rohen HTML (der Aufrufer MUSS findRawHtmlBody()
// übergeben, nicht den Klartext-/gestrippten Body wie bei den beiden Parsern oben): beim Umwandeln
// von HTML zu Klartext (findHtmlBodyAsText()/htmlToPlainText()) werden Attribut-Query-Parameter
// mitten in einem <a href="...">-Tag zerstört, bevor eine Regex sie noch sehen könnte.
export interface PackageStatusEmailMatch {
  trackingNumber: string;
  aliexpressOrderId: string;
  emailDate: string;
}

// Plausibilitäts-Check (Auftrag Aufgabe 2, zusätzlich zu isAliInternalLogisticsId()): eine echte
// Zusteller-Nummer ist rein numerisch und deutlich länger als eine typische Produkt-/Bestell-ID
// (beide bisher bekannten echten DHL-Nummern: 20 Ziffern) — 10 als konservative Untergrenze
// gewählt, um auch kürzere Zusteller-Nummer-Formate anderer Fälle nicht von vornherein
// auszuschließen, ohne offensichtlich zu kurze/unplausible Treffer (z.B. Bruchstücke) zuzulassen.
export function looksLikeCarrierTrackingNumber(no: string): boolean {
  return /^\d{10,}$/.test(no.trim());
}

export function parsePackageStatusEmail(subject: string, rawHtmlBody: string): PackageStatusEmailMatch | null {
  // Jede zusammenhängende Ziffernfolge ab 10 Stellen im Betreff als Kandidat — wortlautunabhängig
  // (s. Kommentar oben). Der erste Kandidat, der beide Plausibilitäts-Checks besteht, gewinnt; in
  // allen sechs echten Beispiel-Betreffzeilen steht ohnehin nur eine einzige Ziffernfolge.
  //
  // Hinweis zu isAliInternalLogisticsId() hier: eine reine \d{10,}-Ziffernfolge kann NIE das
  // AP-Präfix enthalten (isAliInternalLogisticsId prüft /^AP\d+$/i, \d matcht keine Buchstaben) —
  // der Aufruf ist für DIESE Extraktionsart also strukturell ein No-op. Trotzdem bewusst
  // beibehalten (Auftrag verlangt es ausdrücklich, Grundgesetz Regel 8: dieselbe Quelle wie in
  // PR #102 statt einer zweiten Prüfung) und als Absicherung, falls die Extraktion künftig auf
  // ganze Wörter statt reiner Ziffernfolgen umgestellt wird.
  const digitCandidates = subject.match(/\d{10,}/g) ?? [];
  const trackingNumber = digitCandidates.find(no => looksLikeCarrierTrackingNumber(no) && !isAliInternalLogisticsId(no));
  if (!trackingNumber) return null;

  // Live-Fund beim ersten echten Testlauf (Grundgesetz Regel 1): HTML-Mails kodieren das "&"
  // zwischen Query-Parametern in href-Attributen standardmäßig als Entity "&amp;", nicht als
  // rohes "&" — ein reines `[?&]o_ids=` verfehlte den Parameter deshalb komplett (0 Treffer in
  // einer realistischen Fixture). Jetzt wird das optionale "amp;" mit abgedeckt.
  const orderIdMatch = rawHtmlBody.match(/[?&](?:amp;)?o_ids=(\d+)/i);
  if (!orderIdMatch) return null;

  return { trackingNumber, aliexpressOrderId: orderIdMatch[1], emailDate: '' };
}

// ─── Base64url-MIME-Payload → Klartext ────────────────────────────────────────
interface GmailMessagePart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePart[];
}

function findPlainTextBody(part: GmailMessagePart): string | null {
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }
  for (const sub of part.parts ?? []) {
    const found = findPlainTextBody(sub);
    if (found) return found;
  }
  return null;
}

// P2 Teil 2 (2026-09-14): der ROHE HTML-Body, UNVERÄNDERT — wird für die o_ids=-Extraktion aus den
// Tracking-Links gebraucht (s. parsePackageStatusEmail() unten). Der bisherige "grobe
// HTML-Bereinigung"-Fallback (Klartext aus HTML, falls keine text/plain-Variante existiert) baut
// jetzt auf DIESER Rohfassung auf (s. htmlToPlainText() unten) — Tag-Entfernung würde
// Query-Parameter zerstören, die mitten in einem <a href="...">-Attribut stehen (bestätigt am
// Auftrag: "im geprüften Beispiel" wird der Parameter beim Umwandeln in Klartext zerstört),
// deshalb bekommt der o_ids-Parser explizit die rohe, ungestrippte Fassung.
function findRawHtmlBody(part: GmailMessagePart): string | null {
  if (part.mimeType === 'text/html' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf8');
  }
  for (const sub of part.parts ?? []) {
    const found = findRawHtmlBody(sub);
    if (found) return found;
  }
  return null;
}

interface FetchedGmailMessage {
  subject: string;
  plainText: string | null;
  rawHtml: string | null;
  internalDate: string | null;
}

// ─── Gmail durchsuchen + rohe Nachrichten (Betreff, Klartext-Body, roher HTML-Body) liefern ────
// Gemeinsame Grundlage für ALLE drei AliExpress-Logistik-Mail-Typen (P-84 Abflug, P-85 Zustellung,
// P2-Teil-2 Paket-Status/o_ids) — reiner Fetch+Parse-Auftrenn-Schritt, unterscheiden sich nur in
// Suchbegriff und dem, was sie mit plainText/rawHtml jeweils anfangen (Grundgesetz Regel 8: die
// Gmail-List-/Fetch-/Pagination-Logik existiert dadurch nur einmal).
// P2-Teil-2-Nachbesserung (2026-09-14, Live-Fund in der Render-Shell): eine echte, im Postfach
// nachweislich vorhandene Mail (04.08.2026, innerhalb des 90-Tage-Fensters) fehlte im Ergebnis —
// der echte Lauf lieferte nur 26 Treffer, ältester davon 04.09.2026. Ursache: Gmail's
// `messages.list` GARANTIERT NICHT, dass eine Antwort bis zu `maxResults` Treffer enthält, auch
// wenn mehr verfügbar sind — sie kann früher abschneiden und stattdessen ein `nextPageToken`
// zurückgeben, das man verfolgen MUSS, um an die übrigen (typischerweise älteren) Treffer zu
// kommen (dokumentiertes Verhalten der Gmail API, keine Bun/Fetch-Eigenheit). Ohne Pagination
// wurde dieses Token bisher ignoriert — das 90-Tage-Fenster war im `q`-Parameter korrekt gesetzt,
// griff aber nie, weil die Ergebnisliste vorher (serverseitig) abgeschnitten wurde.
const GMAIL_LIST_PAGE_SIZE = 50;
// Obergrenze gegen einen Endlos-/Runaway-Lauf, falls Gmail z.B. dauerhaft ein nextPageToken
// zurückgibt — 20 Seiten × 50 = bis zu 1000 Treffer, weit über dem bisher beobachteten Bereich
// (26 Treffer/90 Tage) und großzügig genug für absehbares Mail-Aufkommen dieses Absenders.
const GMAIL_LIST_MAX_PAGES = 20;

// Reine, DI-testbare Paginierungs-Schleife — extrahiert (statt inline in fetchAliexpressMessages()),
// damit der Terminierungs-/Akkumulations-Mechanismus (alle Seiten sammeln, bis kein nextPageToken
// mehr da ist ODER die Obergrenze erreicht ist) unabhängig von einem echten Gmail-Zugriff getestet
// werden kann (Grundgesetz Regel 2) — genau das war die Lücke, die den P2-Teil-2-Live-Fund
// verursacht hat.
export async function collectPaginatedIds(
  fetchPage: (pageToken: string | undefined) => Promise<{ ids: string[]; nextPageToken?: string }>,
  maxPages: number = GMAIL_LIST_MAX_PAGES
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let page = 0;
  do {
    const result = await fetchPage(pageToken);
    ids.push(...result.ids);
    pageToken = result.nextPageToken;
    page++;
  } while (pageToken && page < maxPages);
  return ids;
}

async function fetchAliexpressMessages(subjectQuery: string | undefined, days: number): Promise<FetchedGmailMessage[]> {
  const token = await getGmailAccessToken();
  if (!token) throw new Error('Gmail nicht verbunden');

  // subjectQuery === undefined (P2-Teil-2-Nachbesserung): kein Betreff-Filter — nötig für
  // searchRecentPackageStatusEmails(), weil kein gemeinsames Wort mehr über alle Sprachvarianten
  // hinweg existiert (s. parsePackageStatusEmail()-Kommentar). Absender bleibt der einzige Filter.
  const q = subjectQuery
    ? `from:transaction@notice.aliexpress.com subject:(${subjectQuery}) newer_than:${days}d`
    : `from:transaction@notice.aliexpress.com newer_than:${days}d`;

  const messageIds = await collectPaginatedIds(async (pageToken) => {
    const params = new URLSearchParams({ q, maxResults: String(GMAIL_LIST_PAGE_SIZE) });
    if (pageToken) params.set('pageToken', pageToken);
    const listRes = await fetch(`${GMAIL_API}/messages?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) {
      const text = await listRes.text();
      throw new Error(`Gmail-Suche fehlgeschlagen: ${listRes.status} ${text.slice(0, 300)}`);
    }
    const listData = await listRes.json() as { messages?: Array<{ id: string }>; nextPageToken?: string };
    return { ids: (listData.messages ?? []).map(m => m.id), nextPageToken: listData.nextPageToken };
  });

  const results: FetchedGmailMessage[] = [];

  for (const id of messageIds) {
    // NUR LESEND (P2 Teil 2, Auftrag): GET /messages/{id} liest die Mail, ändert nichts an ihr
    // (kein modify/trash-Aufruf irgendwo in diesem Modul) — Gmail markiert Nachrichten beim
    // reinen Lesen über die API NICHT automatisch als gelesen (anders als das Öffnen im Web-UI).
    const msgRes = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!msgRes.ok) continue; // einzelne Mail überspringen statt ganzen Lauf abzubrechen
    const msg = await msgRes.json() as {
      internalDate?: string;
      payload?: GmailMessagePart & { headers?: Array<{ name: string; value: string }> };
    };
    const subject = msg.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value ?? '';
    if (!msg.payload) continue;

    results.push({
      subject,
      plainText: findPlainTextBody(msg.payload),
      rawHtml: findRawHtmlBody(msg.payload),
      internalDate: msg.internalDate ?? null,
    });
  }

  return results;
}

// ─── Gmail durchsuchen + jede Treffer-Mail (Klartext bevorzugt) mit dem übergebenen Parser
// auswerten — unveränderte Fassung/Verhalten aus P-84/P-85, jetzt auf fetchAliexpressMessages()
// aufgesetzt statt die List-/Fetch-Logik ein zweites Mal zu bauen.
async function searchAndParseEmails<T extends { emailDate: string }>(
  subjectPhrases: string[],
  days: number,
  parser: (subject: string, bodyText: string) => T | null
): Promise<T[]> {
  // P-106: mehrere Sprachvarianten als OR-Gruppe (Gmail-Suchsyntax) — AliExpress verschickt je
  // nach Bestellung Deutsch oder Englisch, siehe Kommentar bei parseTrackingEmail() oben.
  const subjectQuery = subjectPhrases.map(p => (p.includes(' ') ? `"${p}"` : p)).join(' OR ');
  const messages = await fetchAliexpressMessages(subjectQuery, days);
  const results: T[] = [];

  for (const msg of messages) {
    const bodyText = msg.plainText ?? (msg.rawHtml ? htmlToPlainText(msg.rawHtml) : null);
    if (!bodyText) continue;

    const parsed = parser(msg.subject, bodyText);
    if (!parsed) continue;
    parsed.emailDate = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : '';
    results.push(parsed);
  }

  return results;
}

// Reine HTML→Text-Bereinigung, aus findHtmlBodyAsText() extrahiert (Regel 8: dieselbe Logik, jetzt
// auf dem bereits geladenen rawHtml, statt den MIME-Baum ein zweites Mal zu durchsuchen).
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// ─── Kürzlich eingegangene Logistik-Mails suchen + parsen ────────────────────
export async function searchRecentTrackingEmails(days = 14): Promise<TrackingEmailMatch[]> {
  return searchAndParseEmails(['Abflugregion verlassen', 'left the departure'], days, parseTrackingEmail);
}

// ─── P-85/P-96: Kürzlich eingegangene Zustellbestätigungen suchen + parsen ────
// P-96: Gmail-Suchbegriff von der exakten Phrase "wurde zugestellt" auf das einzelne Wort
// "zugestellt" verbreitert (holt serverseitig auch andere Formulierungen + die noch-nicht-
// zugestellt-Vorstufe "wird zugestellt" — Filterung übernimmt parseDeliveryEmail()). Zeitfenster
// von 14 auf 30 Tage erhöht, da Zustellungen bei Auslandsversand oft erst nach 2+ Wochen kommen.
export async function searchRecentDeliveryEmails(days = 30): Promise<DeliveryEmailMatch[]> {
  return searchAndParseEmails(['zugestellt', 'delivered'], days, parseDeliveryEmail);
}

// ─── P2 Teil 2: Paket-Status-Mails suchen + parsen (Zusteller-Nummer + Bestellnr.) ──────────────
// NICHT auf searchAndParseEmails() aufgesetzt — der übergibt Parsern den Klartext-Body (Plaintext
// bevorzugt, sonst HTML→Text-gestrippt), parsePackageStatusEmail() braucht aber zwingend den ROHEN
// HTML-Body für die o_ids=-Extraktion (s. Kommentar dort). Eigener, kurzer Loop auf
// fetchAliexpressMessages() (derselbe geteilte Gmail-List-/Fetch-Schritt wie oben, Regel 8).
//
// KEIN Betreff-Suchbegriff (P2-Teil-2-Nachbesserung, Live-Fund im echten Postfach): die
// Mail-Serie kommt deutsch UND englisch, mit stark unterschiedlichem Wortlaut ("Package X: at
// customs" / "Paket X wurde zugestellt" / "Packstück X: beim Zoll" / "Zollabfertigung für X
// wurde beendet" / …) — kein gemeinsames Wort existiert mehr über alle Varianten hinweg. Der
// ursprüngliche Suchbegriff "Package" (nur englisch) hätte alle acht echten Mails zur Bestellung
// 3075188992327211 (durchgehend deutsch) verpasst. Absender bleibt der einzige Gmail-seitige
// Filter — parsePackageStatusEmail() filtert danach per Ziffernfolge + Plausibilität + o_ids.
//
// Tage-Fenster bewusst NICHT auf 30 Tage begrenzt (Default-Parameter unten, 90 Tage) — Auftrag
// P2 Teil 2 Aufgabe 4: PR #102 hat eine echte Bestellung mit 41 Tagen ohne Sendungsnummer gezeigt,
// ein 30-Tage-Fenster hätte deren Zustellmail strukturell nie gefunden.
export async function searchRecentPackageStatusEmails(days = 90): Promise<PackageStatusEmailMatch[]> {
  const messages = await fetchAliexpressMessages(undefined, days);
  const results: PackageStatusEmailMatch[] = [];

  for (const msg of messages) {
    if (!msg.rawHtml) continue; // ohne rohen HTML-Body keine o_ids-Extraktion möglich
    const parsed = parsePackageStatusEmail(msg.subject, msg.rawHtml);
    if (!parsed) continue;
    parsed.emailDate = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : '';
    results.push(parsed);
  }

  return results;
}

// ─── Adressabgleich ────────────────────────────────────────────────────────────
// Reine, testbare Matching-Logik — getrennt von der DB-/eBay-Abfrage in index.ts.
export interface MatchableAddress {
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  phone: string | null;
}

const normalizeAddressText = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß\s]/g, '').replace(/\s+/g, ' ').trim();
const lastDigits = (s: string, n: number) => s.replace(/\D/g, '').slice(-n);

// true wenn Straße+Ort (Pflicht) und — falls beide Seiten eine Telefonnummer haben — auch
// die Telefonnummer übereinstimmt. Telefon ist nur eine ZUSÄTZLICHE Bestätigung, kein
// Ausschlusskriterium, wenn eine der beiden Seiten keine Nummer liefert.
// Nimmt sowohl TrackingEmailMatch (P-84) als auch DeliveryEmailMatch (P-85) an — beide
// haben dieselbe Adress-Form.
export function addressMatchesEmail(addr: MatchableAddress, email: { street: string; city: string; phone: string | null }): boolean {
  const emailStreetNorm = normalizeAddressText(email.street);
  const emailCityNorm = normalizeAddressText(email.city);
  const emailHouseNr = email.street.match(/\d+/)?.[0] ?? '';
  const emailPhoneTail = email.phone ? lastDigits(email.phone, 8) : null;

  const orderStreetNorm = normalizeAddressText(`${addr.addressLine1} ${addr.addressLine2 ?? ''}`);
  const orderCityNorm = normalizeAddressText(addr.city);

  const cityMatches = orderCityNorm === emailCityNorm;
  const houseNrMatches = emailHouseNr ? orderStreetNorm.includes(emailHouseNr) : true;
  const streetNameOnly = emailStreetNorm.replace(/\s*\d+\s*$/, '').trim();
  const orderStreetNameOnly = orderStreetNorm.replace(/\s*\d+\s*$/, '').trim();
  const streetMatches = houseNrMatches && (orderStreetNorm.includes(streetNameOnly) || emailStreetNorm.includes(orderStreetNameOnly));

  if (!cityMatches || !streetMatches) return false;
  if (emailPhoneTail && addr.phone) {
    return lastDigits(addr.phone, 8) === emailPhoneTail;
  }
  return true;
}

// P-84-Nachbesserung (Live-Fund 2026-09-03, Bestellungen Hoffmann/Engel): AliExpress liefert im
// "Ort"-Feld der Logistik-Mails bei kleineren Gemeinden manchmal den übergeordneten LANDKREIS
// statt der tatsächlichen Gemeinde (bestätigt an zwei echten Fällen: "Suedwestpfalz" statt
// "Eppenbrunn", "Vogelsbergkreis" statt "Alsfeld-Liederbach") — die strikte Ortsprüfung oben
// schlägt dann fehl, obwohl Straße+Hausnummer eindeutig übereinstimmen. Das führt NICHT zu einer
// falschen automatischen Zuordnung (addressMatchesEmail liefert dann einfach 0 Treffer, P-84s
// Sicherheitsprinzip greift), sondern dazu, dass der automatische Vorschlag komplett ausbleibt und
// stattdessen riskante manuelle Eingabe nötig wird — bei zwei nahezu identischen Bestellungen
// (hier: gleicher Artikel, nur andere Varianten-Packgröße) genau das Risiko, das zur
// Fehlzuordnung geführt hat. Bewusst NUR als Fallback gedacht (Straße+Hausnummer allein ist kein
// hinreichendes Kriterium, da Straßennamen sich wiederholen können) — an den Aufrufstellen erst
// genutzt, wenn addressMatchesEmail() 0 Treffer liefert, und auch dann nur übernommen, wenn genau
// EIN eindeutiger Treffer übrigbleibt (gleiches "0 oder mehrere → nichts vorschlagen"-Prinzip).
export function addressMatchesEmailByStreetOnly(addr: MatchableAddress, email: { street: string; phone: string | null }): boolean {
  const emailStreetNorm = normalizeAddressText(email.street);
  const emailHouseNr = email.street.match(/\d+/)?.[0] ?? '';
  const emailPhoneTail = email.phone ? lastDigits(email.phone, 8) : null;

  const orderStreetNorm = normalizeAddressText(`${addr.addressLine1} ${addr.addressLine2 ?? ''}`);
  const houseNrMatches = emailHouseNr ? orderStreetNorm.includes(emailHouseNr) : true;
  const streetNameOnly = emailStreetNorm.replace(/\s*\d+\s*$/, '').trim();
  const orderStreetNameOnly = orderStreetNorm.replace(/\s*\d+\s*$/, '').trim();
  const streetMatches = houseNrMatches && (orderStreetNorm.includes(streetNameOnly) || emailStreetNorm.includes(orderStreetNameOnly));

  if (!streetMatches) return false;
  if (emailPhoneTail && addr.phone) {
    return lastDigits(addr.phone, 8) === emailPhoneTail;
  }
  return true;
}
