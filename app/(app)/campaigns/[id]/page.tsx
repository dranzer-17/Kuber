import { createAdminClient } from "@/lib/supabase/admin";
import { getCampaign } from "@/lib/server/campaigns";
import { CampaignDetailClient } from "./campaign-detail-client";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let initialCampaign = null;
  try {
    initialCampaign = await getCampaign(createAdminClient(), id);
  } catch {
    // campaign not found — client component will handle
  }

  return <CampaignDetailClient campaignId={id} initialCampaign={initialCampaign} />;
}
