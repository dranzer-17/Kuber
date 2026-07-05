import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { setLeadInterestStatus } from "@/lib/services/unibox";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const { threadId } = await params;
  const body = await req.json().catch(() => null) as { interest_value?: number | null; lead_email?: string } | null;
  if (!body || !("interest_value" in body)) {
    return fail(400, "VALIDATION_ERROR", "interest_value required");
  }

  const db = createAdminClient();
  let leadEmail = body.lead_email ?? null;
  if (!leadEmail) {
    const { data: row } = await db.from("unibox_emails").select("lead_email").eq("thread_id", threadId).limit(1).maybeSingle();
    leadEmail = row?.lead_email ?? null;
  }
  if (!leadEmail) return fail(400, "MISSING_LEAD", "Could not resolve lead email for thread");

  await setLeadInterestStatus(db, {
    leadEmail,
    interestValue: body.interest_value ?? null,
    actorId: user.id,
  });

  return ok({ lead_email: leadEmail, interest_value: body.interest_value });
}
