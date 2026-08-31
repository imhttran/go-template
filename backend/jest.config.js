export default {
  testEnvironment: "node",
  transform: {},
  testMatch: ["**/tests/**/*.test.js"],
  // ponytail: test suites share one SQLite file (dev.test.db) and a few
  // pre-existing suites do unscoped deleteMany() in beforeEach/afterAll —
  // parallel workers race on writes to it. Serializing trades away parallel
  // test time repo-wide instead of scoping those suites' cleanup (or giving
  // each worker its own SQLite file). Upgrade path: scope every suite's
  // deleteMany() the way backend/tests/user-management.test.js already does,
  // or set DATABASE_URL per JEST_WORKER_ID, then drop this.
  maxWorkers: 1,
};
