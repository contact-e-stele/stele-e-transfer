// Beschreibung v3 — Stichpunkt-Format für die KI-Texte (Gemini), EINE Quelle für beide Prompts in api/index.ts
// (Import mit Produktdaten + "Beschreibung aus Rohtext"). Grundgesetz 8: nicht doppelt pflegen.
// Ziel (Plan "Beschreibung einfach", claude/design-check-teil2-bestseller-2026-11-04.md Punkt 4, Vorbild Tourok/axion):
// 5 Zeilen "✓ STICHWORT – 1 Satz". shared/description-v3.ts (v3Bullets) erkennt "Stichwort: Satz" und setzt das Stichwort fett.
// Versand/Lieferzeit/Rückgabe gehören NICHT in die Stichpunkte — sie stehen in der Fußzeile (shared/shipping-return-text.ts).

export const V3_BULLET_COUNT = 5;

/** Block zwischen ###BULLETS### und ###OUTRO### im Prompt. Mit Set-Inhalten ist die 5. Zeile der Lieferumfang. */
export function v3BulletsPromptBlock(hasSetContents: boolean): string {
  const lines = [
    '- [STICHWORT]: [1 Satz mit echten Daten, z.B. Maße, Material, Menge]',
    '- [STICHWORT]: [1 Satz]',
    '- [STICHWORT]: [1 Satz]',
    '- [STICHWORT]: [1 Satz, Anwendungsbereich wenn bekannt]',
    hasSetContents
      ? '- Lieferumfang: [alle Set-Inhalte aus LIEFERUMFANG JE SET oben, z.B. "SET1: 10 kleine + 10 große + Schraubendreher"]'
      : '- [STICHWORT]: [1 Satz]',
  ];
  return lines.join('\n');
}

/** Zusätzliche Regeln für die Stichpunkte (werden an die REGELN-Liste des Prompts angehängt). */
export const V3_BULLET_RULES = [
  `- Genau ${V3_BULLET_COUNT} Stichpunkte. Jeder beginnt mit einem STICHWORT aus 1–3 Wörtern, dann Doppelpunkt, dann genau 1 Satz (max. 15 Wörter)`,
  '- Beispiel: "- Elastischer Rand: Passt sich Schüsseln von ca. 14 bis 29 cm an."',
  '- Mengen und Größen nur so, wie sie in den Produktdaten stehen — nichts ergänzen oder umrechnen außer inch → cm',
  '- KEINE Aussagen zu Versand, Lieferzeit, Lager, Rückgabe oder Käuferschutz (stehen in der Fußzeile)',
].join('\n');
