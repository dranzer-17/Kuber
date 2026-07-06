import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { getThreadMessages, hydrateThreadIfStale } from "@/lib/services/unibox";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const { threadId } = await params;
  const db = createAdminClient();

  if (req.nextUrl.searchParams.get("hydrate") === "1") {
    await hydrateThreadIfStale(db, threadId);
  }

  const detail = await getThreadMessages(db, threadId);
  return ok(detail);
}
