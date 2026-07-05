import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { getThreads, type UniboxStatusFilter, type UniboxTab } from "@/lib/services/unibox";

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const sp = req.nextUrl.searchParams;
  const db = createAdminClient();

  const result = await getThreads(db, {
    tab: (sp.get("tab") as UniboxTab) ?? "primary",
    status: (sp.get("status") as UniboxStatusFilter) || undefined,
    campaign_id: sp.get("campaign_id") ?? undefined,
    eaccount: sp.get("eaccount") ?? undefined,
    q: sp.get("q") ?? undefined,
    unread_only: sp.get("unread_only") === "1",
    cursor: sp.get("cursor") ?? undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 30,
  });

  return ok(result);
}
