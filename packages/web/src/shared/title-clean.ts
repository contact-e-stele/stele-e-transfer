// OFFEN 009 Punkt 1 (27.10.2026): Gemini schreibt die Längenvorgabe des Prompts gelegentlich in den Titel
// (stele-181 live "… Groß 75 Zeichen", stele-241 "… Rutschfest 78 Zeichen"). Bereinigung NACH der Erzeugung. REINE Funktion.
const TAIL_PATTERNS: RegExp[] = [
  /\s*[(\[]?\s*(?:ca\.?\s*|~\s*)?\d{1,3}\s*(?:zeichen|characters?|chars?)\s*[)\]]?\s*[.!]?\s*$/i, // "78 Zeichen", "(75 Zeichen)"
  /\s*[(\[]?\s*(?:länge|laenge|length)\s*:?\s*\d{1,3}(?:\s*(?:zeichen|characters?))?\s*[)\]]?\s*$/i, // "Länge: 78", "(Length 80)"
];

export function cleanGeneratedTitle(raw: string): string {
  let t = (raw ?? '').replace(/[\r\n]+/g, ' ').trim().replace(/^["'„“”]+|["'„“”]+$/g, '').trim();
  for (let i = 0; i < 3; i++) {
    const before = t;
    for (const p of TAIL_PATTERNS) t = t.replace(p, '');
    t = t.replace(/[\s,;:–-]+$/, '').trim();
    if (t === before) break;
  }
  return t.replace(/\s{2,}/g, ' ').slice(0, 80).trim();
}
