import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The console's own Content-Security-Policy.
 *
 * helmet turns CSP off on the API, correctly: that process serves JSON and
 * nothing else, so a policy there would constrain documents that do not exist.
 * The policy belongs wherever the bundle is served from — which in development
 * is this dev server, and in production is whatever static host you deploy to.
 *
 * What it buys: `script-src 'self'` means a stored string that reaches the DOM
 * cannot pull in code from anywhere else, and `frame-ancestors 'none'` means
 * this console cannot be framed by a hostile page and clicked through by an
 * administrator who thinks they are pressing something else.
 *
 * `connect-src` has to name Firebase explicitly. Signing in is a call to
 * identitytoolkit and every token refresh is a call to securetoken, so a policy
 * that forgets them locks everybody out at the login screen.
 */
function contentSecurityPolicy(apiUrl: string, dev: boolean): string {
  const firebase = 'https://identitytoolkit.googleapis.com https://securetoken.googleapis.com';

  return [
    "default-src 'self'",
    // Vite's dev server injects its client and rewrites modules on the fly, so
    // development needs eval and inline; a built bundle needs neither, and the
    // policy that ships is the strict one.
    dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    // Vite's client pings the dev server from a blob: worker while it waits to
    // reconnect after a restart. Development only; the built bundle has no
    // workers, so production keeps workers limited to its own origin.
    dev ? "worker-src 'self' blob:" : "worker-src 'self'",
    // Inline styles stay allowed in both: this codebase styles with the `style`
    // prop throughout, which is an inline style as far as CSP is concerned.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    // blob: and data: are for the avatars and dish photos the app stores.
    "img-src 'self' data: blob: https:",
    `connect-src 'self' ${apiUrl} ${firebase}${dev ? ' ws://localhost:5173' : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

// Port 5173 is not the default by accident: server/.env.example ships
// ALLOWED_ORIGINS=http://localhost:5173, and the API's CORS check is an exact
// string match. Changing the port here means changing it there too, or every
// browser request is rejected before it reaches a route.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiUrl = env.VITE_API_URL ?? 'http://localhost:8080';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Fail loudly rather than drifting to 5174: the API would reject that
      // origin and every screen would show "Failed to fetch".
      strictPort: true,
      headers: {
        'Content-Security-Policy': contentSecurityPolicy(apiUrl, true),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    },
    // `vite preview` serves the built bundle, so this is the policy that should
    // match whatever the production host is configured with. Keep the two in
    // step: a policy that only exists in preview protects nobody.
    preview: {
      headers: {
        'Content-Security-Policy': contentSecurityPolicy(apiUrl, false),
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
      },
    },
  };
});
