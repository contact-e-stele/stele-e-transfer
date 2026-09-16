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

// Reine Substring-Erkennung (case-insensitive) — bewusst simpel, keine NLP/Fuzzy-Logik.
// Gibt alle Kategorien zurück, deren Keywords (DE oder EN) im Text vorkommen.
export function matchRegulatedCategories(text: string): RegulatedCategory[] {
  const lower = text.toLowerCase();
  return REGULATED_CATEGORIES.filter(cat =>
    cat.keywordsDe.some(k => lower.includes(k.toLowerCase())) ||
    cat.keywordsEn.some(k => lower.includes(k.toLowerCase()))
  );
}

export interface RegulatedCategoryMatch {
  category: RegulatedCategory;
  keyword: string;
  field: 'title' | 'description';
}

function findKeywordHit(cat: RegulatedCategory, title: string, description: string): { keyword: string; field: 'title' | 'description' } | undefined {
  const titleLower = title.toLowerCase();
  const allKeywords = [...cat.keywordsDe, ...cat.keywordsEn];
  for (const k of allKeywords) {
    if (titleLower.includes(k.toLowerCase())) return { keyword: k, field: 'title' };
  }
  const descLower = description.toLowerCase();
  for (const k of allKeywords) {
    if (descLower.includes(k.toLowerCase())) return { keyword: k, field: 'description' };
  }
  return undefined;
}

// P-66 Schritt 3: wie matchRegulatedCategories(), aber liefert zusätzlich pro Treffer das
// konkrete Stichwort und das Feld (Titel/Beschreibung) — Titel wird vor Beschreibung geprüft.
// Damit können Blockier-Meldung und Übersteuerungs-Dialog konkret zeigen, WAS erkannt wurde,
// statt nur "regulierte Kategorie". matchRegulatedCategories() bleibt unverändert bestehen.
export function matchRegulatedCategoriesDetailed(fields: { title: string; description: string }): RegulatedCategoryMatch[] {
  const matches: RegulatedCategoryMatch[] = [];
  for (const cat of REGULATED_CATEGORIES) {
    const hit = findKeywordHit(cat, fields.title, fields.description);
    if (hit) matches.push({ category: cat, keyword: hit.keyword, field: hit.field });
  }
  return matches;
}

// P-66 Schritt 3: die 4 im Auftrag vorgegebenen Begründungen für eine manuelle Übersteuerung —
// eine Quelle für das Dropdown (lieferanten.tsx) UND das Badge-Tooltip (produkte.tsx).
export const COMPLIANCE_OVERRIDE_REASONS: Array<{ value: string; label: string }> = [
  { value: 'heimtierbedarf', label: 'Heimtierbedarf (kein Kinderspielzeug)' },
  { value: 'lieferant_bekannt', label: 'Lieferant ist mir bekannt und geprüft' },
  { value: 'kategorie_trifft_nicht_zu', label: 'Kategorie trifft nicht zu' },
  { value: 'sonstiges', label: 'Sonstiges (Freitext)' },
];

export function complianceOverrideReasonLabel(value: string | null | undefined): string {
  return COMPLIANCE_OVERRIDE_REASONS.find(r => r.value === value)?.label ?? (value || '(kein Grund angegeben)');
}
