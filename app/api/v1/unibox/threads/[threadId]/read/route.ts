import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { markThreadRead } from "@/lib/services/unibox";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ threadId: string }> },
) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const { threadId } = await params;
  await markThreadRead(createAdminClient(), threadId);
  return ok({ read: true });
}
