import { validatePassword } from "../common/validators.js";
import { ROLES, hasRole } from "../common/roles.js";
import { US_STATES, COUNTRIES } from "../common/usStates.js";
import { renderPageHeader } from "../common/header.js";
import { renderPageFooter } from "../common/footer.js";

const API_BASE = "http://localhost:3000";

// Shared by signup and reset-password: alerts and returns false on the first
// broken rule (mismatch, then strength), true if the password is good to submit.
function confirmedPasswordOrAlert(password, confirmPassword) {
  if (password !== confirmPassword) {
    alert("Passwords do not match");
    return false;
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    alert(passwordError);
    return false;
  }
  return true;
}

const yesNo = (bool) => (bool ? "Yes" : "No");

// Shared form submit: busy-labels the form's button, POSTs a JSON body,
// alerts the outcome, and restores the button. onSuccess runs only on
// HTTP ok and gets the parsed response; preflight checks (password
// match, etc.) stay with the caller, before submitForm is invoked.
async function submitForm(
  form,
  { path, body, busyLabel, idleLabel, onSuccess },
) {
  const button = form.querySelector(".login-button");
  const idle = idleLabel ?? button.textContent;
  button.textContent = busyLabel;
  button.disabled = true;

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (response.ok) {
      await onSuccess(result);
    } else {
      alert(`Error: ${result.message}`);
    }
  } catch (error) {
    alert("Connection error. Is the backend running?");
  } finally {
    button.textContent = idle;
    button.disabled = false;
  }
}

// Shared by forgot-password and resend-verification: both forms just POST an
// email, alert the response, and send the user back to login on success.
async function submitEmailForm(form, path, idleLabel) {
  await submitForm(form, {
    path,
    body: { email: new FormData(form).get("email") },
    busyLabel: "Sending...",
    idleLabel,
    onSuccess: (result) => {
      alert(result.message);
      window.location.href = "/index.html";
    },
  });
}

// Shared by every authenticated admin/staff action button: hits the API with
// the token, alerts the response message, and surfaces network errors the
// same way every other fetch in this file does (rather than an unhandled
// rejection). Defined once at module scope instead of per rendered row.
async function callApi(token, path, method, body, notify = true) {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body && { "Content-Type": "application/json" }),
      },
      ...(body && { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    if (notify) alert(result.message);
    return response.ok ? result : false;
  } catch (error) {
    if (notify) alert("Connection error. Is the backend running?");
    return false;
  }
}

// Shared by every authenticated self-service form (change-password, profile):
// bounces to login if there's no stored session, POSTs via callApi, and
// sends the user to the dashboard on success.
async function submitAuthedForm(path, body) {
  const token = localStorage.getItem("auth_token");
  if (!token) {
    window.location.href = "/index.html";
    return;
  }
  const result = await callApi(token, path, "POST", body);
  if (result) window.location.href = "/dashboard.html";
}

const USERS_PER_PAGE = 10;

// Fetch the staff/admin user table from the API. `state` (sort column/
// direction + current page) survives across fetches so a mutation's refresh
// doesn't reset the admin's place in the list.
async function loadUserList(token, isAdmin, state, currentUserId) {
  const userListEl = document.getElementById("user-list");
  document.getElementById("user-actions-header").style.display = isAdmin
    ? ""
    : "none";

  try {
    const response = await fetch(`${API_BASE}/api/users`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    renderUserTable(data.users, token, isAdmin, state, currentUserId);
  } catch (error) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = "Failed to load users.";
    tr.appendChild(td);
    userListEl.replaceChildren(tr);
  }
}

// Sorts/paginates the already-fetched `users` array and renders one page of
// rows plus the sort-header indicators and pager. Sorting and paging just
// re-run this against the in-memory list; only a real mutation re-fetches
// (via `refresh`, which goes back through `loadUserList`).
function renderUserTable(users, token, isAdmin, state, currentUserId) {
  const refresh = () => loadUserList(token, isAdmin, state, currentUserId);
  const rerender = () =>
    renderUserTable(users, token, isAdmin, state, currentUserId);

  const sorted = [...users].sort((a, b) => {
    const cmp = String(a[state.sortBy]).localeCompare(
      String(b[state.sortBy]),
      undefined,
      { numeric: true },
    );
    return state.sortDir === "asc" ? cmp : -cmp;
  });

  const pageCount = Math.max(1, Math.ceil(sorted.length / USERS_PER_PAGE));
  state.page = Math.min(state.page, pageCount);
  const start = (state.page - 1) * USERS_PER_PAGE;
  const pageUsers = sorted.slice(start, start + USERS_PER_PAGE);

  document
    .getElementById("user-list")
    .replaceChildren(
      ...pageUsers.map((u) =>
        buildUserRow(u, token, isAdmin, refresh, currentUserId),
      ),
    );

  wireSortHeaders(state, rerender);
  renderPager(state, pageCount, rerender);
}

// Attaches (idempotently — click handlers are reassigned, not stacked) the
// click-to-sort behavior to each sortable column header and redraws its
// label with an arrow showing the active sort.
function wireSortHeaders(state, rerender) {
  document
    .querySelectorAll("#user-list-section th[data-sort]")
    .forEach((th) => {
      const column = th.dataset.sort;
      th.onclick = () => {
        if (state.sortBy === column) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortBy = column;
          state.sortDir = "asc";
        }
        state.page = 1;
        rerender();
      };
      const arrow =
        state.sortBy === column ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
      th.textContent = th.dataset.label + arrow;
    });
}

// Prev/Next + "Page X of Y", hidden entirely when everything fits on one page.
function renderPager(state, pageCount, rerender) {
  const pagerEl = document.getElementById("user-pager");
  pagerEl.replaceChildren();
  if (pageCount <= 1) return;

  const prevBtn = document.createElement("button");
  prevBtn.textContent = "Prev";
  prevBtn.disabled = state.page <= 1;
  prevBtn.addEventListener("click", () => {
    state.page -= 1;
    rerender();
  });

  const label = document.createElement("span");
  label.textContent = `Page ${state.page} of ${pageCount}`;

  const nextBtn = document.createElement("button");
  nextBtn.textContent = "Next";
  nextBtn.disabled = state.page >= pageCount;
  nextBtn.addEventListener("click", () => {
    state.page += 1;
    rerender();
  });

  pagerEl.append(prevBtn, label, nextBtn);
}

// A single action renders as its own button (unchanged behavior). More than
// one becomes a real floating dropdown via the native Popover API — it
// renders in the browser's top layer, so it's never clipped by
// .table-scroll's overflow and doesn't push the table's rows around when
// opened (unlike an inline-expanding <details>). Outside-click/Escape
// dismissal is native; only positioning and closing-on-item-click are ours.
function buildActionsCell(actions) {
  if (actions.length <= 1) {
    const fragment = document.createDocumentFragment();
    fragment.append(...actions);
    return fragment;
  }

  const menu = document.createElement("div");
  menu.className = "actions-menu-list";
  menu.popover = "auto";
  for (const btn of actions) {
    btn.classList.add("link-button"); // menu items read as links, not pill buttons
    btn.addEventListener("click", () => menu.hidePopover());
    menu.appendChild(btn);
  }

  const trigger = document.createElement("button");
  trigger.className = "actions-trigger";
  trigger.textContent = "Actions ▾";
  trigger.addEventListener("click", () => {
    const rect = trigger.getBoundingClientRect();
    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.left = `${rect.left}px`;
    menu.togglePopover();
  });
  menu.addEventListener("toggle", (event) => {
    trigger.textContent = event.newState === "open" ? "Actions ▴" : "Actions ▾";
    if (event.newState === "open") {
      // Popovers don't reposition on scroll — close instead of drifting
      // away from the trigger that opened them.
      window.addEventListener("scroll", () => menu.hidePopover(), {
        once: true,
        capture: true,
      });
    }
  });

  const wrapper = document.createDocumentFragment();
  wrapper.append(trigger, menu);
  return wrapper;
}

// One <tr> per user; buttons call the admin/staff-only endpoints and re-fetch
// the list (`refresh`) on success so the row reflects the new state.
// A user-table action button: label, optional class, click handler.
function makeAction(label, onClick, cls) {
  const btn = document.createElement("button");
  btn.textContent = label;
  if (cls) btn.className = cls;
  btn.addEventListener("click", onClick);
  return btn;
}

function buildUserRow(user, token, isAdmin, refresh, currentUserId) {
  const tr = document.createElement("tr");

  const emailTd = document.createElement("td");
  emailTd.textContent = user.email; // textContent, not innerHTML: user data is user-controlled
  const roleTd = document.createElement("td");
  // Admins get an editable dropdown (except on their own row — the backend
  // also blocks self-demotion, but disabling here skips the round trip).
  if (isAdmin && user.id !== currentUserId) {
    const select = document.createElement("select");
    select.append(
      ...ROLES.map((role) => new Option(role, role, false, role === user.role)),
    );
    select.addEventListener("change", async () => {
      await callApi(token, `/api/users/${user.id}/role`, "PATCH", {
        role: select.value,
      });
      await refresh();
    });
    roleTd.appendChild(select);
  } else {
    roleTd.textContent = user.role;
  }
  tr.append(emailTd, roleTd);

  const verifiedTd = document.createElement("td");
  verifiedTd.textContent = yesNo(user.emailVerified);
  tr.appendChild(verifiedTd);

  const actions = [];

  if (!user.emailVerified) {
    actions.push(
      makeAction("Resend Verification", () =>
        callApi(token, `/api/users/${user.id}/resend-verification`, "POST"),
      ),
    );
  }

  if (isAdmin) {
    actions.push(
      makeAction(user.emailVerified ? "Unverify" : "Verify", async () => {
        await callApi(token, `/api/users/${user.id}/verification`, "PATCH", {
          emailVerified: !user.emailVerified,
        });
        await refresh();
      }),
    );
    actions.push(
      makeAction("Reset Password", () =>
        callApi(token, `/api/users/${user.id}/reset-password`, "POST"),
      ),
    );
    actions.push(
      makeAction(
        "Delete",
        async () => {
          if (!confirm(`Delete ${user.email}?`)) return;
          await callApi(token, `/api/users/${user.id}`, "DELETE");
          await refresh();
        },
        "button-danger",
      ),
    );
  }

  const actionsTd = document.createElement("td");
  actionsTd.appendChild(buildActionsCell(actions));

  tr.appendChild(actionsTd);
  return tr;
}

document.addEventListener("DOMContentLoaded", async () => {
  const loginForm = document.getElementById("login-form");
  const signupForm = document.getElementById("signup-form");
  const showSignupBtn = document.getElementById("show-signup");
  const showLoginBtn = document.getElementById("show-login");

  // Elements for Dashboard
  const pageHeader = document.getElementById("page-header");
  const pageFooter = document.getElementById("page-footer");
  const logoutLink = document.getElementById("logout-link");

  // --- AUTH LOGIC ---

  // Toggle Forms
  showSignupBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    loginForm.style.display = "none";
    signupForm.style.display = "block";
  });

  showLoginBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    signupForm.style.display = "none";
    loginForm.style.display = "block";
  });

  // Login Logic
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(loginForm);
    await submitForm(loginForm, {
      path: "/api/login",
      body: {
        email: formData.get("email"),
        password: formData.get("password"),
      },
      busyLabel: "Signing in...",
      onSuccess: (result) => {
        localStorage.setItem("auth_token", result.token);
        window.location.href = "/dashboard.html";
      },
    });
  });

  // Signup Logic
  signupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(signupForm);
    const email = formData.get("email");
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");

    if (!confirmedPasswordOrAlert(password, confirmPassword)) return;

    await submitForm(signupForm, {
      path: "/api/signup",
      body: { email, password },
      busyLabel: "Registering...",
      onSuccess: () => {
        alert("Account created! You can now log in.");
        signupForm.style.display = "none";
        loginForm.style.display = "block";
      },
    });
  });

  // Forgot Password Logic
  const forgotPasswordForm = document.getElementById("forgot-password-form");
  forgotPasswordForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitEmailForm(
      forgotPasswordForm,
      "/api/forgot-password",
      "Send Reset Link",
    );
  });

  // Resend Verification Logic
  const resendVerificationForm = document.getElementById(
    "resend-verification-form",
  );
  resendVerificationForm?.addEventListener("submit", (e) => {
    e.preventDefault();
    submitEmailForm(
      resendVerificationForm,
      "/api/resend-verification",
      "Resend Verification",
    );
  });

  // Reset Password Logic
  const resetPasswordForm = document.getElementById("reset-password-form");
  resetPasswordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(resetPasswordForm);
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");

    if (!confirmedPasswordOrAlert(password, confirmPassword)) return;

    await submitForm(resetPasswordForm, {
      path: "/api/reset-password",
      body: {
        token: new URLSearchParams(window.location.search).get("token"),
        password,
      },
      busyLabel: "Resetting...",
      onSuccess: (result) => {
        localStorage.setItem("auth_token", result.token);
        alert(result.message);
        window.location.href = "/dashboard.html";
      },
    });
  });

  // Change Password Logic (self-service, requires an existing session)
  const changePasswordForm = document.getElementById("change-password-form");
  changePasswordForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(changePasswordForm);
    const password = formData.get("password");
    const confirmPassword = formData.get("confirmPassword");

    if (!confirmedPasswordOrAlert(password, confirmPassword)) return;

    await submitAuthedForm("/api/change-password", {
      currentPassword: formData.get("currentPassword"),
      newPassword: password,
    });
  });

  // Complete Profile Logic (self-service, requires an existing session)
  const profileForm = document.getElementById("profile-form");
  const populateOptions = (selectId, list) =>
    document
      .getElementById(selectId)
      ?.append(...list.map(([code, name]) => new Option(name, code)));
  populateOptions("state", US_STATES);
  populateOptions("country", COUNTRIES);
  profileForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(profileForm);
    await submitAuthedForm("/api/profile", {
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      address: formData.get("address"),
      address2: formData.get("address2"),
      state: formData.get("state"),
      zip: formData.get("zip"),
      country: formData.get("country"),
      phone: formData.get("phone"),
      communicationPreference: formData.get("communicationPreference"),
      linkedin: formData.get("linkedin"),
      github: formData.get("github"),
      altEmail: formData.get("altEmail"),
    });
  });

  // --- VERIFY PAGE LOGIC ---
  const verifyMessage = document.getElementById("verify-message");
  if (verifyMessage) {
    const token = new URLSearchParams(window.location.search).get("token");
    try {
      const response = await fetch(
        `${API_BASE}/api/verify?token=${encodeURIComponent(token || "")}`,
      );
      const result = await response.json();
      if (response.ok) {
        verifyMessage.textContent = `${result.message} Redirecting to login…`;
        setTimeout(() => {
          window.location.href = "/index.html";
        }, 1500);
      } else {
        verifyMessage.textContent = result.message || "Verification failed.";
      }
    } catch (error) {
      verifyMessage.textContent = "Connection error. Is the backend running?";
    }
    return;
  }

  // --- DASHBOARD LOGIC ---

  // If we are on the dashboard page
  if (pageHeader) {
    renderPageHeader(
      pageHeader,
      "Dashboard",
      `Welcome back, <span id="user-email" class="highlight">...</span>!`,
    );
    renderPageFooter(
      pageFooter,
      `Role: <span id="user-role" class="highlight">...</span> · Email
      verified: <span id="user-verified" class="highlight">...</span>`,
    );
    const userEmailSpan = document.getElementById("user-email");

    const token = localStorage.getItem("auth_token");

    if (!token) {
      // No token? Kick them back to login
      window.location.href = "/index.html";
      return;
    }

    try {
      // notify=false: this is the page's own auto-load, not an action
      // the user requested — redirect on failure instead of alerting.
      const me = await callApi(token, "/api/me", "GET", undefined, false);
      if (!me) {
        // Token expired or invalid? Clear it and kick back to login.
        localStorage.removeItem("auth_token");
        window.location.href = "/index.html";
        return;
      }
      // Admin-created accounts start with a temp password — force a change
      // before anything else in the dashboard is usable.
      if (me.user.mustChangePassword) {
        window.location.href = "/change-password.html";
        return;
      }
      // New accounts (self-signup or admin-created) start with no profile —
      // send them to fill it in before anything else in the dashboard loads.
      if (!me.user.hasProfile) {
        window.location.href = "/profile.html";
        return;
      }

      userEmailSpan.textContent = me.user.email;
      document.getElementById("user-role").textContent = me.user.role;
      document.getElementById("user-verified").textContent = yesNo(
        me.user.emailVerified,
      );

      // Only staff/admin can list users at all (backend enforces this too).
      if (hasRole(me.user.role, "staff")) {
        document.getElementById("user-list-section").style.display = "block";
        document.querySelector(".dashboard-container").classList.add("wide");
        const isAdmin = hasRole(me.user.role, "admin");
        await loadUserList(
          token,
          isAdmin,
          { sortBy: "email", sortDir: "asc", page: 1 },
          me.user.id,
        );

        const addUserDetails = document.getElementById("add-user-details");
        const addUserForm = document.getElementById("add-user-form");
        if (isAdmin) {
          addUserDetails.style.display = "block";
          addUserForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const formData = new FormData(addUserForm);
            const result = await callApi(token, "/api/users", "POST", {
              email: formData.get("email"),
              password: formData.get("password"),
            });
            if (result) {
              addUserForm.reset();
              addUserDetails.open = false;
              await loadUserList(
                token,
                isAdmin,
                { sortBy: "email", sortDir: "asc", page: 1 },
                me.user.id,
              );
            }
          });
        }
      }
    } catch (error) {
      console.error("Error fetching user:", error);
      window.location.href = "/index.html";
      return;
    }
  }

  // Logout Logic
  logoutLink?.addEventListener("click", () => {
    localStorage.removeItem("auth_token");
    window.location.href = "/index.html";
  });
});
