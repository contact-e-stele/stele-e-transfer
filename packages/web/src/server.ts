import app from "./api";
import { startBackupScheduler } from "./api/backup";
import { startPriceMonitor } from "./api/price-monitor";
import { startOrderNotifier } from "./api/order-notifier";
import { runMigrations } from "./db/migrate";
import { runStartupCheck } from "./startup-check";

const port = Number(process.env.PORT ?? 3000);
const distDir = `${import.meta.dir}/../dist`;
const indexPath = `${distDir}/index.html`;

// P-87: index.html darf NIE gecacht werden — sie ist die einzige Datei, die auf die
// content-gehashten Asset-Dateinamen verweist (/assets/*.HASH.js/css). Ohne dieses Header
// blieb die installierte PWA (Android/iOS "Add to Home Screen") nach einem Deploy oft auf
// einer alten index.html hängen, die auf längst ersetzte Asset-Hashes zeigte — der Nutzer
// musste die App löschen und neu installieren, um etwas Neues zu sehen.
const INDEX_HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-cache, no-store, must-revalidate",
};

// /assets/* sind Vite-Build-Output mit Content-Hash im Dateinamen (z.B. index-L7T5m_NX.js) —
// ein neuer Build erzeugt neue Dateinamen, alte Dateien werden nie unter demselben Namen
// wiederverwendet. Deshalb hier sicher unbegrenzt cachebar.
const ASSET_HEADERS = { "Cache-Control": "public, max-age=31536000, immutable" };

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api") || url.pathname.startsWith("/backup")) {
      return app.fetch(request);
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const index = Bun.file(indexPath);
      if (await index.exists()) {
        return new Response(index, { headers: INDEX_HTML_HEADERS });
      }
    }

    const filePath = getStaticFilePath(url.pathname);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      const headers = url.pathname.startsWith("/assets/") ? ASSET_HEADERS : undefined;
      return new Response(file, headers ? { headers } : undefined);
    }

    // SPA-Fallback für Client-Routen (z.B. /produkte) — ebenfalls nie cachen.
    const index = Bun.file(indexPath);
    if (await index.exists()) {
      return new Response(index, { headers: INDEX_HTML_HEADERS });
    }

    return new Response("Build output not found. Run \`bun run build\` first.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
});

console.log(`Web server listening on http://localhost:${server.port}`);

// DB-Migrationen beim Start ausführen
try {
  await runMigrations();
  // Uploads-Ordner sicherstellen
  await Bun.write(`${distDir}/uploads/.gitkeep`, '').catch(() => {});
  // Rechnungen-Ordner sicherstellen (P13)
  await Bun.write(`${distDir}/invoices/.gitkeep`, '').catch(() => {});
} catch (e) {
  console.error('[migrate] Fehler:', e);
}

// Startup-Check: alle kritischen Features prüfen
await runStartupCheck();

// Automatischer DB-Backup: täglich 15:00, 23:35 Uhr (P-23)
startBackupScheduler();

// Preisüberwachung: alle 8h AliExpress-Preise prüfen, erster Check nach 2 Min (P-23)
startPriceMonitor();

// Neue-Bestellung-Benachrichtigung: alle 120 Min, 8–22 Uhr Berlin-Zeit
startOrderNotifier();

function getStaticFilePath(pathname: string) {
  const cleanPath = decodeURIComponent(pathname)
    .replace(/^\/+/, "")
    .replaceAll("..", "");

  return cleanPath ? `${distDir}/${cleanPath}` : indexPath;
}
