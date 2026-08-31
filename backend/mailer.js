import nodemailer from "nodemailer";

// ponytail: lazy singleton transport. Real SMTP when SMTP_HOST is set, otherwise
// JSONTransport logs the email instead of sending — dev works with no mail server.
let transport = null;
function getTransport() {
  if (transport) return transport;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) {
    console.log("[mailer] SMTP_HOST not set — emails are logged, not sent.");
    transport = nodemailer.createTransport({ jsonTransport: true });
  } else {
    const port = Number(SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }
  return transport;
}

export async function sendMail({ to, subject, text }) {
  const info = await getTransport().sendMail({
    from: process.env.MAIL_FROM || "no-reply@example.com",
    to,
    subject,
    text,
  });
  if (!process.env.SMTP_HOST) console.log("[mailer] email:\n", info.message);
  return info;
}
