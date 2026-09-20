import { describe, expect, test } from 'bun:test';
import { parseMissingAspectNames, stillMissingAspectNames } from './missing-aspects';

describe('parseMissingAspectNames', () => {
  test('leer/null/undefined → leeres Array', () => {
    expect(parseMissingAspectNames(null)).toEqual([]);
    expect(parseMissingAspectNames(undefined)).toEqual([]);
    expect(parseMissingAspectNames('')).toEqual([]);
  });

  test('ein Name → Array mit einem Eintrag', () => {
    expect(parseMissingAspectNames('Farbe')).toEqual(['Farbe']);
  });

  test('mehrere kommagetrennte Namen → alle einzeln, getrimmt', () => {
    expect(parseMissingAspectNames('Farbe, Produktart,  Material')).toEqual(['Farbe', 'Produktart', 'Material']);
  });
});

describe('stillMissingAspectNames', () => {
  test('P-88 Nacharbeit NACHWEIS: mehrere fehlende Felder → nur die OHNE manuellen Wert bleiben übrig', () => {
    const result = stillMissingAspectNames('Farbe, Produktart', { Farbe: 'Rot' });
    expect(result).toEqual(['Produktart']);
  });

  test('alle fehlenden Felder ausgefüllt → leeres Array (vollständig gelöst)', () => {
    const result = stillMissingAspectNames('Farbe, Produktart', { Farbe: 'Rot', Produktart: 'Haarspange' });
    expect(result).toEqual([]);
  });

  test('leerer/nur-Leerzeichen manueller Wert zählt NICHT als ausgefüllt', () => {
    const result = stillMissingAspectNames('Farbe', { Farbe: '   ' });
    expect(result).toEqual(['Farbe']);
  });

  test('keine manualAspects vorhanden → alle bleiben fehlend', () => {
    const result = stillMissingAspectNames('Farbe, Produktart', null);
    expect(result).toEqual(['Farbe', 'Produktart']);
  });
});
