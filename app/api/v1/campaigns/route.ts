import { NextRequest } from "next/server";
import { requireAuth, requireManager } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { CreateCampaignSchema } from "@/lib/validators/campaigns";
import { buildDefaultCampaignSteps } from "@/lib/constants";
import { getAccessibleCampaignIds } from "@/lib/auth/scope";


export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }

  const db = createAdminClient();

  // A campaign is a container that may hold leads from several employees
  // (spec §5). An employee sees any campaign that contains at least one lead
  // assigned to them (getAccessibleCampaignIds resolves that); the per-lead
  // filtering happens in the campaign-detail route.
  if (user.role === "employee") {
    const ids = await getAccessibleCampaignIds(db, user);
    if (ids.length === 0) return ok({ campaigns: [] });
    const { data, error } = await db
      .from("campaigns")
      .select("*")
      .eq("is_deleted", false)
      .in("id", ids)
      .order("created_at", { ascending: false });
    if (error) return fail(500, "INTERNAL", error.message);
    return ok({ campaigns: data });
  }

  const { data, error } = await db
    .from("campaigns")
    .select("*")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false });

  if (error) return fail(500, "INTERNAL", error.message);
  return ok({ campaigns: data });
}

// Campaign creation is a manager/super-admin action — employees are
// execution-only and cannot create campaigns (spec §1).
export async function POST(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireManager>>;
  try { user = await requireManager(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = CreateCampaignSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();

  const { data, error } = await db
    .from("campaigns")
    .insert({
      name: parsed.data.name,
      human_in_loop: parsed.data.human_in_loop,
      send_mode: parsed.data.send_mode,
      schedule_start_at: parsed.data.schedule_start_at,
      window_from: parsed.data.window_from,
      window_to: parsed.data.window_to,
      send_days: parsed.data.send_days,
      schedule_timezone: parsed.data.schedule_timezone,
      daily_limit: parsed.data.daily_limit,
      ai_prompt_context: parsed.data.ai_prompt_context,
      sender_name: parsed.data.sender_name,
      // followup_day_2 / followup_day_3 DB columns are left nullable going forward;
      // actual step delays are now stored in campaign_steps rows built below.
      attachment_path: parsed.data.attachment_path,
      attachment_name: parsed.data.attachment_name,
      attachment_mime: parsed.data.attachment_mime,
      attachment_size: parsed.data.attachment_size,
      attachment_url: parsed.data.attachment_url,
      // follow_up_pattern REMOVED — column dropped
      status: "draft",
      created_by: user.id,
      signature_user_id: parsed.data.signature_user_id ?? user.id,
      created_at: new Date().toISOString(),

    })
    .select()
    .single();

  if (error) return fail(500, "INTERNAL", error.message);

  // Build sequence steps dynamically from the requested follow-up delays.
  const followupSteps = Array.isArray(parsed.data.followup_steps) && parsed.data.followup_steps.length > 0
    ? parsed.data.followup_steps
    : [{ delay: 30, delay_unit: "days" as const }, { delay: 90, delay_unit: "days" as const }]; // safe default if the client omitted it
  const steps = buildDefaultCampaignSteps(followupSteps);

  await db.from("campaign_steps").insert(
    steps.map((s) => ({
      ...s,
      campaign_id: data.id,
      created_at: new Date().toISOString(),
    }))
  );

  return ok(data);
}
