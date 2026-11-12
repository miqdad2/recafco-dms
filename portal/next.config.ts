import path from 'node:path';
import type { NextConfig } from 'next';

// Every page is per-employee and rendered on request (`dynamic =
// 'force-dynamic'`). Cache Components is deliberately not enabled: nothing
// in this portal may be cached across users.
//
// Do not add proxy.ts (middleware): Next.js buffers request bodies through
// it (default 10 MB) and silently truncates larger uploads.

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

// The portal folder is the project root. Next.js otherwise infers the root
// from the nearest lockfile; a lockfile in a parent folder (the repository
// once had an empty one) moves the root, and a build with a cache from the
// other root wrote generated files to portal/portal/.next. Pin both roots.
const projectRoot = path.resolve(__dirname);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
