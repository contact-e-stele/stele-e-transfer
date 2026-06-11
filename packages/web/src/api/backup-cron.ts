import { runBackup } from './backup';

async function main() {
  await runBackup();
  console.log('Backup done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
