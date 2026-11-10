import 'server-only';

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return value;
}

function mayanUrl(): string {
  const value = process.env.MAYAN_URL;
  if (!value) throw new Error('MAYAN_URL is not set.');
  return value.replace(/\/+$/, '');
}

export const config = {
  get mayanApiUrl() {
    return `${mayanUrl()}/api/v4`;
  },
  sessionIdleMs: number('PORTAL_SESSION_IDLE_MINUTES', 30) * 60_000,
  sessionAbsoluteMs: number('PORTAL_SESSION_ABSOLUTE_HOURS', 8) * 3_600_000,
  maxUploadBytes: number('PORTAL_MAX_UPLOAD_MB', 50) * 1024 * 1024,
  // Secure cookies need HTTPS. Default: on in production builds.
  cookieSecure:
    process.env.PORTAL_COOKIE_SECURE !== undefined
      ? process.env.PORTAL_COOKIE_SECURE === 'true'
      : process.env.NODE_ENV === 'production',
};

export const SESSION_COOKIE = 'recafco_portal_session';
