import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/auth/roles";
import { getCampaigns } from "@/lib/server/campaigns";
import { CampaignsClient } from "./campaigns-client";

export default async function CampaignsPage() {
  const db = createAdminClient();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = getUserRole(user);
  const isManager = role === "manager";

  const campaigns = await getCampaigns(db, isManager ? undefined : user?.id);
  return <CampaignsClient initialCampaigns={campaigns} />;
}
