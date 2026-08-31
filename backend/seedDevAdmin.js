// Dev-only convenience: guarantees a known admin login exists locally, so
// there's no manual set-role.js step for local dev. Gated on NODE_ENV so
// these credentials can never appear in a qa/prod database.
import { prisma, hashPassword } from "./app.js";

const DEV_ADMIN = { email: "admin@mail.com", password: "Password1234!" };

export async function seedDevAdmin() {
  if (process.env.NODE_ENV !== "development") return;
  const admin = await prisma.user.upsert({
    where: { email: DEV_ADMIN.email },
    update: {},
    create: {
      email: DEV_ADMIN.email,
      password: hashPassword(DEV_ADMIN.password),
      role: "admin",
      emailVerified: true,
    },
  });
  // Pre-fill the profile too, so the dev admin isn't stopped by its own
  // onboarding gate (see ONBOARDING_GATES in app.js).
  await prisma.userProfile.upsert({
    where: { userId: admin.id },
    update: {},
    create: {
      userId: admin.id,
      firstName: "Dev",
      lastName: "Admin",
      address: "N/A",
      state: "N/A",
      zip: "00000",
      phone: "N/A",
    },
  });
  console.log(`[seed] dev admin ready: ${DEV_ADMIN.email}`);
}
