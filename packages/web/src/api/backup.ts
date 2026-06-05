import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '../db/index';
import * as schema from '../db/schema';

const execFileAsync = promisify(execFile);

export async function createBackupArchive(): Promise<{ path: string; name: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = join(tmpdir(), 'stele-backups');
  await mkdir(dir, { recursive: true });

  const jsonPath = join(dir, `backup-${stamp}.json`);
  const zipPath = join(dir, `backup-${stamp}.zip`);

  const [products, priceHistory] = await Promise.all([
    db.select().from(schema.products),
    db.select().from(schema.priceHistory),
  ]);

  const payload = {
    createdAt: new Date().toISOString(),
    meta: {
      productCount: products.length,
      priceHistoryCount: priceHistory.length,
    },
    products,
    priceHistory,
  };

  await writeFile(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  await execFileAsync('zip', ['-j', '-q', zipPath, jsonPath]);

  return { path: zipPath, name: `stele-backup-${stamp}.zip` };
}

export async function createBackupSummary(archiveName: string): Promise<string> {
  const content = [
    `Backup erstellt: ${new Date().toLocaleString('de-DE')}`,
    `Datei: ${archiveName}`,
    '',
    'Wenn du die Daten brauchst, antworte direkt auf diese Mail.',
  ].join('\n');

  const path = join(tmpdir(), `${archiveName}.txt`);
  await writeFile(path, content, 'utf8');
  return path;
}
