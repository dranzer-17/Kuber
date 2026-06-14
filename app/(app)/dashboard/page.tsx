"use client";

import { useRouter } from "next/navigation";
import { DashboardView } from "@/components/app/dashboard";
import { useApp } from "@/lib/app-context";

export default function DashboardPage() {
  const router = useRouter();
  const { leads, campaigns } = useApp();

  return (
    <DashboardView
      leads={leads}
      campaigns={campaigns}
      onNavigate={(view) => router.push(view === "campaigns" ? "/campaigns" : "/leads")}
    />
  );
}
