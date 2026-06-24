import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { ok, fail } from "@/lib/api-response";
import { sendCampaign } from "@/lib/services/campaign-fanout";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user: { id: string };
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;
  try {
    const result = await sendCampaign(id, user.id);
    return ok(result);
  } catch (err) {
    return fail(500, "INSTANTLY_ERROR", (err as Error).message);
  }
}
