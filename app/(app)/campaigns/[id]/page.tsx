import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/auth/roles";
import { getCampaign } from "@/lib/server/campaigns";
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
    const campaign = await getCampaign(createAdminClient(), id);
    const isOwner = campaign.createdBy === user?.id;
    if (role === "employee" && !isOwner) {
      initialCampaign = null;
    } else {
      initialCampaign = campaign;
    }
  } catch {
    // campaign not found — client component will handle
  }

  return <CampaignDetailClient campaignId={id} initialCampaign={initialCampaign} />;
}
