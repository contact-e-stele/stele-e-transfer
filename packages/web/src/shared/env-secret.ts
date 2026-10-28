// K-016 (Kalkulator 28.10.2026, Sicherheit): Geheimnisse NIE als Klartext-Fallback im Quellcode (Repo ist öffentlich lesbar).
// Fehlt die Variable, gibt es einen klaren Fehler statt eines eingebauten Ersatzwerts. REINE Funktionen.
export function readEnvSecret(name: string, env: Record<string, string | undefined> = process.env): string | null {
  const v = env[name];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export function requireEnvSecret(name: string, env: Record<string, string | undefined> = process.env): string {
  const v = readEnvSecret(name, env);
  if (!v) throw new Error(`${name} fehlt – in Render (Environment) setzen. AliExpress-Aufrufe sind ohne diesen Wert gesperrt.`);
  return v;
}
