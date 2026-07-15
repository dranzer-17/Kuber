/**
 * Local stand-in for Vercel Cron while this app only runs on localhost.
 * Vercel Cron (see vercel.json) only fires once actually deployed — until
 * then, nothing periodically resumes the enrichment pipeline if its
 * self-chain silently dies (confirmed this happens even while the dev server
 * itself stays up). Run this alongside `npm run dev` in a second terminal:
 *
 *   node scripts/watchdog.js
 *
 * Ctrl+C to stop. Safe to leave running all day — both jobs are no-ops when
 * there's nothing to do.
 */

const fs = require("fs");
const path = require("path");

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  const env = {};
  if (!fs.existsSync(envPath)) return env;
  // .env.local has CRLF endings — split("\n") alone leaves a trailing \r on
  // every line, which silently breaks `$` (JS's $ without /m won't match
  // before a lone \r), so the whole regex fails to match on every line.
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const env = loadEnvLocal();
// Always localhost, not the ngrok URL — this script runs on the same machine
// as `npm run dev`, and the ngrok tunnel is for external callers (Apollo/etc
// webhooks), not for the app talking to itself.
const APP_URL = "http://localhost:3000";
const INTERNAL_SECRET = env.INTERNAL_SECRET;

if (!INTERNAL_SECRET) {
  console.error("INTERNAL_SECRET not found in .env.local — cannot authenticate to the watchdog routes.");
  process.exit(1);
}

const WATCHDOG_INTERVAL_MS = 15 * 60 * 1000;      // "did the relay die?" — every 15 min
const AUTO_RETRY_INTERVAL_MS = 3 * 60 * 60 * 1000; // "give stale failures another shot" — every 3h

async function hit(pathName, label) {
  try {
    const res = await fetch(`${APP_URL}${pathName}`, {
      method: "POST",
      headers: { "x-internal-secret": INTERNAL_SECRET },
    });
    const json = await res.json().catch(() => ({}));
    console.log(`[${new Date().toISOString()}] ${label} -> ${res.status}`, json.data ?? json);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ${label} failed:`, err.message);
  }
}

console.log(`Watchdog running against ${APP_URL}`);
console.log(`- enrichment-watchdog every ${WATCHDOG_INTERVAL_MS / 60000} min`);
console.log(`- auto-retry-failed-orgs every ${AUTO_RETRY_INTERVAL_MS / 3600000} h`);

hit("/api/internal/enrichment-watchdog", "watchdog");
hit("/api/internal/auto-retry-failed-orgs", "auto-retry");

setInterval(() => hit("/api/internal/enrichment-watchdog", "watchdog"), WATCHDOG_INTERVAL_MS);
setInterval(() => hit("/api/internal/auto-retry-failed-orgs", "auto-retry"), AUTO_RETRY_INTERVAL_MS);
