"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardView } from "@/components/app/dashboard";
import { useApp } from "@/lib/app-context";
import { fetchImports, type ImportBatch } from "@/lib/api-client";

export default function DashboardPage() {
  const router = useRouter();
  const { leads, campaigns, session } = useApp();
  const [importBatches, setImportBatches] = useState<ImportBatch[]>([]);
  const [hotCount, setHotCount] = useState<number | null>(null);

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
      onNavigate={(view) => router.push(view === "campaigns" ? "/campaigns" : "/leads")}
      onSelectBatch={(label) => router.push(`/leads?batches=${encodeURIComponent(label)}`)}
    />
  );
}
