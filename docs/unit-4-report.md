# Unit 4 report — Local username/password accounts

Branch `unit-4-local-auth` (from Unit 3). Development stack only
(`recafco-dms-dev`, port 8091). The original Mayan installation (project
`mayan`, port 80) was not touched. Nothing was deployed.

## Result

| Requirement | Status | Evidence (tests in `portal/tests/integration/09-local-accounts.test.ts` unless noted) |
| --- | --- | --- |
| No email, phone or self-registration; admin creates username + temporary password | Done | "needs only a username and a temporary password" |
| Simple temporary passwords such as "123" | Done | same test; temporary minimum is 1 character |
| Replacement required at first sign-in and after admin reset | Done | "first sign-in…", "administrator password reset…" |
| Until changed, only password change and sign-out (backend and direct Mayan access) | Done | API token, Mayan's own token endpoint, HTTP Basic, Mayan web session, portal pages and portal API routes all tested |
| Personal password ≥ 6 characters, no character types | Done | "needs at least 6 characters…" (5 refused, "123456" accepted) |
| Simple usernames and numeric employee IDs; consistent case; backend uniqueness | Done | "accepts numeric employee IDs and enforces unique usernames regardless of case" |
| Change own password with the current password | Done | "a signed-in person changes their own password…" |
| Admin reset revokes sessions and credentials | Done | portal session, API token and Mayan web session all end; old password refused |
| No plaintext passwords stored or shown | Done | "never returns or records the password"; `recafco_dev password-info` shows the hash algorithm only (`pbkdf2_sha256`) |
| Supported secure hashing | Done | Django `set_password()`/`authenticate()`; no own hashing |
| Accessible show/hide control | Done | real `<button>`, named "Show password"/"Hide password", `aria-controls`; screenshots 01–11 |
| Throttling without blocking the office | Done | "locks one username… without blocking others on the same IP"; "limits rapid sign-in requests per username" |
| Same identity source, no second password database | Done | Mayan's Django user table only; `PasswordState` holds a flag, not a password |
| Outside-access authorization and additional verification | **Not implemented** | Kept as an open requirement; not claimed (see gaps) |

Checks (final run, after all changes):
- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npm run build`: clean.
- `npm run test:unit`: **13/13** (3 new: pending flag across restarts, token replacement after a change, upgrade of an older session file).
- `npm run test:integration`: **174/174**, of which 15 are new and 159 are the earlier permission, upload, confidential and session tests. During that run the known Unit 3 dropped-connection error happened twice before the upload was processed. The test helper's resend with the same operation ID completed both uploads, as designed.

## How it works

**Identity.** Accounts are Mayan's own Django users.
- Passwords are set with `set_password()` and checked with `authenticate()`.
- So Django's configured hasher (PBKDF2-SHA256 in this image) and Mayan's lockout apply to every attempt.
- The extension stores only `PasswordState` (must change: yes/no, reason, when, set by whom).

**Usernames.** Stored in lower case.
- On create, a name that matches an existing one ignoring case is refused. Exact-name uniqueness is the database constraint, and every new name is lower case, so concurrent creates cannot produce case variants.
- Portal sign-in finds the account ignoring case.
- Mayan's own login page compares exactly. It is not changed; people type lower case there.
- Accounts created earlier with capitals keep their spelling.

**Sign-in.** The portal no longer uses Mayan's token-obtain endpoint. It calls `POST /api/v4/recafco/auth/login/`, which returns:
- the Mayan token, which stays on the portal server;
- whether a password change is pending;
- the person's roles.

This is the only extension view without `IsAuthenticated`, because it is how one signs in. It is limited per username, not per IP.

**Pending change.** `recafco_dms.middleware.PasswordPolicyMiddleware` is installed through Mayan's supported `MAYAN_EXTRA_SETTINGS_FUNCTION_LIST` hook; Mayan's source is unchanged. It runs directly after Django's authentication middleware.
- It refuses every request made as an account with a pending change: web session, `Token` header, or HTTP Basic.
- Exceptions: the password change, token revocation (portal sign-out), and Mayan logout.
- Basic credentials are verified before anything is revealed. A wrong password gets a plain 401.
- The portal mirrors the rule: pages redirect to `/change-password`, and API routes answer 403. Mayan is the authority either way.

**Changing one's password.** `POST /api/v4/recafco/auth/password/`:
- requires the current password (checked through the lockout);
- requires 6–128 characters, different from the current password;
- issues a new Mayan token. The portal session switches to it, and every other session and device is signed out.

**Administrator reset.** Sets a temporary password and a pending change, then:
- deletes the token, which ends all portal sessions;
- ends Mayan web sessions, because Django checks the password hash stored in each session;
- clears the lockout counter;
- writes the activity-log entry `user.password_reset`, with no password in it.

Administrators cannot reset their own password there; they use "Change password".

**Throttling.**
- Mayan's lockout (django-axes) counts per **username**: the fifth wrong password locks that username for 15 minutes, and that reply already says so. Direct Mayan access is locked too.
- A second limit of 10 sign-in requests per minute per username is counted in the database. Mayan's throttle cache is per-process memory, so a count kept there would be split across Gunicorn workers; this was observed.
- Neither limit is per IP: a test shows another user signs in from the same address while one username is locked.

## Findings during this unit

1. **Mayan lets any signed-in user change their own password without the current one, and rename their account.** `PATCH /api/v4/users/current/` did both; reproduced inside a rolled-back transaction, without the new middleware. The rename can use capitals, which bypasses case-insensitive uniqueness. The same endpoint also accepts `DELETE` (delete own account). The middleware now refuses `/users/current/` writes and Mayan's web password-change page for RECAFCO accounts (tested). Mayan system accounts are unaffected.
2. **Mayan's lockout is off by default, and its default keys are username + IP address.** Both must be configured; the dev stack now does this.
3. **Mayan's throttle cache is per-process memory.** Its built-in API rate limits are therefore counted per Gunicorn worker, not per server. The RECAFCO sign-in limit avoids this by counting in the database.
4. **The lockout middleware replaced the sign-in API's JSON "locked" answer with Mayan's HTML lockout page.** The portal then showed "not responding" instead of the lock message. Fixed: the endpoint reports the lock itself (tested: the portal shows "Too many unsuccessful sign-in attempts…").
5. **Mayan has Django password validators configured** (minimum 8 characters, not all numbers, not common). RECAFCO's rule (6 characters, no types) is applied to these passwords instead, as required. Mayan's validators still apply to anything a Mayan superuser sets in Mayan's own screens.

## Production settings required (not applied anywhere but the dev stack)

See the README section "Accounts and sign-in". Without `MAYAN_EXTRA_SETTINGS_FUNCTION_LIST`, the pending-change rule holds only in the portal, not on direct Mayan access. Without the lockout settings, there is no lockout. Applying them to the company server is a deployment step that needs approval.

## Screenshots (`docs/screenshots/unit-4/`)

| # | Shows |
| --- | --- |
| 01–02 | Sign-in with the password shown (desktop, mobile) |
| 03 | Administrator creates an account with temporary password "123" |
| 04 | New account page: "must choose their own password" notice |
| 05–06 | First sign-in: only "Choose your password" and "Sign out" (desktop, mobile) |
| 07 | Too-short password: error next to the field |
| 08 | Password saved, home page |
| 09 | Voluntary "Change password" for a signed-in person |
| 10–11 | Administrator reset confirmation; the field is cleared and nothing is echoed (desktop, mobile) |

All captured at 1440px and 390px wide without sideways scrolling.

## Files changed

Extension (`mayan-extensions/recafco_dms/`):
- `passwords.py` (new)
- `auth_api_views.py` (new)
- `middleware.py` (new)
- `settings_hooks.py` (new)
- `models.py`: `PasswordState`, `LoginRateWindow`
- `migrations/0005_password_state.py`, `0006_login_rate_window.py`
- `admin_services.py`: create user with temporary password and lower-case username; `locked_out` and `must_change_password` fields; the old password setter removed
- `admin_api_views.py`: reset view, which refuses self-reset
- `urls.py`
- `literals.py`
- `management/commands/recafco_dev.py`: `password-info`, `sessions`, `lockout-settings`; the dev user reset also clears pending changes and lockouts

Portal (`portal/`):
- `src/lib/mayan.ts`: `signIn`, `changeOwnPassword`, `PasswordChangeRequiredError`
- `src/lib/session-store.ts`: `must_change` column, upgraded in place; `markMustChange`; `replaceSessionToken`
- `src/lib/auth.ts`
- `src/lib/route-helpers.ts`
- `src/lib/admin.ts`
- `src/app/actions.ts`: sign-in
- `src/app/change-password/` (new)
- `src/components/password-input.tsx` (new)
- `src/app/login/login-form.tsx`
- `src/components/app-shell.tsx`: "Change password" in the account menu
- `src/app/page.tsx`
- `src/app/admin/actions.ts`
- `src/app/admin/users/` (create, detail, list)
- the five API routes
- tests: `09-local-accounts.test.ts` (new); `05-departments-admin.test.ts` (account test updated for temporary passwords); `helpers.ts`; `session-store.test.ts`

Other:
- `deploy/dev/compose.yaml`
- `scripts/screenshots-unit4.mjs`
- `README.md`
- `CLAUDE.md`
- `docs/decisions.md`
- `docs/permission-model.md`
- `docs/progress.md`

## Remaining gaps

**Needs a RECAFCO decision**
- Outside (internet) access: whether it is allowed, through what (VPN, reverse proxy), and which additional verification (for example a second factor) is required. **Not implemented**; sign-in is username and password only. Mayan has a multi-factor framework, but it was not evaluated or enabled.
- Lockout figures: 5 failures / 15 minutes and 10 requests per minute are working values, not RECAFCO-confirmed.
- Whether temporary passwords should expire if unused (today they do not).

**Known limitations**
- Mayan's own login page is case-sensitive for usernames; only the portal ignores case.
- Accounts that differ only by case and were created before Unit 4 (outside the portal) are not merged or detected. None exist in dev.
- A Mayan superuser can still set any password from Mayan's own user screens without setting "must change". This is a system-account path outside the portal.
- Password spraying, where one password is tried against many usernames, is limited only per username. A per-IP limit was deliberately not added because the office shares addresses.
- `LoginRateWindow` rows are pruned opportunistically (about once a minute when sign-ins happen), not by a scheduled task.
- Production settings (middleware hook, lockout) are documented, not applied.

## Environment safety

- Only the `recafco-dms-dev` app container was recreated and restarted, to load the settings and code.
- The original `mayan` project, its volumes and port 80 were not touched.
- The old portal process on port 3107 was stopped by its own PID (25080); no other Node.js process was affected.
- No database was reset, truncated or recreated. Dev test accounts were added.
