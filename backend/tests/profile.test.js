import request from "supertest";
import { app, prisma } from "../app.js";
import { profileFields } from "./testHelpers.js";

describe("User profile", () => {
  const email = "profile-test@example.com";
  const password = "Valid123!";

  beforeEach(async () => {
    process.env.EMAIL_VERIFICATION_REQUIRED = "false";
    await prisma.user.deleteMany({ where: { email } });
    await request(app).post("/api/signup").send({ email, password });
    // Reachable by role once the profile gate lifts, so tests below can
    // assert on that gate specifically rather than a 403 from role checks.
    await prisma.user.update({ where: { email }, data: { role: "staff" } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await prisma.$disconnect();
  });

  async function login() {
    const res = await request(app).post("/api/login").send({ email, password });
    return res.body.token;
  }

  describe("GET /api/profile", () => {
    it("returns null before a profile is filled in", async () => {
      const token = await login();
      const res = await request(app)
        .get("/api/profile")
        .set("Authorization", `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.profile).toBeNull();
    });

    it("returns the saved profile afterward", async () => {
      const token = await login();
      await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields());

      const res = await request(app)
        .get("/api/profile")
        .set("Authorization", `Bearer ${token}`);
      expect(res.body.profile.firstName).toBe("Test");
    });
  });

  describe("POST /api/profile", () => {
    it("saves the required fields plus optional references", async () => {
      const token = await login();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(
          profileFields({
            address2: "Apt 4B",
            communicationPreference: "text",
            linkedin: "https://linkedin.com/in/ada",
            github: "https://github.com/ada",
            altEmail: "ada@example.com",
          }),
        );
      expect(res.statusCode).toBe(201);
      expect(res.body.profile.linkedin).toBe("https://linkedin.com/in/ada");
      expect(res.body.profile.address2).toBe("Apt 4B");
      expect(res.body.profile.communicationPreference).toBe("text");
    });

    it("defaults country to US when not provided", async () => {
      const token = await login();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields());
      expect(res.statusCode).toBe(201);
      expect(res.body.profile.country).toBe("US");
    });

    it("rejects a missing state or zip", async () => {
      const token = await login();
      const { state, ...withoutState } = profileFields();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(withoutState);
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain("state");
    });

    it("rejects an invalid phone number", async () => {
      const token = await login();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields({ phone: "not-a-phone" }));
      expect(res.statusCode).toBe(400);
    });

    it("rejects an invalid zip code", async () => {
      const token = await login();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields({ zip: "not-a-zip" }));
      expect(res.statusCode).toBe(400);
    });

    it("rejects an invalid state code", async () => {
      const token = await login();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields({ state: "ZZ" }));
      expect(res.statusCode).toBe(400);
    });

    it("rejects a non-US country", async () => {
      const token = await login();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields({ country: "CA" }));
      expect(res.statusCode).toBe(400);
    });

    it("rejects an invalid additional email address", async () => {
      const token = await login();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields({ altEmail: "not-an-email" }));
      expect(res.statusCode).toBe(400);
    });

    it("rejects an invalid LinkedIn URL", async () => {
      const token = await login();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields({ linkedin: "not-a-url" }));
      expect(res.statusCode).toBe(400);
    });

    it("rejects an invalid GitHub URL", async () => {
      const token = await login();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields({ github: "ftp://wrong-scheme.example" }));
      expect(res.statusCode).toBe(400);
    });

    it("rejects an invalid communication preference", async () => {
      const token = await login();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields({ communicationPreference: "carrier-pigeon" }));
      expect(res.statusCode).toBe(400);
    });

    it("rejects a missing required field", async () => {
      const token = await login();
      const { phone, ...withoutPhone } = profileFields();
      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(withoutPhone);
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain("phone");
    });

    it("rejects a second submission for the same user", async () => {
      const token = await login();
      await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields());

      const res = await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields());
      expect(res.statusCode).toBe(400);
    });

    it("blocks other API routes until a profile is filled in", async () => {
      const token = await login();

      // /api/me and /api/profile stay reachable...
      const meRes = await request(app)
        .get("/api/me")
        .set("Authorization", `Bearer ${token}`);
      expect(meRes.statusCode).toBe(200);
      expect(meRes.body.user.hasProfile).toBe(false);

      // ...but every other authenticated route is blocked until then.
      const usersRes = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${token}`);
      expect(usersRes.statusCode).toBe(403);

      await request(app)
        .post("/api/profile")
        .set("Authorization", `Bearer ${token}`)
        .send(profileFields());

      const usersResAfter = await request(app)
        .get("/api/users")
        .set("Authorization", `Bearer ${token}`);
      expect(usersResAfter.statusCode).toBe(200);

      const meResAfter = await request(app)
        .get("/api/me")
        .set("Authorization", `Bearer ${token}`);
      expect(meResAfter.body.user.hasProfile).toBe(true);
    });
  });

  it("deletes the profile along with the user (cascade)", async () => {
    const token = await login();
    await request(app)
      .post("/api/profile")
      .set("Authorization", `Bearer ${token}`)
      .send(profileFields());

    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.user.delete({ where: { id: user.id } });

    const orphanedProfile = await prisma.userProfile.findUnique({
      where: { userId: user.id },
    });
    expect(orphanedProfile).toBeNull();
  });
});
