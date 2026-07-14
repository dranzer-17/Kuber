"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, RefreshCw, Shuffle } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  fetchUsers, createUser, patchUser,
  fetchOversight, fetchAssignmentSettings, patchAssignmentSettings,
  type Profile, type Territory,
} from "@/lib/api-client";

const TERRITORY_OPTIONS: { value: Territory; label: string }[] = [
  { value: "india",   label: "India" },
  { value: "europe",  label: "Europe" },
  { value: "foreign", label: "Foreign (rest of world)" },
];

const AUTO_ASSIGN_OPTIONS: { value: "manual" | "round_robin" | "territory"; label: string; description: string }[] = [
  { value: "manual",      label: "Off (manual)",  description: "Newly enriched leads wait in the manager pool until someone assigns them." },
  { value: "round_robin", label: "Round-robin",   description: "Spread across all active employees, least-loaded first." },
  { value: "territory",   label: "By territory",  description: "India → India reps, Europe → Europe reps, everything else → Foreign reps." },
];

export function TeamView() {
  const router = useRouter();
  const { session, role, loadingSession } = useApp();

  const [users, setUsers] = useState<Profile[]>([]);
  const [counts, setCounts] = useState<Record<string, { assigned_lead_count: number; campaign_count: number }>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [newRole, setNewRole] = useState<"manager" | "employee">("employee");
  const [territory, setTerritory] = useState<Territory | "">("");

  const [autoStrategy, setAutoStrategy] = useState<"manual" | "round_robin" | "territory">("manual");
  const [savingStrategy, setSavingStrategy] = useState(false);

  useEffect(() => {
    if (!loadingSession && role !== "manager") router.replace("/dashboard");
  }, [loadingSession, role, router]);

  useEffect(() => {
    if (!session || role !== "manager") return;
    setLoading(true);
    Promise.all([
      fetchUsers(session.access_token),
      fetchOversight(session.access_token),
      fetchAssignmentSettings(session.access_token).catch(() => ({ strategy: "manual" as const })),
    ])
      .then(([u, o, a]) => {
        setUsers(u);
        setCounts(Object.fromEntries(o.employees.map((e) => [e.id, { assigned_lead_count: e.assigned_lead_count, campaign_count: e.campaign_count }])));
        setAutoStrategy(a.strategy as "manual" | "round_robin" | "territory");
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [session, role]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (newRole === "employee" && !territory) {
      toast.error("Pick a territory — employees need one for lead routing.");
      return;
    }
    setSaving(true);
    try {
      const created = await createUser(session.access_token, {
        email, password, full_name: fullName, role: newRole,
        territory: newRole === "employee" ? (territory as Territory) : null,
      });
      setUsers((prev) => [...prev, created]);
      setShowAdd(false);
      setEmail(""); setPassword(""); setFullName(""); setNewRole("employee"); setTerritory("");
      toast.success("User created");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePatch(id: string, patch: Partial<{ role: "manager" | "employee"; territory: Territory | null; is_active: boolean }>) {
    if (!session) return;
    try {
      const updated = await patchUser(session.access_token, id, patch) as Profile & { held_campaigns?: number; held_leads?: number };
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
      // Deactivation must never silently strand work (planning.md Phase 2.2).
      if (patch.is_active === false && ((updated.held_campaigns ?? 0) > 0 || (updated.held_leads ?? 0) > 0)) {
        toast.warning(
          `${updated.full_name || updated.email} still holds ${updated.held_campaigns ?? 0} campaign(s) and ${updated.held_leads ?? 0} lead(s) — reassign them from the Campaigns and Leads pages.`,
          { duration: 10000 },
        );
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleStrategyChange(next: "manual" | "round_robin" | "territory") {
    if (!session || savingStrategy) return;
    const prev = autoStrategy;
    setAutoStrategy(next);
    setSavingStrategy(true);
    try {
      await patchAssignmentSettings(session.access_token, next);
      toast.success("Auto-assignment updated");
    } catch (e) {
      setAutoStrategy(prev);
      toast.error((e as Error).message);
    } finally {
      setSavingStrategy(false);
    }
  }

  const me = users.find((u) => u.id === session?.user.id);
  const isSuperAdmin = me?.is_super_admin ?? false;
  const activeEmployees = users.filter((u) => u.role === "employee" && u.is_active);
  const territoriesCovered = new Set(activeEmployees.map((u) => u.territory).filter(Boolean));
  const missingTerritories = autoStrategy === "territory"
    ? TERRITORY_OPTIONS.filter((t) => !territoriesCovered.has(t.value)).map((t) => t.label)
    : [];

  if (loadingSession || role !== "manager") return null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Users</h2>
          <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
            <UserPlus className="size-3.5 mr-1.5" /> Add user
          </Button>
        </div>

        {showAdd && (
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-3 rounded-lg border border-border p-4">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as "manager" | "employee")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newRole === "employee" && (
              <div className="space-y-1.5 col-span-2">
                <Label>Territory <span className="text-destructive">*</span></Label>
                <Select value={territory} onValueChange={(v) => setTerritory(v as Territory)}>
                  <SelectTrigger><SelectValue placeholder="Pick a territory (required)" /></SelectTrigger>
                  <SelectContent>
                    {TERRITORY_OPTIONS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Decides which leads route to them under territory-based assignment.</p>
              </div>
            )}
            <div className="col-span-2 flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <RefreshCw className="size-3.5 mr-1.5 animate-spin" />} Create
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : (
          <div className="divide-y divide-border">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate flex items-center gap-1.5">
                    {u.full_name || u.email}
                    {u.is_super_admin && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/25">
                        Super Admin
                      </span>
                    )}
                    {u.role === "employee" && u.is_active && !u.territory && (
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/25"
                        title="Excluded from territory routing until a territory is set"
                      >
                        No territory
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
                {u.role === "employee" && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
                    <span>{counts[u.id]?.assigned_lead_count ?? 0} leads</span>
                    <span>{counts[u.id]?.campaign_count ?? 0} campaigns</span>
                  </div>
                )}
                {(() => {
                  // Super Admin's role is locked for everyone; role changes of any
                  // kind are Super-Admin-only (a regular manager can no longer
                  // demote a peer — planning.md D5/Q3).
                  const canEditRole = !u.is_super_admin && isSuperAdmin;
                  if (!canEditRole) {
                    return (
                      <div className="w-32 h-9 px-3 flex items-center rounded-md border border-border bg-secondary/40 text-sm text-muted-foreground">
                        {u.is_super_admin ? "Super Admin" : u.role === "manager" ? "Manager" : "Employee"}
                      </div>
                    );
                  }
                  return (
                    <Select value={u.role} onValueChange={(v) => handlePatch(u.id, { role: v as "manager" | "employee" })}>
                      <SelectTrigger className="w-32 bg-card"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="employee">Employee</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                      </SelectContent>
                    </Select>
                  );
                })()}
                {u.role === "employee" && (
                  <Select
                    value={u.territory ?? "none"}
                    onValueChange={(v) => handlePatch(u.id, { territory: v === "none" ? null : (v as Territory) })}
                  >
                    <SelectTrigger className="w-40"><SelectValue placeholder="Territory" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No territory</SelectItem>
                      {TERRITORY_OPTIONS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {!u.is_super_admin && (isSuperAdmin || u.role === "employee") && (
                  <Button
                    size="sm"
                    variant={u.is_active ? "ghost" : "outline"}
                    onClick={() => handlePatch(u.id, { is_active: !u.is_active })}
                  >
                    {u.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-assignment of newly enriched leads (planning.md Phase 4.4) */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Shuffle className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Auto-assignment of new leads</h2>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          How freshly enriched, unassigned leads are routed to employees. Bulk-assign on the Leads page and import-time assignment always work regardless of this setting.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {AUTO_ASSIGN_OPTIONS.map((opt) => {
            const active = autoStrategy === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={savingStrategy}
                onClick={() => void handleStrategyChange(opt.value)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                  active ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground",
                )}
              >
                <p className="text-sm font-medium">{opt.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{opt.description}</p>
              </button>
            );
          })}
        </div>
        {missingTerritories.length > 0 && (
          <p className="text-xs text-amber-400">
            No active employee covers: {missingTerritories.join(", ")}. Leads from those regions will stay in the manager pool
            {missingTerritories.includes("Europe") ? " (Europe falls back to Foreign reps if any exist)" : ""}.
          </p>
        )}
      </div>
    </div>
  );
}
