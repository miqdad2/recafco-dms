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

## Final refinement and polish (branch `login-final`)

Screenshots: `docs/screenshots/login-refresh/final/`, with measured checks in `index.json`.

- **Logo:** the original PNG is 3375×3375 with about 30% empty space around the artwork, so it looked small in any container. `public/recafco-logo-mark.png` is a copy cropped to the artwork's bounding box (1% margin) and resized to 640×501. The artwork, colours and proportions are unchanged, and the original file is kept. The tile is 96px on desktop (artwork 80px wide) and 72px on mobile.
- **Beside the logo:** "Document / Management" in 18px medium weight, without wide letter spacing.
- **Headline:** "Documents across / departments. / Together in one place." at 30px with 1.3 line height, plus the small red accent. The supporting paragraph was removed.
- **Card:** 1040px wide, split 39% / 61% (measured 405 / 633px), with a content-driven height. The plain sign-in measures 555px tall at 1440px. Errors and the first-login password form make it taller; nothing is clipped.
- **Background:** the page uses a warm grey (`--color-canvas-warm: #f3f2ef`), with a white form surface, the charcoal branding panel and RECAFCO red.
- **Form:**
  - "Welcome back" / "Sign in to RECAFCO Documents."; the form column is 400px wide;
  - 16px labels, with 52px fields and button (measured);
  - eye-icon toggle "Show password" / "Hide password";
  - the divider was removed. "Need help? Contact your system administrator." sits 24px below the button at 15px muted grey (6.3:1 on white).
- **Signed-out feedback:** shown only after a real sign-out. The sign-out action sets a one-time, non-secret cookie (`recafco_signed_out`, path `/login`, 2 minutes). The page reads it on the server, so it renders with the page and causes no layout shift; it is announced with `role="status"`. A small client component clears the cookie and removes `?signedout=1` from the address. Measured: shown after signing out; not shown after a reload; not shown when `/login?signedout=1` is typed. The redirect still goes to `/login?signedout=1`, so existing tests and bookmarks behave the same.
- **"Blue fields":** our inputs are white with a grey border and turn blue only on keyboard focus. A pale-blue *fill* is the browser's native autofill styling (Chrome/Edge `:-webkit-autofill`), which also sets its own text colour. Autofill and password managers are untouched. Autofilled fields are restyled to a light tint with our dark text, so they stay readable and recognisably filled. This could not be triggered in headless Edge, which has no saved credentials; it needs a manual check in a normal browser.

Checks:
- Populated fields, empty-field errors, wrong password (username kept, password not in the HTML), lockout, "Signing in…" (button disabled), Show/Hide name and type, keyboard order and focus, signed-out once only, first-login password change.
- Desktop 1440/1920, tablet, phone, 1440×600, phone with keyboard (390×480) and 200% zoom: no horizontal scrolling, nothing clipped.

Tests for this final version:
- Typecheck, lint and build are clean; unit tests 13/13.
- Integration, first full run: 115 passed. File 05 stopped in its setup (63 tests skipped) when an admin API query returned no data; run alone, 05 passed 63/63. The setup line now fails with the real status and reply body.
- Integration, second full run: 175/178 passed. File 05 passed, but three tests in files 06 and 09 failed with `fetch failed: ECONNRESET` (a dropped connection, not an assertion). Two of them call the Mayan API directly and never touch the portal or the sign-in page, so the login change cannot cause them. Rerun alone, 06 and 09 passed 30/30.
- Cause, partly established: these match the intermittent keep-alive connection drop known since Units 1 and 3; the Mayan web workers were recycled during the run. The dev Mayan container also ran close to its 2.5 GiB memory limit after Docker Desktop restarted (memory.events `max 130`, `oom_kill 0`, so nothing was killed). The exact trigger is still not isolated (open since Unit 3).
