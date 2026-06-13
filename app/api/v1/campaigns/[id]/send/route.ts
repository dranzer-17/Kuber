import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { createInstantlyCampaign, addLeadsToInstantly, activateInstantlyCampaign } from "@/lib/services/instantly";
import { z } from "zod";

const Schema = z.object({
  emails: z.array(z.object({
    lead_id: z.string().uuid(),
    email: z.string().email(),
    first_name: z.string(),
    last_name: z.string(),
    subject: z.string().min(1),
    body: z.string().min(1),
  })).min(1),
  config: z.object({
    daily_limit: z.number().int().min(1).max(500).default(30),
    window_from: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
    window_to: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
    timezone: z.string().default("Asia/Kolkata"),
    send_days: z.record(z.string(), z.boolean()).optional(),
  }),
});

const DEFAULT_SEND_DAYS = {
  monday: true, tuesday: true, wednesday: true,
  thursday: true, friday: true, saturday: false, sunday: false,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const db = createAdminClient();
  const { data: campaign } = await db
    .from("campaigns")
    .select("name, human_in_loop")
    .eq("id", id)
    .single();

  if (!campaign) return fail(404, "NOT_FOUND", "Campaign not found");

  const { emails, config } = parsed.data;

  try {
    const instantlyId = await createInstantlyCampaign(campaign.name, {
      dailyLimit: config.daily_limit,
      windowFrom: config.window_from,
      windowTo: config.window_to,
      timezone: config.timezone,
      sendDays: config.send_days ?? DEFAULT_SEND_DAYS,
    });

    await addLeadsToInstantly(instantlyId, emails.map((e) => ({
      email: e.email,
      firstName: e.first_name,
      lastName: e.last_name,
      subject: e.subject,
      body: e.body,
    })));

    // Only activate if human_in_loop is OFF
    if (!campaign.human_in_loop) {
      await activateInstantlyCampaign(instantlyId);
    }

    await db.from("campaigns").update({
      instantly_campaign_id: instantlyId,
      status: campaign.human_in_loop ? "draft" : "active",
      updated_at: new Date().toISOString(),
    }).eq("id", id);

    return ok({
      instantly_campaign_id: instantlyId,
      activated: !campaign.human_in_loop,
    });
  } catch (err) {
    return fail(500, "INSTANTLY_ERROR", (err as Error).message);
  }
}
