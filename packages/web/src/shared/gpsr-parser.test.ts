import { describe, it, expect } from "bun:test";
import { parseGpsrRaw, resolveGpsrForListing, mfrFieldsFromRaw, planMfrBackfill } from "./gpsr-parser";

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

// ─── A-008 Teil 1: echte Rohtexte aus der Produktions-DB (wortgleich, 01.10.2026) ───────────────
// Hersteller-Befunde: 6-stellige chinesische PLZ, englische Schlüssel, E-Mail-Umbruch, führendes "CN,"/"China", Hausnummern ("No. 1288") dürfen nie als PLZ gelten. Land wird nie aus Stadtnamen geraten.
const RAW_70 = "Name: Shenzhen Yingsi Industrial Co., Ltd.\nAdresse: Nr. 2002, Tangshang Technology Building, Hongbu Road, Nanshan District, Shenzhen City, Provinz Guangdong,\nE-Mail: yingsishiye@163.com\nTelefon: 075523013210\n\n\nAngaben zur verantwortlichen Person in der EU\nName: XDH Tech\nAdresse: 2 Rue Coysevox Bureau 3, Lyon, Frankreich\nE-Mail: xdh.tech@outlook.com\nTelefon: +34 652 768 898";
const RAW_92 = "Herstellerinformationen\nName: Shenzhen Youtuobang Technology Co., Ltd\nAdresse: 208B, Yizhe Building, Yuquan Road, Nantou Street, Nanshan District, Shenzhen, 518000\nE-Mail: youtbus@163.com\nTelefon: 18988523813\n\n\nAngaben zur verantwortlichen Person in der EU\nName: GLOBAL ONE SOLUTION LTD\nAdresse: 6 rue d'Armaillé 75017 Paris, Frankreich\nE-Mail: GOS.business@hotmail.com\nTelefon: +34 615 561159";
const RAW_95 = "Herstellerinformationen\nName: Guangzhou Dinglin Trading Co., Ltd.\nAdresse: Raum 252, Selbstorganisiert, 2. Stock, Nr. 37, Nr. 1 (1), Zhusigang Erma Road, Yuexiu District, Guangzhou, 510000 E-\nMail: gzdlus@163.com\nTelefon: 13631310201\n\n\nAngaben zur verantwortlichen Person in der EU\nName: ASTERNERY SL ESPAÑA (SPANIEN) MADRID\nAdresse: CALLE NUNEZ MORGADO, 5, BUSINESSPOINT\nE-Mail: GOS.business@hotmail.com\nTelefon: +34 615561159";
const RAW_119 = "Herstellerinformationen\n: Name: Shenzhen Jinboxi Technology Co., Ltd.\nAdresse: China 201, Gebäude 1, Nr. 349 Pinglong East Road, Lichang Community, Pinghu Street, Longgang District, Shenzhen, Provinz Guangdong\nE-Mail: Jinboxizhizaoshang@163.com\nTelefon: +86 15779002199\n\n\nInformationen zur verantwortlichen Person in der EU\nName:GAVIMOSA CONSULTORIA, SOCIEDAD LIMITADA\nAdresse:Calle Fernando Chueca Goitia, 13, Portal Derecha, 2A, 28051 Madrid, Spanien\nE-Mail:compliance.gavimosa@outlook.com";
const RAW_132 = "Informationen zum Hersteller \nName: ZhuhaiMituNetwork Technology Co., Ltd\nAdresse: CN-Room 1302, Unit 1, Building 4, No. 1288 HuxinRoad,Doumen District, Zhuhai City, Guangdong Province\nE-Mail-Adresse: qin_fang@foxmail.com\nTelefon: 15118806414\n\n\nInformationen zum EU-Verantwortlichen\nName: SUCCESS COURIER SL\nAdresse: CALLE RIO TORMES NUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada, Madrid，28947 Spain\nE-Mail-Adresse: successservice2@hotmail.com\nTelefon: 910602659";
const RAW_148 = "Herstellerinformationen\n: Name: Yiwu Tian Bing Trading Co., Ltd.\nAdresse: CN, 303, 3. Etage, Gebäudekomplex, B9 Yongjin Avenue, Futian Street, Yiwu City, Jinhua City, Provinz Zhejiang\nE-Mail: 811282008@qq.com\nTelefon: 18367921355\n\n\nAngaben zur verantwortlichen Person in der EU\n: Name: ZHEKAN GmbH,\nAdresse: Römeräcker 8, 76297 Stutensee, Deutschland,\nE-Mail: eken190228@gmail.com,\nTelefon: +44 6975795891";
const RAW_150 = "Informationen zum Hersteller\r\nName: Pujiangdianlimaoyi Co., Ltd.\r\nAdresse: Room 302, Unit 2, Building 4, Jiayi Gold Coast, Huangzhai Town, Pujiang County, Zhejiang Province Pujiang County 322200 Zhejiang Province, Jinhua City\r\nE-Mail-Adresse: 1449719085@qq.com\r\nTelefon: 18858978004\r\n\r\n\r\nInformationen zum EU-Verantwortlichen\r\nName: SUCCESS COURIER SL\r\nAdresse: Company_Name:SUCCESS COURIER SL; Address_CountryandRegion:Spain; Address_CountryandRegion_Simple:ES; Address_District_1:MADRID; Address_District_2:FUENLABRADA; Address_Detail_1:CALLE RIO TORMES NUM.1, PLANTA 1, DERECHA,OFICINA\r\nE-Mail-Adresse: successservice2@hotmail.com\r\nTelefon: 910602659";
const RAW_197 = "Manufacturer information\nName: Yiwu City Meigu Trading Co.,Ltd\nAddress: Room 401, 4th Floor, Building 2, No. D300, Huancheng West Road, Beiyuan Street, Yiwu City, Jinhua City, Zhejiang Province, China\nEmail: mgtrade36@hotmail.com\nPhone: 15382495790\n\nEU responsible person information\nName: SUCCESS COURIER SL\nAddress: Calle Rio Tormes Num. 1, Planta 1, Derecha, Oficina 3, Fuenlabrada, Madrid, 28947, Spanien\nEmail: successservice2@hotmail.com\nPhone: 910602659\n\nProduct identifier: 1005005889377982-12000036214170694";

describe("parseGpsrRaw — A-008 Herstellerblock (echte Rohtexte)", () => {
  it("92: 6-stellige PLZ am Ende (\"Shenzhen, 518000\") wird als PLZ+Ort erkannt, Land bleibt leer (kein Länderwort im Text)", () => {
    const m = parseGpsrRaw(RAW_92).manufacturer!;
    expect(m.city).toBe("518000 Shenzhen");
    expect(m.address).toBe("208B, Yizhe Building, Yuquan Road, Nantou Street, Nanshan District");
    expect(m.country).toBeNull();
  });
  it("95: \"E-\nMail:\"-Umbruch — E-Mail erkannt, \"E-\" gehört nicht mehr zur Adresse, PLZ 510000 erkannt", () => {
    const m = parseGpsrRaw(RAW_95).manufacturer!;
    expect(m.email).toBe("gzdlus@163.com");
    expect(m.city).toBe("510000 Guangzhou");
    expect(m.address).toBe("Raum 252, Selbstorganisiert, 2. Stock, Nr. 37, Nr. 1 (1), Zhusigang Erma Road, Yuexiu District");
  });
  it("132: Hausnummer \"No. 1288 HuxinRoad\" wird NICHT als PLZ gelesen; Land CN aus \"CN-\"", () => {
    const m = parseGpsrRaw(RAW_132).manufacturer!;
    expect(m.city).toBeNull();
    expect(m.country).toBe("CN");
  });
  it("70: \"Nr. 2002, …\" wird NICHT als PLZ gelesen", () => {
    expect(parseGpsrRaw(RAW_70).manufacturer!.city).toBeNull();
  });
  it("148: führendes \"CN, \" → Land CN, keine PLZ geraten", () => {
    const m = parseGpsrRaw(RAW_148).manufacturer!;
    expect(m.country).toBe("CN");
    expect(m.city).toBeNull();
  });
  it("119: führendes Länderwort \"China 201, …\" → Land CN", () => {
    expect(parseGpsrRaw(RAW_119).manufacturer!.country).toBe("CN");
  });
  it("197: englische Schlüssel (Address/Email/Phone) — Adresse, E-Mail, Land CN; EU-Block bleibt erkannt", () => {
    const g = parseGpsrRaw(RAW_197);
    expect(g.manufacturer!.address).toContain("Room 401");
    expect(g.manufacturer!.email).toBe("mgtrade36@hotmail.com");
    expect(g.manufacturer!.country).toBe("CN");
    expect(g.euBlockFound).toBe(true);
    expect(g.name).toBe("SUCCESS COURIER SL");
  });
  it("150: PLZ mitten im Text (\"Pujiang County 322200 Zhejiang Province, Jinhua City\") wird NICHT geraten", () => {
    expect(parseGpsrRaw(RAW_150).manufacturer!.city).toBeNull();
  });
});

describe("resolveGpsrForListing — A-008 Hersteller mit 6-stelliger PLZ", () => {
  const base = { gpsrRaw: RAW_92, gpsrName: null, gpsrAddress: null, gpsrCity: null, gpsrEmail: null, gpsrPhone: null, gpsrCountry: null };
  it("92: PLZ/Ort/Straße ok, nur das Land fehlt → manufacturer null, manufacturerMissing = [Land]", () => {
    const r = resolveGpsrForListing(base);
    expect(r.manufacturer).toBeNull();
    expect(r.manufacturerMissing).toEqual(["Land"]);
  });
});

describe("mfrFieldsFromRaw / planMfrBackfill — A-008 Teil 2 (echte Rohtexte)", () => {
  it("92: Name, Straße, PLZ+Ort, E-Mail, Telefon; KEIN Land (nicht im Text), kein URL-Feld", () => {
    expect(mfrFieldsFromRaw(RAW_92)).toEqual({
      gpsrMfrName: "Shenzhen Youtuobang Technology Co., Ltd",
      gpsrMfrAddress: "208B, Yizhe Building, Yuquan Road, Nantou Street, Nanshan District",
      gpsrMfrCity: "518000 Shenzhen",
      gpsrMfrEmail: "youtbus@163.com",
      gpsrMfrPhone: "18988523813",
    });
  });
  it("132: Hausnummer wird nicht zur Stadt — gpsrMfrCity fehlt, Land CN aus \"CN-\"", () => {
    const f = mfrFieldsFromRaw(RAW_132);
    expect(f.gpsrMfrCity).toBeUndefined();
    expect(f.gpsrMfrCountry).toBe("CN");
  });
  it("EU-Person landet nie im Herstellerfeld (92: EU-Name steht nicht in gpsrMfrName)", () => {
    expect(mfrFieldsFromRaw(RAW_92).gpsrMfrName).not.toBe("GLOBAL ONE SOLUTION LTD");
  });
  it("kein Herstellerblock → leer", () => {
    expect(mfrFieldsFromRaw("")).toEqual({});
    expect(mfrFieldsFromRaw(null)).toEqual({});
  });
  it("planMfrBackfill überschreibt NIE: gefüllte Felder bleiben draußen, nur leere kommen aus dem Parser", () => {
    const plan = planMfrBackfill({ gpsrMfrName: "Von Hand", gpsrMfrCity: "  ", gpsrMfrEmail: null }, RAW_92);
    expect(plan.gpsrMfrName).toBeUndefined();
    expect(plan.gpsrMfrCity).toBe("518000 Shenzhen");
    expect(plan.gpsrMfrEmail).toBe("youtbus@163.com");
  });
  it("planMfrBackfill: alles gefüllt → leerer Plan", () => {
    const full = { gpsrMfrName: "a", gpsrMfrAddress: "b", gpsrMfrCity: "c", gpsrMfrCountry: "CN", gpsrMfrEmail: "e", gpsrMfrPhone: "p" };
    expect(planMfrBackfill(full, RAW_92)).toEqual({});
  });
});

describe("A-008 Review-Fixes — EU-Person nie als Hersteller, EU-Block unverändert", () => {
  const EU_FIRST = "EU responsible person information\nName: EU GmbH\nAddress: Hauptstr 1, 10115 Berlin, Germany\nEmail: eu@example.de\n\nManufacturer information\nName: Foo Ltd\nAddress: Building 2, Longgang District, Shenzhen, 518000, China\nEmail: foo@example.cn";
  it("vertauschte Reihenfolge mit ENGLISCHEN Titeln: Hersteller = Foo Ltd, nie die EU-Person", () => {
    const f = mfrFieldsFromRaw(EU_FIRST);
    expect(f.gpsrMfrName).toBe("Foo Ltd");
    expect(parseGpsrRaw(EU_FIRST).name).toBe("EU GmbH");
  });
  it("reine Positions-Zuordnung ohne passenden Titel: kein Hersteller (leer), statt zu raten", () => {
    const raw = "Name: A Ltd\nAdresse: Weg 1, 10115 Berlin\nE-Mail: a@b.de\n\nName: B Ltd\nAdresse: Weg 2, 20095 Hamburg\nE-Mail: b@c.de";
    expect(mfrFieldsFromRaw(raw)).toEqual({});
  });
  it("EU-Block: führendes Länderwort ändert das EU-Land NICHT (stilles falsches Land verhindert)", () => {
    const mk = (addr: string) => "Hersteller\nName: H Ltd\nAdresse: Weg 1, Shenzhen\nE-Mail: h@h.cn\n\nEU-Verantwortlicher\nName: E GmbH\nAdresse: " + addr + "\nE-Mail: e@e.de";
    expect(parseGpsrRaw(mk("Polen Strasse 5, 10115 Berlin")).country).toBeNull();
    expect(parseGpsrRaw(mk("Italia 12, 10115 Berlin")).country).toBeNull();
  });
  it("Hausnummer-Sperre ist unabhängig von Groß-/Kleinschreibung (room 12345 Foo Road)", () => {
    const raw = "Herstellerinformationen\nName: H Ltd\nAdresse: Building 2, room 12345 Foo Road, Shenzhen\nE-Mail: h@h.cn\n\nEU-Verantwortlicher\nName: E GmbH\nAdresse: Weg 1, 10115 Berlin, Germany\nE-Mail: e@e.de";
    expect(parseGpsrRaw(raw).manufacturer!.city).toBeNull();
  });
  it("6-stellige PLZ am Ende hat Vorrang vor einer Stockwerkzahl (1001 Floor, Shenzhen, 518000)", () => {
    const raw = "Herstellerinformationen\nName: H Ltd\nAdresse: Foo Rd, 1001 Floor, Shenzhen, 518000\nE-Mail: h@h.cn\n\nEU-Verantwortlicher\nName: E GmbH\nAdresse: Weg 1, 10115 Berlin, Germany\nE-Mail: e@e.de";
    expect(parseGpsrRaw(raw).manufacturer!.city).toBe("518000 Shenzhen");
  });
  it("'E-' am Zeilenende eines Wortes (Pierre-) wird nicht als umgebrochenes E-Mail behandelt", () => {
    const raw = "Herstellerinformationen\nName: Pierre-\nMail: x\nAdresse: Weg 1\n\nEU-Verantwortlicher\nName: E GmbH\nAdresse: Weg 1, 10115 Berlin, Germany\nE-Mail: e@e.de";
    expect(parseGpsrRaw(raw).manufacturer!.name).toBe("Pierre-");
  });
});
