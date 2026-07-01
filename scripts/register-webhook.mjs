/**
 * One-time script to register the Instantly webhook.
 * Run once per workspace / environment:
 *   node scripts/register-webhook.mjs
 *
 * Requires these env vars (from .env.local):
 *   INSTANTLY_API_KEY
 *   INSTANTLY_WEBHOOK_SECRET
 *   NEXT_PUBLIC_APP_URL  (e.g. https://kuber.vercel.app)
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const BASE = "https://api.instantly.ai/api/v2";

const apiKey = process.env.INSTANTLY_API_KEY;
const secret = process.env.INSTANTLY_WEBHOOK_SECRET;
const appUrl = process.env.NEXT_PUBLIC_APP_URL;

if (!apiKey || !secret || !appUrl) {
  console.error("Missing env vars: INSTANTLY_API_KEY, INSTANTLY_WEBHOOK_SECRET, NEXT_PUBLIC_APP_URL");
  process.exit(1);
}

const targetUrl = `${appUrl}/api/v1/webhooks/instantly`;

// 1. List existing webhooks to avoid duplicates
const listRes = await fetch(`${BASE}/webhooks?limit=50`, {
  headers: { Authorization: `Bearer ${apiKey}` },
});
const listData = await listRes.json();
const existing = (listData.items ?? []).find((w) => w.target_hook_url === targetUrl);

if (existing) {
  console.log("Webhook already registered:", existing.id, "→", existing.target_hook_url);
  console.log("Status:", existing.status);
  process.exit(0);
}

// 2. Register new webhook for all events
const createRes = await fetch(`${BASE}/webhooks`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    target_hook_url: targetUrl,
    name: "Kuber reply pipeline — all events",
    event_type: "all_events",
    headers: { "X-Webhook-Secret": secret },
  }),
});

const created = await createRes.json();

if (!createRes.ok) {
  console.error("Failed to register webhook:", createRes.status, created);
  process.exit(1);
}

console.log("Webhook registered successfully:");
console.log("  ID:", created.id);
console.log("  URL:", created.target_hook_url);
console.log("  Status:", created.status);
console.log("\nSave this ID in a safe place. To delete: DELETE /api/v2/webhooks/" + created.id);
