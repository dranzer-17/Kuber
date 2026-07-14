"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useApp } from "@/lib/app-context";
import {
  assignCampaign, deleteCampaign, fetchUsers, pauseCampaign, resumeCampaign, type Profile,
} from "@/lib/api-client";
import type { Campaign } from "@/components/app/create-campaign-modal";
import { Pause, Play, Trash2, User, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const [pausingCampaign, setPausingCampaign] = useState<Campaign | null>(null);
  const [pauseLoading, setPauseLoading] = useState(false);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [assigningCampaign, setAssigningCampaign] = useState<Campaign | null>(null);
  const [assignTarget, setAssignTarget] = useState<string>("pool");
  const [reassignLeads, setReassignLeads] = useState(true);
  const [assignLoading, setAssignLoading] = useState(false);

  useEffect(() => {
    if (role !== "manager" || !session) return;
    fetchUsers(session.access_token).then(setUsers).catch(() => {});
  }, [role, session]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const activeEmployees = users.filter((u) => u.role === "employee" && u.is_active);

  function displayName(userId: string | null | undefined): string | null {
    if (!userId) return null;
    const u = userMap.get(userId);
    return u ? (u.full_name || u.email) : null;
  }

  const filtered = list.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "All" || c.status === statusFilter;
    const matchesOwner = ownerFilter === "all" || c.createdBy === ownerFilter || c.assignedTo === ownerFilter;
    return matchesSearch && matchesStatus && matchesOwner;
  });

  const counts: Record<CampaignStatus | "All", number> = {
    All:    list.length,
    Draft:  list.filter((c) => c.status === "Draft").length,
    Live:   list.filter((c) => c.status === "Live").length,
    Paused: list.filter((c) => c.status === "Paused").length,
  };

  function openAssignModal(c: Campaign) {
    setAssigningCampaign(c);
    setAssignTarget(c.assignedTo ?? "pool");
    setReassignLeads(true);
  }

  async function handleResume(c: Campaign) {
    if (!session || resumingId) return;
    setResumingId(c.id);
    try {
      const res = await resumeCampaign(session.access_token, c.id);
      if (res.errors.length > 0) {
        toast.warning(`Resumed ${res.resumed} region(s); ${res.errors.length} failed. Try again for the rest.`);
      } else {
        toast.success("Campaign resumed — Instantly is sending again");
      }
      setCampaigns((prev) => prev.map((x) => (x.id === c.id ? { ...x, status: "Live" } : x)));
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Failed to resume campaign");
    } finally {
      setResumingId(null);
    }
  }

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
            const assigneeName = role === "manager" ? displayName(c.assignedTo) : null;
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
                    <div className="flex items-center gap-3 flex-wrap">
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
                          {displayName(c.createdBy)}
                        </span>
                      )}
                      {assigneeName && (
                        <span className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border text-primary bg-primary/10 border-primary/20">
                          <UserPlus className="size-3" />
                          {assigneeName}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-px shrink-0 pr-24">
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
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-all">
                  {role === "manager" && (
                    <button
                      type="button"
                      title="Assign campaign to an employee"
                      onClick={() => openAssignModal(c)}
                      className="p-2 rounded-lg text-muted-foreground/50 hover:text-primary hover:bg-primary/10 transition-colors"
                    >
                      <UserPlus className="size-4" />
                    </button>
                  )}
                  {c.status === "Live" && (
                    <button
                      type="button"
                      title="Pause campaign (stops all sending, incl. follow-ups)"
                      onClick={() => setPausingCampaign(c)}
                      className="p-2 rounded-lg text-muted-foreground/50 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
                    >
                      <Pause className="size-4" />
                    </button>
                  )}
                  {c.status === "Paused" && (
                    <button
                      type="button"
                      title="Resume campaign"
                      disabled={resumingId === c.id}
                      onClick={() => void handleResume(c)}
                      className="p-2 rounded-lg text-muted-foreground/50 hover:text-green-400 hover:bg-green-500/10 transition-colors disabled:opacity-50"
                    >
                      <Play className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Delete campaign"
                    onClick={() => setDeletingCampaign(c)}
                    className="p-2 rounded-lg text-muted-foreground/50 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
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

      <ConfirmDialog
        open={!!pausingCampaign}
        title={`Pause "${pausingCampaign?.name}"?`}
        description="Instantly stops sending this campaign, including scheduled follow-ups, until you resume it. Conversations already started are unaffected."
        loading={pauseLoading}
        onClose={() => { if (!pauseLoading) setPausingCampaign(null); }}
        onConfirm={async () => {
          if (!pausingCampaign || !session || pauseLoading) return;
          const id = pausingCampaign.id;
          setPauseLoading(true);
          try {
            const res = await pauseCampaign(session.access_token, id);
            if (res.errors.length > 0) {
              toast.warning(`Paused ${res.paused} region(s); ${res.errors.length} failed. Try again for the rest.`);
            } else {
              toast.success("Campaign paused — Instantly has stopped sending");
            }
            setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status: "Paused" } : c)));
            setPausingCampaign(null);
            router.refresh();
          } catch (e) {
            toast.error((e as Error).message || "Failed to pause campaign");
          } finally {
            setPauseLoading(false);
          }
        }}
      />

      {/* Assign campaign modal (managers only) */}
      {assigningCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!assignLoading) setAssigningCampaign(null); }} />
          <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 space-y-5 shadow-xl">
            <div>
              <p className="font-semibold text-sm">Assign &quot;{assigningCampaign.name}&quot;</p>
              <p className="text-xs text-muted-foreground mt-1">
                The assignee sees this campaign, its drafts, and every reply in their inbox. One assignee at a time — assigning someone new replaces the current one.
              </p>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Assign to</p>
              <Select value={assignTarget} onValueChange={setAssignTarget}>
                <SelectTrigger className="h-9 w-full bg-card"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pool">Nobody (manager pool)</SelectItem>
                  {activeEmployees.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assigningCampaign.assignedTo && (
                <p className="text-[11px] text-muted-foreground">
                  Currently assigned to {displayName(assigningCampaign.assignedTo) ?? "an inactive user"}.
                </p>
              )}
            </div>

            <label className={cn(
              "flex items-start gap-2.5 rounded-lg border border-border p-3 text-xs cursor-pointer transition-colors hover:bg-secondary/30",
              assignTarget === "pool" && "opacity-50 pointer-events-none",
            )}>
              <input
                type="checkbox"
                checked={reassignLeads}
                onChange={(e) => setReassignLeads(e.target.checked)}
                className="mt-0.5 accent-[var(--primary)]"
              />
              <span>
                <span className="font-medium text-foreground">Also assign this campaign&apos;s leads to them</span>
                <br />
                <span className="text-muted-foreground">Keeps the Leads table and the inbox consistent. Untick if this campaign&apos;s leads are split between people.</span>
              </span>
            </label>

            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={assignLoading} onClick={() => setAssigningCampaign(null)}>Cancel</Button>
              <Button
                disabled={assignLoading || !session}
                onClick={async () => {
                  if (!assigningCampaign || !session || assignLoading) return;
                  const id = assigningCampaign.id;
                  const target = assignTarget === "pool" ? null : assignTarget;
                  setAssignLoading(true);
                  try {
                    const res = await assignCampaign(session.access_token, id, target, target ? reassignLeads : false);
                    const name = target ? (displayName(target) ?? "employee") : null;
                    toast.success(
                      target
                        ? `Assigned to ${name}${res.leads_reassigned > 0 ? ` (+${res.leads_reassigned} leads)` : ""}`
                        : "Returned to the manager pool",
                    );
                    setCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, assignedTo: target } : c)));
                    setAssigningCampaign(null);
                    router.refresh();
                  } catch (e) {
                    toast.error((e as Error).message || "Failed to assign campaign");
                  } finally {
                    setAssignLoading(false);
                  }
                }}
              >
                {assignLoading ? "Assigning…" : "Assign"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
