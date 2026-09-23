// server/src/mail.ts
//
// The one place this server sends real email from. Gmail SMTP rather than a
// transactional API — this app sends a handful of verification codes, not
// marketing volume, and Gmail's free tier covers that with no account to sign
// up for beyond the one already used to develop this.
//
// GMAIL_USER must be a full @gmail.com address, and GMAIL_APP_PASSWORD an
// App Password (myaccount.google.com/apppasswords) — Gmail refuses SMTP auth
// with the account's real password once 2-Step Verification is on, which it
// must be to generate an App Password in the first place.

import nodemailer from 'nodemailer';

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD are not set — copy .env.example to .env');
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
  return transporter;
}

/**
 * Sends the 6-digit sign-up verification code. Kept to one job — the caller
 * decides whether sending it is even necessary (a fresh code vs. a resend);
 * this just puts an already-decided code on the wire.
 */
export async function sendVerificationEmail(to: string, code: string): Promise<void> {
  const from = process.env.GMAIL_USER;
  await getTransporter().sendMail({
    from: `Panzi <${from}>`,
    to,
    subject: `${code} is your Panzi verification code`,
    text: `Your Panzi verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't try to create a Panzi account, you can ignore this email.`,
    html: verificationEmailHtml(code),
  });
}

function verificationEmailHtml(code: string): string {
  const spaced = code.split('').join(' ');
  return `
<div style="background:#F3E9D4;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:420px;margin:0 auto;background:#FFFFFF;border-radius:24px;padding:36px 28px;text-align:center;">
    <h1 style="margin:0 0 8px;font-size:22px;color:#234A1B;">Verify your email</h1>
    <p style="margin:0 0 28px;font-size:14.5px;line-height:21px;color:#5B6B4E;">
      Enter this code in Panzi to finish creating your account.
    </p>
    <div style="display:inline-block;background:#E6F4D8;border-radius:16px;padding:16px 24px;font-size:30px;font-weight:800;letter-spacing:6px;color:#2F6B22;">
      ${spaced}
    </div>
    <p style="margin:28px 0 0;font-size:12.5px;line-height:18px;color:#8A9580;">
      This code expires in 10 minutes. If you didn't request it, you can ignore this email.
    </p>
  </div>
</div>`;
}
