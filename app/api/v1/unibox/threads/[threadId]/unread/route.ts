import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { assertThreadAccessById } from "@/lib/auth/scope";
import { markThreadUnread } from "@/lib/services/unibox";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const { threadId } = await params;
  const db = createAdminClient();
  try { await assertThreadAccessById(db, user, threadId); } catch (r) { return r as Response; }
  await markThreadUnread(db, threadId);
  return ok({ unread: true });
}
