import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { v3BulletsPromptBlock, V3_BULLET_RULES, V3_BULLET_COUNT } from './description-prompt';
import { v3Bullets } from './description-v3';

describe('Stichpunkt-Format v3 für Gemini', () => {
  test('genau 5 Zeilen, jede "- [STICHWORT]: …" bzw. Lieferumfang', () => {
    const plain = v3BulletsPromptBlock(false).split('\n');
    expect(plain.length).toBe(V3_BULLET_COUNT);
    expect(plain.every(l => l.startsWith('- [STICHWORT]: '))).toBe(true);
    const withSet = v3BulletsPromptBlock(true).split('\n');
    expect(withSet.length).toBe(V3_BULLET_COUNT);
    expect(withSet[4].startsWith('- Lieferumfang: ')).toBe(true);
  });
  test('Regeln verbieten Versand/Lieferzeit/Rückgabe und verlangen Stichwort + Doppelpunkt', () => {
    expect(V3_BULLET_RULES).toContain('KEINE Aussagen zu Versand, Lieferzeit, Lager, Rückgabe');
    expect(V3_BULLET_RULES).toContain('Doppelpunkt');
  });
  test('eine Antwort im verlangten Format ergibt in der Vorlage fette Stichwörter (Zusammenspiel mit v3Bullets)', () => {
    const antwort = [
      'Elastischer Rand: Passt sich Schüsseln von ca. 14 bis 29 cm an.',
      'Lebensmittelecht: Aus PE gefertigt.',
      'Lieferumfang: 100 Stück je Packung.',
    ];
    expect(v3Bullets(antwort).map(b => b.keyword)).toEqual(['ELASTISCHER RAND', 'LEBENSMITTELECHT', 'LIEFERUMFANG']);
  });
});

describe('api/index.ts nutzt das Format in beiden Prompts und hat keine Versand-Füllsätze mehr', () => {
  const src = readFileSync(join(import.meta.dir, '../api/index.ts'), 'utf8');
  test('beide Prompts binden Block + Regeln ein', () => {
    expect(src.match(/\$\{v3BulletsPromptBlock\(/g)?.length).toBe(2);
    expect(src.match(/\$\{V3_BULLET_RULES\}/g)?.length).toBe(2);
    expect(src).not.toContain('[konkretes Feature/Vorteil');
  });
  test('Fallbacks schieben keine Versand-/Rückgabe-Füllsätze mehr ein', () => {
    expect(src).not.toMatch(/push\('Schnelle Lieferung aus dem EU-Lager'\)/);
    expect(src).not.toMatch(/'30 Tage Rückgabe über eBay Käuferschutz'/);
    expect(src).not.toContain("'Hochwertiges Produkt – schnelle Lieferung aus dem EU-Lager.'");
  });
});
