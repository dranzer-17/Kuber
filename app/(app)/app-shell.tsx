"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  LayoutDashboard, Users, Megaphone, Settings, Inbox,
  RefreshCw, Trash2, AlertTriangle, Menu,
} from "lucide-react";
import { useApp } from "@/lib/app-context";
import { ThemeProvider } from "@/lib/theme-context";
import { APP_LOGO_INITIAL, APP_NAME } from "@/lib/branding";
import { isCampaignEligible, type Lead } from "@/lib/leads";
import { deleteLead, fetchLogo, fetchUniboxUnread } from "@/lib/api-client";
import { RouteSkeleton } from "@/components/app/page-skeletons";
import { cn } from "@/lib/utils";

const CreateCampaignModal = dynamic(
  () => import("@/components/app/create-campaign-modal").then((m) => m.CreateCampaignModal),
  { ssr: false },
);
const LeadDrawer = dynamic(
  () => import("@/components/app/lead-drawer").then((m) => m.LeadDrawer),
  { ssr: false },
);
const OrgDrawer = dynamic(
  () => import("@/components/app/org-drawer").then((m) => m.OrgDrawer),
  { ssr: false },
);
const AddLeadsDrawer = dynamic(
  () => import("@/components/app/add-leads-drawer").then((m) => m.AddLeadsDrawer),
  { ssr: false },
);

function DeleteConfirmModal({
  open, title, description, loading, onClose, onConfirm,
}: {
  open: boolean; title: string; description: string; loading?: boolean;
  onClose: () => void; onConfirm: () => void;
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
          <button type="button" onClick={onClose} disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-border bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={loading}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-60 flex items-center gap-2">
            {loading ? <RefreshCw className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

const SIDEBAR_COLLAPSED_KEY = "kuber_sidebar_collapsed";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard",  icon: LayoutDashboard, exact: true  },
  { href: "/leads",     label: "Leads",      icon: Users,           exact: false },
  { href: "/campaigns", label: "Campaigns",  icon: Megaphone,       exact: false },
  { href: "/unibox",    label: "Unibox",     icon: Inbox,           exact: false },
  { href: "/settings",  label: "Settings",   icon: Settings,        exact: false },
] as const;

function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    session, loadingSession, leads, setLeads, leadsTotal, loadCampaigns, setCampaigns,
    checkedIds, setCheckedIds, selectedLead, setSelectedLead, selectedOrgId, setSelectedOrgId,
    showAddLeads, setShowAddLeads, manualPrefill, setManualPrefill,
    showCreateCampaign, setShowCreateCampaign, deletingLead, setDeletingLead,
    deleteLeadLoading, setDeleteLeadLoading,
  } = useApp();

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uniboxUnread, setUniboxUnread] = useState<number | null>(null);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  });

  function toggleSidebar() {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  }

  useEffect(() => { setPendingHref(null); }, [pathname]);

  useEffect(() => {
    if (!loadingSession && !session) router.replace("/");
  }, [loadingSession, session, router]);

  useEffect(() => {
    if (!session) return;
    fetchLogo(session.access_token).then((r) => setLogoUrl(r.logo_url)).catch(() => setLogoUrl(null));
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const load = () => {
      fetchUniboxUnread(session.access_token).then((r) => setUniboxUnread(r.unread)).catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [session]);

  if (loadingSession) {
    return (
      <div className="h-screen flex bg-background overflow-hidden">
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
        <main className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading...</p>
        </main>
      </div>
    );
  }

  if (!session) return null;

  function handleNavClick(href: string) {
    if (href === pathname || (href !== "/dashboard" && pathname.startsWith(href))) return;
    setPendingHref(href);
    startTransition(() => { router.push(href); });
  }

  const showRouteSkeleton = pendingHref !== null && pendingHref !== pathname;
  const skeletonHref = pendingHref ?? pathname;

  function isActive(href: string, exact: boolean) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <>
      <div className="h-screen flex bg-background overflow-hidden">
        <aside
          className={cn(
            "shrink-0 border-r border-border flex flex-col bg-card transition-[width] duration-200",
            sidebarCollapsed ? "w-16" : "w-56",
          )}
        >
          <div
            className={cn(
              "border-b border-border flex items-center",
              sidebarCollapsed ? "flex-col gap-2 px-2 py-4" : "gap-2.5 px-4 py-5",
            )}
          >
            <button
              type="button"
              onClick={toggleSidebar}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="shrink-0 size-8 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
            >
              <Menu className="size-4" />
            </button>
            {!sidebarCollapsed && (
              <>
                {logoUrl ? (
                  <img src={logoUrl} alt="Brand logo" className="size-8 rounded-lg border border-border bg-card object-contain shrink-0" />
                ) : (
                  <div className="size-8 bg-foreground rounded-lg flex items-center justify-center shrink-0">
                    <span className="text-background text-sm font-black">{APP_LOGO_INITIAL}</span>
                  </div>
                )}
                <span className="font-bold truncate">{APP_NAME}</span>
              </>
            )}
          </div>
          <nav className="flex-1 p-2 space-y-0.5">
            {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact);
              const badge = label === "Leads" ? leadsTotal : label === "Unibox" ? uniboxUnread : null;
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch
                  title={sidebarCollapsed ? label : undefined}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    handleNavClick(href);
                  }}
                  className={cn(
                    "w-full flex items-center rounded-lg text-sm font-medium transition-colors relative",
                    sidebarCollapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2",
                    active
                      ? "bg-primary/15 text-primary font-semibold"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {!sidebarCollapsed && <span className="flex-1 text-left">{label}</span>}
                  {badge !== null && badge > 0 && (
                    sidebarCollapsed ? (
                      <span className="absolute top-1 right-1.5 size-1.5 rounded-full bg-primary" />
                    ) : (
                      <span className="text-[10px] font-semibold bg-secondary rounded-full px-1.5 py-0.5 tabular-nums">
                        {badge}
                      </span>
                    )
                  )}
                </Link>
              );
            })}
          </nav>
          <div className={cn("border-t border-border", sidebarCollapsed ? "p-2 flex justify-center" : "p-3")}>
            {sidebarCollapsed ? (
              <div
                className="size-7 rounded-full bg-secondary flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0"
                title={session.user.email}
              >
                {session.user.email?.[0]?.toUpperCase() ?? "?"}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground truncate px-1">{session.user.email}</p>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto">
          {showRouteSkeleton ? <RouteSkeleton href={skeletonHref} /> : children}
        </main>
      </div>

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
        onImport={() => { if (session) void loadCampaigns(session.access_token); }}
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

export function ThemedAppShell({ children }: { children: React.ReactNode }) {
  const { session } = useApp();
  return (
    <ThemeProvider session={session}>
      <AppShell>{children}</AppShell>
    </ThemeProvider>
  );
}
