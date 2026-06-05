const RESEND_API_KEY = process.env.RESEND_API_KEY ?? '';
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? process.env.BACKUP_GMAIL_USER ?? '';

async function sendViaResend(options: { to: string; subject: string; text: string; attachmentPath?: string; attachmentName?: string }) {
  const body: Record<string, unknown> = {
    from: FROM_EMAIL || 'stele-backup@stele-e-transfer.com',
    to: [options.to],
    subject: options.subject,
    text: options.text,
  };

  if (options.attachmentPath && options.attachmentName) {
    const file = await import('node:fs/promises').then(m => m.readFile(options.attachmentPath!));
    body.attachments = [{ filename: options.attachmentName, content: Buffer.from(file).toString('base64') }];
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Resend failed: ${res.status} ${await res.text()}`);
}

async function sendViaGmail(options: { to: string; subject: string; text: string; attachmentPath?: string; attachmentName?: string }) {
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.default.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.BACKUP_GMAIL_USER,
      pass: process.env.BACKUP_GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: process.env.BACKUP_GMAIL_USER,
    to: options.to,
    subject: options.subject,
    text: options.text,
    attachments: options.attachmentPath && options.attachmentName ? [{ filename: options.attachmentName, path: options.attachmentPath }] : [],
  });
}

export async function sendBackupEmail(options: { to: string; subject: string; text: string; attachmentPath?: string; attachmentName?: string }) {
  if (RESEND_API_KEY) {
    try {
      await sendViaResend(options);
      return;
    } catch (e) {
      console.warn('Resend failed, falling back to Gmail:', e);
    }
  }

  if (!process.env.BACKUP_GMAIL_USER || !process.env.BACKUP_GMAIL_APP_PASSWORD) {
    throw new Error('No mail provider configured');
  }

  await sendViaGmail(options);
}
