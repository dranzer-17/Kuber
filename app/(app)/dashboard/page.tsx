import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/auth/roles";
import { getCampaigns } from "@/lib/server/campaigns";
import { getDashboardAnalytics, getEmployeeDashboard, type DashboardAnalytics } from "@/lib/server/dashboard";
import { getImports } from "@/lib/server/imports";
import { DashboardClient } from "./dashboard-client";

const EMPTY_ANALYTICS: DashboardAnalytics = {
  temperatureBreakdown: { hot: 0, cold: 0, ooo: 0, unsubscribed: 0, unclassified: 0 },
  pendingReplies: [],
  totalLeads: 0,
  enrichedLeads: 0,
  pipelineGrowth: [],
  stageDonutData: [],
};

export default async function DashboardPage() {
  const db = createAdminClient();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const role = getUserRole(user);
  const isManager = role === "manager";

  const [campaigns, analytics, imports] = await Promise.all([
    getCampaigns(db, isManager ? undefined : user?.id),
    // Employees get the same dashboard, scoped to their own leads + campaigns
    // (planning.md Phase 7 / Q9).
    isManager
      ? getDashboardAnalytics(db)
      : user?.id
        ? getEmployeeDashboard(db, user.id)
        : Promise.resolve(EMPTY_ANALYTICS),
    isManager ? getImports(db) : Promise.resolve([]),
  ]);

  return (
    <DashboardClient
      campaigns={campaigns}
      analytics={analytics}
      imports={imports}
    />
  );
}
