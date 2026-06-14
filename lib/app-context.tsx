"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isAdminUser, isValidAdminSession } from "@/lib/auth/admin";
import { type Lead } from "@/lib/leads";
import { type Campaign } from "@/components/app/create-campaign-modal";
import { supabase } from "@/lib/supabase";
import { fetchLeads, fetchCampaigns, rescrapeOrg } from "@/lib/api-client";

export type PrefillData = {
  prefillOrg?: { id?: string; name: string; industry: string; domain: string; country: string };
  prefillLeads?: Array<{ firstName: string; lastName: string; email: string; jobTitle: string; id?: string }>;
  editMode?: boolean;
};

type AppContextValue = {
  // Auth
  session: Session | null;
  loadingSession: boolean;

  // Leads
  leads: Lead[];
  setLeads: React.Dispatch<React.SetStateAction<Lead[]>>;
  loadLeads: (token: string) => Promise<void>;
  loadingLeads: boolean;

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

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session,        setSession       ] = useState<Session | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);

  const [leads,            setLeads          ] = useState<Lead[]>([]);
  const [loadingLeads,     setLoadingLeads   ] = useState(false);
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
    setLoadingCampaigns(true);
    try {
      const list = await fetchCampaigns(token);
      setCampaigns(list);
    } catch { /* silently ignore */ } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    const token = session.access_token;
    void loadLeads(token);
    void loadCampaigns(token);
  }, [session, loadLeads, loadCampaigns]);

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
    leads,
    setLeads,
    loadLeads,
    loadingLeads,
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
