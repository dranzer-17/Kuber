import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { getUniboxScope } from "@/lib/auth/scope";
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
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const sp = req.nextUrl.searchParams;
  const db = createAdminClient();

  const campaignIdsRaw = sp.get("campaign_ids");
  const campaign_ids = campaignIdsRaw
    ? campaignIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const campaign_id: string | undefined = sp.get("campaign_id") ?? undefined;

  const EMPTY_RESULT = { threads: [], next_cursor: null, counts: { unread_total: 0 } };

  // Employees see ONLY threads of leads assigned to them (spec §7). The scope
  // (a campaign_lead_id allow-list) is the security boundary; campaign_id(s)
  // stay purely user-facing filters intersected on top.
  const scope = (await getUniboxScope(db, user)) ?? undefined;
  if (scope && scope.campaign_lead_ids.length === 0) return ok(EMPTY_RESULT);

  const tabRaw = sp.get("tab");
  const tab = tabRaw ? (tabRaw as UniboxTab) : undefined;

  const result = await getThreads(db, {
    tab,
    campaign_id,
    campaign_ids: campaign_ids?.length ? campaign_ids : undefined,
    eaccount: sp.get("eaccount") ?? undefined,
    q: sp.get("q") ?? undefined,
    unread_only: sp.get("unread_only") === "1",
    read_state: parseReadState(sp.get("status")),
    interest_status: parseInterest(sp.get("interest")),
    cursor: sp.get("cursor") ?? undefined,
    limit: sp.get("limit") ? Number(sp.get("limit")) : 30,
    scope,
  });

  return ok(result);
}
