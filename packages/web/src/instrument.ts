// Sentry-Initialisierung — MUSS als allererster Import im Server-Einstiegspunkt geladen werden,
// vor allen anderen Modul-Imports, damit Sentry auch Fehler beim Modul-Laden selbst erfasst.
import * as Sentry from "@sentry/bun";

const dsn = process.env.SENTRY_DSN_BACKEND;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      return stripSensitiveFields(event) as typeof event;
    },
  });
} else {
  console.warn("[sentry] SENTRY_DSN_BACKEND nicht gesetzt — Fehlerüberwachung deaktiviert.");
}

// Entfernt rekursiv Felder mit sensiblen Namen (Groß-/Kleinschreibung egal) aus dem Sentry-Event,
// bevor es gesendet wird — Datensparsamkeit (keine Tokens/Keys/Passwörter in Sentry).
const SENSITIVE_KEYS = /^(token|key|secret|password|authorization)$/i;

function stripSensitiveFields<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => stripSensitiveFields(item, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.test(key)) continue;
    result[key] = stripSensitiveFields(val, seen);
  }
  return result as T;
}

export { Sentry };
