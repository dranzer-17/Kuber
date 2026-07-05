"use client";

import { useRouter } from "next/navigation";
import { CampaignDetail } from "@/components/app/campaign-drawer";
import { useApp } from "@/lib/app-context";
import type { Campaign } from "@/components/app/create-campaign-modal";

interface Props {
  campaignId: string;
  initialCampaign: Campaign | null;
}

export function CampaignDetailClient({ campaignId, initialCampaign }: Props) {
  const router = useRouter();
  const { campaigns } = useApp();

  // Prefer live context data (has real-time updates); fall back to server-fetched initial
  const campaign = campaigns.find((c) => c.id === campaignId) ?? initialCampaign;

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 gap-4">
        <p className="text-sm text-muted-foreground">Campaign not found.</p>
        <button
          type="button"
          onClick={() => router.push("/campaigns")}
          className="text-xs underline text-muted-foreground hover:text-foreground transition-colors"
        >
          Back to campaigns
        </button>
      </div>
    );
  }

  return (
    <CampaignDetail
      key={campaign.id}
      campaign={campaign}
      onBack={() => router.push("/campaigns")}
    />
  );
}
