"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Building2, Globe2, X, Loader2, Pencil, Save,
  AlertCircle, MapPin, Factory,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchOrg, patchOrg } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgData {
  id: string;
  name: string | null;
  domain: string | null;
  website: string | null;
  description: string | null;
  company_description: string | null;
  sells_to: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
}

type OrgForm = {
  name: string;
  domain: string;
  website: string;
  description: string;
  industry: string;
  city: string;
  country: string;
};

// ── Helper ────────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function Section({
  icon: Icon, label, children,
}: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Icon className="size-3" /> {label}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function OrgDrawer({ orgId, onClose }: {
  orgId: string | null;
  onClose: () => void;
}) {
  const [org,     setOrg    ] = useState<OrgData | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving ] = useState(false);
  const [error,   setError  ] = useState("");
  const [form,    setForm   ] = useState<OrgForm>({
    name: "", domain: "", website: "", description: "", industry: "", city: "", country: "",
  });

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  }

  const loadOrg = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      const tok = await getToken();
      const data = await fetchOrg(tok, id) as unknown as OrgData;
      setOrg(data);
      setForm({
        name:        data.name        ?? "",
        domain:      data.domain      ?? "",
        website:     data.website     ?? "",
        description: data.description ?? data.company_description ?? "",
        industry:    data.industry    ?? "",
        city:        data.city        ?? "",
        country:     data.country     ?? "",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleSave() {
    if (!orgId) return;
    setSaving(true);
    setError("");
    try {
      const tok = await getToken();
      const updated = await patchOrg(tok, orgId, {
        name:        form.name        || undefined,
        domain:      form.domain      || undefined,
        website:     form.website     || undefined,
        description: form.description || undefined,
        industry:    form.industry    || undefined,
        city:        form.city        || undefined,
        country:     form.country     || undefined,
      }) as unknown as OrgData;
      setOrg(updated);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!orgId) { setOrg(null); setEditing(false); setError(""); return; }
    setEditing(false);
    setError("");
    void loadOrg(orgId);
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const open = orgId !== null;

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-50 bg-black/40 transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div className={cn(
        "fixed top-0 right-0 z-60 h-full w-[480px] max-w-[95vw] bg-card border-l border-border shadow-2xl",
        "flex flex-col transition-transform duration-300 ease-in-out",
        open ? "translate-x-0" : "translate-x-full",
      )}>
        {/* Header */}
        <div className="flex items-center gap-3 p-5 border-b border-border shrink-0">
          <div className="size-9 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0">
            <Building2 className="size-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold truncate">
              {org?.name ?? (loading ? "Loading…" : "Organization")}
            </h2>
            {org?.domain && (
              <p className="text-xs text-blue-400 truncate">{org.domain}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {org && !editing && (
              <button
                type="button"
                onClick={() => { setEditing(true); setError(""); }}
                className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary"
                title="Edit organization"
              >
                <Pencil className="size-3.5" />
              </button>
            )}
            {editing && (
              <>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setEditing(false); setError(""); }}>
                  Cancel
                </Button>
                <Button size="sm" className="h-7 px-3 text-xs gap-1.5" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            )}
            <button
              type="button" onClick={onClose}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5">
              <AlertCircle className="size-3.5 shrink-0" /> {error}
            </div>
          )}

          {!loading && org && (
            <>
              {editing ? (
                /* ── Edit mode ── */
                <div className="space-y-4">
                  {error && (
                    <div className="flex items-center gap-2 text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5">
                      <AlertCircle className="size-3.5 shrink-0" /> {error}
                    </div>
                  )}
                  <fieldset className="rounded-xl border border-border p-4 space-y-3">
                    <legend className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">Details</legend>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Name</Label>
                      <Input className="h-8 text-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1.5"><Globe2 className="size-3" /> Domain</Label>
                      <Input className="h-8 text-sm" placeholder="acme.com" value={form.domain} onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Website URL</Label>
                      <Input className="h-8 text-sm" placeholder="https://acme.com" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1.5"><Factory className="size-3" /> Industry</Label>
                      <Input className="h-8 text-sm" placeholder="Manufacturing" value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} />
                    </div>
                  </fieldset>
                  <fieldset className="rounded-xl border border-border p-4 space-y-3">
                    <legend className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-1"><MapPin className="size-3" /> Location</legend>
                    <div className="space-y-1.5">
                      <Label className="text-xs">City</Label>
                      <Input className="h-8 text-sm" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Country</Label>
                      <Input className="h-8 text-sm" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
                    </div>
                  </fieldset>
                  <fieldset className="rounded-xl border border-border p-4 space-y-3">
                    <legend className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">About</legend>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Description</Label>
                      <textarea
                        rows={4}
                        className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-foreground resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                        value={form.description}
                        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                        placeholder="What does this company do?"
                      />
                    </div>
                  </fieldset>
                </div>
              ) : (
                /* ── View mode ── */
                <>
                  <Section icon={Building2} label="Details">
                    <Field label="Name"     value={org.name} />
                    <Field label="Domain"   value={org.domain} />
                    <Field label="Website"  value={org.website} />
                    <Field label="Industry" value={org.industry} />
                  </Section>

                  {(org.city || org.country) && (
                    <Section icon={MapPin} label="Location">
                      <Field label="City"    value={org.city} />
                      <Field label="Country" value={org.country} />
                    </Section>
                  )}

                  {(org.company_description || org.description) && (
                    <Section icon={Globe2} label="About">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        {org.company_description ?? org.description}
                      </p>
                    </Section>
                  )}

                  {org.sells_to && (
                    <Section icon={Factory} label="Sells to">
                      <p className="text-sm text-muted-foreground leading-relaxed">{org.sells_to}</p>
                    </Section>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
