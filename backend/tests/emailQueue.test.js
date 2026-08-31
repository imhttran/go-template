import request from "supertest";
import { app, prisma } from "../app.js";
import { processEmailQueue } from "../emailQueue.js";

describe("Email queue", () => {
  const testEmail = "email-queue-test@example.com";

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.emailQueue.deleteMany();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.emailQueue.deleteMany();
    await prisma.$disconnect();
  });

  it("queues welcome + verification emails on signup (pending, not yet sent)", async () => {
    const res = await request(app)
      .post("/api/signup")
      .send({ email: testEmail, password: "Valid123!" });
    expect(res.statusCode).toBe(201);

    const rows = await prisma.emailQueue.findMany({ where: { to: testEmail } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    const subjects = rows.map((r) => r.subject).sort();
    expect(subjects).toEqual([
      "Verify your email address",
      "Your account has been created",
    ]);
  });

  it("processes the queue and marks the email sent", async () => {
    await prisma.emailQueue.create({
      data: { to: "direct@example.com", subject: "Test", body: "Body" },
    });

    const processed = await processEmailQueue();
    expect(processed).toBe(1);

    const row = await prisma.emailQueue.findFirst({
      where: { to: "direct@example.com" },
    });
    expect(row.status).toBe("sent");
    expect(row.sentAt).toBeInstanceOf(Date);
  });
});
