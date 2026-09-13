# GPSR Schritt 1 — Parse-Bericht (gpsr_raw → strukturierte Felder)

Erzeugt mit `bun --env-file=<repo>/.env scripts/gpsr-parse-report.ts` gegen die echte Produktions-DB.
**Reine Analyse — es wurde NICHTS in die DB geschrieben, gpsr_raw ist unverändert.**

## Zahlen

- Produkte gesamt: **50**
- gpsr_raw leer (Sonderfall): **1** — stele-49
- vollständig erkannt (alle 5 Felder — Name, Straße, PLZ+Stadt, E-Mail, Telefon): **23**
- teilweise erkannt (mindestens Name oder E-Mail, aber nicht alle 5 Felder): **26**
- gar nicht erkannt (inkl. der 1 mit leerem gpsr_raw): **1**

## Sonderfall: gpsr_raw komplett leer

- **stele-49** (id 49) — gpsr_raw ist leer. Kann nicht automatisch befüllt werden, muss manuell nachgetragen werden.

## Vollständige Tabelle

| SKU | gpsr_raw (Original) | Name | Straße+Nr. | PLZ+Stadt | E-Mail | Telefon | Sicher erkannt | Hinweise |
|---|---|---|---|---|---|---|---|---|
| stele-49 | _(leer)_ | _nicht erkannt_ | _nicht erkannt_ | _nicht erkannt_ | _nicht erkannt_ | _nicht erkannt_ | nein | gpsr_raw ist leer — nichts zu parsen (manueller Nachtrag nötig) |
| stele-62 | <pre>Name: ZHUHAI KELITONG ELECTRONIC CO., LTD.
Adresse: Yongan Second Road, Liangang Industry Zone, Jinwan District, Zhuhai, Guangdong, China (China)
E-Mail: 3094653260@QQ.COM
Telefon: +85 13537639607


Informationen zur verantwortlichen Person in der EU
Name:SELL TIME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
Adresse:ul. STANISŁAWA LESZCZYŃSKIEGO Nr. 4 Lok. 25, 50-078 WROCŁAW, Województwo dolnośląskie, POLSKA
E-Mail:ysu8903TIK@163.com</pre> | SELL TIME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ | ul. STANISŁAWA LESZCZYŃSKIEGO Nr. 4 Lok. 25 | 50-078 WROCŁAW | ysu8903TIK@163.com | _nicht erkannt_ | teilweise | Telefon im EU-Block nicht angegeben (Feld ist in der Quelle optional) |
| stele-64 | <pre>Informationen zum Hersteller
Name: Guangzhou Zhirui Trading Co., Ltd.
Adresse: A1984 (location: Shop 103) Shop 101, No. 10 Longdong Commercial Street, Tianhe, Guangzhou, 510000, China
E-Mail-Adresse: service@zreeshop.com


Informationen zum EU-Verantwortlichen
Name: HUMISS TRADING S.L
Adresse: Calle Luis Bañuel 12-3A, Madrid, 28018, Spain
E-Mail-Adresse: eugpsres@outlook.com</pre> | HUMISS TRADING S.L | Calle Luis Bañuel 12-3A | 28018 Madrid | eugpsres@outlook.com | _nicht erkannt_ | teilweise | Telefon im EU-Block nicht angegeben (Feld ist in der Quelle optional) |
| stele-65 | <pre>Informationen zum Hersteller
Name: Niulav UG
Adresse: Michelangelostr. 1/1401
E-Mail-Adresse: Kuland2@web.de
Telefon: 15252064185


Informationen zum EU-Verantwortlichen
Name: Niulav UG
Adresse: Michelangelostr. 1/1401
E-Mail-Adresse: Kuland2@web.de
Telefon: 15252064185</pre> | Niulav UG | Michelangelostr. 1/1401 | _nicht erkannt_ | Kuland2@web.de | 15252064185 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-66 | <pre>Name: Niulav UG
Adresse: Michelangelostr. 1/1401, 01217 Dresden, DE(Germany)
E-Mail-Adresse: Kuland2@web.de
Telefon: 15252064185


Informationen zum EU-Verantwortlichen
Name: Niulav UG
Adresse: Michelangelostr. 1/1401, 01217 Dresden, DE(Germany)
E-Mail-Adresse: Kuland2@web.de
Telefon: 15252064185</pre> | Niulav UG | Michelangelostr. 1/1401 | 01217 Dresden | Kuland2@web.de | 15252064185 | ja | – |
| stele-67 | <pre>nformationen zum Hersteller
Name: Guangzhou Zhirui Trading Co., Ltd.
Adresse: A1984 (location: Shop 103) Shop 101, No. 10 Longdong Commercial Street, Tianhe, Guangzhou, 510000, China
E-Mail-Adresse: service@zreeshop.com


Informationen zum EU-Verantwortlichen
Name: HUMISS TRADING S.L
Adresse: Calle Luis Bañuel 12-3A, Madrid, 28018, Spain
E-Mail-Adresse: eugpsres@outlook.com</pre> | HUMISS TRADING S.L | Calle Luis Bañuel 12-3A | 28018 Madrid | eugpsres@outlook.com | _nicht erkannt_ | teilweise | Telefon im EU-Block nicht angegeben (Feld ist in der Quelle optional) |
| stele-70 | <pre>Name: Shenzhen Yingsi Industrial Co., Ltd.
Adresse: Nr. 2002, Tangshang Technology Building, Hongbu Road, Nanshan District, Shenzhen City, Provinz Guangdong,
E-Mail: yingsishiye@163.com
Telefon: 075523013210


Angaben zur verantwortlichen Person in der EU
Name: XDH Tech
Adresse: 2 Rue Coysevox Bureau 3, Lyon, Frankreich
E-Mail: xdh.tech@outlook.com
Telefon: +34 652 768 898</pre> | XDH Tech | 2 Rue Coysevox Bureau 3, Lyon, Frankreich | _nicht erkannt_ | xdh.tech@outlook.com | +34 652 768 898 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-71 | <pre>Herstellerinformationen
Name: Jianghai District Feikeliya Lighting Store
Adresse: Guangdong, Jiangmen, Jianghai District, Waihai Qianjin Lanhuawei First Alley No. 23, 1st Floor
E-Mail: 1163197956@qq.com
Telefon: 18207500123


Informationen zur verantwortlichen Person in der EU
Name:JUN E-COMMERCE
Adresse:6 RUE D ARMAILLE,75017,PARIS FR
E-Mail:junecommerce2024@gmail.com
Telefon:769779007</pre> | JUN E-COMMERCE | 6 RUE D ARMAILLE | 75017 PARIS | junecommerce2024@gmail.com | 769779007 | ja | – |
| stele-75 | <pre>Informationen zum Hersteller
Name: Shenzhen Yunchotai Technology Co., Ltd.
Adresse: Room 830D, Building 615, Bagualing Industrial Zone, Bagua 2nd Road, Pengsheng Community, Yuanling Street, Futian District, Shenzhen CN Guangdong Province 440304
E-Mail-Adresse: qiyund1@163.com
Telefon: 18923434357


Informationen zum EU-Verantwortlichen
Name: MJCM SARL
Adresse: FR-78 avenue des champs Elysees Bureau 326,PARIS,FR(France)
E-Mail-Adresse: mjcm190928@gmail.com
Telefon: 767213611</pre> | MJCM SARL | FR-78 avenue des champs Elysees Bureau 326,PARIS,FR(France) | _nicht erkannt_ | mjcm190928@gmail.com | 767213611 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-77 | <pre>Informationen zum Hersteller
Name: Shenzhen Yuda Yingtu E-Commerce Co., Ltd.
Adresse: 6F07, between Axes A-D, 1-15, Building 3, SEG Science and Technology Industrial Park, Huaqiang North Road, Huaqiangbei Street, Futian District, Shenzhen City.
E-Mail-Adresse: colin@pasup.net
Telefon: 13418617726


Informationen zum EU-Verantwortlichen
Name: DeCio Service GmbH
Adresse: Landsberger Allee 394, 12681 Berlin
E-Mail-Adresse: deeda001@hotmail.com
Telefon: 1788973658</pre> | DeCio Service GmbH | Landsberger Allee 394 | 12681 Berlin | deeda001@hotmail.com | 1788973658 | ja | – |
| stele-78 | <pre>Name: Yiwu Ye Wuheng daily necessities Co., LTD;
Adresse: CN-1806, Einheit 2, Gebäude 4, Nr. 778, Chengdian South Road, Choujiang Straße, Yiwu City, Jinhua City, Provinz Zhejiang;
E-Mail: 458533@qq.com
Telefon: 18279011361


Informationen zum EU-Verantwortlichen
Name:E-CrossStu-GmbH
Adresse:Mainzer Landstr. 69 , Frankfurt am Main
E-Mail:E-CrossStu@web.de
Telefon:69332967674</pre> | E-CrossStu-GmbH | Mainzer Landstr. 69 , Frankfurt am Main | _nicht erkannt_ | E-CrossStu@web.de | 69332967674 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-82 | <pre>Informationen zum Hersteller
Name: Zhejiang Xianlu New Materials Co., Ltd
Adresse: No.1, Juhai 2nd Road, Qujiang District
E-Mail-Adresse: monadealiexpress@163.com
Telefon: 17366385599


Informationen zum EU-Verantwortlichen
Name: MJCM SARL
Adresse: 78 avenue des Champs Elysees Bureau 326,PARIS,FR(France)
E-Mail-Adresse: mjcm190928@gmail.com
Telefon: 767213611</pre> | MJCM SARL | 78 avenue des Champs Elysees Bureau 326,PARIS,FR(France) | _nicht erkannt_ | mjcm190928@gmail.com | 767213611 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-83 | <pre>Informationen zum Hersteller
Name: ZHUHAI KELITONG ELECTRONIC CO., LTD.
Adresse: Yongan Second Road, Liangang Industry Zone, Jinwan District,Zhuhai,Guangdong,CN(China)
E-Mail-Adresse: 3094653260@QQ.COM
Telefon: 13537639607


Informationen zum EU-Verantwortlichen
Name: SELL TIME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
Adresse: ul. STANISŁAWA LESZCZYŃSKIEGO nr 4 lok. 25, 50-078 WROCŁAW, Województwo dolnośląskie, POLSKA
E-Mail-Adresse: ysu8903TIK@163.com</pre> | SELL TIME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ | ul. STANISŁAWA LESZCZYŃSKIEGO nr 4 lok. 25 | 50-078 WROCŁAW | ysu8903TIK@163.com | _nicht erkannt_ | teilweise | Telefon im EU-Block nicht angegeben (Feld ist in der Quelle optional) |
| stele-85 | <pre>Herstellerinformationen
Name: ZHUHAI KELITONG ELECTRONIC CO., LTD.
Adresse: Yongan Second Road, Liangang Industry Zone, Jinwan District, Zhuhai, Guangdong, China (China)
E-Mail: 3094653260@QQ.COM
Telefon: +85 13537639607


Informationen zur verantwortlichen Person in der EU
Name:SELL TIME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
Adresse:ul. STANISŁAWA LESZCZYŃSKIEGO Nr. 4 Lok. 25, 50-078 WROCŁAW, Województwo dolnośląskie, POLSKA
E-Mail:ysu8903TIK@163.com</pre> | SELL TIME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ | ul. STANISŁAWA LESZCZYŃSKIEGO Nr. 4 Lok. 25 | 50-078 WROCŁAW | ysu8903TIK@163.com | _nicht erkannt_ | teilweise | Telefon im EU-Block nicht angegeben (Feld ist in der Quelle optional) |
| stele-87 | <pre>Herstellerinformationen
Name: ZHUHAI KELITONG ELECTRONIC CO., LTD.
Adresse: Yongan Second Road, Liangang Industry Zone, Jinwan District, Zhuhai, Guangdong, China (China)
E-Mail: 3094653260@QQ.COM
Telefon: +85 13537639607


Informationen zur verantwortlichen Person in der EU
Name:SELL TIME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
Adresse:ul. STANISŁAWA LESZCZYŃSKIEGO Nr. 4 Lok. 25, 50-078 WROCŁAW, Województwo dolnośląskie, POLSKA
E-Mail:ysu8903TIK@163.com</pre> | SELL TIME SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ | ul. STANISŁAWA LESZCZYŃSKIEGO Nr. 4 Lok. 25 | 50-078 WROCŁAW | ysu8903TIK@163.com | _nicht erkannt_ | teilweise | Telefon im EU-Block nicht angegeben (Feld ist in der Quelle optional) |
| stele-89 | <pre>Herstellerinformationen
Name:KIVARO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
Adresse:ul. STANISŁAWA LESZCZYŃSKIEGO, Nr. 4, lok. 25, miejsc. WROCŁAW, kod 50-078, poczta WROCŁAW, kraj POLSKA
E-Mail:natb46@163.com


Informationen zur verantwortlichen Person in der EU
: Name: UKFR Fulfilment Service
Adresse: FR-79 rue de Patay 75013 Paris Frankreich
E-Mail: info@fb-ukfr.com
Telefon: +34 651718917</pre> | UKFR Fulfilment Service | FR-79 rue de Patay | 75013 Paris | info@fb-ukfr.com | +34 651718917 | ja | – |
| stele-92 | <pre>Herstellerinformationen
Name: Shenzhen Youtuobang Technology Co., Ltd
Adresse: 208B, Yizhe Building, Yuquan Road, Nantou Street, Nanshan District, Shenzhen, 518000
E-Mail: youtbus@163.com
Telefon: 18988523813


Angaben zur verantwortlichen Person in der EU
Name: GLOBAL ONE SOLUTION LTD
Adresse: 6 rue d'Armaillé 75017 Paris, Frankreich
E-Mail: GOS.business@hotmail.com
Telefon: +34 615 561159</pre> | GLOBAL ONE SOLUTION LTD | 6 rue d'Armaillé | 75017 Paris | GOS.business@hotmail.com | +34 615 561159 | ja | – |
| stele-94 | <pre>Herstellerinformationen
Name:KIVARO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
Adresse:ul. STANISŁAWA LESZCZYŃSKIEGO, Nr. 4, lok. 25, miejsc. WROCŁAW, kod 50-078, poczta WROCŁAW, kraj POLSKA
E-Mail:natb46@163.com


Angaben zur verantwortlichen Person in der EU
Name: UKFR Fulfilment Service
Adresse: 79 rue de Patay 75013 Paris Frankreich
E-Mail: info@fb-ukfr.com
Telefon: +34 651718917</pre> | UKFR Fulfilment Service | 79 rue de Patay | 75013 Paris | info@fb-ukfr.com | +34 651718917 | ja | – |
| stele-95 | <pre>Herstellerinformationen
Name: Guangzhou Dinglin Trading Co., Ltd.
Adresse: Raum 252, Selbstorganisiert, 2. Stock, Nr. 37, Nr. 1 (1), Zhusigang Erma Road, Yuexiu District, Guangzhou, 510000 E-
Mail: gzdlus@163.com
Telefon: 13631310201


Angaben zur verantwortlichen Person in der EU
Name: ASTERNERY SL ESPAÑA (SPANIEN) MADRID
Adresse: CALLE NUNEZ MORGADO, 5, BUSINESSPOINT
E-Mail: GOS.business@hotmail.com
Telefon: +34 615561159</pre> | ASTERNERY SL ESPAÑA (SPANIEN) MADRID | CALLE NUNEZ MORGADO, 5, BUSINESSPOINT | _nicht erkannt_ | GOS.business@hotmail.com | +34 615561159 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-96 | <pre>Informationen zum Hersteller
Name: NYAXINGN SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
Adresse: PL-ul. STANISŁAWA LESZCZYŃSKIEGO, nr 4, lok. 25, miejsc. WROCŁAW,POLSKA
E-Mail-Adresse: gupengyuanh899@163.com
Telefon: 508065548


Informationen zum EU-Verantwortlichen
Name: UKFR Fulfilment Service
Adresse: FR-FR-79 rue de Patay 75013 Paris France
E-Mail-Adresse: info@fb-ukfr.com
Telefon: 651718917</pre> | UKFR Fulfilment Service | FR-FR-79 rue de Patay | 75013 Paris | info@fb-ukfr.com | 651718917 | ja | – |
| stele-97 | <pre>nformationen zum Hersteller
Name: Shenzhen Youtuobang Technology Co., Ltd
Adresse: 208B, Yizhe Building, Yuquan Road, Nantou Street, Nanshan District, Shenzhen,518000
E-Mail-Adresse: youtbus@163.com
Telefon: 18988523813


Informationen zum EU-Verantwortlichen
Name: GLOBAL ONE SOLUTION LTD
Adresse: 6 rue d'Armaillé 75017 Paris, France
E-Mail-Adresse: GOS.business@hotmail.com
Telefon: 34615561159</pre> | GLOBAL ONE SOLUTION LTD | 6 rue d'Armaillé | 75017 Paris | GOS.business@hotmail.com | 34615561159 | ja | – |
| stele-100 | <pre>Informationen zum Hersteller
Name: Shenzhen jieshunrong technology co., ltd
Adresse: North side 202 no. 92, ruyi road, xinlian community, longcheng street, longgang district, shenzhen city, guangdong province
E-Mail-Adresse: jieshunrong88@163.com
Telefon: 13510305397


Informationen zum EU-Verantwortlichen
Name: sea&Mew ConsuIting GmbH
Adresse: Mittenhuber straBe4`92318Neumarkt
E-Mail-Adresse: Compliance.EU@outIook.com
Telefon: 15224685061</pre> | sea&Mew ConsuIting GmbH | Mittenhuber straBe4`92318Neumarkt | _nicht erkannt_ | Compliance.EU@outIook.com | 15224685061 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-107 | <pre>Herstellerinformationen
Name: Yiwu Xinzhan Technology Co. Ltd.
Adresse: 1. Stock, Haike E-Commerce Park, Jiangdong-Unterbezirk, Yiwu City
E-Mail: 2699523@qq.com
Telefon: 18867128024


Angaben zur verantwortlichen Person in der EU
Name: Apex CE Specialists GmbH,
Adresse: Grafenberger Allee 277-287, 40237 Düsseldorf, Deutschland,
E-Mail: info@apex-ce.com,
Telefon: +30 211 8639 2011</pre> | Apex CE Specialists GmbH | Grafenberger Allee 277-287 | 40237 Düsseldorf | info@apex-ce.com | +30 211 8639 2011 | ja | – |
| stele-110 | <pre>Herstellerinformationen
: Name: Yiwu Xinzhan Technology Co. Ltd.
Adresse: 1. Stock, Haike E-Commerce Park, Jiangdong-Unterbezirk, Yiwu City
E-Mail: 2699523@qq.com
Telefon: 18867128024


Angaben zur verantwortlichen Person in der EU
: Name: Apex CE Specialists GmbH,
Adresse: Grafenberger Allee 277-287, 40237 Düsseldorf, Deutschland,
E-Mail: info@apex-ce.com,
Telefon: +30 211 8639 2011</pre> | Apex CE Specialists GmbH | Grafenberger Allee 277-287 | 40237 Düsseldorf | info@apex-ce.com | +30 211 8639 2011 | ja | – |
| stele-119 | <pre>Herstellerinformationen
: Name: Shenzhen Jinboxi Technology Co., Ltd.
Adresse: China 201, Gebäude 1, Nr. 349 Pinglong East Road, Lichang Community, Pinghu Street, Longgang District, Shenzhen, Provinz Guangdong
E-Mail: Jinboxizhizaoshang@163.com
Telefon: +86 15779002199


Informationen zur verantwortlichen Person in der EU
Name:GAVIMOSA CONSULTORIA, SOCIEDAD LIMITADA
Adresse:Calle Fernando Chueca Goitia, 13, Portal Derecha, 2A, 28051 Madrid, Spanien
E-Mail:compliance.gavimosa@outlook.com</pre> | GAVIMOSA CONSULTORIA, SOCIEDAD LIMITADA | Calle Fernando Chueca Goitia, 13, Portal Derecha, 2A | 28051 Madrid | compliance.gavimosa@outlook.com | _nicht erkannt_ | teilweise | Telefon im EU-Block nicht angegeben (Feld ist in der Quelle optional) |
| stele-120 | <pre>Informationen zum Hersteller
Name: Pingyang Maoqiang Leather Co.. Ltd
Adresse: 105 Jiangshan East Road, Shuitou Town, Pingyang County, Wenzhou City,Zhejiang Province, China
E-Mail-Adresse: jiabaobelt@163.com
Telefon: 13157799662


Informationen zum EU-Verantwortlichen
Name: MJCM SARL
Adresse: 78 avenue des Champs Elysees Bureau 326
E-Mail-Adresse: mjcm190928@gmail.com
Telefon: 752907452</pre> | MJCM SARL | 78 avenue des Champs Elysees Bureau 326 | _nicht erkannt_ | mjcm190928@gmail.com | 752907452 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-121 | <pre>Informationen zum Hersteller
Name: Dongguan Huanyu E-Commerce Co., Ltd.
Adresse: No. 68, Longping East Road, Fenggang Town, Dongguan City
E-Mail-Adresse: dghyyg@163.com
Telefon: 13995640590


Informationen zum EU-Verantwortlichen
Name: eVatmaster Consulting GmbH
Adresse: Bettinastr. 30 Frankfurt am Main,Germany
E-Mail-Adresse: contact@evatmaster.com
Telefon: 6995179070</pre> | eVatmaster Consulting GmbH | Bettinastr. 30 Frankfurt am Main,Germany | _nicht erkannt_ | contact@evatmaster.com | 6995179070 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-122 | <pre>Informationen zum Hersteller
Name: Jinhua Zhiyuqu E-commerce Co., Ltd.
Adresse: East side, 3rd floor, Building 1, Jinhua Shuangying Tool Factory, No. 228 Wulian Street, Chisong Town, Jindong District, Jinhua City, Zhejiang Province
E-Mail-Adresse: zhu15397521963@163.com
Telefon: 13235896605


Informationen zum EU-Verantwortlichen
Name: VAT SPEED SL
Adresse: Calle Antonio Salvador N99.1,28026 Madrid,Spain
E-Mail-Adresse: services@vatspeed-eu.com
Telefon: 916321624</pre> | VAT SPEED SL | Calle Antonio Salvador N99.1 | 28026 Madrid | services@vatspeed-eu.com | 916321624 | ja | – |
| stele-123 | <pre>Informationen zum Hersteller
Name: Yiwu Gemai E-Commerce Co., Ltd.
Adresse: Room 405, Unit 1, Building 28, Xigu Village, Jiangdong Subdistrict, Yiwu City, Jinhua City, Zhejiang Province,China
E-Mail-Adresse: 2699523@qq.com
Telefon: 18867128024


Informationen zum EU-Verantwortlichen
Name: Apex CE Specialists GmbH
Adresse: Grafenberger Allee 277-287,40237 Düsseldorf,DE
E-Mail-Adresse: info@apex-ce.com
Telefon: 21186392011</pre> | Apex CE Specialists GmbH | Grafenberger Allee 277-287 | 40237 Düsseldorf | info@apex-ce.com | 21186392011 | ja | – |
| stele-127 | <pre>Informationen zum Hersteller 
Name: Pingyang Maoqiang Leather Co.. Ltd
Adresse: 105 Jiangshan East Road, Shuitou Town, Pingyang County, Wenzhou City,Zhejiang Province, China
E-Mail-Adresse: jiabaobelt@163.com 
Telefon: 13157799662


Informationen zum EU-Verantwortlichen
Name: MJCM SARL
Adresse: 78 avenue des Champs Elysees Bureau 326
E-Mail-Adresse: mjcm190928@gmail.com
Telefon: 752907452</pre> | MJCM SARL | 78 avenue des Champs Elysees Bureau 326 | _nicht erkannt_ | mjcm190928@gmail.com | 752907452 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-129 | <pre>Herstellerinformationen
Name: Xuyi Stone Axe Technology Co., Ltd
Adresse: Nr. 99 Huaihe South Road, Xucheng Street, Xuyi County, Huai'an City, Provinz Jiangsu
E-Mail: 15312300300@189.cn
Telefon: 15312300300


Angaben zur verantwortlichen Person in der EU
: Name: APEX CE SPECIALISTS
Adresse: 64 Rue Waldeck Rousseau, 69006 Lyon, Rhône, Frankreich
E-Mail: Julien@specialisis.com
Telefon: +34 780752086</pre> | APEX CE SPECIALISTS | 64 Rue Waldeck Rousseau | 69006 Lyon | Julien@specialisis.com | +34 780752086 | ja | – |
| stele-131 | <pre>Informationen zum Hersteller 
Name: Yiwu Yifeng E-commerce Firm
Adresse: Room 304,Unit 1,Building 25,Qingyan Liu A District,Jiangdong Street,Jinhua,Zhejiang
E-Mail-Adresse: 1042110248@qq.com
Telefon: 18257812459


Informationen zum EU-Verantwortlichen
Name: SUCCESS COURIER SL
Adresse: ES-CALLE RIO TORMES NUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada, Madrid, 28947
E-Mail-Adresse: successservice2@hotmail.com
Telefon: 910602659</pre> | SUCCESS COURIER SL | ES-CALLE RIO TORMES NUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada | 28947 Madrid | successservice2@hotmail.com | 910602659 | ja | – |
| stele-132 | <pre>Informationen zum Hersteller 
Name: ZhuhaiMituNetwork Technology Co., Ltd
Adresse: CN-Room 1302, Unit 1, Building 4, No. 1288 HuxinRoad,Doumen District, Zhuhai City, Guangdong Province
E-Mail-Adresse: qin_fang@foxmail.com
Telefon: 15118806414


Informationen zum EU-Verantwortlichen
Name: SUCCESS COURIER SL
Adresse: CALLE RIO TORMES NUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada, Madrid，28947 Spain
E-Mail-Adresse: successservice2@hotmail.com
Telefon: 910602659</pre> | SUCCESS COURIER SL | CALLE RIO TORMES NUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada | 28947 Madrid | successservice2@hotmail.com | 910602659 | ja | – |
| stele-135 | <pre>Informationen zum Hersteller 
Name: Shenzhen Tengsheng Technology Trading Co.,LTD
Adresse: 5th Floor Yonghuile technology. No.58 Yousong Road, Longhua District,Shenzhenshi,China
E-Mail-Adresse: 1099936556@qq.com
Telefon: 13662246105


Informationen zum EU-Verantwortlichen
Name: Prolinx GmbH
Adresse: Duesseldorf Brehmstr.56
E-Mail-Adresse: eu@eulinx.eu
Telefon: 2113105498</pre> | Prolinx GmbH | Duesseldorf Brehmstr.56 | _nicht erkannt_ | eu@eulinx.eu | 2113105498 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-136 | <pre>Informationen zum Hersteller 
Name: Wuhan Pinjia Shi Technology Co., Ltd
Adresse: B6-701, 2nd Floor, Building 15, Jiangcheng No.1 Cultural and Creative Park, No. 47 Gutian 4th Road, Qiaokou District, Wuhan
E-Mail-Adresse: moonlightshai@163.com
Telefon: 19926823513


Informationen zum EU-Verantwortlichen
Name: SUCCESS COURIER SL
Adresse: CALLE RIO TORMES NUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada, Madrid, 28947 Spain 
E-Mail-Adresse: successservice2@hotmail.com
Telefon: 910602659</pre> | SUCCESS COURIER SL | CALLE RIO TORMES NUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada | 28947 Madrid | successservice2@hotmail.com | 910602659 | ja | – |
| stele-137 | <pre>Informationen zum Hersteller 
Name: Wenzhou Dianjin Industry Trade Co., Ltd.
Adresse: CN-CN-No. 95, Binhai Sidao, Wenzhou City, Zhejiang Province.
E-Mail-Adresse: 38846590@qq.com
Telefon: 18001768882


Informationen zum EU-Verantwortlichen
Name: SUCCESS COURIER SL
Adresse: CALLE RIO TORMES NUM.1,PLANTA1,DERECHA,OFICINA 3,Fuenlabrada
Madrid
E-Mail-Adresse: successservice2@hotmail.com
Telefon: 910602659</pre> | SUCCESS COURIER SL | CALLE RIO TORMES NUM.1,PLANTA1,DERECHA,OFICINA 3,Fuenlabrada | _nicht erkannt_ | successservice2@hotmail.com | 910602659 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-138 | <pre>Informationen zum Hersteller 
Name: Shenzhen Yixingsheng Trading Co., Ltd.
Adresse: CN-No. 289, Ainan Road, Nanlian Community, Longgang Street, Longgang District, Shenzhen, Guangdong Province, 317
E-Mail-Adresse: 735062025@qq.com
Telefon: 153618387652


Informationen zum EU-Verantwortlichen
Name: SUCCESS COURIER SL
Adresse: ES-ES-CALLE RIO TORMES NUM.1, PLANTA 1,DERECHA, OFICINA 3,Fuenlabrada,Madrid,28947 Spain
E-Mail-Adresse: successservice2@hotmail.com
Telefon: 910602659</pre> | SUCCESS COURIER SL | ES-ES-CALLE RIO TORMES NUM.1, PLANTA 1,DERECHA, OFICINA 3,Fuenlabrada | 28947 Madrid | successservice2@hotmail.com | 910602659 | ja | – |
| stele-139 | <pre>Informationen zum Hersteller
Name: Shenzhen Youtuobang Technology Co., Ltd
Adresse: 208B, Yizhe Building, Yuquan Road, Nantou Street, Nanshan District, Shenzhen,518000
E-Mail-Adresse: youtbus@163.com
Telefon: 18988523813


Informationen zum EU-Verantwortlichen
Name: GLOBAL ONE SOLUTION LTD
Adresse: 6 rue d'Armaillé 75017 Paris, France
E-Mail-Adresse: GOS.business@hotmail.com
Telefon: 34615561159</pre> | GLOBAL ONE SOLUTION LTD | 6 rue d'Armaillé | 75017 Paris | GOS.business@hotmail.com | 34615561159 | ja | – |
| stele-140 | <pre>Herstellerinformationen
Name:XUAN TECH SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ
Adresse:PL-ul. NOWOGRODZKA, Nr. 64, lok. 43, miejsc. WARSZAWA,02-014,POLSKA
E-Mail:dongbi78317395tr@163.com
Telefon:508065548


Informationen zur verantwortlichen Person in der EU
: Name: UKFR Fulfilment Service
Adresse: FR-79 rue de Patay 75013 Paris Frankreich
E-Mail: info@fb-ukfr.com
Telefon: +34 651718917</pre> | UKFR Fulfilment Service | FR-79 rue de Patay | 75013 Paris | info@fb-ukfr.com | +34 651718917 | ja | – |
| stele-141 | <pre>Herstellerinformationen
: Name: Hangzhou Maiya Haituo Trading Co., Ltd.
Adresse: 2. Etage, Gebäude 2, Nr. 20 Daoqian East Street, Yipeng Street, Qiantang District
E-Mail: hzmyht@163.com
Telefon: 15382316596


Informationen zur verantwortlichen Person in der EU
Name:ECLAT SOLUTION SARL
Adresse:Bureau 1145, 37 Passage du Ponceau
E-Mail:eclatsolution@outlook.com
Telefon:187652619</pre> | ECLAT SOLUTION SARL | Bureau 1145, 37 Passage du Ponceau | _nicht erkannt_ | eclatsolution@outlook.com | 187652619 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-142 | <pre>Herstellerinformationen
Name: Yiwu Lulu Handicraft Co., Ltd.
Adresse: 3/F, No.1 Weiya Road, Shangxi Town, Yiwu City, Jinhua City, Provinz Zhejiang
E-Mail: 946839087@qq.com
Telefon: 15057908325


Angaben zur verantwortlichen Person in der EU
: Name: SUCCESSCOURIERSL
Adresse: CALLERIOTORMESNUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada, Madrid, 28947 Spanien
E-Mail: successservice2@hotmail.com
Telefon: +34 910 602 659</pre> | SUCCESSCOURIERSL | CALLERIOTORMESNUM. 1, PLANTA 1, DERECHA, OFICINA 3, Fuenlabrada | 28947 Madrid | successservice2@hotmail.com | +34 910 602 659 | ja | – |
| stele-143 | <pre>Herstellerinformationen
Name: Derun LvJian (Shandong) Composite Materials Co., Ltd
Adresse: Gebäude 1, Nr. 166 Jingshan Straße, Qiaoguan Stadt, Changle Kreis, Weifang Stadt, Provinz Shandong
E-Mail: hefeituotu@yeah.net
Telefon: 055163660016


Informationen zum EU-Verantwortlichen
Name:E-CrossStu GmbH
Adresse:Mainzer Landstr. 69 ,60329 Frankfurt am Main
E-Mail:E-CrossStu@web.de
Telefon:69332967674</pre> | E-CrossStu GmbH | Mainzer Landstr. 69 | 60329 Frankfurt am Main | E-CrossStu@web.de | 69332967674 | ja | – |
| stele-144 | <pre>Herstellerinformationen
Name: Shenzhen Barry Century Trading Co., Ltd.
Adresse: CN-2111-D099, Gebäude 1, Hengdu Metropolis Plaza, Nr. 15 Huancheng South Road, Ma'antang Community, Bantian Street, Longgang District, Shenzhen City
E-Mail: balihaohuo@foxmail.com
Telefon: 13242068766


Informationen zur verantwortlichen Person in der EU
Name:ORIENTCONSULTINGSL
Adresse:AV.DELAINDUSTRIA,2,NV16,PICANTUEÑA,FUENLABRADA,ESPAÑA
E-Mail:rae@orientconsulting.es
Telefon:912918327</pre> | ORIENTCONSULTINGSL | AV.DELAINDUSTRIA,2,NV16,PICANTUEÑA,FUENLABRADA,ESPAÑA | _nicht erkannt_ | rae@orientconsulting.es | 912918327 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-145 | <pre>Herstellerinformationen
Name: Shenzhen Youtuobang Technology Co., Ltd
Adresse: 208B, Yizhe Building, Yuquan Road, Nantou Street, Nanshan District, Shenzhen, 518000
E-Mail: youtbus@163.com
Telefon: 18988523813


Angaben zur verantwortlichen Person in der EU
: Name: GLOBAL ONE SOLUTION LTD
Adresse: 6 rue d'Armaillé 75017 Paris, Frankreich
E-Mail: GOS.business@hotmail.com
Telefon: +34 615 561159</pre> | GLOBAL ONE SOLUTION LTD | 6 rue d'Armaillé | 75017 Paris | GOS.business@hotmail.com | +34 615 561159 | ja | – |
| stele-147 | <pre>Informationen zum Hersteller
Name: Yiwu Biqi Jewelry Co., Ltd.
Adresse: CN-No. 201, Unit 3, Building 55, Fandong Community, Beiyuan Street, Yiwu City, Jinhua City, Zhejiang Province
E-Mail-Adresse: 1941362378@qq.com
Telefon: 18276179419


Informationen zum EU-Verantwortlichen
Name: MJCM SARL
Adresse: 78 avenue des Champs-Elysees Bureau 326
E-Mail-Adresse: mjcm190928@gmail.com
Telefon: 0767213611</pre> | MJCM SARL | 78 avenue des Champs-Elysees Bureau 326 | _nicht erkannt_ | mjcm190928@gmail.com | 0767213611 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
| stele-148 | <pre>Herstellerinformationen
: Name: Yiwu Tian Bing Trading Co., Ltd.
Adresse: CN, 303, 3. Etage, Gebäudekomplex, B9 Yongjin Avenue, Futian Street, Yiwu City, Jinhua City, Provinz Zhejiang
E-Mail: 811282008@qq.com
Telefon: 18367921355


Angaben zur verantwortlichen Person in der EU
: Name: ZHEKAN GmbH,
Adresse: Römeräcker 8, 76297 Stutensee, Deutschland,
E-Mail: eken190228@gmail.com,
Telefon: +44 6975795891</pre> | ZHEKAN GmbH | Römeräcker 8 | 76297 Stutensee | eken190228@gmail.com | +44 6975795891 | ja | – |
| stele-149 | <pre>Herstellerinformationen
: Name: Wuxi Jifan E-commerce Co., Ltd.
Adresse: Nr. 809 Qianhu Road, Qianqiao Street, Huishan District, Wuxi City, College Student Entrepreneurship Park, A-105-04 E-
Mail: 441244802@qq.com
Telefon: 18861600372


Informationen zur verantwortlichen Person in der EU
Name: Synertrade FR SAS
Adresse: 9 rue du Bat d'Argent, 69001 Lyon, Frankreich, LYON, RHONE, FR (Frankreich)
E-Mail: E-Mail: info@syner-sarl.cn</pre> | Synertrade FR SAS | 9 rue du Bat d'Argent | 69001 Lyon | _nicht erkannt_ | _nicht erkannt_ | teilweise | E-Mail-Wert sieht nicht wie eine gültige Adresse aus: "E-Mail: info@syner-sarl.cn" — nicht übernommen<br>Telefon im EU-Block nicht angegeben (Feld ist in der Quelle optional) |
| stele-150 | <pre>Informationen zum Hersteller
Name: Pujiangdianlimaoyi Co., Ltd.
Adresse: Room 302, Unit 2, Building 4, Jiayi Gold Coast, Huangzhai Town, Pujiang County, Zhejiang Province Pujiang County 322200 Zhejiang Province, Jinhua City
E-Mail-Adresse: 1449719085@qq.com
Telefon: 18858978004


Informationen zum EU-Verantwortlichen
Name: SUCCESS COURIER SL
Adresse: Company_Name:SUCCESS COURIER SL; Address_CountryandRegion:Spain; Address_CountryandRegion_Simple:ES; Address_District_1:MADRID; Address_District_2:FUENLABRADA; Address_Detail_1:CALLE RIO TORMES NUM.1, PLANTA 1, DERECHA,OFICINA
E-Mail-Adresse: successservice2@hotmail.com
Telefon: 910602659</pre> | SUCCESS COURIER SL | Company_Name:SUCCESS COURIER SL; Address_CountryandRegion:Spain; Address_CountryandRegion_Simple:ES; Address_District_1:MADRID; Address_District_2:FUENLABRADA; Address_Detail_1:CALLE RIO TORMES NUM.1, PLANTA 1, DERECHA,OFICINA | _nicht erkannt_ | successservice2@hotmail.com | 910602659 | teilweise | Adresse liegt als Formularfeld-Dump der Importquelle vor (z. B. "Address_District_1:…") — nicht zuverlässig in Straße/PLZ/Stadt aufteilbar, Rohwert in gpsr_address übernommen, gpsr_city nicht erkannt |
| stele-151 | <pre>Informationen zum Hersteller
Name: Pujiangdianlimaoyi Co., Ltd.
Adresse: Room 302, Unit 2, Building 4, Jiayi Gold Coast, Huangzhai Town, Pujiang County, Zhejiang Province Pujiang County 322200 Zhejiang Province, Jinhua City
E-Mail-Adresse: 1449719085@qq.com
Telefon: 18858978004


Informationen zum EU-Verantwortlichen
Name: SUCCESS COURIER SL
Adresse: Company_Name:SUCCESS COURIER SL; Address_CountryandRegion:Spain; Address_CountryandRegion_Simple:ES; Address_District_1:MADRID; Address_District_2:FUENLABRADA; Address_Detail_1:CALLE RIO TORMES NUM.1, PLANTA 1, DERECHA,OFICINA
E-Mail-Adresse: successservice2@hotmail.com
Telefon: 910602659</pre> | SUCCESS COURIER SL | Company_Name:SUCCESS COURIER SL; Address_CountryandRegion:Spain; Address_CountryandRegion_Simple:ES; Address_District_1:MADRID; Address_District_2:FUENLABRADA; Address_Detail_1:CALLE RIO TORMES NUM.1, PLANTA 1, DERECHA,OFICINA | _nicht erkannt_ | successservice2@hotmail.com | 910602659 | teilweise | Adresse liegt als Formularfeld-Dump der Importquelle vor (z. B. "Address_District_1:…") — nicht zuverlässig in Straße/PLZ/Stadt aufteilbar, Rohwert in gpsr_address übernommen, gpsr_city nicht erkannt |
| stele-152 | <pre>Herstellerinformationen
: Name: Wuhan Fangxin E-Commerce Co., Ltd.
Adresse: Raum Nr. 0309, 14. Etage, Einheit 1, Gebäude 1, Gutian Art Mall, Jiefang Avenue 61, Bezirk Qiaokou, Wuhan.
E-Mail: 836207972@qq.com
. Telefon: 13667201362


Informationen zum EU-Verantwortlichen
Name:E-CrossStu GmbH
Adresse:Mainzer Landstr.69, Frankfurt am Main
E-Mail:E-CrossStu@web.de
Telefon:69332967674</pre> | E-CrossStu GmbH | Mainzer Landstr.69, Frankfurt am Main | _nicht erkannt_ | E-CrossStu@web.de | 69332967674 | teilweise | Kein sicheres PLZ+Stadt-Muster in der Adresse erkannt — voller Adresstext in gpsr_address übernommen, gpsr_city nicht erkannt (nicht geraten) |
