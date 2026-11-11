# portal

The RECAFCO employee portal (Next.js 16). See
[docs/setup.md](../docs/setup.md) for setup, and [CLAUDE.md](../CLAUDE.md) for the
rules this code must keep.

- `src/lib/`: server-only code: config, session store, Mayan client, auth.
- `src/app/`: pages (login, home, upload, document, search, my uploads) and
  route handlers under `src/app/api/` (upload, status, preview, download).
- `tests/unit/`: session expiry rules.
- `tests/integration/`: permission, upload, auth and journey tests against
  the dev stack.
