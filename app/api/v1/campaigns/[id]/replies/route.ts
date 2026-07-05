import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { getCampaignReplyThreads } from "@/lib/services/unibox";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;
  const threads = await getCampaignReplyThreads(createAdminClient(), id);
  return ok({ threads });
}
