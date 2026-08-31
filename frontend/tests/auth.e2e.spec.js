import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5173";
const API_URL = "http://localhost:3000";
const LOGIN_EMAIL = "tom@example.com";
const LOGIN_PASSWORD = "Tran1234!";

test.describe("Authentication Flow", () => {
  test.beforeAll(async ({ request }) => {
    // Seed the login-flow user through the real signup API (idempotent: 400 if it already exists)
    // so the login test has a real account to authenticate against.
    await request.post(`${API_URL}/api/signup`, {
      data: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
    });
    // Also idempotent: a fresh account has no profile, and the login test
    // expects a clean redirect straight to the dashboard — fill one in
    // (POST /api/profile 400s harmlessly if a prior run already did).
    const loginRes = await request.post(`${API_URL}/api/login`, {
      data: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
    });
    const { token } = await loginRes.json();
    await request.post(`${API_URL}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        firstName: "Tom",
        lastName: "Tran",
        address: "1 Test St",
        state: "CA",
        zip: "94043",
        phone: "555-123-4567",
        communicationPreference: "email",
      },
    });
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
  });

  test("should show error for weak password during signup", async ({
    page,
  }) => {
    await page.click("#show-signup");
    await page.fill("#signup-email", "test@example.com");
    await page.fill("#signup-password", "weak");
    await page.fill("#signup-confirm-password", "weak");

    page.on("dialog", async (dialog) => {
      expect(dialog.message()).toContain("at least 8 characters");
      await dialog.dismiss();
    });

    await page.click('#signup-form button[type="submit"]');
  });

  test("should show error when passwords do not match", async ({ page }) => {
    await page.click("#show-signup");
    await page.fill("#signup-email", "mismatch@example.com");
    await page.fill("#signup-password", "Valid123!");
    await page.fill("#signup-confirm-password", "Different1!");

    page.on("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Passwords do not match");
      await dialog.dismiss();
    });

    await page.click('#signup-form button[type="submit"]');
    await expect(page.locator("#signup-form")).toBeVisible();
  });

  test("should successfully signup and redirect to login", async ({ page }) => {
    // Unique email per run: this account is never cleaned up, so a fixed address
    // would 400 on every rerun against a persisted dev.db.
    const email = `newuser-${Date.now()}@test.com`;
    await page.click("#show-signup");
    await page.fill("#signup-email", email);
    await page.fill("#signup-password", "Valid123!");
    await page.fill("#signup-confirm-password", "Valid123!");

    page.on("dialog", async (dialog) => {
      expect(dialog.message()).toBe("Account created! You can now log in.");
      await dialog.accept();
    });

    await page.click('#signup-form button[type="submit"]');
    await expect(page.locator("#signup-form")).toBeHidden();
    await expect(page.locator("#login-form")).toBeVisible();
  });

  test("should log in and redirect to dashboard", async ({ page }) => {
    await page.fill("#email", LOGIN_EMAIL);
    await page.fill("#password", LOGIN_PASSWORD);

    page.on("dialog", async (dialog) => {
      await dialog.accept();
    });

    await page.click('#login-form button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard.html/);
    await expect(page.locator("#user-email")).toContainText("tom@example.com");
  });

  test("should redirect to login if accessing dashboard without token", async ({
    page,
  }) => {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE_URL}/dashboard.html`);
    await expect(page).toHaveURL(/.*index.html/);
  });
});
