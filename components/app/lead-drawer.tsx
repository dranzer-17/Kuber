"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Building2, Globe2, Mail, Megaphone, Users, X,
  Loader2, RefreshCw, CheckCircle2, AlertCircle, Clock,
  RotateCcw, Zap, Bot, Settings, Pencil, Phone, Link,
  MapPin, Save, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Lead, EnrichmentStage } from "@/lib/leads";
import { Avatar, PipelineStepper, ScoreBadge, StatusBadge } from "@/components/leads/lead-ui";
import { fetchLead, patchLead, rescrapeOrg } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EnrichLog {
  event: string;
  source: string;
  duration_ms: number | null;
  error: string | null;
  created_at: string;
}

interface EnrichStatus {
  enrichment_stage: EnrichmentStage | null;
  enrichment_status: string | null;
  enrichment_attempts: number;
  company_description: string | null;
  sells_to: string | null;
  last_error: string | null;
  logs: EnrichLog[];
}

// ── Event label map ───────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  SCRAPE_QUEUED:               "Queued for enrichment",
  SCRAPE_BATCH_STARTED:        "Batch processing started",
  SCRAPE_STARTED:              "Website scrape started",
  SCRAPE_SUCCESS:              "Website scraped successfully",
  SCRAPE_EMPTY:                "Website returned no content",
  SCRAPE_FAILED:               "Website scrape failed",
  LLM_EXTRACTION_STARTED:      "Extracting company info...",
  LLM_EXTRACTION_SUCCESS:      "Company info extracted",
  LLM_EXTRACTION_PARTIAL:      "Partial info extracted",
  LLM_EXTRACTION_FAILED:       "Extraction failed",
  ENRICHMENT_COMPLETE:         "Enrichment complete",
  ENRICHMENT_FAILED:           "Enrichment failed",
  ENRICHMENT_FAILED_PERMANENT: "Enrichment permanently failed",
  BATCH_COMPLETE:              "All orgs processed",
};

const SOURCE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  firecrawl: Globe2,
  claude:    Bot,
  system:    Settings,
  apollo:    Zap,
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({
  icon: Icon, label, children,
}: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-4 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        <Icon className="size-3" /> {label}
      </div>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function EnrichStageBadge({ stage, hasData }: { stage: EnrichmentStage | null; hasData?: boolean }) {
  if (!stage) return null;
  const doneLabel = hasData ? "Enriched" : "Done (No Data)";
  const doneCls   = hasData
    ? "bg-green-500/10 text-green-400 border-green-500/20"
    : "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
  const configs: Record<EnrichmentStage, { label: string; cls: string }> = {
    queued:   { label: "In Queue",         cls: "bg-secondary text-muted-foreground border-border" },
    scraping: { label: "Enriching...",      cls: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" },
    done:     { label: doneLabel,           cls: doneCls },
    failed:   { label: "Enrichment Failed", cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  };
  const c = configs[stage];
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] border font-medium", c.cls)}>
      {stage === "done"     && <CheckCircle2 className="size-2.5" />}
      {stage === "failed"   && <AlertCircle  className="size-2.5" />}
      {stage === "queued"   && <Clock        className="size-2.5" />}
      {stage === "scraping" && <Loader2      className="size-2.5 animate-spin" />}
      {c.label}
    </span>
  );
}

function TimelineItem({ log, isLast }: { log: EnrichLog; isLast: boolean }) {
  const Icon = SOURCE_ICONS[log.source] ?? Settings;
  const label = EVENT_LABELS[log.event] ?? log.event;
  const isError = !!log.error;
  const time = new Date(log.created_at).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  return (
    <div className="flex gap-2.5 text-xs">
      <div className="flex flex-col items-center shrink-0">
        <div className={cn(
          "size-5 rounded-full flex items-center justify-center border shrink-0",
          isError
            ? "bg-red-500/10 border-red-500/20 text-red-400"
            : "bg-secondary border-border text-muted-foreground",
        )}>
          <Icon className="size-2.5" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border/60 mt-1 min-h-[12px]" />}
      </div>
      <div className={cn("min-w-0", !isLast && "pb-3")}>
        <p className={cn("font-medium leading-snug", isError ? "text-red-400" : "text-foreground")}>
          {label}
        </p>
        <div className="flex items-center gap-2 mt-0.5 text-muted-foreground">
          <span>{time}</span>
          {log.duration_ms != null && <span>· {log.duration_ms}ms</span>}
        </div>
        {log.error && (
          <p className="mt-1 text-red-400/80 font-mono text-[10px] break-all leading-relaxed">
            {log.error}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main drawer ───────────────────────────────────────────────────────────────

type EditForm = {
  first_name: string; last_name: string; email: string; phone: string;
  title: string; headline: string; linkedin_url: string;
  city: string; state: string; country: string;
};

export function LeadDrawer({ lead, onClose, onLeadUpdated, onOrgClick }: {
  lead: Lead | null;
  onClose: () => void;
  onLeadUpdated?: (updated: Lead) => void;
  onOrgClick?: (orgId: string) => void;
}) {
  const [freshLead,   setFreshLead  ] = useState<Lead | null>(null);
  const [loadingLead, setLoadingLead] = useState(false);
  const [enrichData,  setEnrichData ] = useState<EnrichStatus | null>(null);
  const [retrying,    setRetrying   ] = useState(false);
  const [editing,     setEditing    ] = useState(false);
  const [saving,      setSaving     ] = useState(false);
  const [saveError,   setSaveError  ] = useState("");
  const [form,        setForm       ] = useState<EditForm>({
    first_name: "", last_name: "", email: "", phone: "",
    title: "", headline: "", linkedin_url: "",
    city: "", state: "", country: "",
  });

  const display = freshLead ?? lead;

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? "";
  }

  const fetchFresh = useCallback(async (l: Lead) => {
    setLoadingLead(true);
    try {
      const tok = await getToken();
      if (!tok) return;
      const updated = await fetchLead(tok, l.id);
      setFreshLead(updated);
    } catch { /* keep stale */ }
    finally { setLoadingLead(false); }
  }, []);

  const fetchEnrichStatus = useCallback(async (orgId: string) => {
    try {
      const tok = await getToken();
      if (!tok) return;
      const res = await fetch(`/api/enrich/status?org_id=${orgId}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json() as { success: boolean; data?: EnrichStatus };
      if (json.success && json.data) setEnrichData(json.data);
    } catch { /* non-fatal */ }
  }, []);

  function populateForm(l: Lead) {
    setForm({
      first_name:   l.firstName   ?? "",
      last_name:    l.lastName    ?? "",
      email:        l.email       ?? "",
      phone:        l.phone       ?? "",
      title:        l.jobTitle    ?? "",
      headline:     "",
      linkedin_url: "",
      city:         "",
      state:        "",
      country:      "",
    });
  }

  async function handleSave() {
    if (!display) return;
    setSaving(true);
    setSaveError("");
    try {
      const tok = await getToken();
      const updated = await patchLead(tok, display.id, {
        first_name:   form.first_name   || undefined,
        last_name:    form.last_name    || undefined,
        email:        form.email        || undefined,
        phone:        form.phone        || undefined,
        title:        form.title        || undefined,
        headline:     form.headline     || undefined,
        linkedin_url: form.linkedin_url || undefined,
        city:         form.city         || undefined,
        state:        form.state        || undefined,
        country:      form.country      || undefined,
      });
      setFreshLead(updated);
      onLeadUpdated?.(updated);
      setEditing(false);
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!lead) { setFreshLead(null); setEnrichData(null); setEditing(false); return; }
    setFreshLead(null);
    setEnrichData(null);
    setEditing(false);
    setSaveError("");
    populateForm(lead);
    void fetchFresh(lead);
    if (lead.orgId) void fetchEnrichStatus(lead.orgId);
  }, [lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handler(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  async function handleRetry() {
    if (!display?.orgId) return;
    setRetrying(true);
    try {
      const tok = await getToken();
      await rescrapeOrg(tok, display.orgId);
      setTimeout(async () => {
        if (display.orgId) await fetchEnrichStatus(display.orgId);
        if (lead) await fetchFresh(lead);
      }, 800);
    } catch { /* non-fatal */ }
    finally { setRetrying(false); }
  }

  const open = lead !== null;
  const currentStage = enrichData?.enrichment_stage ?? display?.enrichmentStage ?? null;
  const attempts = enrichData?.enrichment_attempts ?? 0;
  const enrichHasData = !!((enrichData?.company_description || display?.companyDescription));

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/50 transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <div className={cn(
        "fixed top-0 right-0 z-50 h-full w-[520px] max-w-[95vw] bg-card border-l border-border shadow-2xl",
        "flex flex-col transition-transform duration-300 ease-in-out",
        open ? "translate-x-0" : "translate-x-full",
      )}>
        {display && (
          <>
            {/* Header */}
            <div className="flex items-start gap-3 p-5 border-b border-border shrink-0">
              <Avatar name={`${display.firstName} ${display.lastName}`} size="md" />
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold truncate">{display.firstName} {display.lastName}</h2>
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <StatusBadge status={display.status} />
                  <ScoreBadge score={display.score} />
                  <span className="text-[10px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-full border border-border">
                    {display.source}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!editing ? (
                  <button
                    type="button"
                    onClick={() => { populateForm(display); setEditing(true); setSaveError(""); }}
                    className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-secondary"
                    title="Edit lead"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                ) : (
                  <>
                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setEditing(false); setSaveError(""); }}>
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

              {/* ── Edit mode ── */}
              {editing && (
                <div className="space-y-4">
                  {saveError && (
                    <div className="flex items-center gap-2 text-xs text-destructive rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5">
                      <AlertCircle className="size-3.5 shrink-0" /> {saveError}
                    </div>
                  )}
                  <fieldset className="rounded-xl border border-border p-4 space-y-3">
                    <legend className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">Personal</legend>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">First name</Label>
                        <Input className="h-8 text-sm" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Last name</Label>
                        <Input className="h-8 text-sm" value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1.5"><Mail className="size-3" /> Email</Label>
                      <Input className="h-8 text-sm" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1.5"><Phone className="size-3" /> Phone</Label>
                      <Input className="h-8 text-sm" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                    </div>
                  </fieldset>
                  <fieldset className="rounded-xl border border-border p-4 space-y-3">
                    <legend className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1">Professional</legend>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Job title</Label>
                      <Input className="h-8 text-sm" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Headline</Label>
                      <Input className="h-8 text-sm" placeholder="e.g. VP Procurement at Acme" value={form.headline} onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs flex items-center gap-1.5"><Link className="size-3" /> LinkedIn URL</Label>
                      <Input className="h-8 text-sm" placeholder="linkedin.com/in/..." value={form.linkedin_url} onChange={(e) => setForm((f) => ({ ...f, linkedin_url: e.target.value }))} />
                    </div>
                  </fieldset>
                  <fieldset className="rounded-xl border border-border p-4 space-y-3">
                    <legend className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-1 flex items-center gap-1"><MapPin className="size-3" /> Location</legend>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">City</Label>
                        <Input className="h-8 text-sm" value={form.city} onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">State</Label>
                        <Input className="h-8 text-sm" value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Country</Label>
                      <Input className="h-8 text-sm" value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} />
                    </div>
                  </fieldset>
                </div>
              )}

              {/* ── View mode ── */}
              {!editing && <>

              {/* Organization — clickable row that opens OrgDrawer */}
              {display.company && (
                <button
                  type="button"
                  onClick={() => display.orgId && onOrgClick?.(display.orgId)}
                  disabled={!display.orgId || !onOrgClick}
                  className="w-full text-left rounded-xl border border-border bg-secondary/20 p-4 hover:border-muted-foreground/50 hover:bg-secondary/40 transition-colors group disabled:cursor-default disabled:hover:border-border disabled:hover:bg-secondary/20"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      <Building2 className="size-3" /> Organization
                    </div>
                    {display.orgId && onOrgClick && (
                      <ChevronRight className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                  <div className="text-sm leading-relaxed mt-1.5">
                    <p className="font-medium">{display.company}</p>
                    {display.domain && (
                      <a href={/^https?:\/\//i.test(display.domain) ? display.domain : `https://${display.domain}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 mt-0.5 hover:underline block">{display.domain}</a>
                    )}
                  </div>
                </button>
              )}

              {/* Contact */}
              <Section icon={Mail} label="Contact">
                {display.jobTitle && (
                  <p><span className="text-muted-foreground">Title: </span>{display.jobTitle}</p>
                )}
                <p>
                  <span className="text-muted-foreground">Email: </span>
                  {display.email || <span className="text-muted-foreground/50 italic">Not yet enriched</span>}
                </p>
                {display.phone && (
                  <p><span className="text-muted-foreground">Phone: </span>{display.phone}</p>
                )}
                {display.country && (
                  <p><span className="text-muted-foreground">Country: </span>{display.country}</p>
                )}
              </Section>

              {/* Pipeline */}
              <Section icon={Users} label="Pipeline stage">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={display.status} />
                    <span className="text-xs text-muted-foreground">Current stage</span>
                  </div>
                  <PipelineStepper currentStatus={display.status} />
                </div>
              </Section>

              {/* Meta */}
              <div className="grid grid-cols-2 gap-3">
                <Section icon={Globe2} label="Source">
                  <p className="font-medium">{display.source}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Added {display.createdAt}</p>
                </Section>
                <Section icon={Megaphone} label="Campaign">
                  {display.campaigns && display.campaigns.length > 0 ? (
                    <div className="flex flex-col gap-1.5 mt-0.5">
                      {display.campaigns.map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium truncate">{c.name}</p>
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground border border-border rounded px-1.5 py-0.5 shrink-0">
                            {c.crm_status}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground/60 text-xs">Not assigned</p>
                  )}
                </Section>
              </div>

              {/* ── Company Enrichment ── */}
              <div className="rounded-xl border border-border overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-secondary/30 border-b border-border">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Building2 className="size-3 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Company Enrichment</span>
                    <EnrichStageBadge stage={currentStage} hasData={enrichHasData} />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(currentStage === "failed" || currentStage === "queued" || currentStage === null || (currentStage === "done" && !enrichHasData)) && attempts < 3 && (
                      <Button
                        size="sm" variant="outline"
                        className="h-6 px-2 text-[11px] gap-1"
                        onClick={handleRetry}
                        disabled={retrying}
                      >
                        <RotateCcw className={cn("size-3", retrying && "animate-spin")} />
                        {currentStage === "failed" || (currentStage === "done" && !enrichHasData) ? "Retry" : "Enrich"}
                      </Button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        if (lead) void fetchFresh(lead);
                        if (display.orgId) void fetchEnrichStatus(display.orgId);
                      }}
                      disabled={loadingLead}
                      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className={cn("size-3", loadingLead && "animate-spin")} />
                      Refresh
                    </button>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {currentStage === "done" && (
                    <>
                      {(enrichData?.company_description ?? display.companyDescription) && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">What they do</p>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {enrichData?.company_description ?? display.companyDescription}
                          </p>
                        </div>
                      )}
                      {(enrichData?.sells_to ?? display.sellsTo) && (
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Who they sell to</p>
                          <p className="text-sm text-muted-foreground leading-relaxed">
                            {enrichData?.sells_to ?? display.sellsTo}
                          </p>
                        </div>
                      )}
                    </>
                  )}
                  {currentStage === "failed" && enrichData?.last_error && (
                    <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/5 rounded-lg p-3">
                      <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                      <span>{enrichData.last_error}</span>
                    </div>
                  )}
                  {currentStage === "failed" && attempts >= 3 && (
                    <p className="text-[11px] text-muted-foreground text-center">Maximum retry attempts reached.</p>
                  )}
                  {(currentStage === "queued" || currentStage === "scraping") && !enrichData?.logs?.length && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground py-2 justify-center">
                      <Loader2 className="size-3.5 animate-spin" />
                      {currentStage === "scraping" ? "Scraping website..." : "Waiting to start..."}
                    </div>
                  )}
                  {!display.orgId && (
                    <p className="text-xs text-muted-foreground italic text-center py-2">
                      No organization linked to this lead.
                    </p>
                  )}
                  {enrichData?.logs && enrichData.logs.length > 0 && (
                    <Section icon={Clock} label="Enrichment Log">
                      <div>
                        {enrichData.logs.map((log, i) => (
                          <TimelineItem
                            key={i}
                            log={log}
                            isLast={i === enrichData.logs.length - 1}
                          />
                        ))}
                      </div>
                    </Section>
                  )}
                </div>
              </div>

              </> /* end view mode */}

            </div>
          </>
        )}
      </div>
    </>
  );
}
