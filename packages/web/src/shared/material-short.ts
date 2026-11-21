// Kurzform des Materials für das eBay-Merkmal „Material“ (AUFSICHT 21.11.2026, stele-259): erster Eintrag ohne Klammerzusatz.
// „Wolle (Futter), PU (Obermaterial), PVC (Sohle)“ → „Wolle“. Leer/null → null. Rein (Grundgesetz 2).
export function shortMaterial(material: string | null | undefined): string | null {
  const first = String(material ?? '').split(/[,;/]/)[0]?.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim() ?? '';
  return first.length > 0 ? first : null;
}
