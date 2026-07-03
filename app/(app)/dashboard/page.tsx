import { createAdminClient } from "@/lib/supabase/admin";
import { getCampaigns } from "@/lib/server/campaigns";
import { getDashboardAnalytics } from "@/lib/server/dashboard";
import { getImports } from "@/lib/server/imports";
import { DashboardClient } from "./dashboard-client";

export default async function DashboardPage() {
  const db = createAdminClient();
  const [campaigns, analytics, imports] = await Promise.all([
    getCampaigns(db),
    getDashboardAnalytics(db),
    getImports(db),
  ]);

  return (
    <DashboardClient
      campaigns={campaigns}
      analytics={analytics}
      imports={imports}
    />
  );
}
