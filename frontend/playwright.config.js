import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  webServer: [
    {
      command: "npm run dev",
      cwd: "../backend",
      url: "http://localhost:3000/api/me",
      reuseExistingServer: !process.env.CI,
      // /api/me with no token replies 401, not 200 — just means the server is up.
      timeout: 120_000,
      // e2e only exercises login/signup, not the verify-email flow (covered in backend/tests/verification.test.js).
      env: { EMAIL_VERIFICATION_REQUIRED: "false" },
    },
    {
      command: "npm run dev",
      cwd: ".",
      url: "http://localhost:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
