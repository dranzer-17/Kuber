import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { getThreads, type UniboxReadState, type UniboxTab } from "@/lib/services/unibox";

function parseInterest(raw: string | null): number | "lead" | undefined {
  if (!raw) return undefined;
  if (raw === "lead") return "lead";
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function parseReadState(raw: string | null): UniboxReadState | undefined {
  if (!raw || raw === "all") return undefined;
  const valid: UniboxReadState[] = ["unread", "read", "replied", "needs_reply"];
  return valid.includes(raw as UniboxReadState) ? (raw as UniboxReadState) : undefined;
}

export async function GET(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const sp = req.nextUrl.searchParams;
  const db = createAdminClient();

  const campaignIdsRaw = sp.get("campaign_ids");
  const campaign_ids = campaignIdsRaw
    ? campaignIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const tabRaw = sp.get("tab");
  const tab = tabRaw ? (tabRaw as UniboxTab) : undefined;

  const result = await getThreads(db, {
    tab,
    campaign_id: sp.get("campaign_id") ?? undefined,
    campaign_ids: campaign_ids?.length ? campaign_ids : undefined,
    eaccount: sp.get("eaccount") ?? undefined,
    q: sp.get("q") ?? undefined,
    unread_only: sp.get("unread_only") === "1",
    read_state: parseReadState(sp.get("status")),
    interest_status: parseInterest(sp.get("interest")),
    cursor: sp.get("cursor") ?? undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 30,
  });

  return ok(result);
}
