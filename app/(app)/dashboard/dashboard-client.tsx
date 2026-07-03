"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { DashboardView } from "@/components/app/dashboard";
import { useApp } from "@/lib/app-context";
import type { ImportBatch } from "@/lib/api-client";
import type { Campaign } from "@/components/app/create-campaign-modal";
import type { DashboardAnalytics } from "@/lib/server/dashboard";

export function DashboardClient({
  campaigns,
  analytics,
  imports,
}: {
  campaigns: Campaign[];
  analytics: DashboardAnalytics;
  imports: ImportBatch[];
}) {
  const router = useRouter();
  const { setCampaigns } = useApp();

  useEffect(() => {
    setCampaigns(campaigns);
  }, [campaigns, setCampaigns]);

  return (
    <DashboardView
      campaigns={campaigns}
      imports={imports}
      loading={false}
      totalLeads={analytics.totalLeads}
      enrichedLeads={analytics.enrichedLeads}
      hotCount={analytics.temperatureBreakdown.hot}
      pipelineGrowth={analytics.pipelineGrowth}
      stageDonutData={analytics.stageDonutData}
      temperatureBreakdown={analytics.temperatureBreakdown}
      pendingReplies={analytics.pendingReplies}
      onNavigate={(view) => router.push(view === "campaigns" ? "/campaigns" : "/leads")}
      onSelectBatch={(label) => router.push(`/leads?batches=${encodeURIComponent(label)}`)}
    />
  );
}
