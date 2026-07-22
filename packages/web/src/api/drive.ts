/**
 * Google Drive Anbindung — Backups, Bilder, Rechnungen automatisch hochladen
 * OAuth2 (Web-Anwendung), Refresh-Token wird in app_settings (DB) gespeichert.
 */
import { eq } from 'drizzle-orm';

const CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID ?? '';
const CLIENT_SECRET = process.env.GOOGLE_DRIVE_CLIENT_SECRET ?? '';
const REDIRECT_URI = process.env.GOOGLE_DRIVE_REDIRECT_URI ?? 'https://stele-e-transfer.onrender.com/api/drive/callback';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

// ─── Bekannte Ordner-IDs (einmalig ermittelt, siehe getOrCreateFolder) ────────
// Struktur (vom User in Drive vorbereitet):
//   Meine Ablage/RECHNUNG/E-Commerce-Plattform/AliExpress   -> Lieferanten-Rechnungen
//   Meine Ablage/RECHNUNG/E-Commerce-Plattform/stele-e-transfer -> unsere eBay-Ausgangsrechnungen
//   Meine Ablage/APP/STELE-DS-APP/Backups                   -> DB-Backups
//   Meine Ablage/APP/STELE-DS-APP/Bilder                    -> Produktbilder

// ─── OAuth: Autorisierungs-URL ─────────────────────────────────────────────────
export function getDriveOAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',   // wichtig: liefert einen refresh_token
    prompt: 'consent',        // erzwingt erneuten Consent -> garantiert refresh_token bei jedem Connect
    scope: 'https://www.googleapis.com/auth/drive.file', // nur Zugriff auf von der App erstellte/geöffnete Dateien
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

// Authorization Code → Access + Refresh Token
export async function exchangeDriveCodeForToken(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
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
    throw new Error(`Google Drive token exchange failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

// ─── Token-Speicherung (DB, wie AliExpress) ────────────────────────────────────
async function saveDriveTokens(accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const now = new Date().toISOString();
  const expiresAt = Date.now() + expiresIn * 1000;
  await db.insert(appSettings).values({ key: 'gdrive_access_token', value: accessToken, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: accessToken, updatedAt: now } });
  await db.insert(appSettings).values({ key: 'gdrive_refresh_token', value: refreshToken, updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: refreshToken, updatedAt: now } });
  await db.insert(appSettings).values({ key: 'gdrive_token_expires', value: String(expiresAt), updatedAt: now })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: String(expiresAt), updatedAt: now } });
}

export async function handleDriveCallback(code: string): Promise<void> {
  const tokens = await exchangeDriveCodeForToken(code);
  await saveDriveTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
}

// ─── Gueltigen Access-Token holen (auto-refresh bei Bedarf) ────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getDriveAccessToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }
  const { db } = await import('../db/index');
  const { appSettings } = await import('../db/schema');
  const refreshRow = await db.select().from(appSettings).where(eq(appSettings.key, 'gdrive_refresh_token')).get();
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
    console.error('[Drive] Token-Refresh fehlgeschlagen:', res.status, await res.text());
    return null;
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

export async function isDriveConnected(): Promise<boolean> {
  const token = await getDriveAccessToken();
  return !!token;
}

// ─── Ordner finden oder anlegen (per Name + optionalem Parent) ────────────────
const folderIdCache: Record<string, string> = {};

export async function findOrCreateFolder(name: string, parentId?: string): Promise<string> {
  const cacheKey = `${parentId ?? 'root'}/${name}`;
  if (folderIdCache[cacheKey]) return folderIdCache[cacheKey];

  const token = await getDriveAccessToken();
  if (!token) throw new Error('Google Drive nicht verbunden');

  const parentQ = parentId ? ` and '${parentId}' in parents` : '';
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentQ}`);
  const searchRes = await fetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const searchData = await searchRes.json() as { files?: Array<{ id: string; name: string }> };
  if (searchData.files && searchData.files.length > 0) {
    folderIdCache[cacheKey] = searchData.files[0].id;
    return searchData.files[0].id;
  }

  // Nicht gefunden -> anlegen
  const createRes = await fetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
    }),
  });
  if (!createRes.ok) throw new Error(`Ordner "${name}" konnte nicht erstellt werden: ${await createRes.text()}`);
  const created = await createRes.json() as { id: string };
  folderIdCache[cacheKey] = created.id;
  return created.id;
}

// Pfad wie "RECHNUNG/E-Commerce-Plattform/AliExpress" -> Ordner-ID der letzten Ebene
export async function findOrCreatePath(pathParts: string[]): Promise<string> {
  let parentId: string | undefined;
  for (const part of pathParts) {
    parentId = await findOrCreateFolder(part, parentId);
  }
  if (!parentId) throw new Error('Leerer Pfad');
  return parentId;
}

// ─── Datei hochladen ────────────────────────────────────────────────────────────
export async function uploadToDrive(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  folderId: string
): Promise<{ id: string; webViewLink: string }> {
  const token = await getDriveAccessToken();
  if (!token) throw new Error('Google Drive nicht verbunden');

  const metadata = { name: filename, parents: [folderId] };
  const boundary = 'stele-drive-boundary-' + Date.now();
  const metaPart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const fileHeaderPart = `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;

  const body = Buffer.concat([
    Buffer.from(metaPart, 'utf8'),
    Buffer.from(fileHeaderPart, 'utf8'),
    buffer,
    Buffer.from(closing, 'utf8'),
  ]);

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive-Upload fehlgeschlagen: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ id: string; webViewLink: string }>;
}
