#!/usr/bin/env node
// Sets an existing user's role. There's no HTTP endpoint for this on purpose —
// admin/staff are granted out-of-band (usage: node scripts/set-role.js <email> <role>).
import { prisma } from "../db.js";
import { ROLES } from "../../common/roles.js";

const [email, role] = process.argv.slice(2);

if (!email || !ROLES.includes(role)) {
  console.error(`Usage: node scripts/set-role.js <email> <${ROLES.join("|")}>`);
  process.exit(1);
}

try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }
  await prisma.user.update({ where: { email }, data: { role } });
  console.log(`${email} is now ${role}`);
} catch (error) {
  console.error("Failed to set role:", error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
