import request from "supertest";
import { app, prisma } from "../app.js";

describe("Email verification", () => {
  const email = "verify-test@example.com";
  const password = "Valid123!";

  beforeEach(async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = "true";
    await prisma.user.deleteMany({ where: { email } });
    await prisma.emailQueue.deleteMany();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.emailQueue.deleteMany();
    delete process.env.EMAIL_VERIFICATION_REQUIRED;
    await prisma.$disconnect();
  });

  async function signupAndGetToken() {
    const res = await request(app)
      .post("/api/signup")
      .send({ email, password });
    expect(res.statusCode).toBe(201);
    const user = await prisma.user.findUnique({ where: { email } });
    return user.verificationToken;
  }

  it("refuses login before the email is verified", async () => {
    await signupAndGetToken();
    const res = await request(app).post("/api/login").send({ email, password });
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toContain("verify your email");
  });

  it("verifies via token and then allows login", async () => {
    const token = await signupAndGetToken();

    const verifyRes = await request(app).get(`/api/verify?token=${token}`);
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.body.success).toBe(true);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user.emailVerified).toBe(true);
    expect(user.verificationToken).toBeNull();

    const loginRes = await request(app)
      .post("/api/login")
      .send({ email, password });
    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.body.token).toBeDefined();
  });

  it("rejects an invalid verification token", async () => {
    await signupAndGetToken();
    const res = await request(app).get("/api/verify?token=bogus-token");
    expect(res.statusCode).toBe(400);
  });

  it("allows login when EMAIL_VERIFICATION_REQUIRED=false (bypass)", async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = "false";
    await signupAndGetToken();
    const res = await request(app).post("/api/login").send({ email, password });
    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});
