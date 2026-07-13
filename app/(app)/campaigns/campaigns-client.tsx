"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app-context";
import { deleteCampaign, fetchUsers, type Profile } from "@/lib/api-client";
import type { Campaign } from "@/components/app/create-campaign-modal";
import { Trash2, User } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

type CampaignStatus = "Draft" | "Live" | "Paused";

const CAMPAIGN_STATUS_STYLES: Record<string, { badge: string; dot: string }> = {
  Draft:  { badge: "bg-zinc-500/15 text-zinc-400 border-zinc-500/25",   dot: "bg-zinc-400"  },
  Live:   { badge: "bg-green-500/15 text-green-400 border-green-500/25", dot: "bg-green-400" },
  Paused: { badge: "bg-amber-500/15 text-amber-400 border-amber-500/25", dot: "bg-amber-400" },
};

export function CampaignsClient({ initialCampaigns }: { initialCampaigns: Campaign[] }) {
  const router = useRouter();
  const { campaigns, setCampaigns, session, role } = useApp();

  // After first sync, always trust client state — even when empty after deleting
  // the last campaign. Falling back to initialCampaigns made deleted rows reappear.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    setCampaigns(initialCampaigns);
    setSeeded(true);
  }, [initialCampaigns, setCampaigns]);

  const list = seeded ? campaigns : (campaigns.length > 0 ? campaigns : initialCampaigns);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "All">("All");
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [users, setUsers] = useState<Profile[]>([]);
  const [deletingCampaign, setDeletingCampaign] = useState<Campaign | null>(null);
  const [deleteCampaignLoading, setDeleteCampaignLoading] = useState(false);

  useEffect(() => {
    if (role !== "manager" || !session) return;
    fetchUsers(session.access_token).then(setUsers).catch(() => {});
  }, [role, session]);

  const userMap = new Map(users.map((u) => [u.id, u]));

  const filtered = list.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || c.status === statusFilter;
    const matchesOwner = ownerFilter === "all" || c.createdBy === ownerFilter;
    return matchesSearch && matchesStatus && matchesOwner;
  });

  const counts: Record<CampaignStatus | "All", number> = {
    All:    list.length,
    Draft:  list.filter((c) => c.status === "Draft").length,
    Live:   list.filter((c) => c.status === "Live").length,
    Paused: list.filter((c) => c.status === "Paused").length,
  };

  return (
    <div className="max-w-5xl mx-auto p-8 space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-1">Outreach</p>
        <h1 className="text-2xl font-bold">Campaigns</h1>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search campaigns…"
          wrapperClassName="flex-1 min-w-[200px] max-w-xs"
        />
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
              <span className={cn("ml-1.5 tabular-nums", statusFilter === s ? "opacity-70" : "opacity-50")}>
                {counts[s]}
              </span>
            </button>
          ))}
        </div>
        {role === "manager" && users.length > 0 && (
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="h-9 w-40 bg-card"><SelectValue placeholder="Owner" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          message={
            list.length === 0
              ? "No campaigns yet. Create one to start sending outreach emails."
              : "No campaigns match your filters."
          }
        />
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
                  onClick={() => router.push(`/campaigns/${c.id}`)}
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
                      {role === "manager" && c.createdBy && userMap.has(c.createdBy) && (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <User className="size-3" />
                          {userMap.get(c.createdBy)?.full_name || userMap.get(c.createdBy)?.email}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-px shrink-0 pr-8">
                    {[
                      { label: "Leads", value: c.leads, color: "text-foreground" },
                      { label: "Sent", value: c.sent, color: "text-foreground" },
                      { label: "Replied", value: c.replied, color: "text-green-400" },
                      { label: "Reply rate", value: `${replyRate}%`, color: replyRate > 0 ? "text-green-400" : "text-muted-foreground" },
                    ].map(({ label, value, color }, idx) => (
                      <div key={label} className={cn("text-center px-5 py-1", idx < 3 && "border-r border-border")}>
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

      <ConfirmDialog
        open={!!deletingCampaign}
        title={`Delete "${deletingCampaign?.name}"?`}
        description="This will permanently delete the campaign and all its leads, drafts, and send history. This cannot be undone."
        loading={deleteCampaignLoading}
        onClose={() => { if (!deleteCampaignLoading) setDeletingCampaign(null); }}
        onConfirm={async () => {
          if (!deletingCampaign || !session || deleteCampaignLoading) return;
          const id = deletingCampaign.id;
          setDeleteCampaignLoading(true);
          try {
            await deleteCampaign(session.access_token, id);
            setCampaigns((prev) => prev.filter((c) => c.id !== id));
            setDeletingCampaign(null);
            toast.success("Campaign deleted");
            router.refresh();
          } catch (e) {
            toast.error((e as Error).message || "Failed to delete campaign");
          } finally {
            setDeleteCampaignLoading(false);
          }
        }}
      />
    </div>
  );
}
