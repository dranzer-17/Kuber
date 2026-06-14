"use client";

import { useParams, useRouter } from "next/navigation";
import { CampaignDetail } from "@/components/app/campaign-drawer";
import { useApp } from "@/lib/app-context";

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = typeof params.id === "string" ? params.id : "";
  const { campaigns } = useApp();

  const campaign = campaigns.find((c) => c.id === campaignId) ?? null;

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
      campaign={campaign}
      onBack={() => router.push("/campaigns")}
    />
  );
}
