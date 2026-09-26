import type { NextConfig } from "next";

/**
 * Security headers for every route (SECURITY_AUDIT.md M-6). The app loads no third-party
 * scripts; the wallet is an injected provider, and the only outbound browser connections
 * are the Monad RPC and the app's own API.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js inlines its bootstrap scripts; no external script sources are allowed.
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' https://testnet-rpc.monad.xyz" + (process.env.NEXT_PUBLIC_MONAD_RPC_URL ? ` ${process.env.NEXT_PUBLIC_MONAD_RPC_URL}` : "") + (process.env.NODE_ENV === "development" ? " ws: http://127.0.0.1:*" : ""),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
