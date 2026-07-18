"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  KeyRound, Plus, Eye, EyeOff, RefreshCw, Trash2, ShieldCheck,
  Pencil, Mail, X,
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  fetchProviderKeys, createProviderKey, patchProviderKey, deleteProviderKey,
  checkProviderKey, setProviderModel, setLlmTierRoles, setSendingAccounts,
  type ProviderConfig, type ProviderKey, type LlmTierRoles,
} from "@/lib/api-client";

const OTHER_MODEL = "__other__";
type TierRole = "primary" | "fallback";

function statusMeta(status: ProviderKey["status"]): { label: string; dot: string; text: string } {
  if (status === "healthy") return { label: "Healthy", dot: "bg-emerald-400", text: "text-emerald-400" };
  if (status === "cooling_off") return { label: "Cooling off", dot: "bg-amber-400", text: "text-amber-400" };
  return { label: "Dead", dot: "bg-destructive", text: "text-destructive" };
}

/** One line describing where a provider's credential is coming from. This is
 *  the thing an admin actually scans for, so it stays identical in shape for
 *  every provider: a dot, then the source. */
function ConfigSummary({ provider }: { provider: ProviderConfig }) {
  const active = provider.keys.filter((k) => k.is_active);
  const dead = active.filter((k) => k.status === "dead").length;

  if (active.length === 0 && provider.envFallback) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-sky-400" aria-hidden />
        Using .env.local value
      </span>
    );
  }
  if (active.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/40" aria-hidden />
        Not configured
      </span>
    );
  }
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 text-xs",
      dead > 0 ? "text-destructive" : "text-muted-foreground",
    )}>
      <span className={cn("size-1.5 rounded-full", dead > 0 ? "bg-destructive" : "bg-emerald-400")} aria-hidden />
      {active.length} key{active.length !== 1 ? "s" : ""}{dead > 0 ? ` · ${dead} dead` : ""}
    </span>
  );
}

export function KeysView() {
  const { session } = useApp();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [tierRoles, setTierRoles] = useState<LlmTierRoles>({ primary: null, fallback: null });
  const [tierOrder, setTierOrder] = useState<string[]>([]);
  const [sendingAccounts, setAccounts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingRole, setSavingRole] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<ProviderConfig | null>(null);

  const load = useCallback(async (initial = false) => {
    if (!session) return;
    if (initial) setLoading(true);
    try {
      const data = await fetchProviderKeys(session.access_token);
      setProviders(data.providers);
      setTierRoles(data.tierRoles);
      setTierOrder(data.tierOrder);
      setAccounts(data.sendingAccounts);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      if (initial) setLoading(false);
    }
  }, [session]);

  useEffect(() => { void load(true); }, [load]);

  // Clicking an already-active role clears it (back to default order).
  // Clicking a provider's OTHER role moves it there and clears whichever role
  // it previously held, so a provider can never hold both — the server also
  // rejects primary === fallback as defense in depth, but this keeps the
  // common case from ever hitting that rejection.
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
      await setLlmTierRoles(session.access_token, { primary, fallback });
      toast.success("Provider order updated");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingRole(false);
    }
  }

  const llmProviders = useMemo(() => providers.filter((p) => p.category === "llm"), [providers]);
  const serviceProviders = useMemo(() => providers.filter((p) => p.category === "service"), [providers]);
  const labelById = useMemo(() => new Map(providers.map((p) => [p.id, p.label])), [providers]);

  // Only providers the admin has actually set up appear in the list; the rest
  // live behind "Add provider". Showing all six unconfigured cards made the
  // page read as six broken integrations rather than one working one.
  const configuredLlm = llmProviders.filter((p) => p.keys.length > 0 || p.envFallback);
  const availableLlm = llmProviders.filter((p) => p.keys.length === 0 && !p.envFallback);

  if (loading) {
    return <p className="text-sm text-muted-foreground px-5 py-10 text-center">Loading provider keys…</p>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 enter">
      <div className="space-y-1">
        <p className="eyebrow px-1">Settings · Keys</p>
        <h2 className="font-display text-lg font-semibold px-1">API keys</h2>
        <p className="text-xs text-muted-foreground px-1">
          Credentials for the external services this app calls. Anything left unset
          falls back to the matching value in <code className="font-mono">.env.local</code>.
        </p>
      </div>

      {/* ── Services ─────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="px-1">
          <p className="eyebrow">Services</p>
          <p className="text-xs text-muted-foreground mt-1">
            Each one powers a specific feature — they are not interchangeable.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {serviceProviders.map((p) => (
            <ProviderRow
              key={p.id}
              provider={p}
              onManage={() => setEditing(p)}
            />
          ))}
        </div>
      </section>

      {/* ── Sending accounts ─────────────────────────────────────────────── */}
      <SendingAccountsCard
        emails={sendingAccounts}
        onSaved={(next) => setAccounts(next)}
      />

      {/* ── LLM providers ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4 px-1">
          <div className="min-w-0">
            <p className="eyebrow">LLM providers</p>
            <p className="text-xs text-muted-foreground mt-1">
              {configuredLlm.length === 0
                ? "None configured yet — drafts can't be generated until you add one."
                : <>Tried in order: {tierOrder.filter((id) => configuredLlm.some((p) => p.id === id)).map((id) => labelById.get(id) ?? id).join(" → ")}</>}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            disabled={availableLlm.length === 0}
            onClick={() => setAddOpen(true)}
            title={availableLlm.length === 0 ? "Every supported provider is already configured" : undefined}
          >
            <Plus className="size-3.5 mr-1.5" /> Add provider
          </Button>
        </div>

        {configuredLlm.length === 0 ? (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="w-full rounded-xl border border-dashed border-border bg-card/40 px-5 py-8 text-center transition-colors hover:border-primary/50 hover:bg-secondary/30"
          >
            <KeyRound className="size-5 mx-auto text-muted-foreground/50" />
            <p className="mt-2 text-sm font-medium">Add your first LLM provider</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick a provider, choose a model, paste an API key.
            </p>
          </button>
        ) : (
          <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
            {configuredLlm.map((p) => (
              <ProviderRow
                key={p.id}
                provider={p}
                tierRole={tierRoles.primary === p.id ? "primary" : tierRoles.fallback === p.id ? "fallback" : null}
                onSetRole={handleSetRole}
                savingRole={savingRole}
                onManage={() => setEditing(p)}
              />
            ))}
          </div>
        )}
      </section>

      {addOpen && (
        <AddProviderModal
          available={availableLlm}
          onClose={() => setAddOpen(false)}
          onAdded={async () => { setAddOpen(false); await load(); }}
        />
      )}

      {editing && (
        <ManageProviderModal
          provider={providers.find((p) => p.id === editing.id) ?? editing}
          onClose={() => setEditing(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/** A single provider line. Same shape for services and LLMs so the page reads
 *  as one list; the Primary/Fallback toggles are the only LLM-specific part. */
function ProviderRow({ provider, tierRole, onSetRole, savingRole, onManage }: {
  provider: ProviderConfig;
  tierRole?: TierRole | null;
  onSetRole?: (providerId: string, role: TierRole) => Promise<void>;
  savingRole?: boolean;
  onManage: () => void;
}) {
  const model = provider.selectedModel || provider.defaultModel;

  return (
    <div className="flex items-center gap-4 px-5 py-3.5 min-w-0">
      <div className="shrink-0 size-8 rounded-md bg-secondary/60 flex items-center justify-center">
        <KeyRound className="size-4 text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-semibold truncate">{provider.label}</p>
          {provider.modelInputMode !== "none" && model && (
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground bg-secondary/60 rounded px-1.5 py-0.5 truncate max-w-[14rem]">
              {model}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <ConfigSummary provider={provider} />
          {provider.description && (
            <span className="text-xs text-muted-foreground/70 truncate hidden sm:inline">
              · {provider.description}
            </span>
          )}
        </div>
      </div>

      {onSetRole && (
        <div className="hidden sm:flex items-center gap-1 shrink-0">
          {(["primary", "fallback"] as const).map((role) => {
            const active = tierRole === role;
            return (
              <Button
                key={role}
                size="sm"
                variant={active ? "default" : "outline"}
                className="h-7 px-2.5 text-[11px] capitalize"
                disabled={savingRole}
                onClick={() => void onSetRole(provider.id, role)}
                title={active ? `Click to clear ${role}` : `Set as ${role}`}
              >
                {role}
              </Button>
            );
          })}
        </div>
      )}

      <Button size="sm" variant="ghost" className="shrink-0 h-8" onClick={onManage}>
        Manage
      </Button>
    </div>
  );
}

/** Provider → model → key, in one modal. This is the whole "add" flow: the
 *  previous page pre-rendered a card per provider, which meant six always-empty
 *  forms for the four providers a given deployment never uses. */
function AddProviderModal({ available, onClose, onAdded }: {
  available: ProviderConfig[];
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const { session } = useApp();
  const [providerId, setProviderId] = useState(available[0]?.id ?? "");
  const [label, setLabel] = useState("Primary");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [model, setModel] = useState<string>(available[0]?.defaultModel ?? "");
  const [saving, setSaving] = useState(false);

  const provider = available.find((p) => p.id === providerId);

  function handleProviderChange(id: string) {
    setProviderId(id);
    const next = available.find((p) => p.id === id);
    setModel(next?.defaultModel ?? "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session || !provider) return;
    if (!label.trim() || !secret.trim()) {
      toast.error("Label and API key are both required.");
      return;
    }
    setSaving(true);
    try {
      await createProviderKey(session.access_token, {
        provider: provider.id, label: label.trim(), secret: secret.trim(),
      });
      // Only persist a model when it differs from the built-in default —
      // storing the default would pin the provider to today's model name.
      const chosen = model.trim();
      if (chosen && chosen !== provider.defaultModel) {
        await setProviderModel(session.access_token, provider.id, chosen);
      }
      toast.success(`${provider.label} added`);
      await onAdded();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add LLM provider</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Provider</Label>
            <Select value={providerId} onValueChange={handleProviderChange}>
              <SelectTrigger><SelectValue placeholder="Choose a provider" /></SelectTrigger>
              <SelectContent>
                {available.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {provider && provider.modelInputMode !== "none" && (
            <div className="space-y-1.5">
              <Label>Model</Label>
              <ModelField provider={provider} value={model} onChange={setModel} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Primary, Backup"
              required
            />
            <p className="text-xs text-muted-foreground">
              Only used to tell multiple keys for this provider apart.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>API key</Label>
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                required
                className="pr-9 font-mono"
                autoComplete="off"
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

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving || !provider}>
              {saving && <RefreshCw className="size-3.5 mr-1.5 animate-spin" />} Add provider
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Dropdown for providers with a known catalog, free text for the rest, and an
 *  "Other…" escape hatch so a new model name never requires a code change. */
function ModelField({ provider, value, onChange }: {
  provider: ProviderConfig;
  value: string;
  onChange: (v: string) => void;
}) {
  const isPreset = provider.modelOptions.includes(value);
  const [freeform, setFreeform] = useState(provider.modelInputMode === "freeform" || (!!value && !isPreset));

  if (provider.modelInputMode === "dropdown" && !freeform) {
    return (
      <Select
        value={value}
        onValueChange={(v) => {
          if (v === OTHER_MODEL) { setFreeform(true); onChange(""); return; }
          onChange(v);
        }}
      >
        <SelectTrigger><SelectValue placeholder="Choose a model" /></SelectTrigger>
        <SelectContent>
          {provider.modelOptions.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          <SelectItem value={OTHER_MODEL}>Other…</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="space-y-1.5">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={provider.defaultModel ?? "exact model id"}
        className="font-mono text-xs"
      />
      {provider.modelInputMode === "dropdown" && (
        <button
          type="button"
          onClick={() => { setFreeform(false); onChange(provider.defaultModel ?? provider.modelOptions[0] ?? ""); }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back to the model list
        </button>
      )}
    </div>
  );
}

/** Everything for one provider after it exists: its model, its keys, and the
 *  per-key health actions that used to live inline on the page. */
function ManageProviderModal({ provider, onClose, onChanged }: {
  provider: ProviderConfig;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { session } = useApp();
  const [model, setModel] = useState(provider.selectedModel ?? provider.defaultModel ?? "");
  const [savingModel, setSavingModel] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderKey | null>(null);
  const [deleting, setDeleting] = useState(false);

  const keys = [...provider.keys].sort((a, b) => a.priority - b.priority);

  async function handleModelSave() {
    if (!session) return;
    setSavingModel(true);
    try {
      await setProviderModel(session.access_token, provider.id, model.trim() || null);
      toast.success(`${provider.label} model updated`);
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingModel(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (!label.trim() || !secret.trim()) {
      toast.error("Label and key are both required.");
      return;
    }
    setSaving(true);
    try {
      await createProviderKey(session.access_token, {
        provider: provider.id, label: label.trim(), secret: secret.trim(),
      });
      toast.success(`Key added for ${provider.label}`);
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

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{provider.label}</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {provider.description && (
              <p className="text-xs text-muted-foreground -mt-2">{provider.description}</p>
            )}

            {provider.modelInputMode !== "none" && (
              <div className="space-y-1.5">
                <Label>Model</Label>
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <ModelField provider={provider} value={model} onChange={setModel} />
                  </div>
                  <Button
                    size="sm" variant="outline" className="h-9 shrink-0"
                    disabled={savingModel || model === (provider.selectedModel ?? provider.defaultModel ?? "")}
                    onClick={() => void handleModelSave()}
                  >
                    {savingModel && <RefreshCw className="size-3.5 mr-1.5 animate-spin" />} Save
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>API keys</Label>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setShowAdd((v) => !v)}>
                  <Plus className="size-3.5 mr-1.5" /> Add key
                </Button>
              </div>

              {keys.length === 0 && !showAdd && (
                <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-4 text-center">
                  {provider.envFallback
                    ? <>No key stored here — running on the <code className="font-mono">.env.local</code> value.</>
                    : "No key configured."}
                </p>
              )}

              {keys.length > 0 && (
                <ul className="rounded-md border border-border divide-y divide-border overflow-hidden">
                  {keys.map((key) => {
                    const meta = statusMeta(key.status);
                    const busy = busyKeyId === key.id;
                    return (
                      <li key={key.id} className={cn("px-3 py-2.5 space-y-2", !key.is_active && "opacity-60")}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium truncate">{key.label}</span>
                          <span className="font-mono text-xs text-muted-foreground">•••{key.secret_last4}</span>
                          <span
                            className={cn("ml-auto inline-flex items-center gap-1.5 text-xs font-medium shrink-0", meta.text)}
                            title={key.last_error ?? undefined}
                          >
                            <span className={cn("size-1.5 rounded-full", meta.dot)} aria-hidden />
                            {meta.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => void handleCheck(key)}>
                            {busy ? <RefreshCw className="size-3.5 animate-spin" /> : "Re-check"}
                          </Button>
                          {key.status === "dead" && (
                            <Button
                              size="sm" variant="ghost" className="h-7 text-xs text-emerald-400"
                              disabled={busy}
                              onClick={() => void handlePatch(key, { status: "healthy" })}
                              title="Mark healthy again"
                            >
                              <ShieldCheck className="size-3.5 mr-1" /> Revive
                            </Button>
                          )}
                          <Button
                            size="sm" variant="ghost" className="h-7 text-xs"
                            disabled={busy}
                            onClick={() => void handlePatch(key, { is_active: !key.is_active })}
                          >
                            {key.is_active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="icon-sm" variant="ghost"
                            className="ml-auto text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(key)}
                            aria-label="Remove key"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {showAdd && (
                <form onSubmit={handleAdd} className="space-y-3 rounded-md border border-border bg-secondary/20 p-3 enter">
                  <div className="space-y-1.5">
                    <Label>Label</Label>
                    <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Backup" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>API key</Label>
                    <div className="relative">
                      <Input
                        type={showSecret ? "text" : "password"}
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        required
                        className="pr-9 font-mono"
                        autoComplete="off"
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
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
                    <Button type="submit" size="sm" disabled={saving}>
                      {saving && <RefreshCw className="size-3.5 mr-1.5 animate-spin" />} Add key
                    </Button>
                  </div>
                </form>
              )}

              {keys.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  Keys are tried top to bottom — if one runs out of credit or fails, the next takes over.
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {deleteTarget && (
        <ConfirmDialog
          open
          title="Remove this key?"
          description={`"${deleteTarget.label}" will be permanently deleted. Traffic fails over to the next key for ${provider.label}, or to the .env.local value if none remain.`}
          confirmLabel="Remove"
          loading={deleting}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        />
      )}
    </>
  );
}

/** The sender addresses campaigns send from. Lives on this page because a
 *  valid Instantly key with zero sending accounts produces a campaign that is
 *  accepted and then silently never sends — the two are one setup step. */
function SendingAccountsCard({ emails, onSaved }: {
  emails: string[];
  onSaved: (next: string[]) => void;
}) {
  const { session } = useApp();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(emails);
  const [entry, setEntry] = useState("");
  const [saving, setSaving] = useState(false);

  function openEditor() {
    setDraft(emails);
    setEntry("");
    setOpen(true);
  }

  function addEntry() {
    const value = entry.trim().toLowerCase();
    if (!value) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error(`"${value}" is not a valid email address`);
      return;
    }
    if (draft.some((e) => e.toLowerCase() === value)) {
      toast.error("That address is already in the list");
      return;
    }
    setDraft((d) => [...d, value]);
    setEntry("");
  }

  async function handleSave() {
    if (!session) return;
    setSaving(true);
    try {
      const { sendingAccounts } = await setSendingAccounts(session.access_token, draft);
      onSaved(sendingAccounts);
      toast.success("Sending accounts updated");
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="px-1">
        <p className="eyebrow">Sending accounts</p>
        <p className="text-xs text-muted-foreground mt-1">
          The mailboxes campaigns send from. These must already be connected inside Instantly.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card px-5 py-3.5 flex items-center gap-4">
        <div className="shrink-0 size-8 rounded-md bg-secondary/60 flex items-center justify-center">
          <Mail className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          {emails.length === 0 ? (
            <>
              <p className="text-sm font-semibold">No sending accounts</p>
              <span className="inline-flex items-center gap-1.5 text-xs text-destructive mt-0.5">
                <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
                Campaigns cannot send until at least one is set
              </span>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold truncate">
                {emails.length} address{emails.length !== 1 ? "es" : ""}
              </p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{emails.join(", ")}</p>
            </>
          )}
        </div>
        <Button size="sm" variant="ghost" className="shrink-0 h-8" onClick={openEditor}>
          <Pencil className="size-3.5 mr-1.5" /> Edit
        </Button>
      </div>

      {open && (
        <Dialog open onOpenChange={(v) => { if (!v) setOpen(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Sending accounts</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Add an address</Label>
                <div className="flex gap-2">
                  <Input
                    type="email"
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); addEntry(); }
                    }}
                    placeholder="sales@kuberpolyplast.com"
                    autoComplete="off"
                  />
                  <Button type="button" variant="outline" onClick={addEntry}>Add</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Must match a mailbox already connected in Instantly, or its campaigns will be rejected.
                </p>
              </div>

              {draft.length > 0 && (
                <ul className="rounded-md border border-border divide-y divide-border overflow-hidden">
                  {draft.map((email) => (
                    <li key={email} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-sm truncate flex-1 font-mono text-xs">{email}</span>
                      <Button
                        size="icon-sm" variant="ghost"
                        className="text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => setDraft((d) => d.filter((e) => e !== email))}
                        aria-label={`Remove ${email}`}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {draft.length === 0 && (
                <p className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-4 text-center">
                  Saving with none set falls back to <code className="font-mono">INSTANTLY_SENDING_ACCOUNTS</code>.
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={() => void handleSave()} disabled={saving}>
                  {saving && <RefreshCw className="size-3.5 mr-1.5 animate-spin" />} Save
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
