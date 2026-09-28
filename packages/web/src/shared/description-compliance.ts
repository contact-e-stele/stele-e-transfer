// eBay-Verstoßserie ("Handel außerhalb von eBay" / "no external links, even non-clickable",
// Live-Fund 2026-09-28, 6 gesperrte Angebote + 1 unauffälliges Muster): eBay blockiert JEDE
// Kontaktaufnahme-Möglichkeit im Beschreibungstext — nicht nur fremde E-Mail-Adressen (bisher
// findForeignEmails() in gpsr-description.ts), sondern auch die EIGENE Adresse, http(s)-Links,
// "www."-Erwähnungen und Domain-förmige Textstücke (z.B. "shop.example.de" ohne http/www davor).
// Reine Funktion (GRUNDGESETZ Regel 2), einzige Prüfstelle für "darf diese Beschreibung an eBay
// gesendet werden" (GRUNDGESETZ Regel 8) — wird von /ebay/list, dem Beschreibungs-Nachzieh-Weg
// und der manuellen Listing-Inhalt-Route genutzt.

export interface DescriptionComplianceViolation {
  kind: 'email' | 'url' | 'domain';
  match: string;
}

// Aus findForeignEmails() (gpsr-description.ts) übernommen: erkennt E-Mail-Adressen, ignoriert
// aber Bild-Dateinamen mit Retina-Suffix wie "logo@2x.png" (keine E-Mail-Adresse).
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

const HTTP_RE = /https?:\/\//gi;
const WWW_RE = /\bwww\./gi;

// Kuratierte, häufige TLDs — bewusst keine vollständige IANA-Liste, um Fehltreffer auf Maße
// ("12.5 cm") oder Versionsnummern ("v1.2") zu vermeiden (nur Wortkombinationen mit einer dieser
// Endungen zählen als Domain). "com.cn" muss vor "com" stehen, sonst würde nur ".com" matchen.
const ALLOWED_TLDS = [
  'com.cn', 'com', 'de', 'net', 'org', 'eu', 'cn', 'shop', 'store', 'info', 'biz',
  'co', 'io', 'uk', 'fr', 'es', 'it', 'nl', 'pl', 'at', 'ch',
];
const DOMAIN_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_RE = new RegExp(
  `\\b${DOMAIN_LABEL}\\.(?:${ALLOWED_TLDS.map(t => t.replace('.', '\\.')).join('|')})\\b`,
  'gi',
);

export function findDescriptionComplianceViolations(html: string): DescriptionComplianceViolation[] {
  const violations: DescriptionComplianceViolation[] = [];

  const emails = (html.match(EMAIL_RE) ?? []).filter(e => !IMAGE_EXT_RE.test(e));
  for (const match of new Set(emails)) violations.push({ kind: 'email', match });

  const httpMatches = html.match(HTTP_RE) ?? [];
  for (const match of new Set(httpMatches)) violations.push({ kind: 'url', match });

  const wwwMatches = html.match(WWW_RE) ?? [];
  for (const match of new Set(wwwMatches)) violations.push({ kind: 'url', match });

  const domainMatches = html.match(DOMAIN_RE) ?? [];
  for (const match of new Set(domainMatches)) violations.push({ kind: 'domain', match });

  return violations;
}

export function assertDescriptionCompliant(html: string): void {
  const violations = findDescriptionComplianceViolations(html);
  if (violations.length > 0) {
    const list = violations.map(v => `${v.match} (${v.kind})`).join(', ');
    throw new Error(`Beschreibung verstößt gegen eBays "Handel außerhalb von eBay"-Regel: ${list}`);
  }
}
