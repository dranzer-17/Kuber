import { getCampaigns } from "@/lib/server/campaigns";
import { requireAppSessionContext } from "@/lib/server/session";
import { CampaignsClient } from "./campaigns-client";

export default async function CampaignsPage() {
  const { db, userId, role } = await requireAppSessionContext();
  const isManager = role === "manager";

  const campaigns = await getCampaigns(db, isManager ? undefined : userId);
  return <CampaignsClient initialCampaigns={campaigns} />;
}
