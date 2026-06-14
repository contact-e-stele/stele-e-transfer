/**
 * STELE-E-TRANSFER — eBay Beschreibungs-Generator
 * Erzeugt die vollständige Black & Gold HTML-Vorlage mit echtem Produktinhalt.
 */

export interface ScrapedProduct {
  title: string;
  images?: string[];
  price?: string;
  description?: string;
  specs?: Record<string, string>;
  variants?: Array<{ name: string; values: string[] }>;
  bullets?: string[];
}

function decodeEntities(str: string): string {
  return str
    .replace(/&uuml;/g, "ü").replace(/&Uuml;/g, "Ü")
    .replace(/&auml;/g, "ä").replace(/&Auml;/g, "Ä")
    .replace(/&ouml;/g, "ö").replace(/&Ouml;/g, "Ö")
    .replace(/&szlig;/g, "ß")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/&[a-zA-Z]+;/g, "");
}

function cleanText(text: string): string {
  return decodeEntities(text)
    .replace(/([a-zäöüß]{4,})([A-ZÄÖÜ])/g, "$1 $2")
    .replace(/\b(.{10,40}?)\s+\1\b/gi, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isGarbage(text: string): boolean {
  // Filtert chinesische Zeichen, reine URLs, sehr kurze Fragmente
  if (/[\u4e00-\u9fff]/.test(text)) return true;
  if (/^https?:\/\//.test(text)) return true;
  if (text.length < 5) return true;
  // Zu viele Sonderzeichen
  const specialRatio = (text.match(/[^a-zA-ZäöüÄÖÜß0-9\s.,!?:;()\-–€%°²³+]/g)?.length ?? 0) / text.length;
  if (specialRatio > 0.3) return true;
  return false;
}

/**
 * Hauptfunktion: erzeugt komplette eBay-HTML-Beschreibung im STELE Black & Gold Design
 */
export function buildEbayHTML(product: ScrapedProduct): string {
  const title = cleanText(product.title || "");
  const specs = product.specs ?? {};
  const specEntries = Object.entries(specs).filter(([k, v]) => {
    const key = cleanText(k);
    const val = cleanText(v);
    return key && val && !isGarbage(key) && !isGarbage(val);
  }).slice(0, 14);

  // ── Bullet Points ─────────────────────────────────────────────────────────
  let bulletsHtml = "";
  const bullets: string[] = [];

  // Aus product.bullets (Amazon-Scraper liefert das)
  if (product.bullets && product.bullets.length > 0) {
    for (const b of product.bullets) {
      const c = cleanText(b);
      if (c.length > 15 && !isGarbage(c)) bullets.push(c);
      if (bullets.length >= 8) break;
    }
  }

  // Aus description — Zeilenumbrüche als Bullets
  if (bullets.length < 3 && product.description) {
    const lines = product.description
      .split(/[\n•\-\*]/)
      .map(l => cleanText(l))
      .filter(l => l.length > 20 && !isGarbage(l));
    for (const l of lines) {
      if (!bullets.includes(l)) bullets.push(l);
      if (bullets.length >= 8) break;
    }
  }

  if (bullets.length > 0) {
    bulletsHtml = `
    <ul style="margin:0 0 16px 0;padding:0;list-style:none;">
      ${bullets.map(b => `
      <li style="display:flex;align-items:flex-start;gap:10px;padding:7px 0;border-bottom:1px solid #1e1e0e;">
        <span style="color:#C9A84C;font-size:16px;line-height:1;flex-shrink:0;">✓</span>
        <span style="color:#c8b878;line-height:1.6;font-size:13px;">${b}</span>
      </li>`).join("")}
    </ul>`;
  }

  // ── Beschreibungstext ──────────────────────────────────────────────────────
  let descParas = "";
  if (product.description && product.description.length > 30) {
    const cleaned = cleanText(product.description);
    const parts = cleaned
      .split(/[.!?]\s+/)
      .map(p => p.trim())
      .filter(p => p.length > 25 && !isGarbage(p))
      .slice(0, 3);
    if (parts.length > 0) {
      descParas = parts.map(p => `<p style="color:#a89050;line-height:1.75;margin:8px 0;font-size:13px;">${p}.</p>`).join("\n");
    }
  }

  // Fallback-Beschreibung wenn nichts da ist
  if (!descParas && !bulletsHtml) {
    descParas = `<p style="color:#a89050;line-height:1.75;margin:8px 0;font-size:13px;">${title} — hochwertige Qualität für anspruchsvolle Anwender.</p>`;
  }

  // ── Specs-Tabelle ──────────────────────────────────────────────────────────
  let specsHtml = "";
  if (specEntries.length > 0) {
    const rows = specEntries.map(([k, v]) => {
      const key = cleanText(k);
      const val = cleanText(v);
      return `<tr>
        <td style="padding:8px 14px;font-weight:600;color:#C9A84C;white-space:nowrap;border-bottom:1px solid #2a2a0a;width:35%;font-size:12px;">${key}</td>
        <td style="padding:8px 14px;color:#e0d0a0;border-bottom:1px solid #2a2a0a;font-size:12px;">${val}</td>
      </tr>`;
    }).join("\n");
    specsHtml = `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#0d0d07;border-radius:4px;overflow:hidden;">
      <thead>
        <tr style="background:#1a1a08;">
          <th colspan="2" style="padding:10px 14px;text-align:left;color:#C9A84C;font-size:12px;letter-spacing:1px;border-bottom:2px solid #C9A84C;">TECHNISCHE DATEN</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>`;
  }

  // ── Tab 1: Beschreibung HTML ───────────────────────────────────────────────
  const tab1 = `
    <h3 style="color:#C9A84C;border-bottom:1px solid #3a2a0a;padding-bottom:10px;letter-spacing:1px;margin:0 0 16px 0;font-size:15px;">${title}</h3>
    ${bulletsHtml}
    ${descParas}
    ${specsHtml}
    <hr style="margin:20px 0;border:none;border-top:1px solid #2a2a0a;" />
    <p style="font-size:11px;color:#5a4a20;margin:0;"><strong>Hinweis gem&auml;&szlig; &sect;19 UStG:</strong> Als Kleinunternehmer im Sinne von &sect;19 Abs. 1 UStG wird keine Umsatzsteuer berechnet und ausgewiesen.</p>
  `.trim();

  // ── Vollständige Vorlage ───────────────────────────────────────────────────
  return `<!-- STELE-E-TRANSFER eBay Vorlage - Black & Gold Edition -->
<div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;color:#e8d5a0;background:#0a0a0a;border:1px solid #C9A84C;border-radius:8px;overflow:hidden;">

<!-- HEADER -->
<div style="background:linear-gradient(135deg,#0a0a0a 0%,#1a1a0a 50%,#0a0a0a 100%);padding:18px;text-align:center;border-bottom:2px solid #C9A84C;">
  <div style="color:#C9A84C;font-size:22px;font-weight:bold;letter-spacing:5px;">STELE-E-TRANSFER</div>
  <div style="color:#8a7040;font-size:11px;letter-spacing:3px;margin-top:6px;">PREMIUM QUALIT&Auml;T &middot; SCHNELLE LIEFERUNG</div>
  <div style="height:1px;background:linear-gradient(to right,#0a0a0a,#C9A84C,#0a0a0a);margin-top:12px;">&nbsp;</div>
</div>

<!-- INFO BOXEN -->
<div style="display:table;width:100%;border-collapse:collapse;background:#111108;">
  <div style="display:table-cell;width:33%;border-right:1px solid #C9A84C;vertical-align:top;">
    <div style="padding:18px 15px;text-align:center;">
      <div style="font-weight:bold;font-size:13px;color:#C9A84C;margin-bottom:8px;letter-spacing:1px;">KOSTENLOSER VERSAND</div>
      <div style="font-size:11px;color:#8a7040;line-height:1.7;">Lieferzeit 3–7 Werktage<br/>Versand per DHL / Deutsche Post</div>
    </div>
  </div>
  <div style="display:table-cell;width:33%;border-right:1px solid #C9A84C;vertical-align:top;">
    <div style="padding:18px 15px;text-align:center;">
      <div style="font-weight:bold;font-size:13px;color:#C9A84C;margin-bottom:8px;letter-spacing:1px;">30 TAGE R&Uuml;CKGABE</div>
      <div style="font-size:11px;color:#8a7040;line-height:1.7;">Einfache R&uuml;ckgabe<br/>K&auml;uferschutz &uuml;ber eBay</div>
    </div>
  </div>
  <div style="display:table-cell;width:33%;vertical-align:top;">
    <div style="padding:18px 15px;text-align:center;">
      <div style="font-weight:bold;font-size:13px;color:#C9A84C;margin-bottom:8px;letter-spacing:1px;">KUNDENSERVICE</div>
      <div style="font-size:11px;color:#8a7040;line-height:1.7;">contact@stele-e-transfer.com<br/>Wir helfen gerne weiter</div>
    </div>
  </div>
</div>

<div style="background:#0a0a0a;border-top:1px solid #C9A84C;border-bottom:1px solid #3a2a0a;">
  <div style="height:1px;background:linear-gradient(to right,#0a0a0a,#C9A84C,#0a0a0a);">&nbsp;</div>
</div>

<!-- CSS TABS -->
<style type="text/css">
  .stet-tabs{width:100%;background:#0a0a0a;}
  .stet-tabs input[type="radio"]{display:none;}
  .stet-tab-labels{display:flex;flex-wrap:wrap;border-bottom:2px solid #C9A84C;margin:0;padding:8px 8px 0;background:#111108;}
  .stet-tab-labels label{padding:9px 14px;background:#1a1508;color:#8a7040;cursor:pointer;font-size:12px;font-weight:bold;border-radius:4px 4px 0 0;margin-right:3px;border:1px solid #3a2a0a;border-bottom:none;letter-spacing:.5px;}
  .stet-tab-labels label:hover{background:#2a1e08;color:#C9A84C;}
  .stet-content{display:none;padding:24px 28px;background:linear-gradient(180deg,#0f0f07 0%,#0a0a0a 100%);color:#c8b878;line-height:1.8;}
  .stet-content h3{color:#C9A84C;border-bottom:1px solid #3a2a0a;padding-bottom:8px;letter-spacing:1px;}
  .stet-content ul{color:#a89050;}
  .stet-content strong{color:#C9A84C;}
  .stet-content p{color:#a89050;}
  #stet-t1:checked~.stet-tab-labels label[for="stet-t1"],
  #stet-t2:checked~.stet-tab-labels label[for="stet-t2"],
  #stet-t3:checked~.stet-tab-labels label[for="stet-t3"],
  #stet-t4:checked~.stet-tab-labels label[for="stet-t4"]{background:#C9A84C;color:#000;border-color:#C9A84C;}
  #stet-t1:checked~.stet-contents #stet-c1,
  #stet-t2:checked~.stet-contents #stet-c2,
  #stet-t3:checked~.stet-contents #stet-c3,
  #stet-t4:checked~.stet-contents #stet-c4{display:block;}
</style>

<div class="stet-tabs">
  <input checked="checked" id="stet-t1" name="stet-tab" type="radio"/>
  <input id="stet-t2" name="stet-tab" type="radio"/>
  <input id="stet-t3" name="stet-tab" type="radio"/>
  <input id="stet-t4" name="stet-tab" type="radio"/>
  <div class="stet-tab-labels">
    <label for="stet-t1">Beschreibung</label>
    <label for="stet-t2">Versand &amp; Retouren</label>
    <label for="stet-t3">Impressum</label>
    <label for="stet-t4">AGB</label>
  </div>
  <div class="stet-contents">

    <!-- TAB 1: Beschreibung -->
    <div class="stet-content" id="stet-c1">
      ${tab1}
    </div>

    <!-- TAB 2: Versand & Retouren -->
    <div class="stet-content" id="stet-c2">
      <h3>Versandinformationen</h3>
      <ul style="line-height:1.9;">
        <li><strong>Kostenloser Versand</strong> auf alle Bestellungen</li>
        <li>Lieferzeit: <strong>3–7 Werktage</strong></li>
        <li>Versand per <strong>DHL, Deutsche Post oder Amazon Logistik</strong></li>
        <li>Sendungsverfolgung wird per eBay-Nachricht mitgeteilt</li>
      </ul>
      <h3>Retouren &amp; R&uuml;ckgabe</h3>
      <ul style="line-height:1.9;">
        <li><strong>30 Tage R&uuml;ckgaberecht</strong> ab Erhalt der Ware</li>
        <li>R&uuml;cksendekosten tr&auml;gt der K&auml;ufer (sofern kein Defekt)</li>
        <li>Bei Defekt oder Falschlieferung: R&uuml;cksendekosten werden erstattet</li>
        <li>R&uuml;ckerstattung innerhalb von 3–5 Werktagen nach Wareneingang</li>
      </ul>
      <p style="font-size:11px;color:#5a4a20;margin-top:20px;"><strong>Hinweis gem&auml;&szlig; &sect;19 UStG:</strong> Als Kleinunternehmer im Sinne von &sect;19 Abs. 1 UStG wird keine Umsatzsteuer berechnet und ausgewiesen.</p>
    </div>

    <!-- TAB 3: Impressum -->
    <div class="stet-content" id="stet-c3">
      <h3>Impressum</h3>
      <p><strong>STELE-E-TRANSFER</strong><br/>
      Inhaber: Evgenij Stele<br/>
      Am Hochfeld 47<br/>
      65205 Wiesbaden<br/>
      Deutschland</p>
      <p><strong>E-Mail:</strong> contact@stele-e-transfer.com</p>
      <p><strong>Hinweis gem&auml;&szlig; &sect;19 UStG:</strong><br/>
      Als Kleinunternehmer im Sinne von &sect;19 Abs. 1 UStG wird keine Umsatzsteuer berechnet und ausgewiesen.</p>
      <p>Verantwortlich f&uuml;r den Inhalt dieser Seite:<br/>
      STELE-E-TRANSFER, Am Hochfeld 47, 65205 Wiesbaden</p>
    </div>

    <!-- TAB 4: AGB -->
    <div class="stet-content" id="stet-c4">
      <h3>Allgemeine Gesch&auml;ftsbedingungen (AGB)</h3>
      <p style="color:#5a4a20;font-size:13px;">stele-e-transfer | eBay-Shop</p>
      <p><strong>&sect; 1 Geltungsbereich</strong><br/>
      Diese AGB gelten f&uuml;r alle K&auml;ufe &uuml;ber den eBay-Shop von stele-e-transfer.<br/>
      Anbieter: Evgenij Stele, Am Hochfeld 47, 65205 Wiesbaden | E-Mail: contact@stele-e-transfer.com</p>
      <p><strong>&sect; 2 Vertragsschluss</strong><br/>
      Mit dem Klick auf &quot;Sofort-Kaufen&quot; gibt der K&auml;ufer ein verbindliches Angebot ab. Der Vertrag kommt zustande, wenn der Verk&auml;ufer durch Auftragsbestätigung oder Versand der Ware annimmt.</p>
      <p><strong>&sect; 3 Preise</strong><br/>
      Alle Preise sind Endpreise in Euro (EUR).<br/>
      Als Kleinunternehmer gem. &sect;19 UStG wird keine Umsatzsteuer berechnet.</p>
      <p><strong>&sect; 4 Zahlung</strong><br/>
      Zahlung &uuml;ber eBay-Zahlungsabwicklung. Der Betrag ist sofort nach Kauf f&auml;llig.</p>
      <p><strong>&sect; 5 Lieferung &amp; Versand</strong><br/>
      Lieferung innerhalb Deutschlands. Lieferzeit: 3–7 Werktage nach Zahlungseingang.<br/>
      Keine Haftung f&uuml;r Verz&ouml;gerungen durch den Versanddienstleister.</p>
      <p><strong>&sect; 6 Eigentumsvorbehalt</strong><br/>
      Die Ware bleibt bis zur vollst&auml;ndigen Bezahlung Eigentum von stele-e-transfer.</p>
      <p><strong>&sect; 7 Widerrufsrecht</strong><br/>
      Sie haben das Recht, binnen 30 Tagen ohne Angabe von Gr&uuml;nden zu widerrufen.<br/>
      Widerruf an: stele-e-transfer, Am Hochfeld 47, 65205 Wiesbaden, contact@stele-e-transfer.com<br/>
      K&auml;ufer k&ouml;nnen den Widerruf per Brief, E-Mail oder Fax erkl&auml;ren. Zus&auml;tzlich steht die digitale Widerrufsfunktion &quot;Artikel zur&uuml;ckgeben&quot; in der eBay-Kaufübersicht zur Verf&uuml;gung. Als Widerrufsgrund bitte &quot;Widerruf des Vertrags&quot; ausw&auml;hlen.<br/>
      R&uuml;ckerstattung innerhalb 14 Tagen. R&uuml;cksendekosten tr&auml;gt der K&auml;ufer.<br/>
      Kein Widerrufsrecht bei Hygieneartikeln nach &Ouml;ffnung.</p>
      <p><strong>&sect; 8 Gew&auml;hrleistung</strong><br/>
      Gesetzliche Gew&auml;hrleistung: 2 Jahre ab Lieferung.</p>
      <p><strong>&sect; 9 Haftungsbeschr&auml;nkung</strong><br/>
      Keine Haftung f&uuml;r leichte Fahrl&auml;ssigkeit, sofern keine wesentlichen Vertragspflichten verletzt werden.</p>
      <p><strong>&sect; 10 Datenschutz</strong><br/>
      Daten werden ausschlie&szlig;lich zur Vertragserf&uuml;llung genutzt. Es gelten eBay-Datenschutzbestimmungen und DSGVO.</p>
      <p><strong>&sect; 11 Streitbeilegung</strong><br/>
      EU-Streitschlichtung: <a href="https://ec.europa.eu/consumers/odr" style="color:#C9A84C;">https://ec.europa.eu/consumers/odr</a><br/>
      Wir nehmen nicht an Streitbeilegungsverfahren teil.</p>
      <p><strong>&sect; 12 Schlussbestimmungen</strong><br/>
      Es gilt deutsches Recht. Gerichtsstand: Wiesbaden.<br/>
      <em>Stand: Juni 2026</em></p>
    </div>

  </div>
</div>

<!-- FOOTER -->
<div style="background:#111108;padding:14px;text-align:center;border-top:2px solid #C9A84C;">
  <span style="color:#C9A84C;font-size:11px;letter-spacing:5px;font-weight:bold;">STELE-E-TRANSFER</span><br/>
  <span style="color:#5a4a20;font-size:10px;letter-spacing:2px;">WIESBADEN &middot; DEUTSCHLAND</span>
</div>

</div>`;
}
