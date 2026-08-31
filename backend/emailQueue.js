import { prisma } from "./db.js";
import { sendMail } from "./mailer.js";

const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS) || 3;

// Build the welcome-email row data; used by app.js so the enqueue is atomic with the user create.
export function welcomeEmail(to) {
  return {
    to,
    subject: "Your account has been created",
    body: "Hi,\n\nYou've been successfully added to our system.\n\nThanks,\nThe Team",
  };
}

// Build the verification-email row data with the click-to-verify link.
export function verificationEmail(to, link) {
  return {
    to,
    subject: "Verify your email address",
    body: `Hi,\n\nPlease verify your email address by visiting this link:\n\n${link}\n\nThanks,\nThe Team`,
  };
}

// Build the password-reset email row data with the click-to-reset link.
export function passwordResetEmail(to, link) {
  return {
    to,
    subject: "Reset your password",
    body: `Hi,\n\nA password reset was requested for this account. Click the link below to choose a new password (expires in 1 hour):\n\n${link}\n\nIf you didn't request this, you can ignore this email.\n\nThanks,\nThe Team`,
  };
}

// Pick up pending emails, send them, mark sent / retry with a bounded cap.
export async function processEmailQueue(take = 10) {
  const jobs = await prisma.emailQueue.findMany({
    where: { status: "pending", attempts: { lt: MAX_ATTEMPTS } },
    orderBy: { createdAt: "asc" },
    take,
  });
  for (const job of jobs) {
    try {
      await sendMail({ to: job.to, subject: job.subject, text: job.body });
      await prisma.emailQueue.update({
        where: { id: job.id },
        data: { status: "sent", sentAt: new Date() },
      });
    } catch (err) {
      const attempts = job.attempts + 1;
      await prisma.emailQueue.update({
        where: { id: job.id },
        data: {
          attempts,
          lastError: String(err),
          // ponytail: no backoff; fixed-interval poll is the retry. Add exponential backoff if a slow mailer causes stampedes.
          status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        },
      });
    }
  }
  return jobs.length;
}

// Polling worker. unref() so it never holds the process open on its own.
export function startEmailWorker(intervalMs = 3000) {
  const timer = setInterval(() => {
    processEmailQueue().catch((err) =>
      console.error("[emailQueue] worker error:", err),
    );
  }, intervalMs);
  timer.unref?.();
  return timer;
}
