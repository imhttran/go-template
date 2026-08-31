import request from "supertest";
import { app, prisma } from "../app.js";
import { profileFields } from "./testHelpers.js";

describe("Auth API", () => {
  const testEmail = "tom@example.com";
  const testPassword = "Tran1234!";

  // Seed a known user through the real signup path (real hashing, real datastore)
  // so tests exercise the same persistence app.js actually uses.
  beforeEach(async () => {
    // These tests exercise the bypass path: verification is not required.
    process.env.EMAIL_VERIFICATION_REQUIRED = "false";
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await request(app)
      .post("/api/signup")
      .send({ email: testEmail, password: testPassword });
    // The RBAC checks below hit requireAuth-gated routes, which now also
    // require a completed profile — fill one in so role is what's under test.
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    await prisma.userProfile.create({
      data: { userId: user.id, ...profileFields() },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: testEmail } });
    await prisma.emailQueue.deleteMany();
    await prisma.$disconnect();
  });

  describe("POST /api/signup", () => {
    it("should fail if password is too short", async () => {
      const res = await request(app)
        .post("/api/signup")
        .send({ email: "test@test.com", password: "S1!" });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain("at least 8 characters");
    });

    it("should fail if password has no uppercase", async () => {
      const res = await request(app)
        .post("/api/signup")
        .send({ email: "test@test.com", password: "password123!" });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain("one uppercase letter");
    });

    it("should fail if password has no number", async () => {
      const res = await request(app)
        .post("/api/signup")
        .send({ email: "test@test.com", password: "Password!" });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain("one number");
    });

    it("should fail if password has no special character", async () => {
      const res = await request(app)
        .post("/api/signup")
        .send({ email: "test@test.com", password: "Password123" });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain("one special character");
    });

    it("should succeed with a valid password", async () => {
      const res = await request(app)
        .post("/api/signup")
        .send({ email: "new@test.com", password: "Password123!" });
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      await prisma.user.deleteMany({ where: { email: "new@test.com" } });
    });

    it("should fail if user already exists", async () => {
      const res = await request(app)
        .post("/api/signup")
        .send({ email: testEmail, password: "Password123!" });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe(
        "Unable to sign up. Please try again later.",
      );
    });
  });

  describe("POST /api/login", () => {
    it("should log in successfully with correct credentials", async () => {
      const res = await request(app)
        .post("/api/login")
        .send({ email: testEmail, password: testPassword });
      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    it("should fail with wrong password", async () => {
      const res = await request(app)
        .post("/api/login")
        .send({ email: testEmail, password: "wrongpassword" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /api/users (RBAC)", () => {
    async function loginAs(email) {
      const res = await request(app)
        .post("/api/login")
        .send({ email, password: testPassword });
      return res.body.token;
    }

    it("should default new signups to the client role and reject them", async () => {
      const token = await loginAs(testEmail);
      const res = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(403);
    });

    it("should allow staff", async () => {
      await prisma.user.update({
        where: { email: testEmail },
        data: { role: "staff" },
      });
      const token = await loginAs(testEmail);
      const res = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
    });

    it("should allow admin", async () => {
      await prisma.user.update({
        where: { email: testEmail },
        data: { role: "admin" },
      });
      const token = await loginAs(testEmail);
      const res = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
    });

    it("should reject unauthenticated requests", async () => {
      const res = await request(app).get("/api/users");
      expect(res.statusCode).toBe(401);
    });
  });
});
