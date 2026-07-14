"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, RefreshCw, Eye, EyeOff } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/leads/lead-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  fetchUsers, createUser, patchUser,
  fetchOversight,
  type Profile, type Territory,
} from "@/lib/api-client";

const TERRITORY_OPTIONS: { value: Territory; label: string; short: string }[] = [
  { value: "india",   label: "India",                   short: "India" },
  { value: "foreign", label: "Foreign (rest of world)", short: "Foreign" },
];

function territoryShort(value: string | null | undefined): string {
  if (!value) return "None";
  if (value === "europe") return "Foreign";
  return TERRITORY_OPTIONS.find((t) => t.value === value)?.short ?? value;
}

function territorySelectValue(value: string | null | undefined): string {
  if (!value) return "none";
  if (value === "europe") return "foreign";
  return value;
}

function roleLabel(u: Profile): string {
  if (u.is_super_admin) return "Super Admin";
  return u.role === "manager" ? "Manager" : "Employee";
}

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
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!loadingSession && role !== "manager") router.replace("/dashboard");
  }, [loadingSession, role, router]);

  useEffect(() => {
    if (!session || role !== "manager") return;
    setLoading(true);
    Promise.all([
      fetchUsers(session.access_token),
      fetchOversight(session.access_token),
    ])
      .then(([u, o]) => {
        setUsers(u);
        setCounts(Object.fromEntries(o.employees.map((e) => [e.id, { assigned_lead_count: e.assigned_lead_count, campaign_count: e.campaign_count }])));
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
      setEmail(""); setPassword(""); setFullName(""); setNewRole("employee"); setTerritory(""); setShowPassword(false);
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

  const me = users.find((u) => u.id === session?.user.id);
  const isSuperAdmin = me?.is_super_admin ?? false;
  const activeCount = users.filter((u) => u.is_active).length;

  if (loadingSession || role !== "manager") return null;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight">Users</h2>
            {!loading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {activeCount} active · {users.length} total
              </p>
            )}
          </div>
          <Button size="sm" onClick={() => setShowAdd((v) => !v)}>
            <UserPlus className="size-3.5 mr-1.5" /> Add user
          </Button>
        </div>

        {showAdd && (
          <form
            onSubmit={handleCreate}
            className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-5 py-4 border-b border-border bg-secondary/20"
          >
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
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
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
              <div className="space-y-1.5 sm:col-span-2">
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
            <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>
                {saving && <RefreshCw className="size-3.5 mr-1.5 animate-spin" />} Create
              </Button>
            </div>
          </form>
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground px-5 py-10 text-center">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-muted-foreground px-5 py-10 text-center">No users yet. Add one to get started.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="pl-5 text-xs font-semibold text-muted-foreground">User</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground w-30">Workload</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground w-34">Role</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground w-34">Territory</TableHead>
                <TableHead className="text-xs font-semibold text-muted-foreground w-26">Status</TableHead>
                <TableHead className="pr-5 text-xs font-semibold text-muted-foreground text-right w-30">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const canEditRole = !u.is_super_admin && isSuperAdmin;
                const canToggleActive = !u.is_super_admin && (isSuperAdmin || u.role === "employee");
                const leadCount = counts[u.id]?.assigned_lead_count ?? 0;
                const campaignCount = counts[u.id]?.campaign_count ?? 0;
                const displayName = u.full_name || u.email;

                return (
                  <TableRow
                    key={u.id}
                    className={cn(
                      "border-border hover:bg-secondary/40",
                      !u.is_active && "opacity-60",
                    )}
                  >
                    <TableCell className="pl-5 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={displayName} size="sm" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <p className="text-sm font-semibold truncate">{displayName}</p>
                            {u.is_super_admin && (
                              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/25">
                                Super Admin
                              </span>
                            )}
                            {u.role === "employee" && u.is_active && !u.territory && (
                              <span
                                className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/25"
                                title="Excluded from territory routing until a territory is set"
                              >
                                No territory
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="py-3">
                      {u.role === "employee" ? (
                        <div className="flex flex-col gap-0.5 text-xs tabular-nums">
                          <span className="text-foreground">{leadCount} <span className="text-muted-foreground">leads</span></span>
                          <span className="text-foreground">{campaignCount} <span className="text-muted-foreground">campaigns</span></span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="py-3">
                      {canEditRole ? (
                        <Select value={u.role} onValueChange={(v) => handlePatch(u.id, { role: v as "manager" | "employee" })}>
                          <SelectTrigger className="h-9 w-30 bg-card"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="employee">Employee</SelectItem>
                            <SelectItem value="manager">Manager</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="inline-flex h-9 items-center px-2.5 rounded-md border border-border bg-secondary/40 text-xs text-muted-foreground">
                          {roleLabel(u)}
                        </span>
                      )}
                    </TableCell>

                    <TableCell className="py-3">
                      {u.role === "employee" ? (
                        <Select
                          value={territorySelectValue(u.territory)}
                          onValueChange={(v) => handlePatch(u.id, { territory: v === "none" ? null : (v as Territory) })}
                        >
                          <SelectTrigger className="h-9 w-30 bg-card" title={u.territory ? TERRITORY_OPTIONS.find((t) => t.value === territorySelectValue(u.territory))?.label ?? "Foreign (rest of world)" : "No territory"}>
                            <SelectValue>{territoryShort(u.territory)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No territory</SelectItem>
                            {TERRITORY_OPTIONS.map((t) => (
                              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>

                    <TableCell className="py-3">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 text-xs font-medium",
                          u.is_active ? "text-emerald-400" : "text-muted-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            u.is_active ? "bg-emerald-400" : "bg-muted-foreground/50",
                          )}
                          aria-hidden
                        />
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>

                    <TableCell className="pr-5 py-3 text-right">
                      {canToggleActive ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className={cn(
                            "h-8 text-xs",
                            u.is_active
                              ? "border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-400",
                          )}
                          onClick={() => handlePatch(u.id, { is_active: !u.is_active })}
                        >
                          {u.is_active ? "Deactivate" : "Reactivate"}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
