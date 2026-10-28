// P-EINFUHR (24.10.2026): Die bestehenden Formel-Tests sind mit echten Belegen bis 20.10.2026 gerechnet (Einfuhr 3,57). Damit sie ihre
// Beispiele weiter exakt prüfen, setzt dieser Preload den Laufzeitwert für alle Tests auf den alten Beleg-Wert. Der Betrieb nutzt
// ALI_EINFUHR_EUR = 5,95; die neuen Tests (p-einfuhr.test.ts) setzen 5,95 ausdrücklich und prüfen damit den Betriebswert.
import { setAliEinfuhrEur, ALI_EINFUHR_ALT_EUR } from './shared/constants';
setAliEinfuhrEur(ALI_EINFUHR_ALT_EUR);

// K-016: Der AliExpress-Secret hat keinen Klartext-Fallback mehr. Tests signieren mit einem Platzhalter (nur wenn nichts gesetzt ist).
if (!process.env.ALIEXPRESS_APP_SECRET) process.env.ALIEXPRESS_APP_SECRET = 'test-secret-nur-fuer-tests';
