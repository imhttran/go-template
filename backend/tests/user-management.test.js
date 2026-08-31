import request from "supertest";
import { app, prisma } from "../app.js";
import { profileFields } from "./testHelpers.js";

describe("User management (RBAC)", () => {
  const adminEmail = "admin-mgmt@example.com";
  const staffEmail = "staff-mgmt@example.com";
  const clientEmail = "client-mgmt@example.com";
  const targetEmail = "target-mgmt@example.com";
  const password = "Tran1234!";

  // Fully onboarded by default (role/verified set, profile filled in) — most
  // tests below are exercising something other than the onboarding gates.
  async function makeUser(email, role, emailVerified = true) {
    await request(app).post("/api/signup").send({ email, password });
    const user = await prisma.user.update({
      where: { email },
      data: { role, emailVerified },
    });
    await prisma.userProfile.create({
      data: { userId: user.id, ...profileFields() },
    });
  }

  async function loginAs(email) {
    const res = await request(app).post("/api/login").send({ email, password });
    return res.body.token;
  }

  // Common per-test arrangement: create/overwrite the target user, log in as
  // the given actor, and hand back both — most tests below only vary role,
  // verified state, and which actor is making the request.
  async function setupTarget(role, emailVerified, actorEmail) {
    await makeUser(targetEmail, role, emailVerified);
    const target = await prisma.user.findUnique({
      where: { email: targetEmail },
    });
    const token = await loginAs(actorEmail);
    return { target, token };
  }

  beforeEach(async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = "false";
    await prisma.user.deleteMany({
      where: {
        email: { in: [adminEmail, staffEmail, clientEmail, targetEmail] },
      },
    });
    await makeUser(adminEmail, "admin");
    await makeUser(staffEmail, "staff");
    await makeUser(clientEmail, "client");
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: {
        email: { in: [adminEmail, staffEmail, clientEmail, targetEmail] },
      },
    });
    await prisma.$disconnect();
  });

  describe("POST /api/users/:id/resend-verification", () => {
    it("lets staff resend for an unverified user", async () => {
      const { target, token } = await setupTarget("client", false, staffEmail);

      const res = await request(app)
        .post(`/api/users/${target.id}/resend-verification`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);

      const queued = await prisma.emailQueue.findFirst({
        where: { to: targetEmail, subject: "Verify your email address" },
      });
      expect(queued).toBeTruthy();
    });

    it("rejects an already-verified user", async () => {
      const { target, token } = await setupTarget("client", true, staffEmail);

      const res = await request(app)
        .post(`/api/users/${target.id}/resend-verification`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(400);
    });

    it("rejects a client", async () => {
      const { target, token } = await setupTarget("client", false, clientEmail);

      const res = await request(app)
        .post(`/api/users/${target.id}/resend-verification`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(403);
    });
  });

  describe("POST /api/resend-verification (public, self-service)", () => {
    it("returns a generic success message whether or not the account exists", async () => {
      const res = await request(app)
        .post("/api/resend-verification")
        .send({ email: "nobody@example.com" });
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("PATCH /api/users/:id/verification", () => {
    it("lets admin set emailVerified", async () => {
      const { target, token } = await setupTarget("client", false, adminEmail);

      const res = await request(app)
        .patch(`/api/users/${target.id}/verification`)
        .set("Authorization", `Bearer ${token}`)
        .send({ emailVerified: true });
      expect(res.statusCode).toBe(200);
      expect(res.body.user.emailVerified).toBe(true);
      // The frontend alerts res.body.message on every mutation response
      // (see callApi in frontend/main.js) — a missing message alerts
      // "undefined" instead of failing loudly, so assert it's actually set.
      expect(res.body.message).toBeTruthy();
    });

    it("rejects staff", async () => {
      const { target, token } = await setupTarget("client", false, staffEmail);

      const res = await request(app)
        .patch(`/api/users/${target.id}/verification`)
        .set("Authorization", `Bearer ${token}`)
        .send({ emailVerified: true });
      expect(res.statusCode).toBe(403);
    });

    it("400s on a non-boolean value", async () => {
      const { target, token } = await setupTarget("client", false, adminEmail);

      const res = await request(app)
        .patch(`/api/users/${target.id}/verification`)
        .set("Authorization", `Bearer ${token}`)
        .send({ emailVerified: "yes" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("PATCH /api/users/:id/role", () => {
    it("lets admin change a user's role", async () => {
      const { target, token } = await setupTarget("client", true, adminEmail);

      const res = await request(app)
        .patch(`/api/users/${target.id}/role`)
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "staff" });
      expect(res.statusCode).toBe(200);
      expect(res.body.user.role).toBe("staff");
      expect(res.body.message).toBeTruthy();
    });

    it("rejects staff", async () => {
      const { target, token } = await setupTarget("client", true, staffEmail);

      const res = await request(app)
        .patch(`/api/users/${target.id}/role`)
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "staff" });
      expect(res.statusCode).toBe(403);
    });

    it("400s on an unknown role", async () => {
      const { target, token } = await setupTarget("client", true, adminEmail);

      const res = await request(app)
        .patch(`/api/users/${target.id}/role`)
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "superadmin" });
      expect(res.statusCode).toBe(400);
    });

    it("blocks an admin from changing their own role", async () => {
      const admin = await prisma.user.findUnique({
        where: { email: adminEmail },
      });
      const token = await loginAs(adminEmail);

      const res = await request(app)
        .patch(`/api/users/${admin.id}/role`)
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "client" });
      expect(res.statusCode).toBe(400);
    });

    it("404s on an id that doesn't exist", async () => {
      const token = await loginAs(adminEmail);
      const res = await request(app)
        .patch("/api/users/999999/role")
        .set("Authorization", `Bearer ${token}`)
        .send({ role: "staff" });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/users/:id/reset-password", () => {
    it("lets admin trigger a reset email for another user", async () => {
      const { target, token } = await setupTarget("client", true, adminEmail);

      const res = await request(app)
        .post(`/api/users/${target.id}/reset-password`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);

      const queued = await prisma.emailQueue.findFirst({
        where: { to: targetEmail, subject: "Reset your password" },
      });
      expect(queued).toBeTruthy();
    });

    it("rejects staff", async () => {
      const { target, token } = await setupTarget("client", true, staffEmail);

      const res = await request(app)
        .post(`/api/users/${target.id}/reset-password`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(403);
    });
  });

  describe("DELETE /api/users/:id", () => {
    it("lets admin delete another user", async () => {
      const { target, token } = await setupTarget("client", true, adminEmail);

      const res = await request(app)
        .delete(`/api/users/${target.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);

      const gone = await prisma.user.findUnique({
        where: { email: targetEmail },
      });
      expect(gone).toBeNull();
    });

    it("blocks an admin from deleting their own account", async () => {
      const admin = await prisma.user.findUnique({
        where: { email: adminEmail },
      });
      const token = await loginAs(adminEmail);

      const res = await request(app)
        .delete(`/api/users/${admin.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(400);
    });

    it("rejects staff", async () => {
      const { target, token } = await setupTarget("client", true, staffEmail);

      const res = await request(app)
        .delete(`/api/users/${target.id}`)
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(403);
    });

    it("404s on an id that doesn't exist", async () => {
      const token = await loginAs(adminEmail);
      const res = await request(app)
        .delete("/api/users/999999")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(404);
    });

    it("400s on a non-numeric id", async () => {
      const token = await loginAs(adminEmail);
      const res = await request(app)
        .delete("/api/users/not-a-number")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/users", () => {
    it("lets admin create a user with a temp password that must be changed", async () => {
      const token = await loginAs(adminEmail);

      const res = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${token}`)
        .send({ email: targetEmail, password });
      expect(res.statusCode).toBe(201);
      expect(res.body.user.email).toBe(targetEmail);

      const created = await prisma.user.findUnique({
        where: { email: targetEmail },
      });
      expect(created.mustChangePassword).toBe(true);
      expect(created.emailVerified).toBe(true);

      const loginRes = await request(app)
        .post("/api/login")
        .send({ email: targetEmail, password });
      expect(loginRes.statusCode).toBe(200);

      const meRes = await request(app)
        .get("/api/me")
        .set("Authorization", `Bearer ${loginRes.body.token}`);
      expect(meRes.body.user.mustChangePassword).toBe(true);
    });

    it("rejects staff", async () => {
      const token = await loginAs(staffEmail);

      const res = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${token}`)
        .send({ email: targetEmail, password });
      expect(res.statusCode).toBe(403);
    });

    it("rejects a duplicate email", async () => {
      const token = await loginAs(adminEmail);

      const res = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${token}`)
        .send({ email: adminEmail, password });
      expect(res.statusCode).toBe(400);
    });

    it("rejects a weak password", async () => {
      const token = await loginAs(adminEmail);

      const res = await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${token}`)
        .send({ email: targetEmail, password: "weak" });
      expect(res.statusCode).toBe(400);
    });

    it("lets a user clear both onboarding gates independently, in either order", async () => {
      // A fresh admin-created user starts blocked by *two* gates at once
      // (temp password AND no profile) — each gate's own route must stay
      // reachable regardless of whether the other gate is still active.
      const adminToken = await loginAs(adminEmail);
      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: targetEmail, password });
      const loginRes = await request(app)
        .post("/api/login")
        .send({ email: targetEmail, password });
      const token = loginRes.body.token;

      const profileRes = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields());
      expect(profileRes.statusCode).toBe(201);

      const changePasswordRes = await request(app)
        .post("/api/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: password, newPassword: "NewValid456!" });
      expect(changePasswordRes.statusCode).toBe(200);
    });

    it("blocks other API routes until the password is changed", async () => {
      const adminToken = await loginAs(adminEmail);
      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: targetEmail, password });
      // Promote to staff so GET /api/users is reachable by role once the
      // password-change gate lifts — isolates the assertion to that gate.
      await prisma.user.update({
        where: { email: targetEmail },
        data: { role: "staff" },
      });
      const loginRes = await request(app)
        .post("/api/login")
        .send({ email: targetEmail, password });
      const token = loginRes.body.token;

      // /api/me and /api/change-password stay reachable...
      const meRes = await request(app)
        .get("/api/me")
        .set("Authorization", `Bearer ${token}`);
      expect(meRes.statusCode).toBe(200);

      // ...but every other authenticated route is blocked with the temp password.
      const usersRes = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${token}`);
      expect(usersRes.statusCode).toBe(403);

      await request(app)
        .post("/api/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: password, newPassword: "NewValid456!" });
      // The profile gate is independent of the password gate — clear it too
      // so this assertion isolates the password gate lifting, not both.
      await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields());

      const usersResAfter = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${token}`);
      expect(usersResAfter.statusCode).toBe(200);
    });
  });

  describe("POST /api/change-password", () => {
    it("changes the password and clears mustChangePassword", async () => {
      const adminToken = await loginAs(adminEmail);
      await request(app)
        .post("/api/users")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ email: targetEmail, password });
      const loginRes = await request(app)
        .post("/api/login")
        .send({ email: targetEmail, password });
      const token = loginRes.body.token;
      const newPassword = "NewValid456!";

      const res = await request(app)
        .post("/api/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: password, newPassword });
      expect(res.statusCode).toBe(200);

      const updated = await prisma.user.findUnique({
        where: { email: targetEmail },
      });
      expect(updated.mustChangePassword).toBe(false);

      const relogin = await request(app)
        .post("/api/login")
        .send({ email: targetEmail, password: newPassword });
      expect(relogin.statusCode).toBe(200);
    });

    it("rejects an incorrect current password", async () => {
      const token = await loginAs(clientEmail);

      const res = await request(app)
        .post("/api/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: "WrongPass1!", newPassword: "NewValid456!" });
      expect(res.statusCode).toBe(401);
    });

    it("rejects a weak new password", async () => {
      const token = await loginAs(clientEmail);

      const res = await request(app)
        .post("/api/change-password")
        .set("Authorization", `Bearer ${token}`)
        .send({ currentPassword: password, newPassword: "weak" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("GET /api/users", () => {
    it("shows clients and staff, but not admin, to staff", async () => {
      const token = await loginAs(staffEmail);

      const res = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(
        res.body.users.every((u) => u.role === "client" || u.role === "staff"),
      ).toBe(true);
      expect(res.body.users.some((u) => u.email === clientEmail)).toBe(true);
      expect(res.body.users.some((u) => u.email === staffEmail)).toBe(true);
      expect(res.body.users.some((u) => u.email === adminEmail)).toBe(false);
    });

    it("shows every role to admin", async () => {
      const token = await loginAs(adminEmail);

      const res = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.users.some((u) => u.role === "staff")).toBe(true);
      expect(res.body.users.some((u) => u.role === "admin")).toBe(true);
    });

    it("rejects a client", async () => {
      const token = await loginAs(clientEmail);

      const res = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /api/me", () => {
    it("includes role and emailVerified", async () => {
      const token = await loginAs(clientEmail);
      const res = await request(app)
        .get("/api/me")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.user.role).toBe("client");
      expect(res.body.user.emailVerified).toBe(true);
    });
  });
});
