import { PrismaClient } from "@prisma/client";

// Jest sets NODE_ENV=test automatically. Tests get their own SQLite file
// (a snapshot of dev.db, refreshed by the "pretest" script) instead of
// sharing dev.db with the running dev server — a test cleaning up its own
// fixtures should never delete something a real dev session needs.
export const prisma = new PrismaClient(
  process.env.NODE_ENV === "test"
    ? { datasources: { db: { url: "file:../dev.test.db" } } }
    : undefined,
);
