import { Database } from "bun:sqlite";
import { existsSync } from "fs";

const dbPath = process.env.DB_PATH || "./stele.db";
if (!existsSync(dbPath)) {
  console.log("DB nicht gefunden:", dbPath);
  process.exit(0);
}

const db = new Database(dbPath);
try {
  db.run("ALTER TABLE products ADD COLUMN ad_rate REAL DEFAULT 5");
  console.log("✓ ad_rate Spalte hinzugefügt");
} catch (e: unknown) {
  if (e instanceof Error && e.message.includes("duplicate column")) {
    console.log("ad_rate existiert bereits");
  } else {
    console.error("Fehler:", e);
  }
}
db.close();
