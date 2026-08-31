import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { prisma } from "./db.js";
import {
  welcomeEmail,
  verificationEmail,
  passwordResetEmail,
} from "./emailQueue.js";
import {
  validateEmail,
  validatePassword,
  validatePhone,
  validateZip,
  validateUrl,
} from "../common/validators.js";
import { ROLES, hasRole } from "../common/roles.js";
import { US_STATE_CODES, COUNTRY_CODES } from "../common/usStates.js";

export const app = express();
// Non-prod profiles fall back to a fixed secret so sessions survive restarts
// even without a .env; production must set JWT_SECRET explicitly.
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production"
    ? (() => {
        throw new Error("JWT_SECRET must be set in production");
      })()
    : "dev-insecure-jwt-secret");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const hashBuffer = Buffer.from(hash, "hex");
  const suppliedBuffer = crypto.scryptSync(password, salt, 64);
  return (
    hashBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(hashBuffer, suppliedBuffer)
  );
}

// Bypass email verification when EMAIL_VERIFICATION_REQUIRED=false (dev / local setups).
function verificationRequired() {
  return process.env.EMAIL_VERIFICATION_REQUIRED !== "false";
}

function tokenLink(page, token) {
  return `${process.env.FRONTEND_URL || "http://localhost:5173"}/${page}?token=${token}`;
}

function issueToken(user) {
  return jwt.sign({ email: user.email }, JWT_SECRET, { expiresIn: "1h" });
}

// A logged-in user can be mid-onboarding — temp password not yet changed,
// registration details not yet filled in, possibly both at once. Each gate
// owns its own clearing route(s), always exempt from every gate (not just its
// own) so a user working through one gate can still reach the other's route —
// enforced here so the frontend redirect isn't the only thing stopping a temp
// password or empty profile from driving the API.
const ONBOARDING_GATES = [
  {
    blocked: (user) => user.mustChangePassword,
    exemptRoutes: ["POST /api/change-password"],
    message: "Password change required",
  },
  {
    blocked: (user) => !user.profile,
    exemptRoutes: ["GET /api/profile", "POST /api/profile"],
    message: "Profile information required",
  },
];
const ONBOARDING_EXEMPT_ROUTES = new Set([
  "GET /api/me",
  ...ONBOARDING_GATES.flatMap((gate) => gate.exemptRoutes),
]);

// Shared by every route that requires a logged-in user (attaches req.user).
async function requireAuth(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { email: decoded.email },
      // Gates only need to know a profile exists, not its contents — routes
      // that need the full row (GET /api/profile) fetch it themselves.
      include: { profile: { select: { id: true } } },
    });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (verificationRequired() && !user.emailVerified) {
      return res.status(403).json({ message: "Please verify your email" });
    }
    const route = `${req.method} ${req.path}`;
    if (!ONBOARDING_EXEMPT_ROUTES.has(route)) {
      for (const gate of ONBOARDING_GATES) {
        if (gate.blocked(user)) {
          return res.status(403).json({ message: gate.message });
        }
      }
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
}

// Chain after requireAuth: 403s unless req.user.role is minRole or higher.
function requireRole(minRole) {
  return (req, res, next) => {
    if (!hasRole(req.user.role, minRole)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
}

// Shared by every route taking a :id param — rejects non-numeric ids before they hit Prisma.
function parseId(req, res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: "Invalid user id" });
  }
  req.targetUserId = id;
  next();
}

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// Shared by /api/forgot-password (self-service, keyed by email) and the
// admin-triggered reset route (keyed by id). One round trip: the update
// itself both finds the user (throwing Prisma's P2025 if `where` doesn't
// match) and sets the token, so callers don't need their own lookup+404 check.
async function queuePasswordReset(where) {
  const token = crypto.randomBytes(32).toString("hex");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where,
      data: {
        resetToken: token,
        resetTokenExpiry: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    await tx.emailQueue.create({
      data: passwordResetEmail(
        user.email,
        tokenLink("reset-password.html", token),
      ),
    });
    return user;
  });
}

// Shared by /api/resend-verification (self-service) and the staff-triggered resend route.
async function queueVerificationEmail(user) {
  const token = crypto.randomBytes(32).toString("hex");
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { verificationToken: token },
    }),
    prisma.emailQueue.create({
      data: verificationEmail(user.email, tokenLink("verify.html", token)),
    }),
  ]);
}

app.use(cors());
app.use(express.json());

app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;

  if (!validateEmail(email)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid email address" });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ success: false, message: passwordError });
  }

  try {
    // Atomic: user + welcome-email row together, so a failed email never leaves an
    // orphaned account and a rolled-back signup leaves no queued email. Actual send
    // is deferred to the worker — signup is never blocked on mail delivery.
    const token = crypto.randomBytes(32).toString("hex");
    const [newUser] = await prisma.$transaction([
      prisma.user.create({
        data: {
          email,
          password: hashPassword(password),
          emailVerified: false,
          verificationToken: token,
        },
      }),
      prisma.emailQueue.create({ data: welcomeEmail(email) }),
      prisma.emailQueue.create({
        data: verificationEmail(email, tokenLink("verify.html", token)),
      }),
    ]);
    res.status(201).json({
      success: true,
      message: "User created successfully!",
      user: { email: newUser.email },
    });
  } catch (error) {
    if (error.code === "P2002") {
      // Keep the user-facing message generic so the API doesn't reveal
      // whether an email is already registered (prevents user enumeration).
      // The real reason is logged server-side for debugging.
      console.warn(
        `[signup] rejected: email already registered (email=${email})`,
      );
      return res.status(400).json({
        success: false,
        message: "Unable to sign up. Please try again later.",
      });
    }
    console.error("Signup Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.get("/api/verify", async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res
      .status(400)
      .json({ success: false, message: "Missing verification token" });
  }
  try {
    const user = await prisma.user.findUnique({
      where: { verificationToken: token },
    });
    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired verification link",
      });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, verificationToken: null },
    });
    res.json({ success: true, message: "Email verified successfully!" });
  } catch (error) {
    console.error("Verify Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/resend-verification", async (req, res) => {
  const { email } = req.body;
  if (!validateEmail(email)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid email address" });
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerified) {
      await queueVerificationEmail(user);
    }
    // Same response regardless of account existence/verified state, so this
    // endpoint can't be used to enumerate registered emails.
    res.json({
      success: true,
      message:
        "If that email is registered and unverified, a verification link has been sent.",
    });
  } catch (error) {
    console.error("Resend Verification Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!validateEmail(email)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid email address" });
  }

  try {
    await queuePasswordReset({ email }).catch((error) => {
      if (error.code !== "P2025") throw error; // no such user: fall through to the generic response
    });
    // Same response whether or not the account exists, so this endpoint
    // can't be used to enumerate registered emails.
    res.json({
      success: true,
      message: "If that email is registered, a reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot Password Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/reset-password", async (req, res) => {
  const { token, password } = req.body;
  if (!token) {
    return res
      .status(400)
      .json({ success: false, message: "Missing reset token" });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ success: false, message: passwordError });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { resetToken: token },
    });
    if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset link",
      });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashPassword(password),
        resetToken: null,
        resetTokenExpiry: null,
        mustChangePassword: false,
      },
    });
    res.json({
      success: true,
      message: "Password reset successfully!",
      token: issueToken(user),
      user: { email: user.email },
    });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && verifyPassword(password, user.password)) {
      if (verificationRequired() && !user.emailVerified) {
        return res.status(403).json({
          success: false,
          message: "Please verify your email before logging in.",
        });
      }
      return res.status(200).json({
        success: true,
        message: "Login successful!",
        token: issueToken(user),
        user: { email: user.email },
      });
    }
    return res
      .status(401)
      .json({ success: false, message: "Invalid email or password" });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.get("/api/me", requireAuth, async (req, res) => {
  res.json({
    message: "Welcome to the secret area!",
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      emailVerified: req.user.emailVerified,
      mustChangePassword: req.user.mustChangePassword,
      hasProfile: !!req.user.profile,
    },
  });
});

const REQUIRED_PROFILE_FIELDS = [
  "firstName",
  "lastName",
  "address",
  "state",
  "zip",
  "phone",
  "communicationPreference",
];
const COMMUNICATION_PREFERENCES = ["email", "text", "phone"];

app.get("/api/profile", requireAuth, async (req, res) => {
  const profile = await prisma.userProfile.findUnique({
    where: { userId: req.user.id },
  });
  res.json({ profile });
});

// One-time registration form, submitted once per user (a second submit
// while onboarding-gated would 400 on the unique userId — that's fine,
// there's no "edit profile" story yet, just "fill it in").
// Returns an error message describing the first unmet rule, or null if valid
// (same convention as validatePassword in common/validators.js).
function validateProfileFields(body) {
  const missing = REQUIRED_PROFILE_FIELDS.filter(
    (field) => !body[field]?.trim(),
  );
  if (missing.length > 0) {
    return `Missing required field(s): ${missing.join(", ")}`;
  }
  if (!COMMUNICATION_PREFERENCES.includes(body.communicationPreference)) {
    return `communicationPreference must be one of: ${COMMUNICATION_PREFERENCES.join(", ")}`;
  }
  if (!validatePhone(body.phone)) return "Phone number is invalid";
  if (!validateZip(body.zip)) return "Zip code is invalid";
  if (!US_STATE_CODES.has(body.state)) return "State is invalid";
  // Dropdown only ever offers what's in COUNTRIES, but a direct API call
  // could still send something else.
  if (body.country && !COUNTRY_CODES.has(body.country)) {
    return "Country is invalid";
  }
  if (body.altEmail && !validateEmail(body.altEmail)) {
    return "Additional email address is invalid";
  }
  if (body.linkedin && !validateUrl(body.linkedin)) {
    return "LinkedIn URL is invalid";
  }
  if (body.github && !validateUrl(body.github)) {
    return "GitHub URL is invalid";
  }
  return null;
}

app.post("/api/profile", requireAuth, async (req, res) => {
  const validationError = validateProfileFields(req.body);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const body = req.body;
  try {
    const profile = await prisma.userProfile.create({
      data: {
        userId: req.user.id,
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        address: body.address.trim(),
        address2: body.address2?.trim() || null,
        state: body.state.trim(),
        zip: body.zip.trim(),
        // Omitted (not null'd) when blank, so Prisma's @default("US") applies.
        country: body.country?.trim() || undefined,
        phone: body.phone.trim(),
        communicationPreference: body.communicationPreference,
        linkedin: body.linkedin?.trim() || null,
        github: body.github?.trim() || null,
        altEmail: body.altEmail?.trim() || null,
      },
    });
    res.status(201).json({ success: true, message: "Profile saved!", profile });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(400).json({ message: "Profile already exists" });
    }
    console.error("Save Profile Error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Authenticated self-service password change. Used both for the general
// "change my password" case and to clear the forced-change flag an
// admin-created account starts with.
app.post("/api/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!verifyPassword(currentPassword || "", req.user.password)) {
    return res
      .status(401)
      .json({ success: false, message: "Current password is incorrect" });
  }
  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return res.status(400).json({ success: false, message: passwordError });
  }

  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashPassword(newPassword), mustChangePassword: false },
    });
    res.json({ success: true, message: "Password changed successfully!" });
  } catch (error) {
    console.error("Change Password Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Staff sees clients and other staff — admin accounts aren't theirs to
// manage. Admin sees everyone.
app.get("/api/users", requireAuth, requireRole("staff"), async (req, res) => {
  const users = await prisma.user.findMany({
    where: hasRole(req.user.role, "admin")
      ? {}
      : { role: { in: ["client", "staff"] } },
    select: {
      id: true,
      email: true,
      role: true,
      emailVerified: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

// Admin-only: creates a user with an admin-chosen password, already verified
// (the admin vouches for the email) and flagged to force a password change
// on first login — the admin never needs to share the real password twice.
app.post("/api/users", requireAuth, requireRole("admin"), async (req, res) => {
  const { email, password } = req.body;

  if (!validateEmail(email)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid email address" });
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    return res.status(400).json({ success: false, message: passwordError });
  }

  try {
    const user = await prisma.user.create({
      data: {
        email,
        password: hashPassword(password),
        emailVerified: true,
        mustChangePassword: true,
      },
      select: { id: true, email: true, role: true, emailVerified: true },
    });
    res
      .status(201)
      .json({ success: true, message: "User created successfully!", user });
  } catch (error) {
    if (error.code === "P2002") {
      return res
        .status(400)
        .json({ success: false, message: "Email is already registered" });
    }
    console.error("Admin Create User Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// Staff can nudge a not-yet-verified user's verification email along.
app.post(
  "/api/users/:id/resend-verification",
  requireAuth,
  requireRole("staff"),
  parseId,
  async (req, res) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: req.targetUserId },
      });
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.emailVerified) {
        return res.status(400).json({ message: "User is already verified" });
      }
      await queueVerificationEmail(user);
      res.json({ success: true, message: "Verification email sent" });
    } catch (error) {
      console.error("Resend Verification Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// Admin-only: flip a user's verified flag directly, no email round-trip.
app.patch(
  "/api/users/:id/verification",
  requireAuth,
  requireRole("admin"),
  parseId,
  async (req, res) => {
    const { emailVerified } = req.body;
    if (typeof emailVerified !== "boolean") {
      return res
        .status(400)
        .json({ message: "emailVerified must be a boolean" });
    }
    try {
      const user = await prisma.user.update({
        where: { id: req.targetUserId },
        data: { emailVerified, verificationToken: null },
        select: { id: true, email: true, emailVerified: true },
      });
      res.json({
        success: true,
        message: user.emailVerified
          ? "User marked as verified"
          : "User marked as unverified",
        user,
      });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({ message: "User not found" });
      }
      console.error("Update Verification Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// Admin-only: changes a user's role. Blocks self-demotion so an admin can't
// lock themselves (and potentially every other admin) out of admin routes.
app.patch(
  "/api/users/:id/role",
  requireAuth,
  requireRole("admin"),
  parseId,
  async (req, res) => {
    const { role } = req.body;
    if (!ROLES.includes(role)) {
      return res
        .status(400)
        .json({ message: `role must be one of: ${ROLES.join(", ")}` });
    }
    if (req.targetUserId === req.user.id) {
      return res.status(400).json({ message: "Cannot change your own role" });
    }
    try {
      const user = await prisma.user.update({
        where: { id: req.targetUserId },
        data: { role },
        select: { id: true, email: true, role: true },
      });
      res.json({ success: true, message: "User role updated", user });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({ message: "User not found" });
      }
      console.error("Update Role Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

// Admin-only: sends the same reset-password email a user would trigger themselves,
// so an admin never has to see or set anyone's plaintext password.
app.post(
  "/api/users/:id/reset-password",
  requireAuth,
  requireRole("admin"),
  parseId,
  async (req, res) => {
    try {
      await queuePasswordReset({ id: req.targetUserId });
      res.json({ success: true, message: "Password reset email sent" });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({ message: "User not found" });
      }
      console.error("Admin Reset Password Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

app.delete(
  "/api/users/:id",
  requireAuth,
  requireRole("admin"),
  parseId,
  async (req, res) => {
    if (req.targetUserId === req.user.id) {
      return res
        .status(400)
        .json({ message: "Cannot delete your own account" });
    }
    try {
      await prisma.user.delete({ where: { id: req.targetUserId } });
      res.json({ success: true, message: "User deleted" });
    } catch (error) {
      if (error.code === "P2025") {
        return res.status(404).json({ message: "User not found" });
      }
      console.error("Delete User Error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  },
);

export { prisma, hashPassword };
