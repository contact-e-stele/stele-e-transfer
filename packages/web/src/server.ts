import app from "./api";
import { startBackupScheduler } from "./api/backup";
import { startPriceMonitor } from "./api/price-monitor";
import { runMigrations } from "./db/migrate";
import { runStartupCheck } from "./startup-check";

const port = Number(process.env.PORT ?? 3000);
const distDir = `${import.meta.dir}/../dist`;
const indexPath = `${distDir}/index.html`;

const server = Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api") || url.pathname.startsWith("/backup")) {
      return app.fetch(request);
    }

    const filePath = getStaticFilePath(url.pathname);
    const file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(file);
    }

    const index = Bun.file(indexPath);
    if (await index.exists()) {
      return new Response(index, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
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

function getStaticFilePath(pathname: string) {
  const cleanPath = decodeURIComponent(pathname)
    .replace(/^\/+/, "")
    .replaceAll("..", "");

  return cleanPath ? `${distDir}/${cleanPath}` : indexPath;
}
