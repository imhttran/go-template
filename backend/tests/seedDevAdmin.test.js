import { prisma } from "../app.js";
import { seedDevAdmin } from "../seedDevAdmin.js";

describe("seedDevAdmin", () => {
  const email = "admin@mail.com";
  const originalNodeEnv = process.env.NODE_ENV;

  // dev.db is the same file the real dev server seeds into — clear any
  // pre-existing admin@mail.com before asserting on a clean slate.
  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { email } });
  });

  afterEach(async () => {
    process.env.NODE_ENV = originalNodeEnv;
    await prisma.user.deleteMany({ where: { email } });
  });

  it("does nothing outside NODE_ENV=development", async () => {
    process.env.NODE_ENV = "production";
    await seedDevAdmin();
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });

  it("creates a verified admin in development, idempotently", async () => {
    process.env.NODE_ENV = "development";
    await seedDevAdmin();
    await seedDevAdmin(); // second call must not throw or duplicate

    const users = await prisma.user.findMany({ where: { email } });
    expect(users).toHaveLength(1);
    expect(users[0].role).toBe("admin");
    expect(users[0].emailVerified).toBe(true);
    expect(users[0].password).not.toBe("Password1234!"); // stored hashed

    // Pre-filled so the dev admin isn't stopped by its own onboarding gate.
    const profile = await prisma.userProfile.findUnique({
      where: { userId: users[0].id },
    });
    expect(profile).toBeTruthy();
  });
});
