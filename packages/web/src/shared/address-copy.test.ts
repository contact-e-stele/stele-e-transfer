// Fixture: erfundene Musteradresse (keine echten Käuferdaten im Repo).
import { describe, expect, test } from 'bun:test';
import { addressCopyParts } from './address-copy';

const muster = { fullName: 'Max Mustermann', addressLine1: 'Musterstraße 1', addressLine2: null, city: 'Musterstadt', postalCode: '12345', phone: '1701234567' };

describe('Kopier-Knöpfe Bestellung', () => {
  test('Name, Telefon (unverändert), Adresse in einem', () => {
    expect(addressCopyParts(muster)).toEqual({ name: 'Max Mustermann', phone: '1701234567', address: 'Musterstraße 1, 12345 Musterstadt' });
  });
  test('Adresszusatz kommt mit in die Adresse', () => {
    expect(addressCopyParts({ ...muster, addressLine2: 'c/o Beispiel' }).address).toBe('Musterstraße 1, c/o Beispiel, 12345 Musterstadt');
  });
  test('fehlendes Telefon → kein Knopf', () => {
    expect(addressCopyParts({ ...muster, phone: null }).phone).toBeNull();
    expect(addressCopyParts({ ...muster, phone: '  ' }).phone).toBeNull();
  });
});
