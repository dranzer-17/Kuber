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

  useEffect(() => {
    if (!session) return;
    fetchImports(session.access_token)
      .then((r) => setImportBatches(r.imports))
      .catch(() => {});
  }, [session, leads]);

  return (
    <DashboardView
      leads={leads}
      campaigns={campaigns}
      imports={importBatches}
      onNavigate={(view) => router.push(view === "campaigns" ? "/campaigns" : "/leads")}
      onSelectBatch={(label) => router.push(`/leads?batches=${encodeURIComponent(label)}`)}
    />
  );
}
