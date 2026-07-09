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
};