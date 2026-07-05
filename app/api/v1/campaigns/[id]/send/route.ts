import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { ok, fail } from "@/lib/api-response";
import { sendCampaign } from "@/lib/services/campaign-fanout";
import { SendCampaignSchema } from "@/lib/validators/campaigns";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = SendCampaignSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  try {
    const result = await sendCampaign(id, user.id, {
      campaignLeadIds: parsed.data.campaign_lead_ids,
    });
    return ok(result);
  } catch (err) {
    return fail(500, "INSTANTLY_ERROR", (err as Error).message);
  }
}
