// ─── Regulierte Produktgruppen — Keyword-/Kategorie-Muster (P-66) ─────────────
// Reine Datenbasis für die spätere Compliance-Prüfung beim Import (Schritt 2).
// Bewusst KEINE Matching-Logik hier — nur die Muster selbst.

export interface RegulatedCategory {
  id: string;
  labelDe: string;
  labelEn: string;
  keywordsDe: string[];
  keywordsEn: string[];
}

export const REGULATED_CATEGORIES: RegulatedCategory[] = [
  {
    id: 'medizinprodukt',
    labelDe: 'Medizinprodukt',
    labelEn: 'Medical Device',
    keywordsDe: [
      'medizinprodukt', 'medizinisch', 'diagnostik', 'diagnose',
      'blutdruckmessgerät', 'fieberthermometer', 'pulsoximeter',
      'hörgerät', 'orthese', 'prothese', 'inhalator', 'inhalationsgerät',
      'bandage', 'stützstrumpf', 'kompressionsstrumpf', 'ekg', 'blutzuckermessgerät',
    ],
    keywordsEn: [
      'medical device', 'diagnostic', 'diagnosis',
      'blood pressure monitor', 'thermometer', 'pulse oximeter',
      'hearing aid', 'orthosis', 'orthotic', 'prosthesis', 'inhaler', 'nebulizer',
      'bandage', 'compression stocking', 'ecg', 'glucose meter',
    ],
  },
  {
    id: 'psa',
    labelDe: 'Persönliche Schutzausrüstung (PSA)',
    labelEn: 'Personal Protective Equipment (PPE)',
    keywordsDe: [
      'schutzausrüstung', 'atemschutzmaske', 'ffp2', 'ffp3', 'schutzbrille',
      'schutzhandschuhe', 'gehörschutz', 'schutzhelm', 'sicherheitsschuhe',
      'auffanggurt', 'absturzsicherung', 'schutzanzug', 'gasmaske',
    ],
    keywordsEn: [
      'protective equipment', 'respirator mask', 'ffp2', 'ffp3', 'safety glasses',
      'protective gloves', 'ear protection', 'safety helmet', 'safety shoes',
      'safety harness', 'fall protection', 'protective suit', 'gas mask',
    ],
  },
  {
    id: 'ce_elektronik',
    labelDe: 'CE-pflichtige Elektronik',
    labelEn: 'CE-regulated Electronics',
    keywordsDe: [
      'netzteil', 'ladegerät', 'akku', 'lithium-akku', 'powerbank',
      'funkgerät', 'sender', 'empfänger', 'wlan-modul', 'bluetooth-modul',
      'steckdose', 'verlängerungskabel', 'trafo', 'spannungswandler', 'led-treiber',
    ],
    keywordsEn: [
      'power supply', 'charger', 'battery', 'lithium battery', 'power bank',
      'radio transmitter', 'transmitter', 'receiver', 'wifi module', 'bluetooth module',
      'power strip', 'extension cable', 'transformer', 'voltage converter', 'led driver',
    ],
  },
  {
    id: 'kosmetik_wirkversprechen',
    labelDe: 'Kosmetik mit Wirkversprechen',
    labelEn: 'Cosmetics with Efficacy Claims',
    keywordsDe: [
      'anti-aging', 'faltenreduktion', 'hautaufhellend', 'aufhellungscreme',
      'akne-behandlung', 'haarwuchsmittel', 'whitening', 'peeling-säure',
      'retinol', 'hyaluronsäure-serum', 'lifting-creme', 'straffend',
    ],
    keywordsEn: [
      'anti-aging', 'wrinkle reduction', 'skin whitening', 'brightening cream',
      'acne treatment', 'hair growth', 'whitening', 'peeling acid',
      'retinol', 'hyaluronic acid serum', 'lifting cream', 'firming',
    ],
  },
  {
    id: 'spielzeug',
    labelDe: 'Spielzeug',
    labelEn: 'Toys',
    keywordsDe: [
      'spielzeug', 'kinderspielzeug', 'babyspielzeug', 'puppe', 'plüschtier',
      'baukasten', 'kuscheltier', 'kinderfahrzeug', 'rutschauto', 'spielzeugauto',
      'lernspielzeug', 'holzspielzeug', 'kinderschmuck',
    ],
    keywordsEn: [
      'toy', 'kids toy', 'baby toy', 'doll', 'plush toy',
      'building blocks', 'stuffed animal', 'ride-on toy', 'toy car',
      'educational toy', 'wooden toy', 'children jewelry',
    ],
  },
  {
    id: 'nahrungsergaenzung',
    labelDe: 'Nahrungsergänzungsmittel',
    labelEn: 'Dietary Supplements',
    keywordsDe: [
      'nahrungsergänzung', 'nahrungsergänzungsmittel', 'vitamintablette',
      'proteinpulver', 'kapseln', 'diätprodukt', 'abnehmkapseln', 'kollagenpulver',
      'mineralstoffe', 'omega-3-kapseln', 'probiotika',
    ],
    keywordsEn: [
      'dietary supplement', 'food supplement', 'vitamin tablet',
      'protein powder', 'capsules', 'diet product', 'weight loss capsules',
      'collagen powder', 'minerals', 'omega-3 capsules', 'probiotics',
    ],
  },
];
