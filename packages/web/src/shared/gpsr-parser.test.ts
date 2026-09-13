import { describe, it, expect } from "bun:test";
import { parseGpsrRaw } from "./gpsr-parser";

// Alle Fixtures sind ECHTE gpsr_raw-Werte aus der Produktions-DB (per Skript geprüft,
// wortgleich kopiert — siehe Format-Befund in gpsr-parser.ts), keine erfundenen Daten.

describe("parseGpsrRaw — leerer Rohtext (stele-49)", () => {
  it("liefert nicht_erkannt mit Begründung, füllt nichts", () => {
    const result = parseGpsrRaw(null);
    expect(result.confidence).toBe("nicht_erkannt");
    expect(result.name).toBeNull();
    expect(result.address).toBeNull();
    expect(result.city).toBeNull();
    expect(result.email).toBeNull();
    expect(result.phone).toBeNull();
    expect(result.notes.join(" ")).toContain("leer");
  });
});

describe("parseGpsrRaw — id 66, vollständige Adresse mit PLZ+Stadt+Land auf einer Zeile", () => {
  const raw = `Name: Niulav UG
Adresse: Michelangelostr. 1/1401, 01217 Dresden, DE(Germany)
E-Mail-Adresse: Kuland2@web.de
Telefon: 15252064185


Informationen zum EU-Verantwortlichen
Name: Niulav UG
Adresse: Michelangelostr. 1/1401, 01217 Dresden, DE(Germany)
E-Mail-Adresse: Kuland2@web.de
Telefon: 15252064185`;

  it("erkennt alle 5 Felder aus dem ZWEITEN Block (nicht dem Hersteller-Block)", () => {
    const result = parseGpsrRaw(raw);
    expect(result.name).toBe("Niulav UG");
    expect(result.email).toBe("Kuland2@web.de");
    expect(result.phone).toBe("15252064185");
    expect(result.address).toBe("Michelangelostr. 1/1401");
    expect(result.city).toBe("01217 Dresden");
    expect(result.confidence).toBe("vollstaendig");
    expect(result.notes).toEqual([]);
  });
});

describe("parseGpsrRaw — id 65, Adresse OHNE jede Orts-/PLZ-Angabe", () => {
  const raw = `Informationen zum Hersteller
Name: Niulav UG
Adresse: Michelangelostr. 1/1401
E-Mail-Adresse: Kuland2@web.de
Telefon: 15252064185


Informationen zum EU-Verantwortlichen
Name: Niulav UG
Adresse: Michelangelostr. 1/1401
E-Mail-Adresse: Kuland2@web.de
Telefon: 15252064185`;

  it("lässt gpsr_city NICHT erkannt statt zu raten — Name/E-Mail/Telefon trotzdem erkannt", () => {
    const result = parseGpsrRaw(raw);
    expect(result.name).toBe("Niulav UG");
    expect(result.email).toBe("Kuland2@web.de");
    expect(result.phone).toBe("15252064185");
    expect(result.address).toBe("Michelangelostr. 1/1401");
    expect(result.city).toBeNull();
    expect(result.confidence).toBe("teilweise");
    expect(result.notes.some(n => n.includes("Kein sicheres PLZ+Stadt-Muster"))).toBe(true);
  });
});

describe("parseGpsrRaw — id 64, Label-Variante 'E-Mail-Adresse:', kein Telefon im EU-Block", () => {
  const raw = `Informationen zum Hersteller
Name: Guangzhou Zhirui Trading Co., Ltd.
Adresse: A1984 (location: Shop 103) Shop 101, No. 10 Longdong Commercial Street, Tianhe, Guangzhou, 510000, China
E-Mail-Adresse: service@zreeshop.com


Informationen zum EU-Verantwortlichen
Name: HUMISS TRADING S.L
Adresse: Calle Luis Bañuel 12-3A, Madrid, 28018, Spain
E-Mail-Adresse: eugpsres@outlook.com`;

  it("erkennt Name/Adresse/E-Mail, Telefon bleibt korrekt unerkannt (optional in Quelle)", () => {
    const result = parseGpsrRaw(raw);
    expect(result.name).toBe("HUMISS TRADING S.L");
    expect(result.email).toBe("eugpsres@outlook.com");
    expect(result.phone).toBeNull();
    expect(result.confidence).toBe("teilweise");
    expect(result.notes.some(n => n.includes("Telefon"))).toBe(true);
    // Manufacturer-Kontakt (service@zreeshop.com) darf NICHT im Ergebnis auftauchen
    expect(result.email).not.toBe("service@zreeshop.com");
  });
});

describe("parseGpsrRaw — id 62, Label 'E-Mail:' ohne Leerzeichen nach Doppelpunkt, kein Blocktitel", () => {
  const raw = `Name: ZHUHAI KELITONG ELECTRONIC CO., LTD.
Adresse: Yongan Second Road, Liangang Industry Zone, Jinwan District, Zhuhai, Guangdong, China (China)
E-Mail: 3094653260@QQ.COM
Telefon: +85 13537639607


Informationen zur verantwortlichen Person in der EU
Name:SELL TIME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
Adresse:ul. STANISŁAWA LESZCZYŃSKIEGO Nr. 4 Lok. 25, 50-078 WROCŁAW, Województwo dolnośląskie, POLSKA
E-Mail:ysu8903TIK@163.com`;

  it("findet den EU-Block auch ohne Blocktitel-Erkennung, rein über Position", () => {
    const result = parseGpsrRaw(raw);
    expect(result.name).toBe("SELL TIME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ");
    expect(result.email).toBe("ysu8903TIK@163.com");
    // Polnisches PLZ-Format (XX-XXX) wird erkannt.
    expect(result.address).toBe("ul. STANISŁAWA LESZCZYŃSKIEGO Nr. 4 Lok. 25");
    expect(result.city).toBe("50-078 WROCŁAW");
  });
});

describe("parseGpsrRaw — id 140, führendes Doppelpunkt-Artefakt ': Name: …'", () => {
  const raw = `Herstellerinformationen
Name:XUAN TECH SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
Adresse:PL-ul. NOWOGRODZKA, Nr. 64, lok. 43, miejsc. WARSZAWA,02-014,POLSKA
E-Mail:dongbi78317395tr@163.com
Telefon:508065548


Informationen zur verantwortlichen Person in der EU
: Name: UKFR Fulfilment Service
Adresse: FR-79 rue de Patay 75013 Paris Frankreich
E-Mail: info@fb-ukfr.com
Telefon: +34 651718917`;

  it("toleriert das Artefakt und erkennt den Namen trotzdem korrekt", () => {
    const result = parseGpsrRaw(raw);
    expect(result.name).toBe("UKFR Fulfilment Service");
    expect(result.email).toBe("info@fb-ukfr.com");
    expect(result.phone).toBe("+34 651718917");
  });
});

describe("parseGpsrRaw — id 64, umgekehrte Reihenfolge 'Stadt, PLZ, Land'", () => {
  const raw = `Informationen zum Hersteller
Name: Guangzhou Zhirui Trading Co., Ltd.
Adresse: A1984 (location: Shop 103) Shop 101, No. 10 Longdong Commercial Street, Tianhe, Guangzhou, 510000, China
E-Mail-Adresse: service@zreeshop.com


Informationen zum EU-Verantwortlichen
Name: HUMISS TRADING S.L
Adresse: Calle Luis Bañuel 12-3A, Madrid, 28018, Spain
E-Mail-Adresse: eugpsres@outlook.com`;

  it("erkennt Madrid als Stadt — NICHT 'Spain' (Regressionsschutz für die Länder-Sperrliste)", () => {
    const result = parseGpsrRaw(raw);
    expect(result.address).toBe("Calle Luis Bañuel 12-3A");
    expect(result.city).toBe("28018 Madrid");
    expect(result.city).not.toContain("Spain");
  });
});

describe("parseGpsrRaw — id 150, Adresse als durchgerutschter Formularfeld-Dump", () => {
  const raw = `Informationen zum Hersteller
Name: Pujiangdianlimaoyi Co., Ltd.
Adresse: Room 302, Unit 2, Building 4, Jiayi Gold Coast, Huangzhai Town, Pujiang County, Zhejiang Province Pujiang County 322200 Zhejiang Province, Jinhua City
E-Mail-Adresse: 1449719085@qq.com
Telefon: 18858978004


Informationen zum EU-Verantwortlichen
Name: SUCCESS COURIER SL
Adresse: Company_Name:SUCCESS COURIER SL; Address_CountryandRegion:Spain; Address_CountryandRegion_Simple:ES; Address_District_1:MADRID; Address_District_2:FUENLABRADA; Address_Detail_1:CALLE RIO TORMES NUM.1, PLANTA 1, DERECHA,OFICINA
E-Mail-Adresse: successservice2@hotmail.com
Telefon: 910602659`;

  it("erkennt den Formularfeld-Dump als solchen — Rohwert in address, city nicht erkannt", () => {
    const result = parseGpsrRaw(raw);
    expect(result.name).toBe("SUCCESS COURIER SL");
    expect(result.email).toBe("successservice2@hotmail.com");
    expect(result.address).toContain("Company_Name:SUCCESS COURIER SL");
    expect(result.city).toBeNull();
    expect(result.confidence).toBe("teilweise");
    expect(result.notes.some(n => n.includes("Formularfeld-Dump"))).toBe(true);
  });
});

describe("parseGpsrRaw — Format weicht komplett ab (Regressionsschutz für die Blockerkennung)", () => {
  it("gibt nicht_erkannt zurück statt zu raten, wenn nicht genau 2 Name:-Blöcke gefunden werden", () => {
    const result = parseGpsrRaw("Irgendein Text ohne das erwartete Format.");
    expect(result.confidence).toBe("nicht_erkannt");
    expect(result.name).toBeNull();
    expect(result.notes.some(n => n.includes("2"))).toBe(true);
  });
});
