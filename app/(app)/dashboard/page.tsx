"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardView } from "@/components/app/dashboard";
import { useApp } from "@/lib/app-context";
import { fetchImports, type ImportBatch } from "@/lib/api-client";

type TemperatureBreakdown = {
  hot: number; cold: number; ooo: number; unsubscribed: number; unclassified: number;
};

type PendingReply = {
  id: string; campaignId: string; campaignName: string;
  leadEmail: string | null; preview: string; createdAt: string;
};

export default function DashboardPage() {
  const router = useRouter();
  const { leads, campaigns, session } = useApp();
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [hotCount, setHotCount] = useState<number | null>(null);
  const [temperatureBreakdown, setTemperatureBreakdown] = useState<TemperatureBreakdown | null>(null);
  const [pendingReplies, setPendingReplies] = useState<PendingReply[]>([]);

  useEffect(() => {
    if (!session) return;
    fetchImports(session.access_token)
      .then((r) => setImportBatches(r.imports))
      .catch(() => {});
  }, [session, leads]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/v1/leads/hot-count", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d) => setHotCount(d.data?.hotCount ?? 0))
      .catch(() => setHotCount(0));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/v1/dashboard/analytics", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        setTemperatureBreakdown(d.data?.temperatureBreakdown ?? null);
        setPendingReplies(d.data?.pendingReplies ?? []);
      })
      .catch(() => {});
  }, [session]);

  // Dashboard is considered "still loading" until BOTH the always-loaded `leads`
  // context array has data AND the hot-count fetch has resolved at least once. Used
  // to show a loading skeleton on the stat cards instead of a misleading "0" during
  // the brief window right after login before data arrives.
  const dashboardLoading = leads.length === 0 && hotCount === null;

  return (
    <DashboardView
      leads={leads}
      campaigns={campaigns}
      imports={importBatches}
      hotCount={hotCount}
      loading={dashboardLoading}
      temperatureBreakdown={temperatureBreakdown}
      pendingReplies={pendingReplies}
      onNavigate={(view) => router.push(view === "campaigns" ? "/campaigns" : "/leads")}
      onSelectBatch={(label) => router.push(`/leads?batches=${encodeURIComponent(label)}`)}
    />
  );
}
