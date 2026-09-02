/**
 * Gmail-Anbindung (P-84) — liest AliExpress-Logistik-Update-Mails, um Sendungsnummer +
 * Lieferadresse zu extrahieren. OAuth2 (Web-Anwendung) exakt nach dem Muster von drive.ts,
 * eigener Refresh-Token in app_settings (DB) — unabhängig von der Drive-Verbindung.
 *
 * WICHTIG: liefert nur VORSCHLÄGE. Kein automatisches Speichern/Übermitteln — das bleibt
 * bewusst beim Menschen (siehe /gmail/tracking-suggestions in index.ts + bestellungen.tsx).
 */
import { eq } from 'drizzle-orm';

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
  const anchorIdx = lines.findIndex(l => /versand nach:?$/i.test(l));
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
  const subjectMatch = subject.match(/Packstück\s+(\S+)\s+hat die Abflugregion verlassen/i);
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
  const subjectMatch = subject.match(/Paket\s+(\S+)[^.\n]{0,40}?\bzugestellt\b/i);
  if (!subjectMatch) return null;
  const address = parseVersandNachBlock(bodyText);
  if (!address) return null;
  return { trackingNumber: subjectMatch[1], ...address, emailDate: '' };
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

// Fallback falls keine text/plain-Variante existiert — grobe HTML-Bereinigung, weniger
// zuverlässig als der Klartext-Pfad (Zeilenumbrüche können sich verschieben).
function findHtmlBodyAsText(part: GmailMessagePart): string | null {
  if (part.mimeType === 'text/html' && part.body?.data) {
    const html = Buffer.from(part.body.data, 'base64url').toString('utf8');
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  }
  for (const sub of part.parts ?? []) {
    const found = findHtmlBodyAsText(sub);
    if (found) return found;
  }
  return null;
}

// ─── Gmail durchsuchen + jede Treffer-Mail mit dem übergebenen Parser auswerten ─
// Gemeinsame Grundlage für P-84 (Abflug) und P-85 (Zustellung) — beide unterscheiden
// sich nur in Suchbegriff und Parser-Funktion.
async function searchAndParseEmails<T extends { emailDate: string }>(
  subjectPhrase: string,
  days: number,
  parser: (subject: string, bodyText: string) => T | null
): Promise<T[]> {
  const token = await getGmailAccessToken();
  if (!token) throw new Error('Gmail nicht verbunden');

  const q = `from:transaction@notice.aliexpress.com subject:"${subjectPhrase}" newer_than:${days}d`;
  const listRes = await fetch(`${GMAIL_API}/messages?q=${encodeURIComponent(q)}&maxResults=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(`Gmail-Suche fehlgeschlagen: ${listRes.status} ${text.slice(0, 300)}`);
  }
  const listData = await listRes.json() as { messages?: Array<{ id: string }> };
  const results: T[] = [];

  for (const { id } of listData.messages ?? []) {
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
    const bodyText = findPlainTextBody(msg.payload) ?? findHtmlBodyAsText(msg.payload);
    if (!bodyText) continue;

    const parsed = parser(subject, bodyText);
    if (!parsed) continue;
    parsed.emailDate = msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : '';
    results.push(parsed);
  }

  return results;
}

// ─── Kürzlich eingegangene Logistik-Mails suchen + parsen ────────────────────
export async function searchRecentTrackingEmails(days = 14): Promise<TrackingEmailMatch[]> {
  return searchAndParseEmails('hat die Abflugregion verlassen', days, parseTrackingEmail);
}

// ─── P-85/P-96: Kürzlich eingegangene Zustellbestätigungen suchen + parsen ────
// P-96: Gmail-Suchbegriff von der exakten Phrase "wurde zugestellt" auf das einzelne Wort
// "zugestellt" verbreitert (holt serverseitig auch andere Formulierungen + die noch-nicht-
// zugestellt-Vorstufe "wird zugestellt" — Filterung übernimmt parseDeliveryEmail()). Zeitfenster
// von 14 auf 30 Tage erhöht, da Zustellungen bei Auslandsversand oft erst nach 2+ Wochen kommen.
export async function searchRecentDeliveryEmails(days = 30): Promise<DeliveryEmailMatch[]> {
  return searchAndParseEmails('zugestellt', days, parseDeliveryEmail);
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
