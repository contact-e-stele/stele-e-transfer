// Zeitlimit für Läufe (Anlass: Preis-/Mengen-Lauf hing am 15.10.2026 ab 21:24 bei stele-107 ohne Fehlermeldung — weil je 3 Produkte
// gemeinsam abgewartet werden (Promise.all), blieb der ganze Lauf stehen und 220 bekam keine Menge).
// REINE Hilfsfunktionen, ohne DB/eBay.

export type TimeLimitResult<T> = { timedOut: false; value: T } | { timedOut: true };

/** Wartet höchstens `ms` auf `promise`. Danach { timedOut: true } — die Arbeit selbst wird NICHT abgebrochen (läuft im Hintergrund aus). */
export function withTimeLimit<T>(promise: Promise<T>, ms: number): Promise<TimeLimitResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimeLimitResult<T>>(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
  const work = promise.then(value => ({ timedOut: false as const, value }));
  return Promise.race([work, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

/** fetch mit festem Zeitlimit je Aufruf (ein vorhandenes signal des Aufrufers bleibt zusätzlich wirksam). */
export function fetchWithTimeout(ms: number, fetchFn: typeof fetch = fetch): typeof fetch {
  const f = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const own = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, own]) : own;
    return fetchFn(input, { ...init, signal });
  };
  return f as typeof fetch;
}
