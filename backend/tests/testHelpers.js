// Shared by every test that needs a user past the profile onboarding gate
// (see ONBOARDING_GATES in app.js) — the exact values don't matter, only
// that all required fields are present.
export function profileFields(overrides = {}) {
  return {
    firstName: "Test",
    lastName: "User",
    address: "1 Test St",
    state: "CA",
    zip: "94043",
    phone: "555-123-4567",
    communicationPreference: "email",
    ...overrides,
  };
}
