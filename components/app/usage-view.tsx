"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-context";
import { fetchUsage, type ProviderUsage } from "@/lib/api-client";

const STATUS_META: Record<ProviderUsage["status"], { label: string; dot: string; text: string }> = {
  ok: { label: "OK", dot: "bg-emerald-400", text: "text-emerald-500" },
  low: { label: "Low", dot: "bg-amber-400", text: "text-amber-500" },
  out: { label: "Out of credits", dot: "bg-destructive", text: "text-destructive" },
  unknown: { label: "Unknown", dot: "bg-muted-foreground/40", text: "text-muted-foreground" },
};

export function UsageView() {
  const { session } = useApp();
  const [providers, setProviders] = useState<ProviderUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (!session) return;
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await fetchUsage(session.access_token);
      setProviders(data.providers);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between border-b border-border pb-4">
        <div>
          <p className="eyebrow">Provider credits</p>
          <h3 className="font-display text-base font-semibold mt-0.5">Usage</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-md">
            Remaining credits for the paid providers this app spends on your behalf.
            Apollo lead imports and website enrichment stop automatically once a
            provider runs low, instead of failing partway through a batch.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void load(true)} disabled={refreshing}>
          <RefreshCw className={refreshing ? "size-3.5 animate-spin" : "size-3.5"} /> Refresh
        </Button>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl bg-secondary" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {providers.map((p) => {
            const meta = STATUS_META[p.status];
            return (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <span className={`size-2 rounded-full ${meta.dot}`} aria-hidden />
                  <div>
                    <p className="text-sm font-medium">{p.label}</p>
                    <p className="text-[11px] text-muted-foreground">{p.message}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold ${meta.text}`}>{meta.label}</p>
                  {p.remaining != null && (
                    <p className="text-[11px] text-muted-foreground">{p.remaining.toLocaleString()} remaining</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
