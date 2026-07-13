"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Eye } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { fetchOversight } from "@/lib/api-client";

type OversightData = Awaited<ReturnType<typeof fetchOversight>>;

export function OversightView() {
  const router = useRouter();
  const { session, role, loadingSession } = useApp();
  const [data, setData] = useState<OversightData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!loadingSession && role !== "manager") router.replace("/dashboard");
  }, [loadingSession, role, router]);

  useEffect(() => {
    if (!session || role !== "manager") return;
    setLoading(true);
    fetchOversight(session.access_token)
      .then(setData)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [session, role]);

  if (loadingSession || role !== "manager") return null;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Eye className="size-5" /> Oversight</h1>
        <p className="text-sm text-muted-foreground mt-1">Which campaigns are running, and which employee owns them.</p>
      </div>

      {loading || !data ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5">Employee</th>
                  <th className="text-left px-4 py-2.5">Territory</th>
                  <th className="text-right px-4 py-2.5">Assigned leads</th>
                  <th className="text-right px-4 py-2.5">Campaigns</th>
                  <th className="text-right px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.employees.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2.5 font-medium">{e.full_name || e.email}</td>
                    <td className="px-4 py-2.5 text-muted-foreground capitalize">{e.territory ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{e.assigned_lead_count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{e.campaign_count}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={e.is_active ? "text-emerald-500" : "text-muted-foreground"}>
                        {e.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5">Campaign</th>
                  <th className="text-left px-4 py-2.5">Owner</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-right px-4 py-2.5">Leads</th>
                  <th className="text-right px-4 py-2.5">Sent</th>
                  <th className="text-right px-4 py-2.5">Replied</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2.5 font-medium">
                      <Link href={`/campaigns/${c.id}`} className="hover:underline">{c.name}</Link>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{c.owner?.full_name || c.owner?.email || "—"}</td>
                    <td className="px-4 py-2.5 capitalize text-muted-foreground">{c.status}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.total_leads}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.sent_count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{c.replied_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
