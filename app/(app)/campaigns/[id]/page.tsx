import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/auth/roles";
import { getCampaign } from "@/lib/server/campaigns";
import { employeeCampaignIds } from "@/lib/auth/scope";
import { CampaignDetailClient } from "./campaign-detail-client";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = getUserRole(user);

  let initialCampaign = null;
  try {
    const db = createAdminClient();
    // Employees may open a campaign they created, that's assigned to them, OR
    // that contains a lead assigned to them (same rule as the list + API — not
    // created_by only, which used to hide campaigns holding their own leads).
    // getCampaign overlays employee-scoped lead/sent/hot counts so the drawer
    // badge + analytics tiles match only their assigned leads.
    if (role === "employee" && user?.id) {
      const ids = await employeeCampaignIds(db, user.id);
      initialCampaign = ids.includes(id) ? await getCampaign(db, id, user.id) : null;
    } else {
      initialCampaign = await getCampaign(db, id);
    }
  } catch {
    // campaign not found — client component will handle
  }

  return <CampaignDetailClient campaignId={id} initialCampaign={initialCampaign} />;
}
