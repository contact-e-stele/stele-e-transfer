// eBay-Verstoßserie ("Handel außerhalb von eBay" / "no external links, even non-clickable",
// Live-Fund 2026-09-28, 6 gesperrte Angebote + 1 unauffälliges Muster): eBay blockiert JEDE
// Kontaktaufnahme-Möglichkeit im Beschreibungstext — nicht nur fremde E-Mail-Adressen (bisher
// findForeignEmails() in gpsr-description.ts), sondern auch die EIGENE Adresse, http(s)-Links,
// "www."-Erwähnungen und Domain-förmige Textstücke (z.B. "shop.example.de" ohne http/www davor).
// Reine Funktion (GRUNDGESETZ Regel 2), einzige Prüfstelle für "darf diese Beschreibung an eBay
// gesendet werden" (GRUNDGESETZ Regel 8) — wird von /ebay/list, dem Beschreibungs-Nachzieh-Weg
// und der manuellen Listing-Inhalt-Route genutzt.
//
// P71-B Teil 2 (2026-09-29): Dauerregeln blockierend vor JEDEM Senden. Regeln (jede prüft
// Beschreibung UND Titel; geprüft wird an den Sendestellen in ebay.ts über
// checkOutgoingListingText(), nicht je Route kopiert):
//   1. email    — keine E-Mail-Adresse (eigene, Lieferant, EU-Vertreter)
//   2. url/domain/alicdn — keine externe URL/Domain, insbesondere kein *.alicdn.com
//      (Bilder nur über imageUrls der Inventory API)
//   3. gpsr     — GPSR-Daten nur in den eBay-`regulatory`-Feldern; im GPSR-Tab der Beschreibung
//      steht ausschließlich GPSR_DESCRIPTION_NOTICE, keine Rohtext-Überschriften/Telefonnummern
//   4. shipping — Versandart/-kosten/Lieferzeit nur in den eBay-Versanddaten (Muster: SHIPPING_PATTERNS)
//   (Regel 5, MPN ≠ AliExpress-ID, liegt in mpn-guard.ts)

import { GPSR_DESCRIPTION_NOTICE } from './gpsr-description';

export type DescriptionViolationKind = 'email' | 'url' | 'domain' | 'alicdn' | 'shipping' | 'gpsr';

export interface DescriptionComplianceViolation {
  kind: DescriptionViolationKind;
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

const ALICDN_RE = /[a-z0-9.-]*alicdn\.com/gi;

// Regel 4 — Versandangaben gehören ausschließlich in die eBay-Versanddaten (Fulfillment-Policy).
// Bewusst enge Muster: "Werktage" allein trifft auch die Rückerstattungsfrist der Vorlage
// ("Rückerstattung innerhalb von 3–5 Werktagen nach Wareneingang") und ist deshalb nur im
// Liefer-/Versandkontext verboten. Carrier-Namen case-sensitive (kein Treffer auf "ups"/"gls").
const SHIPPING_PATTERNS: RegExp[] = [
  /\bLieferzeit(?:en)?\b/gi,
  /\bBearbeitungszeit\b/gi,
  /\bVersandkosten\b/gi,
  /\bVersandart\b/gi,
  /\bVersandzeit\b/gi,
  /\bVersand\s+(?:per|mit|durch|via|aus|nach|innerhalb|ab)\b/gi,
  /\bLieferung\s+(?:aus|innerhalb|per|nach|(?:in|ab)\s+\d)\b/gi,
  /\b(?:Lieferdauer|Lieferfrist)\b/gi,
  /\b(?:Versand|Lieferung)\s*:\s*\d/gi,
  /\bkostenlos(?:e|er|em|en)?\s+(?:Versand|Lieferung)\b/gi,
  /\bGratis-?versand\b/gi,
  /\bversandkostenfrei\b/gi,
  /\b(?:DHL|DPD|GLS|UPS|FedEx)\b/g,
  /\bDeutsche Post\b/g,
  /(?:liefer|versand|zustell|versendet|geliefert)[^<.]{0,80}?werktag|werktag[^<.]{0,80}?(?:liefer|versand|zustell)/gi,
];

// Regel 3 — GPSR-Rohtext. Überschriften des AliExpress-GPSR-Rohtexts und Telefonzeilen; dazu der
// GPSR-Tab selbst: sein <pre> darf nur GPSR_DESCRIPTION_NOTICE enthalten.
const GPSR_RAW_PATTERNS: RegExp[] = [
  /Informationen zum Hersteller/gi,
  /Angaben zur verantwortlichen Person/gi,
  /Telefon\s*:\s*\+?\d[\d\s]{5,}/gi,
];
const GPSR_TAB_RE = /<!-- TAB \d+: Produktsicherheit \(GPSR\) -->(?:(?!<!-- TAB)[\s\S])*?<pre[^>]*>([\s\S]*?)<\/pre>/g;

/** Alle Treffer (NICHT dedupliziert) in Reihenfolge der Regeln — Grundlage für Liste und Zählung. */
function scanAll(html: string): DescriptionComplianceViolation[] {
  const hits: DescriptionComplianceViolation[] = [];
  const push = (kind: DescriptionViolationKind, matches: string[]) => { for (const match of matches) hits.push({ kind, match }); };

  push('email', (html.match(EMAIL_RE) ?? []).filter(e => !IMAGE_EXT_RE.test(e)));
  push('url', html.match(HTTP_RE) ?? []);
  push('url', html.match(WWW_RE) ?? []);
  push('domain', html.match(DOMAIN_RE) ?? []);
  push('alicdn', html.match(ALICDN_RE) ?? []);
  for (const re of SHIPPING_PATTERNS) push('shipping', html.match(re) ?? []);
  for (const re of GPSR_RAW_PATTERNS) push('gpsr', html.match(re) ?? []);
  for (const m of html.matchAll(GPSR_TAB_RE)) {
    if (m[1].trim() !== GPSR_DESCRIPTION_NOTICE) push('gpsr', ['GPSR-Tab enthält Rohtext statt GPSR_DESCRIPTION_NOTICE']);
  }
  return hits;
}

export function findDescriptionComplianceViolations(html: string): DescriptionComplianceViolation[] {
  const seen = new Set<string>();
  return scanAll(html).filter(v => {
    const key = `${v.kind}|${v.match}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface DescriptionViolationSummary {
  email: number;
  url: number;
  domain: number;
  alicdn: number;
  shipping: number;
  gpsr: number;
  total: number;
  /** Externe Hosts aus http(s)://-Adressen mit Anzahl (absteigend). */
  hosts: Array<{ host: string; count: number }>;
}

/** Echte Anzahl je Muster (nicht dedupliziert) — für die Vorschau im Listings-Tab. */
export function summarizeDescriptionViolations(html: string): DescriptionViolationSummary {
  const summary: DescriptionViolationSummary = { email: 0, url: 0, domain: 0, alicdn: 0, shipping: 0, gpsr: 0, total: 0, hosts: [] };
  for (const v of scanAll(html)) { summary[v.kind]++; summary.total++; }
  const hostCounts = new Map<string, number>();
  for (const m of html.matchAll(/https?:\/\/([^/\s"'<>?#]+)/gi)) {
    const host = m[1].toLowerCase();
    hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
  }
  summary.hosts = [...hostCounts].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count);
  return summary;
}

/**
 * EINE Sperrstelle für alles, was an eBay geht (Titel + Beschreibung). Wird an den Sendestellen in
 * ebay.ts aufgerufen (Neulisten, Trading-Revise, Inventory-Nachzieh-Weg) und von den Routen für
 * die frühe Fehlermeldung — keine je Route kopierte Prüfung (GRUNDGESETZ Regel 8).
 */
export function checkOutgoingListingText(t: { title?: string; description?: string }): DescriptionComplianceViolation[] {
  return findDescriptionComplianceViolations([t.title ?? '', t.description ?? ''].join(' <!--title/description--> '));
}

export function formatComplianceViolations(violations: DescriptionComplianceViolation[]): string {
  return violations.map(v => `${v.match} (${v.kind})`).join(', ');
}

export function assertDescriptionCompliant(html: string): void {
  const violations = findDescriptionComplianceViolations(html);
  if (violations.length > 0) {
    const list = violations.map(v => `${v.match} (${v.kind})`).join(', ');
    throw new Error(`Beschreibung verstößt gegen eBays "Handel außerhalb von eBay"-Regel: ${list}`);
  }
}
