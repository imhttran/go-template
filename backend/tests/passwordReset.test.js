import request from "supertest";
import { app, prisma } from "../app.js";

describe("Password reset", () => {
  const email = "reset-test@example.com";
  const password = "Valid123!";
  const newPassword = "NewValid456!";

  beforeEach(async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = "false";
    await prisma.user.deleteMany({ where: { email } });
    await prisma.emailQueue.deleteMany();
    await request(app).post("/api/signup").send({ email, password });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.emailQueue.deleteMany();
    delete process.env.EMAIL_VERIFICATION_REQUIRED;
    await prisma.$disconnect();
  });

  describe("POST /api/forgot-password", () => {
    it("issues a reset token for a known email", async () => {
      const res = await request(app)
        .post("/api/forgot-password")
        .send({ email });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user.resetToken).toBeTruthy();
      expect(user.resetTokenExpiry).toBeTruthy();
    });

    it("returns the same generic response for an unknown email (no enumeration)", async () => {
      const res = await request(app)
        .post("/api/forgot-password")
        .send({ email: "nobody@example.com" });
      expect(res.statusCode).toBe(200);
      expect(res.body.message).toBe(
        "If that email is registered, a reset link has been sent.",
      );
    });

    it("rejects an invalid email address", async () => {
      const res = await request(app)
        .post("/api/forgot-password")
        .send({ email: "not-an-email" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/reset-password", () => {
    async function requestResetToken() {
      await request(app).post("/api/forgot-password").send({ email });
      const user = await prisma.user.findUnique({ where: { email } });
      return user.resetToken;
    }

    it("resets the password with a valid token and allows login with it", async () => {
      const token = await requestResetToken();

      const res = await request(app)
        .post("/api/reset-password")
        .send({ token, password: newPassword });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user.resetToken).toBeNull();
      expect(user.resetTokenExpiry).toBeNull();

      const loginRes = await request(app)
        .post("/api/login")
        .send({ email, password: newPassword });
      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.body.token).toBeDefined();

      const oldPasswordLogin = await request(app)
        .post("/api/login")
        .send({ email, password });
      expect(oldPasswordLogin.statusCode).toBe(401);
    });

    it("clears a pending forced password change (any reset counts as changing it)", async () => {
      await prisma.user.update({
        where: { email },
        data: { mustChangePassword: true },
      });
      const token = await requestResetToken();

      await request(app)
        .post("/api/reset-password")
        .send({ token, password: newPassword });

      const user = await prisma.user.findUnique({ where: { email } });
      expect(user.mustChangePassword).toBe(false);
    });

    it("rejects an invalid token", async () => {
      const res = await request(app)
        .post("/api/reset-password")
        .send({ token: "bogus-token", password: newPassword });
      expect(res.statusCode).toBe(400);
    });

    it("rejects an expired token", async () => {
      const token = await requestResetToken();
      await prisma.user.update({
        where: { email },
        data: { resetTokenExpiry: new Date(Date.now() - 1000) },
      });

      const res = await request(app)
        .post("/api/reset-password")
        .send({ token, password: newPassword });
      expect(res.statusCode).toBe(400);
    });

    it("rejects a weak new password", async () => {
      const token = await requestResetToken();
      const res = await request(app)
        .post("/api/reset-password")
        .send({ token, password: "weak" });
      expect(res.statusCode).toBe(400);
    });

    it("cannot be reused after a successful reset", async () => {
      const token = await requestResetToken();
      await request(app)
        .post("/api/reset-password")
        .send({ token, password: newPassword });

      const res = await request(app)
        .post("/api/reset-password")
        .send({ token, password: "AnotherValid789!" });
      expect(res.statusCode).toBe(400);
    });
  });
});
