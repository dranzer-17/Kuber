import { NextRequest } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { getSendingAccounts, SENDING_ACCOUNTS_SETTING_KEY } from "@/lib/services/service-keys";

// The sender addresses campaigns send from. Stored as one comma-separated
// string to stay compatible with the INSTANTLY_SENDING_ACCOUNTS env var this
// falls back to, so a deployment can move between the two without a data step.
const BodySchema = z.object({
  emails: z.array(z.string().trim().email("Each sending account must be a valid email")).max(50),
});

export async function PUT(req: NextRequest) {
  try { await requireSuperAdmin(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  // De-duplicate case-insensitively — Instantly treats addresses as
  // case-insensitive, and a repeated address would skew its own send pacing.
  const seen = new Set<string>();
  const emails = parsed.data.emails.filter((raw) => {
    const key = raw.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const db = createAdminClient();
  const { error } = await db.from("settings").upsert(
    { key: SENDING_ACCOUNTS_SETTING_KEY, value: emails.join(",") },
    { onConflict: "key" },
  );
  if (error) return fail(500, "INTERNAL", error.message);

  // Return what the app will actually use — with an empty list saved, reads
  // fall through to the env var, and the UI must show that, not an empty box.
  return ok({ sendingAccounts: await getSendingAccounts(db) });
}
