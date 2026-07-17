"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Plus, Eye, EyeOff, RefreshCw, ArrowUp, ArrowDown, Trash2, ShieldCheck } from "lucide-react";
import { useApp } from "@/lib/app-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  fetchProviderKeys, createProviderKey, patchProviderKey, deleteProviderKey,
  reorderProviderKeys, checkProviderKey, setProviderModel, setLlmTierRoles,
  type ProviderConfig, type ProviderKey, type LlmTierRoles,
} from "@/lib/api-client";

const OTHER_MODEL = "__other__";
type TierRole = "primary" | "fallback";

function statusMeta(status: ProviderKey["status"]): { label: string; dot: string; text: string } {
  if (status === "healthy") return { label: "Healthy", dot: "bg-emerald-400", text: "text-emerald-400" };
  if (status === "cooling_off") return { label: "Cooling off", dot: "bg-amber-400", text: "text-amber-400" };
  return { label: "Dead", dot: "bg-destructive", text: "text-destructive" };
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function KeysView() {
  const { session } = useApp();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [tierRoles, setTierRoles] = useState<LlmTierRoles>({ primary: null, fallback: null });
  const [tierOrder, setTierOrder] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState(false);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    fetchProviderKeys(session.access_token)
      .then((data) => { setProviders(data.providers); setTierRoles(data.tierRoles); setTierOrder(data.tierOrder); })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [session]);

  async function reload() {
    if (!session) return;
    try {
      const data = await fetchProviderKeys(session.access_token);
      setProviders(data.providers); setTierRoles(data.tierRoles); setTierOrder(data.tierOrder);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // Clicking an already-active role clears it (back to default order).
  // Clicking a provider's OTHER role moves it there and clears whichever
  // role it previously held, so a provider can never end up holding both —
  // the server also rejects primary === fallback as defense in depth, but
  // this keeps the common case (toggling one provider between the two
  // roles) from ever hitting that rejection in the first place.
  async function handleSetRole(providerId: string, role: TierRole) {
    if (!session) return;
    const settingThisRole = tierRoles[role] !== providerId;
    let primary = tierRoles.primary;
    let fallback = tierRoles.fallback;

    if (role === "primary") {
      primary = settingThisRole ? providerId : null;
      if (settingThisRole && fallback === providerId) fallback = null;
    } else {
      fallback = settingThisRole ? providerId : null;
      if (settingThisRole && primary === providerId) primary = null;
    }

    setSavingRole(true);
    try {
      const updated = await setLlmTierRoles(session.access_token, { primary, fallback });
      toast.success("Provider order updated");
      setTierRoles(updated);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingRole(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground px-5 py-10 text-center">Loading provider keys…</p>;
  }

  const llmProviders = providers.filter((p) => p.category === "llm");
  const scrapeProviders = providers.filter((p) => p.category === "scrape");
  const labelById = new Map(providers.map((p) => [p.id, p.label]));

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6 enter">
      <div className="space-y-1">
        <p className="eyebrow px-1">Settings · Keys</p>
        <h2 className="font-display text-lg font-semibold px-1">Provider API keys</h2>
        <p className="text-xs text-muted-foreground px-1">
          Add multiple keys per provider — if one runs low or fails, the next one takes over automatically.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <p className="eyebrow">LLM providers</p>
          {tierOrder.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Try order: {tierOrder.map((id) => labelById.get(id) ?? id).join(" → ")}
            </p>
          )}
        </div>
        <div className="space-y-4">
          {llmProviders.map((p) => (
            <ProviderCard
              key={p.id}
              config={p}
              onChanged={reload}
              tierRole={tierRoles.primary === p.id ? "primary" : tierRoles.fallback === p.id ? "fallback" : null}
              onSetRole={handleSetRole}
              savingRole={savingRole}
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <p className="eyebrow px-1">Scrape providers</p>
        <div className="space-y-4">
          {scrapeProviders.map((p) => (
            <ProviderCard key={p.id} config={p} onChanged={reload} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ProviderCard({ config, onChanged, tierRole, onSetRole, savingRole }: {
  config: ProviderConfig;
  onChanged: () => Promise<void>;
  /** This provider's current spot in the LLM try-order, if any (LLM providers only). */
  tierRole?: TierRole | null;
  onSetRole?: (providerId: string, role: TierRole) => Promise<void>;
  savingRole?: boolean;
}) {
  const { session } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderKey | null>(null);
  const [deleting, setDeleting] = useState(false);

  const keys = [...config.keys].sort((a, b) => a.priority - b.priority);
  const [modelMode, setModelMode] = useState<"preset" | "other">(
    config.modelInputMode === "dropdown" && config.selectedModel && !config.modelOptions.includes(config.selectedModel) ? "other" : "preset",
  );
  const [modelDraft, setModelDraft] = useState(config.selectedModel ?? "");

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (!label.trim() || !secret.trim()) {
      toast.error("Label and key are both required.");
      return;
    }
    setSaving(true);
    try {
      await createProviderKey(session.access_token, { provider: config.id, label: label.trim(), secret: secret.trim() });
      toast.success(`Key added for ${config.label}`);
      setLabel(""); setSecret(""); setShowSecret(false); setShowAdd(false);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePatch(key: ProviderKey, patch: Partial<{ is_active: boolean; status: ProviderKey["status"] }>) {
    if (!session) return;
    setBusyKeyId(key.id);
    try {
      await patchProviderKey(session.access_token, key.id, patch);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKeyId(null);
    }
  }

  async function handleCheck(key: ProviderKey) {
    if (!session) return;
    setBusyKeyId(key.id);
    try {
      const result = await checkProviderKey(session.access_token, key.id);
      toast[result.ok ? "success" : "error"](result.message);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKeyId(null);
    }
  }

  async function handleMove(index: number, direction: -1 | 1) {
    if (!session) return;
    const target = index + direction;
    if (target < 0 || target >= keys.length) return;
    const reordered = [...keys];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    try {
      await reorderProviderKeys(session.access_token, config.id, reordered.map((k) => k.id));
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDelete() {
    if (!session || !deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProviderKey(session.access_token, deleteTarget.id);
      toast.success("Key removed");
      setDeleteTarget(null);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleModelSave(model: string | null) {
    if (!session) return;
    try {
      await setProviderModel(session.access_token, config.id, model);
      toast.success(`${config.label} model updated`);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden min-w-0">
      <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-border">
        <div className="min-w-0 flex items-center gap-2.5">
          <div className="shrink-0 size-8 rounded-md bg-secondary/60 flex items-center justify-center">
            <KeyRound className="size-4 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold">{config.label}</p>
            <p className="text-xs text-muted-foreground">
              {keys.length === 0 ? "No keys configured — currently using the .env.local value" : `${keys.length} key${keys.length !== 1 ? "s" : ""} configured`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onSetRole && (
            <div className="flex items-center gap-1">
              {(["primary", "fallback"] as const).map((role) => {
                const active = tierRole === role;
                return (
                  <Button
                    key={role}
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-7 px-2.5 text-[11px] capitalize"
                    disabled={savingRole}
                    onClick={() => void onSetRole(config.id, role)}
                    title={active ? `Click to clear ${role}` : `Set as ${role}`}
                  >
                    {role}
                  </Button>
                );
              })}
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="size-3.5 mr-1.5" /> Add key
          </Button>
        </div>
      </div>

      {config.modelInputMode !== "none" && (
        <div className="flex items-center gap-3 px-5 py-3 border-b border-border bg-secondary/10">
          <Label className="text-xs shrink-0 w-16">Model</Label>
          {config.modelInputMode === "dropdown" ? (
            <>
              <Select
                value={modelMode === "other" ? OTHER_MODEL : (config.selectedModel || config.defaultModel || "")}
                onValueChange={(v) => {
                  if (v === OTHER_MODEL) { setModelMode("other"); return; }
                  setModelMode("preset");
                  void handleModelSave(v);
                }}
              >
                <SelectTrigger className="h-8 w-56 bg-card text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {config.modelOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  <SelectItem value={OTHER_MODEL}>Other…</SelectItem>
                </SelectContent>
              </Select>
              {modelMode === "other" && (
                <div className="flex items-center gap-2">
                  <Input
                    value={modelDraft}
                    onChange={(e) => setModelDraft(e.target.value)}
                    placeholder="exact model id"
                    className="h-8 w-48 text-xs"
                  />
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => void handleModelSave(modelDraft.trim() || null)}>Save</Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={modelDraft}
                onChange={(e) => setModelDraft(e.target.value)}
                placeholder={config.defaultModel ?? "model id"}
                className="h-8 w-64 text-xs"
              />
              <Button size="sm" variant="ghost" className="h-8" onClick={() => void handleModelSave(modelDraft.trim() || null)}>Save</Button>
            </div>
          )}
        </div>
      )}

      {showAdd && (
        <form onSubmit={handleAdd} className="grid grid-cols-1 sm:grid-cols-2 gap-3 px-5 py-4 border-b border-border bg-secondary/20 enter">
          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Primary, Backup" required />
          </div>
          <div className="space-y-1.5">
            <Label>API key</Label>
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                required
                className="pr-9"
              />
              <Button
                type="button" variant="ghost" size="icon-sm"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute inset-y-0 right-0 h-full w-9 rounded-none text-muted-foreground hover:bg-transparent hover:text-foreground"
                tabIndex={-1}
                aria-label={showSecret ? "Hide key" : "Show key"}
              >
                {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
            </div>
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving && <RefreshCw className="size-3.5 mr-1.5 animate-spin" />} Add key
            </Button>
          </div>
        </form>
      )}

      {keys.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="pl-5 eyebrow">Label</TableHead>
              <TableHead className="eyebrow">Key</TableHead>
              <TableHead className="eyebrow">Status</TableHead>
              <TableHead className="eyebrow">Last used</TableHead>
              <TableHead className="pr-5 eyebrow text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key, index) => {
              const meta = statusMeta(key.status);
              const busy = busyKeyId === key.id;
              return (
                <TableRow key={key.id} className={cn("border-border hover:bg-secondary/40", !key.is_active && "opacity-60")}>
                  <TableCell className="pl-5 py-3 text-sm font-medium">{key.label}</TableCell>
                  <TableCell className="py-3 font-mono text-xs text-muted-foreground">•••••••{key.secret_last4}</TableCell>
                  <TableCell className="py-3">
                    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", meta.text)} title={key.last_error ?? undefined}>
                      <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
                      {meta.label}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-xs text-muted-foreground">{relativeTime(key.last_used_at)}</TableCell>
                  <TableCell className="pr-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon-sm" variant="ghost" disabled={index === 0 || busy} onClick={() => void handleMove(index, -1)} aria-label="Move up">
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button size="icon-sm" variant="ghost" disabled={index === keys.length - 1 || busy} onClick={() => void handleMove(index, 1)} aria-label="Move down">
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs" disabled={busy} onClick={() => void handleCheck(key)}>
                        {busy ? <RefreshCw className="size-3.5 animate-spin" /> : "Re-check"}
                      </Button>
                      {key.status === "dead" && (
                        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => void handlePatch(key, { status: "healthy" })} aria-label="Clear dead status" title="Mark healthy again">
                          <ShieldCheck className="size-3.5 text-emerald-400" />
                        </Button>
                      )}
                      <Button
                        size="sm" variant="ghost" className="h-8 text-xs"
                        disabled={busy}
                        onClick={() => void handlePatch(key, { is_active: !key.is_active })}
                      >
                        {key.is_active ? "Disable" : "Enable"}
                      </Button>
                      <Button size="icon-sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(key)} aria-label="Remove key">
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          title="Remove this key?"
          description={`"${deleteTarget.label}" will be permanently deleted. Any traffic on it will fail over to the next key for ${config.label}, or to the .env.local value if none remain.`}
          confirmLabel="Remove"
          loading={deleting}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}
