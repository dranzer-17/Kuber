"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { fetchServiceHealth, type ServiceIssue } from "@/lib/api-client";

// Red banner shown on Leads/Kanban when a paid upstream (OpenRouter, Firecrawl,
// Apollo, OpenAI) is failing on credits/auth — so a dead API key surfaces as a
// clear, actionable message instead of a raw HTTP 402 buried in a lead's log.
export function ServiceHealthBanner() {
  const { session } = useApp();
  const [issues, setIssues] = useState<ServiceIssue[]>([]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const load = () => {
      fetchServiceHealth(session.access_token)
        .then((i) => { if (!cancelled) setIssues(i); })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [session]);

  if (issues.length === 0) return null;

  return (
    <div className="px-8 pt-3 space-y-2">
      {issues.map((issue) => (
        <div
          key={issue.service}
          className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold">{issue.service} issue:</span> {issue.message}
          </span>
        </div>
      ))}
    </div>
  );
}
