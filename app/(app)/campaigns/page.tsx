import { createAdminClient } from "@/lib/supabase/admin";
import { getCampaigns } from "@/lib/server/campaigns";
import { CampaignsClient } from "./campaigns-client";

export default async function CampaignsPage() {
  const campaigns = await getCampaigns(createAdminClient());
  return <CampaignsClient initialCampaigns={campaigns} />;
}
