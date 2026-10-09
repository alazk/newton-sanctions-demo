import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  /**
   * Pin the workspace root to this directory.
   *
   * An `npm install` was once run in the home directory by mistake, leaving a
   * stray /Users/alaz/package-lock.json behind. Next.js sees multiple lockfiles,
   * picks the highest one as the root, and warns on every boot. Setting this
   * explicitly stops it guessing.
   */
  outputFileTracingRoot: path.join(__dirname),

  // Audit (Oct 2026): no framework banner, and basic hardening headers. A full
  // CSP is left out on purpose: Next's inline runtime scripts would need nonces.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // A compliance verdict should not be framable by another site.
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
