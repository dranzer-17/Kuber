import { getCampaign } from "@/lib/server/campaigns";
import { employeeCampaignIds } from "@/lib/auth/scope";
import { requireAppSessionContext } from "@/lib/server/session";
import { CampaignDetailClient } from "./campaign-detail-client";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { db, userId, role } = await requireAppSessionContext();

  let initialCampaign = null;
  try {
    // Employees may open a campaign they created, that's assigned to them, OR
    // that contains a lead assigned to them (same rule as the list + API — not
    // created_by only, which used to hide campaigns holding their own leads).
    // getCampaign overlays employee-scoped lead/sent/hot counts so the drawer
    // badge + analytics tiles match only their assigned leads.
    if (role === "employee") {
      const ids = await employeeCampaignIds(db, userId);
      initialCampaign = ids.includes(id) ? await getCampaign(db, id, userId) : null;
    } else {
      initialCampaign = await getCampaign(db, id);
    }
  } catch {
    // campaign not found — client component will handle
  }

  return <CampaignDetailClient campaignId={id} initialCampaign={initialCampaign} />;
}
