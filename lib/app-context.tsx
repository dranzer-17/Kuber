"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isAppUser, getUserRole, type AppRole } from "@/lib/auth/roles";
import { type Lead } from "@/lib/leads";
import { type Campaign } from "@/components/app/create-campaign-modal";
import { supabase } from "@/lib/supabase";
import { fetchLeads, fetchLeadsCount, fetchCampaigns, rescrapeOrg } from "@/lib/api-client";

export type PrefillData = {
  prefillOrg?: { id?: string; name: string; industry: string; domain: string; country: string };
  prefillLeads?: Array<{ firstName: string; lastName: string; email: string; jobTitle: string; id?: string }>;
  editMode?: boolean;
};

type AppContextValue = {
  // Auth
  session: Session | null;
  loadingSession: boolean;
  role: AppRole | null;

  // Leads
  leads: Lead[];
  setLeads: React.Dispatch<React.SetStateAction<Lead[]>>;
  leadsTotal: number | null;
  loadLeads: (token: string) => Promise<void>;
  loadingLeads: boolean;
  loadMoreLeads: (token: string) => Promise<void>;
  loadingMoreLeads: boolean;
  searchLeads: (token: string, query: string) => Promise<{ leads: Lead[]; total: number }>;

  // Campaigns
  campaigns: Campaign[];
  setCampaigns: React.Dispatch<React.SetStateAction<Campaign[]>>;
  loadCampaigns: (token: string) => Promise<void>;
  loadingCampaigns: boolean;

  // Enrichment
  enrichingIds: Set<string>;
  handleEnrichLead: (lead: Lead) => Promise<void>;

  // Selection / UI state
  checkedIds: Set<string>;
  setCheckedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedLead: Lead | null;
  setSelectedLead: React.Dispatch<React.SetStateAction<Lead | null>>;
  selectedOrgId: string | null;
  setSelectedOrgId: React.Dispatch<React.SetStateAction<string | null>>;

  // Add-leads drawer
  showAddLeads: boolean;
  setShowAddLeads: React.Dispatch<React.SetStateAction<boolean>>;
  manualPrefill: PrefillData | null;
  setManualPrefill: React.Dispatch<React.SetStateAction<PrefillData | null>>;

  // Campaign creation
  showCreateCampaign: boolean;
  setShowCreateCampaign: React.Dispatch<React.SetStateAction<boolean>>;

  // Delete lead
  deletingLead: Lead | null;
  setDeletingLead: React.Dispatch<React.SetStateAction<Lead | null>>;
  deleteLeadLoading: boolean;
  setDeleteLeadLoading: React.Dispatch<React.SetStateAction<boolean>>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

async function resolveSession(): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const { data, error } = await supabase.auth.getClaims(session.access_token);
  if (error || !data?.claims) return null;

  const user = {
    app_metadata: data.claims.app_metadata,
  } as Parameters<typeof isAppUser>[0];
  if (!isAppUser(user)) {
    await supabase.auth.signOut();
    return null;
  }
  return session;
}

export function AppProvider({
  children,
  initialSession = null,
  initialLeadsTotal = null,
}: {
  children: React.ReactNode;
  initialSession?: Session | null;
  initialLeadsTotal?: number | null;
}) {
  const [session,        setSession       ] = useState<Session | null>(initialSession);
  const [loadingSession, setLoadingSession] = useState(!initialSession);

  const [leads,            setLeads          ] = useState<Lead[]>([]);
  const [leadsTotal,       setLeadsTotal     ] = useState<number | null>(initialLeadsTotal);
  const [loadingLeads,     setLoadingLeads   ] = useState(false);
  const [loadingMoreLeads, setLoadingMoreLeads] = useState(false);
  const [campaigns,        setCampaigns      ] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);

  const [enrichingIds,       setEnrichingIds      ] = useState<Set<string>>(new Set());
  const [checkedIds,         setCheckedIds        ] = useState<Set<string>>(new Set());
  const [selectedLead,       setSelectedLead      ] = useState<Lead | null>(null);
  const [selectedOrgId,      setSelectedOrgId     ] = useState<string | null>(null);
  const [showAddLeads,       setShowAddLeads      ] = useState(false);
  const [manualPrefill,      setManualPrefill     ] = useState<PrefillData | null>(null);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);
  const [deletingLead,       setDeletingLead      ] = useState<Lead | null>(null);
  const [deleteLeadLoading,  setDeleteLeadLoading ] = useState(false);

  // ── Auth ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;

    if (!initialSession) {
      void resolveSession().then((s) => {
        if (!mounted) return;
        setSession(s);
        setLoadingSession(false);
      });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, s) => {
      if (!mounted) return;
      // Browser client can emit INITIAL_SESSION=null before cookies hydrate; keep server session.
      if (event === "INITIAL_SESSION" && !s && initialSession) return;
      if (event === "SIGNED_OUT") {
        setSession(null);
        setLoadingSession(false);
        return;
      }
      if (!s?.user || !isAppUser(s.user)) {
        if (s?.user && !isAppUser(s.user)) await supabase.auth.signOut();
        setSession(null);
        setLoadingSession(false);
        return;
      }
      setSession(s);
      setLoadingSession(false);
    });

    return () => { mounted = false; subscription.unsubscribe(); };
  }, [initialSession]);

  // ── Data fetching ─────────────────────────────────────────────────────────

  // Supabase's project-level API row cap silently truncates a single request
  // no matter what `limit` we pass it (no error — it just hands back fewer
  // rows than asked, while `count` still reports the true total). Paging in
  // fixed-size chunks and stopping once a page comes back short is what lets
  // us actually reach `total`, whatever that per-request cap happens to be.
  const LEADS_PAGE_SIZE = 500;

  // Offset pagination (page/limit) drifts under concurrent writes: a row
  // fetched on page 1 can reappear on page 2 if a newer lead got inserted
  // in between (it shifts everything after it down by one in the
  // created_at-desc ordering). Dedupe by id while merging pages rather than
  // trying to hold the underlying table still — the alternative is keyset
  // pagination, which isn't worth it for an admin list view like this.
  const fetchLeadsUpTo = useCallback(async (token: string, count: number) => {
    const seen = new Set<string>();
    const all: Lead[] = [];
    let total = 0;
    for (let page = 1; all.length < count; page++) {
      const res = await fetchLeads(token, { limit: LEADS_PAGE_SIZE, page });
      for (const lead of res.leads) {
        if (seen.has(lead.id)) continue;
        seen.add(lead.id);
        all.push(lead);
      }
      total = res.total;
      if (res.leads.length < LEADS_PAGE_SIZE) break; // server had no more to give
    }
    return { leads: all, total };
  }, []);

  // Re-fetches however many leads are already loaded (not just the first
  // page) so the 30s background poll refreshes statuses without discarding
  // anything loadMoreLeads had pulled in.
  const loadLeads = useCallback(async (token: string) => {
    setLoadingLeads(true);
    try {
      const targetCount = Math.max(leads.length, LEADS_PAGE_SIZE);
      const { leads: list, total } = await fetchLeadsUpTo(token, targetCount);
      setLeads(list);
      setLeadsTotal(total);
    } catch { /* silently ignore */ }
    finally { setLoadingLeads(false); }
  }, [leads.length, fetchLeadsUpTo]);

  const loadMoreLeads = useCallback(async (token: string) => {
    setLoadingMoreLeads(true);
    try {
      const targetCount = leads.length + LEADS_PAGE_SIZE;
      const { leads: list, total } = await fetchLeadsUpTo(token, targetCount);
      setLeads(list);
      setLeadsTotal(total);
    } catch { /* silently ignore */ }
    finally { setLoadingMoreLeads(false); }
  }, [leads.length, fetchLeadsUpTo]);

  // Runs the search against the DB (not the client-loaded `leads` subset) so
  // it finds a match anywhere in the table, not just among the leads already
  // paged in. Independent of `leads` state — never touches it.
  const searchLeads = useCallback(async (token: string, query: string): Promise<{ leads: Lead[]; total: number }> => {
    const seen = new Set<string>();
    const all: Lead[] = [];
    let total = 0;
    for (let page = 1; ; page++) {
      const res = await fetchLeads(token, { limit: LEADS_PAGE_SIZE, page, q: query });
      for (const lead of res.leads) {
        if (seen.has(lead.id)) continue;
        seen.add(lead.id);
        all.push(lead);
      }
      total = res.total;
      if (res.leads.length < LEADS_PAGE_SIZE || all.length >= total) break;
    }
    return { leads: all, total };
  }, []);

  const loadCampaigns = useCallback(async (token: string) => {
    setLoadingCampaigns(true);
    try {
      const list = await fetchCampaigns(token);
      setCampaigns(list);
    } catch { /* silently ignore */ } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  useEffect(() => {
    if (!session) {
      setLeads([]);
      setLeadsTotal(null);
      setCampaigns([]);
      return;
    }
    if (initialLeadsTotal === null) {
      fetchLeadsCount(session.access_token)
        .then((total) => setLeadsTotal(total))
        .catch(() => {});
    }
  }, [session, initialLeadsTotal]);

  // ── Enrichment ────────────────────────────────────────────────────────────

  const handleEnrichLead = useCallback(async (lead: Lead) => {
    if (!lead.orgId || !session) return;
    setEnrichingIds((prev) => new Set(prev).add(lead.id));
    try {
      await rescrapeOrg(session.access_token, lead.orgId);
      setTimeout(() => { if (session) void loadLeads(session.access_token); }, 800);
    } catch { /* non-fatal */ }
    finally {
      setEnrichingIds((prev) => { const next = new Set(prev); next.delete(lead.id); return next; });
    }
  }, [session, loadLeads]);

  const value: AppContextValue = {
    session,
    loadingSession,
    role: getUserRole(session?.user),
    leads,
    setLeads,
    leadsTotal,
    loadLeads,
    loadingLeads,
    loadMoreLeads,
    loadingMoreLeads,
    searchLeads,
    campaigns,
    setCampaigns,
    loadCampaigns,
    loadingCampaigns,
    enrichingIds,
    handleEnrichLead,
    checkedIds,
    setCheckedIds,
    selectedLead,
    setSelectedLead,
    selectedOrgId,
    setSelectedOrgId,
    showAddLeads,
    setShowAddLeads,
    manualPrefill,
    setManualPrefill,
    showCreateCampaign,
    setShowCreateCampaign,
    deletingLead,
    setDeletingLead,
    deleteLeadLoading,
    setDeleteLeadLoading,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
