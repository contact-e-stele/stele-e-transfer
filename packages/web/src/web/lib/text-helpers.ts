export function normalizeShippingText(text: string): string {
  return text
    .replace(/10\s*[-–]\s*25\s*(?:Werktage|working days|business days)/gi, '3-7 Werktage')
    .replace(/10\s*bis\s*25\s*(?:Werktage|working days|business days)/gi, '3-7 Werktage')
    .replace(/10\s*[-–]\s*25\s*Tage/gi, '3-7 Tage')
    .replace(/Lieferzeit\s*:?\s*10\s*[-–]\s*25\s*(?:Werktage|Tage|days)/gi, 'Lieferzeit: 3-7 Werktage')
    .replace(/Versand\s*:?\s*10\s*[-–]\s*25\s*(?:Werktage|Tage|days)/gi, 'Versand: 3-7 Werktage')
    .replace(/3\s*[-–]\s*7\s*(?:Tage|days)\s*Lieferung/gi, '3-7 Tage Lieferung')
    .replace(/\b(?:Lieferung|Delivery)\s*[:\-]?\s*10\s*[-–]\s*25\s*(?:Werktage|Tage|days|working days|business days)/gi, '3-7 Tage Lieferung');
}

export function normalizeEbayDeliveryText(text: string): string {
  return text
    .replace(/10\s*[-–]\s*25\s*(?:Werktage|working days|business days)/gi, '3-7 Werktage')
    .replace(/10\s*bis\s*25\s*(?:Werktage|working days|business days)/gi, '3-7 Werktage')
    .replace(/10\s*[-–]\s*25\s*Tage/gi, '3-7 Tage')
    .replace(/3\s*[-–]\s*7\s*Tage\s*Lieferung/gi, '3-7 Tage Lieferung')
    .replace(/\b(?:Lieferung|Delivery)\s*[:\-]?\s*10\s*[-–]\s*25\s*(?:Werktage|Tage|days|working days|business days)/gi, '3-7 Tage Lieferung');
}
