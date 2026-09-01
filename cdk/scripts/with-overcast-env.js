#!/usr/bin/env node
/**
 * Runs a command (default: `cdk`) with the environment variables Overcast's
 * CDK docs prescribe already set:
 *
 *   AWS_ENDPOINT_URL=http://localhost.overcast.sh:4566
 *   AWS_ACCESS_KEY_ID=test
 *   AWS_SECRET_ACCESS_KEY=test
 *   AWS_DEFAULT_REGION=us-east-1
 *
 * See: https://github.com/overcast-sh/overcast/blob/main/docs/cdk.md#2-configure-environment
 *
 * The endpoint uses `localhost.overcast.sh` (a public wildcard-DNS domain
 * that resolves to 127.0.0.1 on every OS) rather than plain `localhost`
 * because CDK's S3 asset publisher addresses buckets virtual-hosted style
 * (`<bucket>.<endpoint-host>`), and Overcast has to recognize that host to
 * rewrite the request to path-style — pair this with `docker run`'s
 * `-e OVERCAST_HOSTNAME=localhost.overcast.sh` (see the top-level README and
 * overcast docs/cdk.md § S3 asset upload fails on Windows; the fix applies
 * on every OS, not just Windows, so it's the default here).
 *
 * A plain shell `export` wrapper would work on macOS/Linux but not on
 * Windows PowerShell/cmd, so this tiny cross-platform launcher stands in for
 * `export FOO=bar && cdk ...` / `$env:FOO='bar'; cdk ...`. Any var already
 * set in the calling shell (e.g. a different AWS_ENDPOINT_URL) is left
 * untouched.
 *
 * Usage: node scripts/with-overcast-env.js <command> [...args]
 *   npm run deploy -- ServerlessApiStack   # extra args pass straight through
 */
const { spawnSync } = require("node:child_process");

const OVERCAST_ENV = {
  AWS_ENDPOINT_URL: "http://localhost.overcast.sh:4566",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
  AWS_DEFAULT_REGION: "us-east-1",
};

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("Usage: node scripts/with-overcast-env.js <command> [...args]");
  process.exit(1);
}

const env = { ...process.env };
for (const [key, value] of Object.entries(OVERCAST_ENV)) {
  if (!env[key]) env[key] = value;
}

const result = spawnSync(command, args, {
  env,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
