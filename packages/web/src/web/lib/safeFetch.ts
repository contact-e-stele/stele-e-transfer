/**
 * safeFetch — wrapper around fetch() that handles HTML responses gracefully.
 * Render Free Tier sometimes returns HTML during cold start instead of JSON.
 * This retries once after 2s if the response is not JSON.
 */
export async function safeFetch(input: string, init?: RequestInit, retries = 2): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(input, init);
    const contentType = res.headers.get('content-type') ?? '';
    
    // If we expect JSON but got HTML, retry after delay
    if (!contentType.includes('application/json') && contentType.includes('text/html')) {
      if (i < retries - 1) {
        console.warn(`[safeFetch] Got HTML instead of JSON for ${input}, retry in 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      // Last retry failed — throw a readable error
      throw new Error('Server antwortet nicht korrekt. Bitte kurz warten und neu laden (Render startet neu).');
    }
    
    return res;
  }
  throw new Error('Verbindungsfehler');
}

/**
 * safeJson — fetch + parse JSON with HTML detection
 */
export async function safeJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await safeFetch(input, init);
  const text = await res.text();
  
  if (text.startsWith('<!DOCTYPE') || text.startsWith('<html')) {
    throw new Error('Server startet neu — bitte 10 Sekunden warten und neu laden.');
  }
  
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Ungültige Server-Antwort: ${text.slice(0, 100)}`);
  }
}
