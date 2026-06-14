"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isAdminUser, isValidAdminSession } from "@/lib/auth/admin";
import { type Lead, type EnrichmentStage, type LeadsSort, isCampaignEligible, campaignIneligibleReason, sortLeads, ENRICHMENT_DOT_HELP, CAMPAIGN_ACTION_HELP } from "@/lib/leads";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Avatar, ScoreBadge, StatusBadge } from "@/components/leads/lead-ui";
import { KanbanBoard } from "@/components/app/kanban-board";
import { CreateCampaignModal, type Campaign } from "@/components/app/create-campaign-modal";
import { DashboardView } from "@/components/app/dashboard";
import { LeadDrawer } from "@/components/app/lead-drawer";
import { AddLeadsDrawer } from "@/components/app/add-leads-drawer";
import { CampaignDetail } from "@/components/app/campaign-drawer";
import { InfoTip } from "@/components/ui/info-tip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  LayoutDashboard, Users, Megaphone, LogOut, Plus,
  Eye, EyeOff, List, Kanban, RefreshCw, Columns3, Check, Search,
  Building2,
} from "lucide-react";
import { fetchLeads, fetchCampaigns } from "@/lib/api-client";

type View = "dashboard" | "lead-generation" | "leads" | "campaigns";
type LeadsViewMode = "list" | "kanban";
type LeadsEntityMode = "individual" | "orgs";

type OrgRow = {
  id: string;
  name: string;
  domain: string;
  enrichmentStage: EnrichmentStage | null;
  companyDescription: string | null;
  sellsTo: string | null;
  leads: Lead[];
};

// ── Column definitions ────────────────────────────────────────────────────────

const COLUMN_DEFS = [
  { key: "email",        label: "Email",        defaultVisible: true  },
  { key: "job_title",   label: "Job Title",    defaultVisible: true  },
  { key: "status",      label: "Status",       defaultVisible: true  },
  { key: "score",       label: "Score",        defaultVisible: true  },
  { key: "source",      label: "Source",       defaultVisible: true  },
  { key: "added",       label: "Added",        defaultVisible: true  },
  { key: "organization",label: "Organization", defaultVisible: true  },
  { key: "phone",       label: "Phone",        defaultVisible: false },
  { key: "country",     label: "Country",      defaultVisible: false },
  { key: "domain",      label: "Domain",       defaultVisible: false },
  { key: "campaign",    label: "Campaign",     defaultVisible: false },
] as const;

type ColKey = typeof COLUMN_DEFS[number]["key"];
type ColVisibility = Record<ColKey, boolean>;

const DEFAULT_VISIBILITY: ColVisibility = Object.fromEntries(
  COLUMN_DEFS.map((c) => [c.key, c.defaultVisible])
) as ColVisibility;

// ── Columns dropdown ──────────────────────────────────────────────────────────

function ColumnsDropdown({ visible, onChange }: {
  visible: ColVisibility;
  onChange: (v: ColVisibility) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggle(key: ColKey) {
    onChange({ ...visible, [key]: !visible[key] });
  }

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen((o) => !o)}>
        <Columns3 className="size-3.5" />
        Columns
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-44 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Toggle columns</p>
          </div>
          <div className="py-1">
            {COLUMN_DEFS.map((col) => (
              <button
                key={col.key}
                type="button"
                onClick={() => toggle(col.key)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary transition-colors"
              >
                <span className={cn(
                  "size-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                  visible[col.key]
                    ? "bg-primary border-primary"
                    : "border-border bg-transparent",
                )}>
                  {visible[col.key] && <Check className="size-2.5 text-primary-foreground" />}
                </span>
                <span className="text-sm text-foreground">{col.label}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => onChange(DEFAULT_VISIBILITY)}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Enrichment status dot ─────────────────────────────────────────────────────

function EnrichDot({ stage }: { stage: EnrichmentStage | null }) {
  const help = ENRICHMENT_DOT_HELP[stage ?? "none"];
  if (!stage) {
    return <span className="size-2 rounded-full bg-border inline-block" title={help} />;
  }
  const styles: Record<EnrichmentStage, string> = {
    queued:   "bg-muted-foreground/40",
    scraping: "bg-yellow-400 animate-pulse",
    done:     "bg-green-500",
    failed:   "bg-red-500",
  };
  return (
    <span
      className={cn("size-2 rounded-full inline-block", styles[stage])}
      title={help}
    />
  );
}

export default function Home() {
  const [session,        setSession       ] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loginEmail,     setLoginEmail    ] = useState("");
  const [loginPassword,  setLoginPassword ] = useState("");
  const [showPwd,        setShowPwd       ] = useState(false);
  const [authError,      setAuthError     ] = useState("");
  const [signingIn,      setSigningIn     ] = useState(false);

  const [view,               setView              ] = useState<View>("dashboard");
  const [leadsViewMode,      setLeadsViewMode     ] = useState<LeadsViewMode>("list");
  const [leads,              setLeads             ] = useState<Lead[]>([]);
  const [campaigns,          setCampaigns         ] = useState<Campaign[]>([]);
  const [loadingLeads,       setLoadingLeads      ] = useState(false);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);
  const [showAddLeads,       setShowAddLeads      ] = useState(false);
  const [selectedLead,       setSelectedLead      ] = useState<Lead | null>(null);
  const [visibleCols,        setVisibleCols       ] = useState<ColVisibility>(DEFAULT_VISIBILITY);
  const [checkedIds,         setCheckedIds        ] = useState<Set<string>>(new Set());
  const [searchQuery,        setSearchQuery       ] = useState("");
  const [leadsSort,          setLeadsSort         ] = useState<LeadsSort>("newest");
  const [leadsEntityMode,    setLeadsEntityMode   ] = useState<LeadsEntityMode>("individual");
  const [selectedCampaign,   setSelectedCampaign  ] = useState<Campaign | null>(null);
  const [selectedOrg,        setSelectedOrg       ] = useState<OrgRow | null>(null);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data: { user }, error } = await supabase.auth.getUser();
      if (!mounted) return;
      if (error || !user) { setSession(null); setLoadingSession(false); return; }
      if (!isAdminUser(user)) { await supabase.auth.signOut(); setSession(null); setLoadingSession(false); return; }
      const { data: { session } } = await supabase.auth.getSession();
      setSession(isValidAdminSession(session) ? session : null);
      setLoadingSession(false);
    }
    void load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_e, s) => {
      if (!mounted) return;
      if (!s?.user || !isAdminUser(s.user) || !isValidAdminSession(s)) {
        if (s?.user && !isAdminUser(s.user)) await supabase.auth.signOut();
        setSession(null); setLoadingSession(false); return;
      }
      setSession(s); setLoadingSession(false);
    });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const loadLeads = useCallback(async (token: string) => {
    setLoadingLeads(true);
    try {
      const { leads } = await fetchLeads(token, { limit: 200 });
      setLeads(leads);
    } catch { /* silently ignore */ }
    finally { setLoadingLeads(false); }
  }, []);

  const loadCampaigns = useCallback(async (token: string) => {
    try {
      const list = await fetchCampaigns(token);
      setCampaigns(list);
    } catch { /* silently ignore */ }
  }, []);

  useEffect(() => {
    if (!session) return;
    const token = session.access_token;
    void loadLeads(token);
    void loadCampaigns(token);
  }, [session, loadLeads, loadCampaigns]);

  // ── Login ─────────────────────────────────────────────────────────────────

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setSigningIn(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    if (error) { setAuthError(error.message); setSigningIn(false); return; }
    if (!isAdminUser(data.user)) {
      await supabase.auth.signOut();
      setAuthError("This account does not have admin access.");
      setSigningIn(false);
      return;
    }
    setSigningIn(false);
  }

  function handleImport() {
    if (session) void loadLeads(session.access_token);
  }

  const filteredLeads = sortLeads(leads, leadsSort);

  const NAV: { key: View; label: string; icon: React.ComponentType<{ className?: string }>; badge: number | null }[] = [
    { key: "dashboard",  label: "Dashboard",  icon: LayoutDashboard, badge: null         },
    { key: "leads",      label: "Leads",      icon: Users,           badge: leads.length },
    { key: "campaigns",  label: "Campaigns",  icon: Megaphone,       badge: null         },
  ];

  // ── Loading / auth gates ──────────────────────────────────────────────────

  if (loadingSession) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          <div className="px-6 py-6 border-b border-border">
            <div className="flex items-center gap-2.5 mb-5">
              <div className="size-8 bg-foreground rounded-lg flex items-center justify-center">
                <span className="text-background text-sm font-black">K</span>
              </div>
              <span className="font-bold text-lg">Kuber</span>
            </div>
            <h1 className="text-2xl font-bold">Sign in</h1>
            <p className="text-sm text-muted-foreground mt-1">Access the lead command center.</p>
          </div>
          <form onSubmit={handleLogin} className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Email</Label>
              <Input type="email" required autoComplete="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="admin@company.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Password</Label>
              <div className="relative">
                <Input
                  type={showPwd ? "text" : "password"}
                  required autoComplete="current-password"
                  value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••" className="pr-10"
                />
                <button
                  type="button" onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label={showPwd ? "Hide password" : "Show password"}
                >
                  {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {authError && <p className="text-xs text-destructive font-mono">{authError}</p>}
            <Button type="submit" disabled={signingIn} className="w-full">
              {signingIn ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // ── App shell ─────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex bg-background overflow-hidden">
      <aside className="w-56 shrink-0 border-r border-border flex flex-col bg-card">
        <div className="px-4 py-5 border-b border-border flex items-center gap-2.5">
          <div className="size-8 bg-foreground rounded-lg flex items-center justify-center">
            <span className="text-background text-sm font-black">K</span>
          </div>
          <span className="font-bold">Kuber</span>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map(({ key, label, icon: Icon, badge }) => (
            <button
              key={key} type="button" onClick={() => setView(key)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                view === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{label}</span>
              {badge !== null && (
                <span className="text-[10px] font-semibold bg-secondary rounded-full px-1.5 py-0.5 tabular-nums">{badge}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border space-y-2">
          <p className="text-[11px] text-muted-foreground truncate px-1">{session.user.email}</p>
          <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => supabase.auth.signOut()}>
            <LogOut className="size-3.5" /> Sign out
          </Button>
        </div>
      </aside>

      <main className={cn(
        "flex-1",
        view === "campaigns" && selectedCampaign
          ? "flex flex-col min-h-0 overflow-hidden"
          : "overflow-y-auto",
      )}>

        {/* ── Dashboard ── */}
        {view === "dashboard" && (
          <DashboardView leads={leads} campaigns={campaigns} onNavigate={(v) => setView(v)} />
        )}

        {/* ── Leads ── */}
        {view === "leads" && (() => {
          const q = searchQuery.trim().toLowerCase();
          const displayLeads = q
            ? sortLeads(
                filteredLeads.filter((l) =>
                  `${l.firstName} ${l.lastName} ${l.email} ${l.company} ${l.jobTitle}`.toLowerCase().includes(q)
                ),
                leadsSort,
              )
            : filteredLeads;
          const eligibleInView = displayLeads.filter(isCampaignEligible);
          const allEligibleChecked = eligibleInView.length > 0 && eligibleInView.every((l) => checkedIds.has(l.id));
          const someChecked = displayLeads.some((l) => checkedIds.has(l.id));
          const checkedCount = displayLeads.filter((l) => checkedIds.has(l.id)).length;
          const eligibleCheckedCount = displayLeads.filter((l) => checkedIds.has(l.id) && isCampaignEligible(l)).length;
          const ineligibleCheckedCount = checkedCount - eligibleCheckedCount;
          const canCreateCampaign = eligibleCheckedCount > 0 && ineligibleCheckedCount === 0;

          function toggleAll() {
            if (allEligibleChecked) {
              setCheckedIds((prev) => {
                const next = new Set(prev);
                eligibleInView.forEach((l) => next.delete(l.id));
                return next;
              });
            } else {
              setCheckedIds((prev) => {
                const next = new Set(prev);
                eligibleInView.forEach((l) => next.add(l.id));
                return next;
              });
            }
          }
          function toggleOne(id: string, e: React.MouseEvent) {
            e.stopPropagation();
            const lead = displayLeads.find((l) => l.id === id);
            if (!lead || !isCampaignEligible(lead)) return;
            setCheckedIds((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            });
          }

          return (
            <div className="flex flex-col h-full">
              {/* ── Top bar ── */}
              <div className="flex items-center justify-between px-8 py-4 border-b border-border shrink-0">
                {/* Left: entity toggle or selection state */}
                {someChecked ? (
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="text-sm font-semibold">
                      {checkedCount} selected
                      {ineligibleCheckedCount > 0 && (
                        <span className="text-muted-foreground font-normal"> · {ineligibleCheckedCount} not ready for outreach</span>
                      )}
                    </span>
                    <Button
                      size="sm" className="gap-1.5"
                      disabled={!canCreateCampaign}
                      title={!canCreateCampaign ? "Only enriched leads with a domain can be added to campaigns" : undefined}
                      onClick={() => { setShowCreateCampaign(true); }}
                    >
                      <Megaphone className="size-3.5" /> Create campaign ({eligibleCheckedCount})
                    </Button>
                    <button
                      type="button"
                      onClick={() => setCheckedIds(new Set())}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                    <button
                      type="button" onClick={() => setLeadsEntityMode("individual")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        leadsEntityMode === "individual" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Users className="size-3.5" /> Individual
                    </button>
                    <button
                      type="button" onClick={() => setLeadsEntityMode("orgs")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        leadsEntityMode === "orgs" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Building2 className="size-3.5" /> Organization
                    </button>
                  </div>
                )}

                {/* Right: view toggle + actions */}
                <div className="flex items-center gap-2">
                  {/* List | Kanban toggle — only for individual view */}
                  {leadsEntityMode === "individual" && (
                  <div className="flex items-center rounded-lg border border-border bg-card p-0.5">
                    <button
                      type="button" onClick={() => setLeadsViewMode("list")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        leadsViewMode === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <List className="size-3.5" /> List
                    </button>
                    <button
                      type="button" onClick={() => setLeadsViewMode("kanban")}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                        leadsViewMode === "kanban" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Kanban className="size-3.5" /> Kanban
                    </button>
                  </div>
                  )}
                  <Button
                    variant="outline" size="sm" className="gap-1.5"
                    disabled={loadingLeads}
                    onClick={() => session && loadLeads(session.access_token)}
                  >
                    <RefreshCw className={cn("size-3.5", loadingLeads && "animate-spin")} />
                    Refresh
                  </Button>
                  <Button size="sm" onClick={() => setShowAddLeads(true)} className="gap-1.5">
                    <Plus className="size-3.5" /> Add leads
                  </Button>
                </div>
              </div>

              {/* ── Search + Columns toolbar ── */}
              {leadsEntityMode === "individual" && leadsViewMode === "list" && (
                <div className="flex items-center gap-3 px-8 py-3 border-b border-border shrink-0">
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search leads…"
                      className="pl-8 h-8 text-sm"
                    />
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <select
                      value={leadsSort}
                      onChange={(e) => setLeadsSort(e.target.value as LeadsSort)}
                      className="h-8 text-xs rounded-md border border-border bg-background px-2"
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="az">A – Z</option>
                      <option value="za">Z – A</option>
                    </select>
                    <ColumnsDropdown visible={visibleCols} onChange={setVisibleCols} />
                    <span className="text-xs text-muted-foreground tabular-nums">{displayLeads.length} leads</span>
                  </div>
                </div>
              )}

              {/* ── Content ── */}
              <div className="flex-1 overflow-auto px-8 py-5">
                {loadingLeads ? (
                  <div className="flex items-center justify-center py-16">
                    <p className="text-sm text-muted-foreground">Loading leads...</p>
                  </div>
                ) : leadsEntityMode === "orgs" ? (() => {
                  // Build org rows from leads
                  const orgMap = new Map<string, OrgRow>();
                  for (const lead of leads) {
                    if (!lead.orgId) continue;
                    if (!orgMap.has(lead.orgId)) {
                      orgMap.set(lead.orgId, {
                        id: lead.orgId,
                        name: lead.company,
                        domain: lead.domain,
                        enrichmentStage: lead.enrichmentStage,
                        companyDescription: lead.companyDescription,
                        sellsTo: lead.sellsTo,
                        leads: [],
                      });
                    }
                    orgMap.get(lead.orgId)!.leads.push(lead);
                  }
                  const orgRows = Array.from(orgMap.values());

                  return (
                    <div className="flex gap-5 h-full">
                      {/* Orgs table */}
                      <div className={cn("rounded-xl border border-border bg-card shadow-sm overflow-hidden", selectedOrg ? "flex-1" : "w-full")}>
                        <Table>
                          <TableHeader>
                            <TableRow className="border-border hover:bg-transparent">
                              <TableHead className="text-xs font-semibold text-muted-foreground">Organization</TableHead>
                              <TableHead className="text-xs font-semibold text-muted-foreground w-8" title="Enrichment" />
                              <TableHead className="text-xs font-semibold text-muted-foreground">Domain</TableHead>
                              <TableHead className="text-xs font-semibold text-muted-foreground">Description</TableHead>
                              <TableHead className="text-xs font-semibold text-muted-foreground">Sells To</TableHead>
                              <TableHead className="text-xs font-semibold text-muted-foreground text-right">Leads</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {orgRows.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={6} className="text-center py-12 text-sm text-muted-foreground">
                                  No organizations found. Add leads with a domain to populate this view.
                                </TableCell>
                              </TableRow>
                            ) : (
                              orgRows.map((org) => (
                                <TableRow
                                  key={org.id}
                                  onClick={() => setSelectedOrg(selectedOrg?.id === org.id ? null : org)}
                                  className={cn(
                                    "cursor-pointer border-border transition-colors hover:bg-secondary/40",
                                    selectedOrg?.id === org.id && "bg-secondary/30",
                                  )}
                                >
                                  <TableCell>
                                    <div className="flex items-center gap-2.5">
                                      <div className="size-7 rounded-md bg-secondary border border-border flex items-center justify-center shrink-0">
                                        <Building2 className="size-3.5 text-muted-foreground" />
                                      </div>
                                      <p className="text-sm font-semibold">{org.name || "—"}</p>
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-center">
                                    <EnrichDot stage={org.enrichmentStage} />
                                  </TableCell>
                                  <TableCell><span className="text-xs text-muted-foreground">{org.domain || "—"}</span></TableCell>
                                  <TableCell className="max-w-xs">
                                    <span className="text-xs text-muted-foreground line-clamp-2">{org.companyDescription || "—"}</span>
                                  </TableCell>
                                  <TableCell className="max-w-xs">
                                    <span className="text-xs text-muted-foreground line-clamp-2">{org.sellsTo || "—"}</span>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <span className="text-xs font-semibold tabular-nums">{org.leads.length}</span>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>

                      {/* Org detail panel */}
                      {selectedOrg && (
                        <div className="w-80 shrink-0 rounded-xl border border-border bg-card shadow-sm overflow-hidden flex flex-col">
                          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <p className="text-sm font-semibold truncate">{selectedOrg.name}</p>
                            <button
                              type="button"
                              onClick={() => setSelectedOrg(null)}
                              className="text-muted-foreground hover:text-foreground transition-colors ml-2 shrink-0"
                            >
                              <span className="sr-only">Close</span>
                              <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M18 6 6 18M6 6l12 12"/></svg>
                            </button>
                          </div>
                          <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            <div className="flex items-center gap-2">
                              <EnrichDot stage={selectedOrg.enrichmentStage} />
                              <span className="text-xs text-muted-foreground capitalize">{selectedOrg.enrichmentStage ?? "not queued"}</span>
                            </div>
                            {selectedOrg.domain && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Domain</p>
                                <p className="text-sm">{selectedOrg.domain}</p>
                              </div>
                            )}
                            {selectedOrg.companyDescription && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">About</p>
                                <p className="text-sm text-muted-foreground leading-relaxed">{selectedOrg.companyDescription}</p>
                              </div>
                            )}
                            {selectedOrg.sellsTo && (
                              <div>
                                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">Sells To</p>
                                <p className="text-sm text-muted-foreground">{selectedOrg.sellsTo}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Leads ({selectedOrg.leads.length})</p>
                              <div className="space-y-2">
                                {selectedOrg.leads.map((lead) => (
                                  <button
                                    key={lead.id}
                                    type="button"
                                    onClick={() => setSelectedLead(lead)}
                                    className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-secondary transition-colors text-left"
                                  >
                                    <Avatar name={`${lead.firstName} ${lead.lastName}`} size="sm" />
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold truncate">{lead.firstName} {lead.lastName}</p>
                                      <p className="text-[11px] text-muted-foreground truncate">{lead.jobTitle || lead.email}</p>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })() : leadsViewMode === "kanban" ? (
                  <KanbanBoard leads={leads} onCardClick={(lead) => setSelectedLead(lead)} />
                ) : (
                  <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border hover:bg-transparent">
                          {/* Select-all checkbox */}
                          <TableHead className="w-10 pl-4">
                            <span
                              onClick={toggleAll}
                              className={cn(
                                "flex size-4 cursor-pointer rounded border items-center justify-center transition-colors",
                                allEligibleChecked ? "bg-primary border-primary" : someChecked ? "bg-primary/40 border-primary/60" : "border-border hover:border-muted-foreground",
                              )}
                            >
                              {(allEligibleChecked || someChecked) && <Check className="size-2.5 text-primary-foreground" />}
                            </span>
                          </TableHead>
                          <TableHead className="w-12">
                            <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-muted-foreground">
                              <InfoTip text={CAMPAIGN_ACTION_HELP.enrichmentColumn} />
                            </span>
                          </TableHead>
                          <TableHead className="text-xs font-semibold text-muted-foreground">Lead</TableHead>
                          {visibleCols.organization && <TableHead className="text-xs font-semibold text-muted-foreground">Organization</TableHead>}
                          {visibleCols.email     && <TableHead className="text-xs font-semibold text-muted-foreground">Email</TableHead>}
                          {visibleCols.phone     && <TableHead className="text-xs font-semibold text-muted-foreground">Phone</TableHead>}
                          {visibleCols.job_title && <TableHead className="text-xs font-semibold text-muted-foreground">Job Title</TableHead>}
                          {visibleCols.status    && (
                            <TableHead className="text-xs font-semibold text-muted-foreground">
                              <span className="inline-flex items-center gap-0.5">
                                Status <InfoTip text={CAMPAIGN_ACTION_HELP.statusColumn} />
                              </span>
                            </TableHead>
                          )}
                          {visibleCols.score     && <TableHead className="text-xs font-semibold text-muted-foreground">Score</TableHead>}
                          {visibleCols.source    && <TableHead className="text-xs font-semibold text-muted-foreground">Source</TableHead>}
                          {visibleCols.domain    && <TableHead className="text-xs font-semibold text-muted-foreground">Domain</TableHead>}
                          {visibleCols.country   && <TableHead className="text-xs font-semibold text-muted-foreground">Country</TableHead>}
                          {visibleCols.campaign  && <TableHead className="text-xs font-semibold text-muted-foreground">Campaign</TableHead>}
                          {visibleCols.added     && <TableHead className="text-xs font-semibold text-muted-foreground">Added</TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {displayLeads.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={13} className="text-center py-12 text-sm text-muted-foreground">
                              {searchQuery ? `No leads match "${searchQuery}".` : "No leads yet. Click \"Add leads\" to get started."}
                            </TableCell>
                          </TableRow>
                        ) : (
                          displayLeads.map((lead) => {
                            const isChecked = checkedIds.has(lead.id);
                            const eligible = isCampaignEligible(lead);
                            const ineligibleReason = campaignIneligibleReason(lead);
                            return (
                              <TableRow
                                key={lead.id}
                                onClick={() => setSelectedLead(lead)}
                                className={cn(
                                  "cursor-pointer border-border transition-colors hover:bg-secondary/40",
                                  isChecked && "bg-secondary/30",
                                  !eligible && "opacity-60",
                                )}
                              >
                                <TableCell className="pl-4" onClick={(e) => toggleOne(lead.id, e)}>
                                  <span
                                    title={ineligibleReason ?? undefined}
                                    className={cn(
                                      "flex size-4 rounded border items-center justify-center transition-colors",
                                      !eligible && "cursor-not-allowed opacity-40",
                                      eligible && "cursor-pointer",
                                      isChecked && eligible ? "bg-primary border-primary" : eligible ? "border-border hover:border-muted-foreground" : "border-border",
                                    )}
                                  >
                                    {isChecked && eligible && <Check className="size-2.5 text-primary-foreground" />}
                                  </span>
                                </TableCell>
                                <TableCell className="text-center">
                                  <EnrichDot stage={lead.enrichmentStage} />
                                </TableCell>
                                <TableCell>
                                  <div className="flex items-center gap-2.5">
                                    <Avatar name={`${lead.firstName} ${lead.lastName}`} size="sm" />
                                    <p className="text-sm font-semibold">{lead.firstName} {lead.lastName}</p>
                                  </div>
                                </TableCell>
                                {visibleCols.organization && <TableCell><span className="text-sm">{lead.company || "—"}</span></TableCell>}
                                {visibleCols.email     && <TableCell><span className="text-xs text-muted-foreground">{lead.email}</span></TableCell>}
                                {visibleCols.phone     && <TableCell><span className="text-xs text-muted-foreground">{lead.phone || "—"}</span></TableCell>}
                                {visibleCols.job_title && <TableCell><span className="text-sm">{lead.jobTitle}</span></TableCell>}
                                {visibleCols.status    && <TableCell><StatusBadge status={lead.status} /></TableCell>}
                                {visibleCols.score     && <TableCell><ScoreBadge score={lead.score} /></TableCell>}
                                {visibleCols.source    && <TableCell><span className="text-xs text-muted-foreground">{lead.source}</span></TableCell>}
                                {visibleCols.domain    && <TableCell><span className="text-xs text-muted-foreground">{lead.domain || "—"}</span></TableCell>}
                                {visibleCols.country   && <TableCell><span className="text-xs text-muted-foreground">{lead.country || "—"}</span></TableCell>}
                                {visibleCols.campaign && (
                                  <TableCell>
                                    {lead.campaigns.length > 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        {lead.campaigns.map((c) => (
                                          <span key={c.id} className="text-[10px] font-medium bg-secondary border border-border rounded px-1.5 py-0.5 text-muted-foreground whitespace-nowrap">
                                            {c.name}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs text-muted-foreground">—</span>
                                    )}
                                  </TableCell>
                                )}
                                {visibleCols.added     && <TableCell><span className="text-xs text-muted-foreground">{lead.createdAt}</span></TableCell>}
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* ── Campaigns ── */}
        {view === "campaigns" && (
          selectedCampaign ? (
            <CampaignDetail
              campaign={selectedCampaign}
              onBack={() => setSelectedCampaign(null)}
            />
          ) : (
          <div className="max-w-5xl mx-auto p-8 space-y-6">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Outreach</p>
              <h1 className="text-2xl font-bold">Campaigns</h1>
            </div>
            {campaigns.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-12 text-center">
                <p className="text-sm text-muted-foreground">No campaigns yet. Create one to start sending outreach emails.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {campaigns.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedCampaign(c)}
                    className="w-full rounded-xl border border-border bg-card shadow-sm p-5 flex items-center gap-5 text-left transition-colors hover:bg-secondary/30"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.status} · {c.humanInLoop ? "Human review ON" : "Auto-send"}</p>
                    </div>
                    <div className="flex items-center gap-6">
                      {[["Leads", c.leads], ["Sent", c.sent], ["Replied", c.replied]].map(([k, v]) => (
                        <div key={String(k)} className="text-center">
                          <p className="text-xl font-bold tabular-nums">{v}</p>
                          <p className="text-[10px] text-muted-foreground uppercase">{k}</p>
                        </div>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          )
        )}
      </main>

      <CreateCampaignModal
        open={showCreateCampaign}
        onClose={() => { setShowCreateCampaign(false); setCheckedIds(new Set()); }}
        onCreated={(c) => {
          setCampaigns((p) => [c, ...p]);
          setView("campaigns");
          setSelectedCampaign(c);
          setShowCreateCampaign(false);
          setCheckedIds(new Set());
          if (session) void loadCampaigns(session.access_token);
        }}
        leads={leads.filter((l) => checkedIds.has(l.id) && isCampaignEligible(l))}
      />

      <AddLeadsDrawer
        open={showAddLeads}
        onClose={() => setShowAddLeads(false)}
        onImport={handleImport}
      />

      <LeadDrawer
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
        onLeadUpdated={(updated) => {
          setLeads((prev) => prev.map((l) => l.id === updated.id ? updated : l));
          setSelectedLead(updated);
        }}
      />
    </div>
  );
}
