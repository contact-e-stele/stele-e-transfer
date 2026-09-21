// Paket 3 (A3/F3): Kontaktdaten Dritter (Hersteller, EU-Verantwortlicher des Lieferanten) gehören
// NICHT in den eBay-Beschreibungstext (eBay-Verstoßserie seit Mai 2026, zuletzt stele-132) —
// sie gehen in die strukturierten Offer-Felder (`regulatory`, ebay.ts). Reine Funktionen, damit
// Generator (web/lib/ebay-description.ts), Listing-Route und Nachzieh-Route dieselbe Regel nutzen.

export const OWN_CONTACT_EMAIL = 'contact@stele-e-transfer.com';

export const GPSR_DESCRIPTION_NOTICE =
  'Die Angaben zum Hersteller und zur verantwortlichen Person in der EU finden Sie in den Abschnitten „Produktsicherheit“ und „Verantwortliche Person in der EU“ dieses Angebots.';

// Ersetzt den Inhalt des <pre>-Blocks im GPSR-Tab ("TAB 5: Produktsicherheit (GPSR)") durch den
// neutralen Hinweis. Wirkt auf bereits gespeicherte Vorlagen (htmlDescription in der DB).
// (?!<!-- TAB): das <pre> muss noch im selben Tab liegen, sonst würde ein späteres <pre> im Dokument ersetzt.
const GPSR_TAB_PRE_RE = /(<!-- TAB 5: Produktsicherheit \(GPSR\) -->(?:(?!<!-- TAB)[\s\S])*?<pre[^>]*>)[\s\S]*?(<\/pre>)/g;

export function neutralizeGpsrTab(html: string): string {
  return html.replace(GPSR_TAB_PRE_RE, `$1${GPSR_DESCRIPTION_NOTICE}$2`);
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Alle E-Mail-Adressen im HTML außer der eigenen (Impressum/AGB/Widerruf). */
export function findForeignEmails(html: string): string[] {
  // Bild-Dateinamen wie "logo@2x.png" (Retina-Suffix in CDN-URLs) sind keine E-Mail-Adressen.
  const found = (html.match(EMAIL_RE) ?? []).filter(e => !/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(e));
  return [...new Set(found.filter(e => e.toLowerCase() !== OWN_CONTACT_EMAIL))];
}
