# Handoff: Node/JS full-stack template — review + fixes

## Goal

Review the Node/JS full-stack template in this repo (Express + Prisma/SQLite
backend under `backend/`, vanilla-JS + Vite frontend under `frontend/`) and
fix what's broken. Started as a code review request; escalated into a full
fix-and-verify pass because the backend turned out to be non-functional, not
just messy.

## Current Progress

All fixes are committed on branch **`fix/backend-security-and-test-reliability`**
(created off `main`), **not pushed, not merged**:

- `dbd27238` — fix: wire up password validation, add e2e web server config,
  fix manage.sh
- `d4812538` — chore: move repo root from `projects/` into `templates-js/`
- `eb749380` — chore: add .gitignore, untrack node_modules and pid files
- `44a3f1b1` — fix: harden backend auth and unbreak the full-stack template

`main` is untouched at `10f86217`. User has not asked to push or open a PR yet.

### What was fixed (all verified by actually running the app, not just read)

1. **`backend/app.js`** — removed a duplicate `app.listen()` (both `app.js`
   and `index.js` bound port 3000 → `EADDRINUSE` crash on every `npm start`).
2. **Deleted `backend/server.js`** — a dead duplicate backend using
   plaintext-JSON `users.json` storage, never imported by anything, diverged
   from the real Prisma-backed path in `app.js`.
3. **`backend/app.js`** — `JWT_SECRET` now from `process.env.JWT_SECRET`
   with a random per-run fallback (+ warning), instead of a hardcoded
   literal shared by every checkout of the template.
4. **`backend/app.js`** — passwords hashed with `crypto.scrypt` +
   `timingSafeEqual` instead of stored/compared in plaintext. No new
   dependency (Node stdlib).
5. **Prisma 7→6 downgrade** (`package.json`, `package-lock.json`,
   `node_modules`) — `@prisma/client@7` dropped the `datasources`
   constructor option `app.js` relies on, so the app literally could not
   boot. Pinned both `@prisma/client` and `prisma` to `^6.19.3`.
6. **`schema.prisma`** — datasource `url` is now the literal
   `"file:../dev.db"` (resolves to `backend/dev.db`, matching `app.js`'s
   runtime override path) instead of `env("DATABASE_URL")`, which nothing
   in the project ever sets.
7. **`backend/package.json`** — added `predev`/`prestart`/`pretest` npm
   hooks all running `prisma migrate deploy`, so every entry point
   (`npm run dev`, `npm start`, `npm test`) self-heals a missing/unmigrated
   `dev.db`.
8. **`setup_db.sh`** — changed `npm install @prisma/client` +
   `npm install --save-dev prisma` (unpinned, would silently re-pull latest
   v7 and reintroduce the break) to plain `npm install` (respects pinned
   versions).
9. **`start.sh`** — was writing `backend.pid` to the repo root while
   `stop.sh`/`manage.sh` read `backend/backend.pid`, so `stop.sh` could
   never find the process. Fixed to write to the same path, and fixed the
   backgrounded `cd` (was a no-op due to subshell scoping).
10. **`manage.sh`** — malformed ANSI reset code `NC='\03[]m'` →
    `NC='\033[0m'`.
11. **`backend/tests/auth.test.js`** — was seeding the orphaned
    `users.json` (nothing in `app.js` reads it — it's Prisma-backed). Now
    seeds/cleans up through the real `/api/signup` endpoint and the real
    `prisma` client (exported from `app.js` for this purpose).
12. **Deleted `backend/users.json`** — orphaned once `server.js` was
    deleted; nothing reads or writes it anymore.
13. **`frontend/index.html`** — removed a duplicate `<body>` tag.
14. **`frontend/tests/auth.e2e.spec.js`** — the `tom@example.com` / `tran`
    login fixture never could have worked for real: that account only ever
    existed via the deleted `server.js`'s JSON seed, and `'tran'` fails the
    app's own signup password-complexity rules. Now seeds a real user
    (`Tran1234!`) through the actual signup API in `test.beforeAll`. Also
    fixed the separate signup test to use a unique
    `newuser-${Date.now()}@test.com` per run — the old fixed email 409'd on
    any rerun against a persisted `dev.db`.
15. **Added root `.gitignore`** (`node_modules/`, `dev.db`, `*.pid`,
    `test-results/`) and untracked ~10,400 already-committed files matching
    those patterns (kept on disk, just no longer tracked). The repo had no
    `.gitignore` at all — every dependency bump was a multi-thousand-file
    diff, and a platform-specific Prisma native binary was committed.
16. **Created `common/validators.js`** — centralized shared validation
    utilities (email and password validation) used by both backend and
    frontend. `frontend/main.js` imports `validatePassword` from here.
17. **Added `.env.example`** — template for environment variables
    (`DATABASE_URL`, `JWT_SECRET`).
18. **`backend/app.js`'s `/api/signup` route never called the validators it
    imported** — `validateEmail`/`validatePassword` were imported on line 8
    but the handler went straight to `prisma.user.create`, so weak
    passwords (`"S1!"`, no-uppercase, no-number, no-special-char) all
    signed up successfully instead of 400ing. Wired both validators into
    the route; `validatePassword` (`backend/validators.js`) now returns the
    specific failing-rule message instead of a bare boolean, so the 400
    response can explain why.
19. **Deleted `backend/tests/test-app.js`** — an untracked, unused
    duplicate of `app.js` with the identical unwired-validator bug. Not
    imported anywhere, not matched by Jest's `*.test.js` pattern.
20. **Added `frontend/playwright.config.js`** — there was no Playwright
    config at all, so `npm run test:e2e` never started the backend (port 3000) or frontend dev server (port 5173) it needs, failing every test
    with `ERR_CONNECTION_REFUSED`. Config's `webServer` array now boots
    both (`cwd: '../backend'` and `cwd: '.'`) and waits on them before
    running specs; `reuseExistingServer` stays on outside CI.
21. **`manage.sh`** — `2&&1` typo (should be `2>&1`) in the port-status
    checks (`check_status`, `start_backend_only`, `start_frontend_only`)
    was silently breaking those checks. Also, `start_all`/
    `start_backend_only`/`start_frontend_only` had dropped the trailing
    `&` backgrounding, so `npm run dev` ran in the foreground and would
    hang the whole interactive menu loop forever on first use. Both fixed.

### Verification performed

- Backend Jest suite (`cd backend && npm test`): 8/8 pass, including the
  weak-password 400 cases that were the trigger for this session's work.
- Frontend Playwright suite (`cd frontend && npx playwright test`), run
  against real dev servers booted by the new `playwright.config.js`: 4/4
  pass.
- `manage.sh` syntax-checked with `bash -n`; **not** exercised through the
  full interactive menu end-to-end (still true from prior session).

### What Worked

- Verifying every fix by actually running the app/tests rather than
  trusting a static code read — caught the Prisma 7 constructor break, the
  migration path mismatch, and this session's unwired-validator bug and
  missing Playwright config.
- Root-causing at the shared entry point instead of the symptom: the
  validators were already written and imported — the fix was wiring them
  into the one route, not rewriting validation inline or duplicating it.
- When a genuine unrelated bug was spotted mid-task (`manage.sh`'s `2&&1`
  typo and dropped `&`), asked the user whether to fix-then-commit or
  commit-as-is; got no response, defaulted to fix-then-commit (smaller
  risk, cheap fix) per "don't stall."

### Session 3: validator consolidation (Next Steps #2, done)

- Deleted `backend/validators.js`; `backend/app.js` now imports
  `validateEmail`/`validatePassword` from `../common/validators.js`.
- `common/validators.js`'s `validatePassword` now returns the specific
  error message (matching the deleted backend copy) instead of a bare
  boolean. `frontend/main.js`'s signup handler updated from
  `if (!validatePassword(password))` + a hardcoded alert string to
  `const passwordError = validatePassword(password); if (passwordError)
{ alert(passwordError); ... }` — also fixes a latent bug: the old
  boolean-vs-string mismatch would have inverted the check the moment
  frontend and common were unified without this change.
- **Gotcha**: `common/validators.js` sits outside `backend/`'s own
  `package.json` (`"type": "module"`), so Node/Jest resolved it as
  CommonJS and choked on the bare `export` keyword the moment
  `backend/app.js` imported it cross-directory. Fixed by adding
  `"type": "module"` to the **root** `package.json` — Node walks up to
  the nearest `package.json` for module-type resolution, and the repo
  root had none before this.
- Verified: backend Jest 8/8 pass, frontend Playwright 4/4 pass.

### What Didn't Work / Gotchas for next agent

- **`pkill -f "node index.js"` does not match `node --watch index.js`**
  (the actual `dev` script) — leftover dev-server processes survived
  cleanup and caused confusing stale-data test failures. Use
  `pkill -f "node --watch index.js"` too, or just `lsof -i :3000` to check.
- **Prisma CLI resolves relative SQLite `url` paths relative to
  `schema.prisma`'s directory, not the process CWD** — fixed by giving the
  schema a literal `"file:../dev.db"` instead of an env-var-based one.
- **A `pretest` hook alone is not enough** — `start.sh`/`manage.sh` launch
  the backend via `npm run dev`, which needed its own `predev` hook, and
  `npm start` needed `prestart`.
- **Non-idempotent e2e fixtures silently rot**: a fixed-email signup test
  passes once, then 409s forever on any rerun against a non-reset `dev.db`.
  Any new e2e test that creates data needs either a unique identifier per
  run or explicit cleanup.
- **Imported-but-uncalled validation is invisible in a diff-only review**
  — `validateEmail`/`validatePassword` were sitting right there imported at
  the top of `app.js`; only running the signup endpoint with bad input
  surfaced that they were never invoked. Grep for where an imported
  function is actually _called_, not just imported, when auditing
  validation/auth paths.
- **Two near-duplicate validator files exist**: `backend/validators.js` and
  `common/validators.js` have overlapping (now slightly diverged — the
  backend copy returns messages, the common one still returns booleans)
  logic. Not yet consolidated — see Next Steps.

### Session 4: password confirmation, welcome email, verification, .env loading

New feature work landed after Session 3 (commits `41df77c8`, `c75bcf9b`,
`7e799fe0`, `b9889a99`):

- **`frontend/index.html`/`main.js`** — signup form gained a "Confirm
  Password" field; `main.js` checks it matches before hitting the API.
- **`backend/emailQueue.js` + `backend/mailer.js` + `EmailQueue` Prisma
  model** — signup now enqueues a welcome email in the same `$transaction`
  as the user create (so a failed email never orphans an account and a
  rolled-back signup never leaves a queued email). A `setInterval` worker
  in `index.js` polls the queue and sends via `nodemailer` (`jsonTransport`
  logging fallback when `SMTP_HOST` is unset, so dev needs no mail server).
  Bounded retry via `MAX_ATTEMPTS` (default 3), no backoff (marked with a
  `ponytail:` comment as the known ceiling).
- **Email verification** — signup also enqueues a verification email with
  a token; `/api/verify?token=` marks the user verified. Login/`/api/me`
  reject unverified users unless `EMAIL_VERIFICATION_REQUIRED=false` (dev
  bypass). New `frontend/verify.html` handles the click-through.
- **`backend/loadEnv.js`** — loads the root `.env` via `dotenv` before
  `app.js` is evaluated, imported first in `index.js`. Tests import
  `app.js` directly and never load it (deliberate — tests use their own
  env).
- New tests: `backend/tests/emailQueue.test.js`,
  `backend/tests/verification.test.js`. All 14 backend Jest tests pass as
  of this handoff (`cd backend && npm test`).

### Ponytail-review pass (applied)

Ran `/ponytail-review` on `main...HEAD`. All three findings fixed and
verified (14/14 backend Jest tests still pass, `bash -n manage.sh` clean):

1. `backend/app.js` — deleted the dead-code duplicate `if
(!process.env.JWT_SECRET) console.warn(...)` block; the IIFE below it
   already warns on the same condition.
2. `backend/app.js` — deleted the unused `__filename`/`__dirname` lines
   and the now-unused `path`/`fileURLToPath` imports.
3. `manage.sh` — extracted `start_service(name, dir, port)` (port check +
   backgrounded `npm run dev` + pid file), called from `start_all`,
   `start_backend_only`, and `start_frontend_only` instead of duplicating
   the block three times.

### Session 5: RBAC, script/migration consolidation, runtime profiles

All of this is **uncommitted working-tree changes** on top of `7dbe2259`
(`git status` shows the full list) — nothing in this session has been
committed yet.

**RBAC** (grilled with the user first — see conversation for the full
decision tree: global roles not multi-tenant, no permissions table, no
API-key auth, all explicitly deferred):

- `User.role` (plain string, default `"client"`) added via
  `backend/prisma/schema.prisma`. Values: `client` / `staff` / `admin`,
  ranked in that order.
- `backend/roles.js` — `ROLES` array + `hasRole(userRole, minRole)`.
- `backend/app.js` — `requireRole(minRole)` middleware, chained after
  `requireAuth`. `GET /api/users` now `requireRole("staff")` (previously any
  logged-in user could list all users — this was the actual gap RBAC closes).
- `backend/scripts/set-role.js` — `node scripts/set-role.js <email> <role>`.
  The **only** way to grant `staff`/`admin`; deliberately no HTTP
  promotion endpoint (self-service admin would be a privilege-escalation bug).
- Tests added to `backend/tests/auth.test.js`: client rejected (403),
  staff/admin allowed (200), unauthenticated rejected (401).
- Frontend needed **no change** — `dashboard.html`'s user-list fetch already
  handled a non-200 generically ("Failed to load users").

**Script consolidation**: the repo had 7 overlapping/broken start/stop/test/
db scripts. Deleted `setup_db.sh`, `start.sh`, `stop.sh`, `test.sh`,
`backend/scripts/{start,stop}_backend.sh` — some had wrong hardcoded paths
(`test.sh` pointed at a nonexistent `templates-js/templates-js/backend`,
`start_backend.sh` at `templates/backend` instead of `templates-js/backend`;
neither had ever actually run correctly). Everything now lives in
`manage.sh` (already the working "command center"), which gained three menu
options:

- **[8] First-Time Setup** — `npm install` (backend+frontend) +
  `prisma migrate deploy`.
- **[9] Set User Role** — prompts email/role, shells out to
  `backend/scripts/set-role.js` (not duplicated — same script stays directly
  runnable for automation/CI).
- **[10] Reset Database** — `prisma migrate reset --force`, requires typing
  `yes` to confirm since it's destructive.

**Migration squash**: the 5 incremental migrations
(`20260828051542_init` … `20260830000000_add_password_reset` + the new
`add_role`) were squashed into one `20260830140226_init` matching the
current schema exactly. This **reset `backend/dev.db`** — squashing rewrites
migration history, and the old db had the 5 old migration names recorded as
applied, which would conflict with the new single one. Only test fixtures
were lost (`newuser-*@test.com` etc.), not real data. Anyone else with a
clone on the old 5-migration history needs the same reset
(`./manage.sh` → option 10).

**Runtime profiles**: `NODE_ENV` drives dev/qa/prod, no new env var invented.

- `backend/package.json`: `dev` script now `NODE_ENV=development node --watch
index.js`; added `start:qa` (`NODE_ENV=qa`) and `start:prod`
  (`NODE_ENV=production`) alongside the existing `start`.
- `backend/seedDevAdmin.js` — hard-gated on `NODE_ENV === "development"`,
  upserts `admin@mail.com` / `Password1234!` (role `admin`, pre-verified)
  idempotently at boot. Called once from `index.js` before `app.listen`.
  `hashPassword` exported from `app.js` so this reuses the real signup
  hashing instead of a second implementation.
- `.env.dev` created at repo root (committable, no real secrets — the
  password above is a known dev-only fixture, not a leaked production
  credential). `backend/loadEnv.js` loads the personal `.env` first (still
  wins for any key it sets, so existing local setups are untouched), then
  layers `.env.dev` on top when `NODE_ENV === "development"`.
- **`.env.qa` / `.env.prod` intentionally not created yet** — user said "just
  `.env.dev` for now." Same shape when asked for: qa/prod defaults should use
  placeholder secrets (`CHANGE_ME`), `EMAIL_VERIFICATION_REQUIRED=true`, and
  their own `FRONTEND_URL`. Also note: `DATABASE_URL` in any of these files
  is currently **inert** — `schema.prisma`'s datasource `url` is a hardcoded
  literal (`"file:../dev.db"`, see Session 1 fix #6), not
  `env("DATABASE_URL")`. Giving qa/prod their own database would mean
  reintroducing an env-based `url`, which previously broke path resolution
  (Prisma CLI resolves relative SQLite paths relative to `schema.prisma`'s
  directory, not CWD) — don't flip that back without re-verifying both
  `prisma migrate` _and_ the running app resolve the same file.

**Permission-tooling gotcha**: mid-session, `Edit` and `Write` were both
denied ("running in don't ask mode") for _any_ file, not just one — looked
like a harness/permission-mode change, not a path-specific block. Stopped and
asked the user rather than routing around it via `Bash`/`sed` (would defeat
the point of the denial). Permission came back on its own by the next
message with no user-visible fix applied. If this recurs: don't shell out to
work around a blocked Edit/Write — surface it and wait.

Verified each step by actually running: `npm test` (28/28 passing after
every change), a real `npm run dev` boot + `curl` login against the seeded
admin, and a standalone `loadEnv.js` load confirming env resolution.

### Session 6: role/verification management dashboard (admin/staff/client)

User asked to extend the dashboard with per-role user management: admin can
delete/verify-toggle/reset-password any user, staff can list everyone and
resend verification, client sees only their own data plus self-service
resend-verification/forgot-password. All of this is **uncommitted
working-tree changes** on top of `797f1f84` (`git status` shows the full
list) — nothing in this session has been committed yet.

**Backend (`backend/app.js`)** — `GET /api/me` and `GET /api/users` now
return `id`/`role`/`emailVerified` (previously email/createdAt only). New
routes, all chained after `requireAuth`:

- `DELETE /api/users/:id` — `requireRole("admin")`. 400s if the caller tries
  to delete their own account (avoids an admin locking themselves out), 404
  via Prisma's `P2025` if the id doesn't exist.
- `PATCH /api/users/:id/verification` — `requireRole("admin")`. Body
  `{ emailVerified: boolean }`, sets the flag directly (no email round-trip),
  clears any pending `verificationToken`.
- `POST /api/users/:id/reset-password` — `requireRole("admin")`. Deliberately
  does **not** let the admin see or set a plaintext password — it triggers
  the same reset-link email a user would send themselves via
  `/api/forgot-password`, reusing `queuePasswordReset`.
- `POST /api/users/:id/resend-verification` — `requireRole("staff")`. 400s if
  the target is already verified.
- `POST /api/resend-verification` — public, no auth. Body `{ email }`. Same
  enumeration-safe pattern as `/api/forgot-password` (generic response
  whether or not the account exists/is already verified) — needed because
  unverified users can't log in to reach an authenticated endpoint, so
  resending their own verification email has to be a public route.

New shared helpers: `parseId` middleware (rejects non-numeric `:id` before it
reaches Prisma), `queueVerificationEmail(user)` (extracted from the signup
route's inline logic, shared by the public and staff resend routes).
`queuePasswordReset` was reshaped to take a Prisma `where` (`{ email }` or
`{ id }`) and run as a single interactive transaction (`prisma.$transaction(
async (tx) => ...)`) that updates-and-reads the user in one round trip,
letting `P2025` (no match) do double duty as both `/api/forgot-password`'s
"user doesn't exist, but stay silent" branch and the admin route's 404 — this
removed a separate `findUnique` + duplicated 404 block from both callers.

**`backend/roles.js` moved to `common/roles.js`** — the frontend now imports
`hasRole` from there (same pattern as `common/validators.js`) instead of
hand-rolling `me.role === "admin"` string comparisons. `backend/app.js` and
`backend/scripts/set-role.js` import paths updated accordingly.

**Frontend** — `dashboard.html`/`main.js`: shows the logged-in user's own
role/verified status; staff+ get a user table (`GET /api/users`) with
role-gated action buttons — staff sees "Resend Verification" on unverified
rows, admin additionally sees Verify/Unverify toggle, Reset Password, and
Delete. New `frontend/resend-verification.html` (mirrors
`forgot-password.html`) linked from the login page, since unverified users
can't log in to self-serve from inside the dashboard. `main.js` gained a
module-level `API_BASE` constant (replaced 9 hardcoded
`http://localhost:3000` literals), a shared `callApi(token, path, method,
body)` for the new admin/staff buttons (catches network errors the same way
every other handler in the file does — this was originally missing and added
during self-review), and a shared `submitEmailForm(form, path, idleLabel)`
extracted from the near-duplicate forgot-password/resend-verification submit
handlers.

**Tests**: `backend/tests/user-management.test.js` — 15 new tests covering
every new route × role combination (admin allowed, staff rejected where
admin-only, unauthenticated rejected, 404/400 edge cases), using a
`setupTarget(role, verified, actorEmail)` helper to cut per-test
boilerplate. 43/43 backend tests passing.

**Jest flake found and patched**: adding this test file (6th suite) made a
**pre-existing** cross-suite race surface much more often — `emailQueue.test.js`
and `verification.test.js` both already do unscoped `prisma.emailQueue
.deleteMany()` in `beforeEach`, and Jest's default parallel workers all share
one SQLite file (`dev.test.db`), so one suite's cleanup could delete rows
another suite's in-flight assertion depended on. Confirmed pre-existing by
stashing this session's changes and rerunning — flake was absent with 5
suites, present intermittently once a 6th was added (more workers = more
contention on the same file). Fixed by setting `maxWorkers: 1` in
`backend/jest.config.js`, marked with a `ponytail:` comment naming the real
fix (scope every suite's `deleteMany()` like `user-management.test.js`
already does, or give each Jest worker its own SQLite file via
`JEST_WORKER_ID`) since fixing the pre-existing suites was out of scope for
this session. Verified clean across 10+ consecutive `npm test` runs after the
fix; do not revert `maxWorkers: 1` without addressing the root cause first.

**Self-review pass** (`/simplify`, 4 parallel review agents — reuse,
simplification, efficiency, altitude): applied — the `common/roles.js` move,
the `queuePasswordReset` round-trip reduction, `API_BASE`/`callApi`/
`submitEmailForm` extraction, a `yesNo()` helper, collapsing a pointless
nested-function wrapper in `loadUserList`, and the `setupTarget` test helper,
all described above. Skipped (judged not worth the added complexity, see
conversation for full reasoning): merging `queuePasswordReset`/
`queueVerificationEmail` into one dynamic-field-name helper (the two now
differ enough — one field vs. two, different email builders — that forcing
them together would read worse); optimistic single-row table patching
instead of refetch-after-mutation (YAGNI for an admin table, not a hot path);
a repo-wide `asyncHandler` wrapper for the `console.error`+500 pattern
(matches this file's pre-existing convention, would be a larger unrelated
refactor); parallelizing the three `beforeEach` test signups with
`Promise.all` (marginal wall-time gain, risked reintroducing the SQLite race
this session just fixed).

## Next Steps

1. **Nothing from this session (or Session 5) is committed yet.** Review the
   diff (`git status` / `git diff`) and commit. Session 6 (this one) is a
   separate logical change from Session 5's RBAC/script/runtime-profile work
   if you want to split commits — but note Session 6 builds directly on
   Session 5's `backend/roles.js`/`requireRole` (moved, not replaced), so
   commit Session 5 first if splitting.
2. **Branch not pushed.** Ask the user whether to push
   `fix/backend-security-and-test-reliability` and open a PR (`/draft-pr`
   skill is available), or whether they want to keep iterating locally
   first.
3. `.env.qa` / `.env.prod` not created — see Session 5 notes above if asked
   for them.
4. Seed your own admin/staff via `./manage.sh` → option 9, or directly:
   `node backend/scripts/set-role.js you@email.com admin`. The dev-only
   `admin@mail.com` / `Password1234!` fixture only exists when
   `NODE_ENV=development`.
5. Optionally exercise `manage.sh`'s interactive menu manually end-to-end —
   still only `bash -n` syntax-checked, not click-tested through every
   option (now 11 options, up from 8).
6. Frontend dashboard user-management UI (Session 6) was verified via
   backend Jest tests and a Prettier/format pass, but **not** click-tested
   through Playwright/browser — no e2e coverage was added for the new
   buttons (Resend Verification, Verify/Unverify, Reset Password, Delete).
   Worth a manual pass or new Playwright specs before shipping.
7. The `maxWorkers: 1` Jest serialization (Session 6) is a deliberate
   stopgap, not a permanent fix — see the `ponytail:` comment in
   `backend/jest.config.js` for the upgrade path if backend test suite count
   grows enough that serial execution becomes slow.

## Setup Instructions

### Quick Start

```bash
./manage.sh   # → [8] First-Time Setup (installs deps, applies migrations)
              # → [1] Start Development (Backend + Frontend)
```

Or manually, equivalent to option 8:

```bash
cd backend && npm install && npx prisma migrate deploy
cd ../frontend && npm install
```

### Manual Startup

- Backend: `cd backend && npm run dev` (dev profile), or `npm run start:qa` /
  `npm run start:prod` for the other profiles, or plain `npm start`
  (NODE_ENV expected to come from the host in real prod)
- Frontend: `cd frontend && npm run dev`
- Tests: `npm test` (backend) or `npm run test:e2e` (frontend)
- Interactive menu: `./manage.sh` — start/stop both, run tests, check status,
  first-time setup, set a user's role, reset the database. See Session 5
  above for the full option list.

### Configuration

- **DATABASE_URL**: Hardcoded literal `file:../dev.db` in
  `backend/prisma/schema.prisma`, **not** read from any `.env` (see Session
  5's `.env.qa`/`.env.prod` note for why, and what breaks if you change it).
- **JWT_SECRET**: Set in environment variable, falls back to random on dev.
- **NODE_ENV**: `development` / `qa` / `production` — see Session 5. Only
  `development` has a committed profile file (`.env.dev`) so far.
- **.env.example**: Template showing every variable the app reads.
- **User roles**: `client` (default) / `staff` / `admin` — see Session 5.
  No self-service promotion; use `./manage.sh` option 9 or
  `backend/scripts/set-role.js` directly.

## Architecture Notes

- **Shared `common/validators.js`** and **`common/roles.js`**: single source
  of truth for validation and role-hierarchy logic, imported by both
  `frontend/main.js` and `backend/app.js` (moved from `backend/roles.js` in
  Session 6 specifically so the frontend could reuse `hasRole()` instead of
  duplicating the role-ordering as string comparisons).
- **Prisma 6**: No longer requires `datasources` constructor or
  `createRequire`.
- **ESM-only**: All modules use ESM (`type: "module"`).
- **Testing**: Backend uses Jest (`backend/jest.config.js`, `maxWorkers: 1` —
  see Session 6), Frontend uses Playwright (`frontend/playwright.config.js`).
- **RBAC**: `common/roles.js` (`ROLES`, `hasRole`) + `requireRole()` in
  `backend/app.js`. Global roles, not per-resource/multi-tenant — see
  Session 5 for why that was explicitly ruled out. User-management routes
  (delete/verify-toggle/reset-password/resend-verification) added in
  Session 6 — see that section for the full route list and the
  `queuePasswordReset`/`queueVerificationEmail` shared helpers.
