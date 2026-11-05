// Fund 05.11.2026 (Live-Prüfung #267): GET /api/ebay/origin-inventory lief für 43 Angebote nacheinander
// (je 2 eBay-Lesungen) länger als Bun.serve' Standard-idleTimeout von 10 s → Render 502 nach ~12 s.
// Lösung: Lesungen mit begrenzter Parallelität. Reihenfolge des Ergebnisses = Reihenfolge der Eingabe.
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const n = Math.max(1, Math.floor(limit));
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
