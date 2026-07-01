"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app-context";
import { deleteCampaign } from "@/lib/api-client";
import type { Campaign } from "@/components/app/create-campaign-modal";
import { Search, Trash2, RefreshCw, AlertTriangle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type CampaignStatus = "Draft" | "Live" | "Paused";

const CAMPAIGN_STATUS_STYLES: Record<string, { badge: string; dot: string }> = {
  Draft:  { badge: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",   dot: "bg-zinc-400"  },
  Live:   { badge: "bg-green-500/15 text-green-400 border-green-500/25", dot: "bg-green-400" },
  Paused: { badge: "bg-amber-500/15 text-amber-400 border-amber-500/25", dot: "bg-amber-400" },
};

// ── Delete confirm modal ──────────────────────────────────────────────────────

function DeleteConfirmModal({
  open,
  title,
  description,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-2xl border border-border bg-card shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <div className="shrink-0 size-10 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center">
            <AlertTriangle className="size-5 text-red-400" />
          </div>
          <div>
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Campaigns list view ───────────────────────────────────────────────────────

export default function CampaignsPage() {
  const router = useRouter();
  const { campaigns, setCampaigns, loadingCampaigns, session } = useApp();

  const [search,               setSearch              ] = useState("");
  const [statusFilter,         setStatusFilter        ] = useState<CampaignStatus | "All">("All");
  const [deletingCampaign,     setDeletingCampaign    ] = useState<Campaign | null>(null);
  const [deleteCampaignLoading, setDeleteCampaignLoading] = useState(false);

  const filtered = campaigns.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const counts: Record<CampaignStatus | "All", number> = {
    All:    campaigns.length,
    Draft:  campaigns.filter((c) => c.status === "Draft").length,
    Live:   campaigns.filter((c) => c.status === "Live").length,
    Paused: campaigns.filter((c) => c.status === "Paused").length,
  };

  function onSelect(c: Campaign) {
    router.push(`/campaigns/${c.id}`);
  }

  function onDeleted(id: string) {
    setCampaigns((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-6">
      {/* Header */}
      <div>
        <p className="text-sm text-muted-foreground mb-1">Outreach</p>
        <h1 className="text-2xl font-bold">Campaigns</h1>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search campaigns…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm bg-secondary/50 border border-border rounded-lg placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div className="flex items-center gap-1.5">
          {(["All", "Draft", "Live", "Paused"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                statusFilter === s
                  ? s === "All"
                    ? "bg-primary text-primary-foreground border-primary"
                    : cn(CAMPAIGN_STATUS_STYLES[s]?.badge, "border-current")
                  : "bg-transparent text-muted-foreground border-border hover:border-muted-foreground/40 hover:text-foreground",
              )}
            >
              {s}
              <span className={cn(
                "ml-1.5 tabular-nums",
                statusFilter === s ? "opacity-70" : "opacity-50",
              )}>
                {counts[s]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Campaign list */}
      {loadingCampaigns ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 flex items-center gap-5">
              <div className="size-2 rounded-full bg-secondary shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-secondary rounded" style={{ width: `${20 + (i % 3) * 10}%` }} />
                <div className="h-3 bg-secondary/60 rounded w-24" />
              </div>
              <div className="flex items-center gap-px shrink-0">
                {[0, 1, 2, 3].map((j) => (
                  <div key={j} className={`px-5 py-1 ${j < 3 ? "border-r border-border" : ""}`}>
                    <div className="h-5 w-8 bg-secondary rounded mx-auto mb-1" />
                    <div className="h-2 w-10 bg-secondary/60 rounded mx-auto" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {campaigns.length === 0
              ? "No campaigns yet. Create one to start sending outreach emails."
              : "No campaigns match your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const style = CAMPAIGN_STATUS_STYLES[c.status] ?? CAMPAIGN_STATUS_STYLES.Draft;
            const replyRate = c.sent > 0 ? Math.round((c.replied / c.sent) * 100) : 0;
            return (
              <div
                key={c.id}
                className="relative group/card rounded-xl border border-border bg-card transition-all hover:bg-secondary/30 hover:border-border/80 hover:shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => onSelect(c)}
                  className="w-full p-5 flex items-center gap-5 text-left"
                >
                  <div className={cn("size-2 rounded-full shrink-0 mt-0.5", style.dot)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold truncate">{c.name}</p>
                      <span className={cn(
                        "text-[10px] font-semibold uppercase tracking-wide border rounded-md px-1.5 py-0.5 shrink-0",
                        style.badge,
                      )}>
                        {c.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn(
                        "text-[11px] px-1.5 py-0.5 rounded border",
                        c.humanInLoop
                          ? "text-blue-400 bg-blue-500/10 border-blue-500/20"
                          : "text-muted-foreground bg-secondary/50 border-border",
                      )}>
                        {c.humanInLoop ? "Human review" : "Auto-send"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">Created {c.createdAt}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-px shrink-0 pr-8">
                    {[
                      { label: "Leads",      value: c.leads,           color: "text-foreground" },
                      { label: "Sent",       value: c.sent,            color: "text-foreground" },
                      { label: "Replied",    value: c.replied,         color: "text-green-400" },
                      { label: "Reply rate", value: `${replyRate}%`,   color: replyRate > 0 ? "text-green-400" : "text-muted-foreground" },
                    ].map(({ label, value, color }, idx) => (
                      <div
                        key={label}
                        className={cn(
                          "text-center px-5 py-1",
                          idx < 3 && "border-r border-border",
                        )}
                      >
                        <p className={cn("text-lg font-bold tabular-nums", color)}>{value}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
                      </div>
                    ))}
                  </div>
                </button>

                <button
                  type="button"
                  title="Delete campaign"
                  onClick={() => setDeletingCampaign(c)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-lg opacity-0 group-hover/card:opacity-100 text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-all"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <DeleteConfirmModal
        open={!!deletingCampaign}
        title={`Delete "${deletingCampaign?.name}"?`}
        description="This will permanently delete the campaign and all its leads, drafts, and send history. This cannot be undone."
        loading={deleteCampaignLoading}
        onClose={() => { if (!deleteCampaignLoading) setDeletingCampaign(null); }}
        onConfirm={async () => {
          if (!deletingCampaign || !session) return;
          setDeleteCampaignLoading(true);
          try {
            await deleteCampaign(session.access_token, deletingCampaign.id);
            onDeleted(deletingCampaign.id);
            setDeletingCampaign(null);
          } finally {
            setDeleteCampaignLoading(false);
          }
        }}
      />
    </div>
  );
}
