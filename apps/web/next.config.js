// Next.js only auto-loads .env/.env.local from this app's own directory
// (apps/web), never the monorepo root — but apps/web and apps/worker must
// agree on the SAME root .env for POSTGRES_* and SETTINGS_KEY_PATH (spec
// §14.4), the same reason apps/worker/src/index.ts loads it explicitly.
// Load it here, before Next.js reads process.env for anything else.
const { config } = require("dotenv");
const { resolve } = require("node:path");
config({ path: resolve(__dirname, "../../.env") });

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  transpilePackages: ["@netryx/shared-types"],
  // Bundles a self-contained server (a trimmed node_modules + apps/web's own
  // compiled server code) into .next/standalone — tools/build.py copies that
  // straight into the installer instead of raw source, so the installed app
  // runs via `node server.js` with no `pnpm install` needed on the target
  // machine at all.
  output: "standalone",
  experimental: {
    // Left to Next's own inference, outputFileTracingRoot walks up to the
    // monorepo root (the outermost lockfile, E:\Lumi) and traces EVERYTHING
    // under it during `next build` — including sibling folders that have
    // nothing to do with the web app. Confirmed live:
    // `EACCES ... scandir 'services/inference/venv-wsl/lib64'` — that venv
    // was created inside WSL, and its Linux-style symlinks (lib64 -> lib,
    // a Linux reparse-point tag) aren't readable by a plain Windows-native
    // Node process outside the WSL translation layer, so tracing crashes.
    // outputFileTracingExcludes (tried first) did NOT fix this — it filters
    // the RESULT set, but the underlying walk still crashes reaching that
    // directory before any filtering happens. Pinning the root to apps/web
    // itself sidesteps the problem entirely: services/inference is a
    // sibling of apps/web, not a descendant, so it's simply never visited.
    // Safe here specifically because this app doesn't use `output:
    // "standalone"` — file tracing isn't relied on for deployment, so
    // narrowing what it covers has no other effect.
    outputFileTracingRoot: __dirname,
  },
  webpack: (webpackConfig, { isServer }) => {
    // mapbox-gl-draw-circle bundles an old @mapbox/mapbox-gl-draw that pulls in
    // @mapbox/geojsonhint -> jsonlint-lines, which `require('fs')`. That fs call
    // is on a CLI/validation path we never hit at runtime, so stub the Node
    // builtin out of the browser bundle instead of letting it fail to resolve.
    if (!isServer) {
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return webpackConfig;
  },
};