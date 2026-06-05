import { createBackupArchive } from './backup';
import { sendBackupEmail } from './mailer';

async function main() {
  const archive = await createBackupArchive();
  await sendBackupEmail({
    to: 'contact@stele-e-transfer.com',
    subject: `Daily Backup ${new Date().toLocaleDateString('de-DE')}`,
    text: 'Daily backup abgeschlossen. Anhang ist beigefügt.',
    attachmentPath: archive.path,
    attachmentName: archive.name,
  });
  console.log(`Backup sent: ${archive.name}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
