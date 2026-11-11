# Login refresh report

Branch `login-refresh` (from `ui-refresh`). UI only: authentication, hashing, lockout and throttling, sessions, CSRF protection (Next.js server-action origin check), redirects and permissions are unchanged. No password-policy or database change. Development stack only; nothing was deployed.

## Skill and design contract

Applied the installed `frontend-ui-engineering` skill and the existing UI design contract (`docs/ui-refresh-report.md`). Existing tokens are reused: charcoal `ink`, red `brand`, `canvas`, `line`, the 8px radius, 48px controls and the blue focus ring.

## Changes

- **`components/auth-layout.tsx`** (new): the shared layout for sign-in and the first-login password change.
  - **Desktop (1024px and up):** a centred two-column card, up to 960px wide.
    - Left: a charcoal panel with the RECAFCO logo (on a white tile, so it stays legible), "RECAFCO Documents", a short red accent bar, "Company documents. Easy to find." and "Find and share documents across departments."
    - The panel's linework is inline SVG after precast facade panels: joints, a stepped edge, lifting anchors, one window opening and one red joint. It is `aria-hidden`, kept to the upper right so it never runs behind text, and has no animation, gradient, photo or glass effect.
    - Right: a white form panel, 432px wide.
  - **Phones and tablets:** the branding panel is hidden. A modest 72px logo sits above the form.
  - **Heights:** content-driven (`min-h-dvh`, never a fixed height), so short screens, 200% zoom and an open on-screen keyboard scroll instead of clipping.
- **`app/login/page.tsx` and `login-form.tsx`:**
  - "Sign in" / "Use your RECAFCO account."
  - Persistent labels; username placeholder "Username or employee number". The capital-letters explanation was removed; case-insensitive sign-in is unchanged on the server.
  - `autocomplete="username"` and `"current-password"`; nothing prefilled.
  - Show/Hide inside the password field: a real button named "Show password" / "Hide password", with `aria-controls` and the shared focus ring.
  - One full-width red "Sign in" button. "Signing in…" while sending, with the button disabled, so it cannot be submitted twice.
  - "Need help signing in? Contact your system administrator." There is no link, self-registration, social login, email or password-reset flow.
  - The signed-out and session-ended messages are now one short line with an icon (`role="status"`) instead of a large block.
  - Empty fields: inline messages beside each field ("Enter your username." / "Enter your password."), with `aria-invalid` and `aria-describedby` and a screen-reader alert.
  - Sign-in failures (wrong details, lockout, system unavailable) appear as one compact alert with an icon. The wording is unchanged.
  - After an error, focus moves to the field that needs attention. The username is kept; the password is never returned.
- **`app/actions.ts`:** `LoginState` gains per-field messages and an attempt marker. The sign-in logic and error texts are unchanged.
- **`app/change-password`:** the forced first-login screen now uses the same layout ("Choose your password", the form, Sign out). The form's error, hint and button styles were aligned. The voluntary change inside the app is unchanged.

**Not present:** temporary passwords do not expire in this system (Unit 4 gap), so there is no expiry flow to restyle. None was added.

## Verification

`scripts/screenshots-login.mjs` (real headless Edge) ran against the old and the new design. Screenshots are in `docs/screenshots/login-refresh/before/` and `after/`, with measured checks in each `index.json`. Results on the new design:

| Check | Result |
| --- | --- |
| 390 / 768 / 1440 / 1920px | No horizontal scrolling (all 23 views) |
| Short screens: 1440×600, phone 390×480 with keyboard open, 200% zoom (720×450 at 2×) | Whole form reachable by scrolling; nothing clipped |
| Keyboard only | Tab order: skip link → Username → Password → Show/Hide; focus ring visible |
| Show/Hide | "Show password", type=password → "Hide password", type=text |
| Autofill attributes | `username` / `current-password`; both fields empty on load |
| Empty submit | Inline errors beside both fields |
| Wrong password | Alert "Username or password is not correct."; username kept; the typed password does not appear anywhere in the page HTML |
| Lockout (5 failures, throwaway account) | Lockout message shown |
| Pending (3s network delay) | "Signing in…", button disabled |
| Signed out | Small green status line |
| First sign-in with a temporary password | Redirected to "Choose your password" in the new layout; a too-short password shows its inline error |

The first capture script tried wrong passwords on `dev_employee_a` and locked that dev account after repeated runs, which shows the lockout working. The script now uses throwaway accounts only, and the dev users were reset with `recafco_dev users`.

Static checks and tests: typecheck, lint and build clean; unit tests 13/13; integration tests **178/178** (including sign-in, lockout, first-login password change, session and permission regressions).

**Not verified:** real password-manager autofill. Only the attributes were checked; headless Edge has no saved passwords.

## Refinement (branch `login-refine`)

Screenshots are in `docs/screenshots/login-refresh/refined/`; `after/` is the previous version, for comparison.

- **Card:** up to 1040px wide, split 42% branding / 58% form. Subtle border, a restrained two-layer shadow and the same 8px radius as the rest of the portal.
- **Branding panel:**
  - softer charcoal (`--color-charcoal: #343a40`; white text 11.5:1, 80% white 8.0:1);
  - the architectural grid was removed;
  - the original square logo sits undistorted in a white square. On desktop it is decorative (empty `alt`) because "RECAFCO Documents" is written beside it; on mobile it is `alt="RECAFCO"`.
- **Branding layout:** logo and name at the top. "Your company documents, / in one place." is written as two deliberate lines, just above the middle of the panel, so the gap below the logo stays modest even on the taller first-login screen. "Find and share documents across departments." sits directly below.
- **Typography:** one font throughout, the system sans-serif stack already used by the portal (`--font-sans`: system-ui, Segoe UI, …); no web fonts, so it works offline.
- **Form:**
  - "Welcome back" / "Sign in to RECAFCO Documents."; the signed-out or session-ended status sits below the subtitle as a compact bordered line with an icon (`role="status"`);
  - the form column is vertically centred, max 392px;
  - persistent labels; 52px fields and button;
  - one full-width red "Sign in";
  - "For account help, contact your system administrator."
- **Password toggle:** an eye / eye-off icon button inside the field, `aria-label` "Show password" / "Hide password", `aria-controls`, a 44px target and the shared focus ring. It applies to every password field, including the admin reset and change-password forms.
- **First-login "Choose your password":** same layout, 52px fields.
- **One test assertion updated:** `09-local-accounts` looked for the old visible "Show" text. It now checks `aria-label="Show password"`, because the requested control is an icon.

Checks on the refined design (real Edge, `scripts/screenshots-login.mjs`):
- 390, 768, 1440 and 1920px, 1440×600, phone 390×480 with the keyboard open, and 200% zoom: no horizontal scrolling, nothing clipped.
- Tab order: username → password → eye toggle, with a visible focus ring.
- Show/Hide name and field type switch correctly.
- `autocomplete` attributes are correct and nothing is prefilled.
- Empty-field inline errors work. After a wrong password the username is kept and the password is not in the HTML.
- Lockout message, "Signing in…" with the button disabled, and the first-login flow all work.
- Typecheck, lint and build clean; unit tests 13/13; integration tests **178/178** (sign-in, lockout, first-login, session and permission regressions).
