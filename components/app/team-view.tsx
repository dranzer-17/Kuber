"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, Shield, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  fetchUsers, createUser, patchUser,
  fetchAssignmentSettings, patchAssignmentSettings,
  fetchOversight,
  type Profile,
} from "@/lib/api-client";

const STRATEGIES = [
  { value: "manual", label: "Manual", description: "Manager assigns each lead by hand — at creation or later." },
  { value: "round_robin", label: "Round robin", description: "New enriched leads rotate evenly across all active employees." },
  { value: "territory", label: "Territory-based", description: "Leads route to employees by territory (India vs. foreign) based on lead country." },
] as const;

export function TeamView() {
  const router = useRouter();
  const { session, role, loadingSession } = useApp();

  const [users, setUsers] = useState<Profile[]>([]);
  const [counts, setCounts] = useState<Record<string, { assigned_lead_count: number; campaign_count: number }>>({});
  const [strategy, setStrategy] = useState<"round_robin" | "territory" | "manual">("manual");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [newRole, setNewRole] = useState<"manager" | "employee">("employee");
  const [territory, setTerritory] = useState<"india" | "foreign" | "">("");

  useEffect(() => {
    if (!loadingSession && role !== "manager") router.replace("/dashboard");
  }, [loadingSession, role, router]);

  useEffect(() => {
    if (!session || role !== "manager") return;
    setLoading(true);
    Promise.all([fetchUsers(session.access_token), fetchAssignmentSettings(session.access_token), fetchOversight(session.access_token)])
      .then(([u, a, o]) => {
        setUsers(u);
        setStrategy(a.strategy);
        setCounts(Object.fromEntries(o.employees.map((e) => [e.id, { assigned_lead_count: e.assigned_lead_count, campaign_count: e.campaign_count }])));
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [session, role]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setSaving(true);
    try {
      const created = await createUser(session.access_token, {
        email, password, full_name: fullName, role: newRole,
        territory: newRole === "employee" && territory ? territory : null,
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

  async function handlePatch(id: string, patch: Partial<{ role: "manager" | "employee"; territory: "india" | "foreign" | null; is_active: boolean }>) {
    if (!session) return;
    try {
      const updated = await patchUser(session.access_token, id, patch);
      setUsers((prev) => prev.map((u) => (u.id === id ? updated : u)));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleStrategyChange(next: "round_robin" | "territory" | "manual") {
    if (!session) return;
    setStrategy(next);
    try {
      await patchAssignmentSettings(session.access_token, next);
      toast.success("Assignment strategy updated");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (loadingSession || role !== "manager") return null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2"><Shield className="size-5" /> Team & Assignment</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage Manager/Employee accounts and how leads route to employees.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <h2 className="text-sm font-semibold">Assignment strategy</h2>
        <div className="grid gap-2">
          {STRATEGIES.map((s) => (
            <label
              key={s.value}
              className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer hover:bg-secondary/40 has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="strategy"
                className="mt-1"
                checked={strategy === s.value}
                onChange={() => handleStrategyChange(s.value)}
              />
              <div>
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.description}</p>
              </div>
            </label>
          ))}
        </div>
      </div>

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
                <Label>Territory</Label>
                <Select value={territory} onValueChange={(v) => setTerritory(v as "india" | "foreign")}>
                  <SelectTrigger><SelectValue placeholder="No fixed territory" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="india">India</SelectItem>
                    <SelectItem value="foreign">Foreign</SelectItem>
                  </SelectContent>
                </Select>
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
                  <p className="text-sm font-medium truncate">{u.full_name || u.email}</p>
                  <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                </div>
                {u.role === "employee" && (
                  <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
                    <span>{counts[u.id]?.assigned_lead_count ?? 0} leads</span>
                    <span>{counts[u.id]?.campaign_count ?? 0} campaigns</span>
                  </div>
                )}
                <Select value={u.role} onValueChange={(v) => handlePatch(u.id, { role: v as "manager" | "employee" })}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
                {u.role === "employee" && (
                  <Select
                    value={u.territory ?? "none"}
                    onValueChange={(v) => handlePatch(u.id, { territory: v === "none" ? null : (v as "india" | "foreign") })}
                  >
                    <SelectTrigger className="w-32"><SelectValue placeholder="Territory" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No territory</SelectItem>
                      <SelectItem value="india">India</SelectItem>
                      <SelectItem value="foreign">Foreign</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="sm"
                  variant={u.is_active ? "ghost" : "outline"}
                  onClick={() => handlePatch(u.id, { is_active: !u.is_active })}
                >
                  {u.is_active ? "Deactivate" : "Reactivate"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
