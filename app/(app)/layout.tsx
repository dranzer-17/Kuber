"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import {
  LayoutDashboard, Users, Megaphone, Settings,
  RefreshCw, Trash2, AlertTriangle,
} from "lucide-react";
import { AppProvider, useApp } from "@/lib/app-context";
import { isCampaignEligible, type Lead } from "@/lib/leads";
import { deleteLead } from "@/lib/api-client";
import { CreateCampaignModal } from "@/components/app/create-campaign-modal";
import { LeadDrawer } from "@/components/app/lead-drawer";
import { OrgDrawer } from "@/components/app/org-drawer";
import { AddLeadsDrawer } from "@/components/app/add-leads-drawer";
import { cn } from "@/lib/utils";

// ── Delete confirm modal (for leads) ─────────────────────────────────────────

function DeleteConfirmModal({
  open,
  title,
  description,
  loading,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm mx-4 rounded-2xl border border-border bg-card shadow-2xl p-6 flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <div className="shrink-0 size-10 rounded-full bg-red-500/15 border border-red-500/25 flex items-center justify-center">
            <AlertTriangle className="size-5 text-red-400" />
          </div>
          <div>
            <p className="font-semibold text-sm">{title}</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── App shell (uses context) ──────────────────────────────────────────────────

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard",  icon: LayoutDashboard, exact: true  },
  { href: "/leads",     label: "Leads",      icon: Users,           exact: false },
  { href: "/campaigns", label: "Campaigns",  icon: Megaphone,       exact: false },
  { href: "/settings",  label: "Settings",   icon: Settings,        exact: false },
] as const;

function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    session,
    loadingSession,
    leads,
    setLeads,
    loadCampaigns,
    setCampaigns,
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
  } = useApp();

  // Auth guard
  useEffect(() => {
    if (!loadingSession && !session) {
      router.replace("/");
    }
  }, [loadingSession, session, router]);

  if (loadingSession) {
    return (
      <div className="h-screen flex bg-background overflow-hidden">
        {/* Sidebar skeleton */}
        <aside className="w-56 shrink-0 border-r border-border flex flex-col bg-card animate-pulse">
          <div className="px-4 py-5 border-b border-border flex items-center gap-2.5">
            <div className="size-8 bg-secondary rounded-lg" />
            <div className="h-4 w-16 bg-secondary rounded" />
          </div>
          <nav className="flex-1 p-2 space-y-1">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 bg-secondary/60 rounded-lg" />
            ))}
          </nav>
        </aside>
        {/* Content skeleton */}
        <main className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </main>
      </div>
    );
  }

  if (!session) {
    // Will redirect via useEffect; render nothing to avoid flash
    return null;
  }

  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  function handleImport() {
    if (session) void loadCampaigns(session.access_token);
  }

  return (
    <>
      <div className="h-screen flex bg-background overflow-hidden">
        <aside className="w-56 shrink-0 border-r border-border flex flex-col bg-card">
          <div className="px-4 py-5 border-b border-border flex items-center gap-2.5">
            <div className="size-8 bg-foreground rounded-lg flex items-center justify-center">
              <span className="text-background text-sm font-black">K</span>
            </div>
            <span className="font-bold">Kuber</span>
          </div>
          <nav className="flex-1 p-2 space-y-0.5">
            {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact);
              const badge = label === "Leads" ? leads.length : null;
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                    active
                      ? "bg-secondary text-white font-semibold"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-white",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 text-left">{label}</span>
                  {badge !== null && (
                    <span className="text-[10px] font-semibold bg-secondary rounded-full px-1.5 py-0.5 tabular-nums">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
          <div className="p-3 border-t border-border">
            <p className="text-[11px] text-muted-foreground truncate px-1">{session.user.email}</p>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      {/* ── Overlays ── */}

      <DeleteConfirmModal
        open={!!deletingLead}
        title={`Delete ${deletingLead ? `${deletingLead.firstName} ${deletingLead.lastName}`.trim() : "lead"}?`}
        description="This will permanently remove the lead and all associated data. This cannot be undone."
        loading={deleteLeadLoading}
        onClose={() => { if (!deleteLeadLoading) setDeletingLead(null); }}
        onConfirm={async () => {
          if (!deletingLead || !session) return;
          setDeleteLeadLoading(true);
          try {
            await deleteLead(session.access_token, deletingLead.id);
            setLeads((prev) => prev.filter((l) => l.id !== deletingLead.id));
            setDeletingLead(null);
          } finally {
            setDeleteLeadLoading(false);
          }
        }}
      />

      <CreateCampaignModal
        open={showCreateCampaign}
        onClose={() => { setShowCreateCampaign(false); setCheckedIds(new Set()); }}
        onCreated={(c) => {
          setCampaigns((p) => [c, ...p]);
          setShowCreateCampaign(false);
          setCheckedIds(new Set());
          router.push(`/campaigns/${c.id}`);
        }}
        leads={leads.filter((l) => checkedIds.has(l.id) && isCampaignEligible(l))}
      />

      <AddLeadsDrawer
        open={showAddLeads}
        onClose={() => { setShowAddLeads(false); setManualPrefill(null); }}
        onImport={handleImport}
        defaultTab={manualPrefill ? "manual" : "apollo"}
        prefillOrg={manualPrefill?.prefillOrg}
        prefillLeads={manualPrefill?.prefillLeads}
        editMode={manualPrefill?.editMode}
      />

      <LeadDrawer
        lead={selectedLead}
        onClose={() => setSelectedLead(null)}
        onLeadUpdated={(updated) => {
          setLeads((prev) => prev.map((l) => l.id === updated.id ? updated : l));
          setSelectedLead(updated);
        }}
        onOrgClick={(id) => setSelectedOrgId(id)}
      />

      <OrgDrawer
        orgId={selectedOrgId}
        onClose={() => setSelectedOrgId(null)}
        onLeadClick={(leadId) => {
          const found = leads.find((l) => l.id === leadId);
          if (found) {
            setSelectedOrgId(null);
            setSelectedLead(found);
          } else {
            // Build minimal shell — LeadDrawer fetches fresh data on mount
            setSelectedOrgId(null);
            setSelectedLead({ id: leadId, firstName: "", lastName: "", email: "", company: "", domain: "", phone: "", jobTitle: "", country: "", status: "Enriched", score: "—", source: "Apollo", campaign: "", campaigns: [], createdAt: new Date().toISOString(), orgId: null, enrichmentStage: null, companyDescription: null, sellsTo: null, lastError: null, hasScraped: false, importId: null, batchLabel: null, batchColor: null } satisfies Lead);
          }
        }}
        onAddLead={(org) => {
          setSelectedOrgId(null);
          setSelectedLead(null);
          setManualPrefill({
            prefillOrg: { id: org.id, name: org.name, industry: org.industry, domain: org.domain, country: org.country },
            prefillLeads: org.leads,
            editMode: true,
          });
          setShowAddLeads(true);
        }}
      />
    </>
  );
}

// ── Layout export (wraps with provider) ──────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <AppShell>{children}</AppShell>
    </AppProvider>
  );
}
