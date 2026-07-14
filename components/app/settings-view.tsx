"use client";

import type React from "react";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import {
  User, Bot, LogOut, Plus,
  ChevronRight, PenLine, Bold, Italic, Underline,
  List, ListOrdered, Link2, Undo2, Redo2, Eraser, Type, Palette, Check, Sun, Moon,
  Building2, Package, FileText, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchLogo, fetchSettings, patchSettings, fetchMySettings, patchMySettings, removeLogo, uploadLogo, fetchUsers, fetchMyAvailability, setMyAvailability, type AvailabilityStatus } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { COLORS } from "@/lib/branding";
import { useTheme } from "@/lib/theme-context";
import { useApp } from "@/lib/app-context";
import dynamic from "next/dynamic";

const TeamView = dynamic(
  () => import("@/components/app/team-view").then((m) => m.TeamView),
  { ssr: false, loading: () => <div className="p-8 animate-pulse"><div className="h-40 rounded-xl bg-secondary" /></div> },
);

type Section = "profile" | "ai" | "knowledge" | "appearance" | "account" | "team";
type AiSection = "my-writing" | "my-signature" | "template" | "default" | "replies" | "footer";
type KnowledgeSection = "company" | "products" | "documents";
type ProductOffering = { name: string; description: string };

const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: "profile",    label: "My Profile" },
  { id: "ai",         label: "AI & Outreach" },
  { id: "appearance", label: "Appearance" },
  { id: "account",    label: "Account" },
];

const MANAGER_NAV_ITEMS: { id: Section; label: string }[] = [
  { id: "profile",    label: "My Profile" },
  { id: "ai",         label: "AI & Outreach" },
  { id: "knowledge",  label: "Knowledge Sources" },
  { id: "appearance", label: "Appearance" },
  { id: "account",    label: "Account" },
  { id: "team",       label: "Team" },
];

// Personal tabs (everyone — stored per user, campaigns you create use these) vs
// company-default tabs (managers only — the fallback every user inherits).
const PERSONAL_AI_NAV_ITEMS: { id: AiSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "my-writing",   label: "My Writing",   icon: PenLine },
  { id: "my-signature", label: "My Signature", icon: Type },
];

const COMPANY_AI_NAV_ITEMS: { id: AiSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "template", label: "Email Template", icon: PenLine },
  { id: "default",  label: "Default draft",  icon: FileText },
  { id: "replies",  label: "Reply AI",       icon: Bot },
  { id: "footer",   label: "Email Footer",   icon: Type },
];

const KNOWLEDGE_NAV_ITEMS: { id: KnowledgeSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "company",   label: "Company Details",   icon: Building2 },
  { id: "products",  label: "Product Offerings", icon: Package },
  { id: "documents", label: "Extra Documents",   icon: FileText },
];

type EditorCommand = "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList" | "undo" | "redo" | "removeFormat";

function textToHtml(value: string) {
  const escaped = value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((p) => p.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br />"))
    .map((p) => `<p>${p || "<br />"}</p>`)
    .join("");
}

function htmlToText(html: string): string {
  return html
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**")
    .replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**")
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "_$1_")
    .replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, "_$1_")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "").replace(/<\/p>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n").trim();
}

function RichTextEditor({
  label, value, onChange, placeholder, minHeight = 240, helper,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; minHeight?: number; helper?: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedValue = useRef<string | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;
    const current = htmlToText(editorRef.current.innerHTML);
    if (lastSyncedValue.current === value && current === value) return;
    editorRef.current.innerHTML = textToHtml(value);
    lastSyncedValue.current = value;
  }, [value]);

  function syncValue() {
    const next = htmlToText(editorRef.current?.innerHTML ?? "").replace(/\n{3,}/g, "\n\n").trimEnd();
    lastSyncedValue.current = next;
    onChange(next);
  }

  function runCommand(cmd: EditorCommand) { editorRef.current?.focus(); document.execCommand(cmd); syncValue(); }

  function addLink() {
    editorRef.current?.focus();
    const url = window.prompt("Paste a URL");
    if (url) { document.execCommand("createLink", false, url); syncValue(); }
  }

  const toolbar = [
    { label: "Bold",           icon: Bold,         command: "bold" as const },
    { label: "Italic",         icon: Italic,        command: "italic" as const },
    { label: "Underline",      icon: Underline,     command: "underline" as const },
    { label: "Bulleted list",  icon: List,          command: "insertUnorderedList" as const },
    { label: "Numbered list",  icon: ListOrdered,   command: "insertOrderedList" as const },
    { label: "Undo",           icon: Undo2,         command: "undo" as const },
    { label: "Redo",           icon: Redo2,         command: "redo" as const },
    { label: "Clear formatting", icon: Eraser,      command: "removeFormat" as const },
  ];

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-secondary/20 p-1.5">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground">
            <Type className="size-3.5" /> Compose
          </span>
          <div className="mx-1 h-5 w-px bg-border" />
          {toolbar.map(({ label: lbl, icon: Icon, command }) => (
            <button key={command} type="button" aria-label={lbl} title={lbl}
              onMouseDown={(e) => e.preventDefault()} onClick={() => runCommand(command)}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
              <Icon className="size-4" />
            </button>
          ))}
          <button type="button" aria-label="Add link" title="Add link"
            onMouseDown={(e) => e.preventDefault()} onClick={addLink}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
            <Link2 className="size-4" />
          </button>
        </div>
        <div ref={editorRef} role="textbox" aria-label={label} aria-multiline="true"
          contentEditable suppressContentEditableWarning data-placeholder={placeholder}
          onInput={syncValue} onBlur={syncValue}
          className="rich-editor min-w-0 bg-card px-4 py-3 text-sm leading-6 text-foreground outline-none"
          style={{ minHeight }} />
      </div>
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}

// Self-service availability toggle (spec §2B) — an employee marking themselves
// available/away (e.g. going on leave) so they stop receiving new automatic
// assignments, without being deactivated. Self-contained (own fetch/save).
function AvailabilityCard() {
  const [status, setStatus] = useState<AvailabilityStatus | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        const res = await fetchMyAvailability(token);
        setStatus(res.availability_status);
      } catch { /* leave null */ }
    })();
  }, []);

  async function toggle() {
    if (saving || !status) return;
    const next: AvailabilityStatus = status === "online" ? "offline" : "online";
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await setMyAvailability(token, next);
      setStatus(res.availability_status);
      toast.success(res.availability_status === "offline" ? "You're now marked as away" : "You're now available");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">Availability</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {status === "offline"
            ? "You're marked away — you won't receive new automatic lead assignments (you can still be assigned manually)."
            : "You're available for new automatic lead assignments."}
        </p>
      </div>
      <Button variant="outline" className="h-9 shrink-0" disabled={saving || !status} onClick={() => void toggle()}>
        {status === "offline" ? "Set available" : "Set away"}
      </Button>
    </div>
  );
}

export function SettingsView() {
  const { theme, mode, setTheme, setMode, savingTheme } = useTheme();
  const { role } = useApp();
  const isManager = role === "manager";
  const navItems = isManager ? MANAGER_NAV_ITEMS : NAV_ITEMS;
  const aiNavItems = isManager ? [...PERSONAL_AI_NAV_ITEMS, ...COMPANY_AI_NAV_ITEMS] : PERSONAL_AI_NAV_ITEMS;
  const [section, setSection] = useState<Section>("profile");
  const [aiSection, setAiSection] = useState<AiSection>("my-writing");
  const [knowledgeSection, setKnowledgeSection] = useState<KnowledgeSection>("company");

  // Company-wide settings (managers edit; everyone inherits)
  const [senderName,     setSenderName    ] = useState("");
  const [clientIndustry, setClientIndustry] = useState("");
  const [companyContext, setCompanyContext] = useState("");
  const [systemPrompt,   setSystemPrompt  ] = useState("");
  const [genericSubject, setGenericSubject] = useState("");
  const [genericBody,    setGenericBody   ] = useState("");
  const [logoPath,       setLogoPath      ] = useState<string | null>(null);
  const [logoUrl,        setLogoUrl       ] = useState<string | null>(null);
  const [logoUploading,  setLogoUploading ] = useState(false);

  const [sigContact, setSigContact] = useState("");

  const [productOfferings, setProductOfferings] = useState<ProductOffering[]>([]);

  const [replyDrafterPrompt,    setReplyDrafterPrompt   ] = useState("");

  // Personal settings (per user — campaigns you create use these; empty = inherit)
  const [myDraftPrompt, setMyDraftPrompt] = useState("");
  const [myReplyPrompt, setMyReplyPrompt] = useState("");
  const [mySignature,   setMySignature  ] = useState("");
  const [mySenderName,  setMySenderName ] = useState("");
  const [myDefaults,    setMyDefaults   ] = useState({ draft_prompt: "", reply_prompt: "", signature: "", sender_name: "" });

  const [userEmail, setUserEmail] = useState("");
  const [userName,  setUserName  ] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving  ] = useState(false);
  const [error,   setError   ] = useState("");

  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const activeAiNavItem        = aiNavItems.find((i) => i.id === aiSection);
  const activeKnowledgeNavItem = KNOWLEDGE_NAV_ITEMS.find((i) => i.id === knowledgeSection);

  // The breadcrumb shows the ancestor trail; the deepest active item becomes the page title.
  const sectionLabel = navItems.find((n) => n.id === section)?.label ?? "Settings";
  const pageTitle =
    (section === "ai" && activeAiNavItem?.label) ||
    (section === "knowledge" && activeKnowledgeNavItem?.label) ||
    sectionLabel;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        setUserEmail(session?.user?.email ?? "");
        setUserName(session?.user?.user_metadata?.full_name ?? session?.user?.user_metadata?.name ?? "");

        // Personal settings load for everyone; company settings + logo only for
        // managers (employees neither see nor edit those tabs).
        const myPromise = fetchMySettings(token);
        const settingsPromise = isManager ? fetchSettings(token) : Promise.resolve(null);
        const logoPromise = isManager
          ? fetchLogo(token).catch(() => ({ logo_path: null, logo_url: null }))
          : Promise.resolve({ logo_path: null, logo_url: null });
        const usersPromise = isManager
          ? fetchUsers(token).catch(() => [])
          : Promise.resolve([]);

        const my = await myPromise;
        setMyDraftPrompt(my.draft_prompt ?? "");
        setMyReplyPrompt(my.reply_prompt ?? "");
        setMySignature(my.signature ?? "");
        setMySenderName(my.sender_name ?? "");
        setMyDefaults(my.defaults);

        const s = await settingsPromise;
        if (s) {
          setSenderName(s.default_sender_name ?? "");
          setClientIndustry(s.client_industry ?? "");
          setCompanyContext(s.company_context ?? "");
          setSystemPrompt(s.system_prompt ?? "");
          setGenericSubject(s.generic_email_subject ?? "");
          setGenericBody(s.generic_email_body ?? "");
          setSigContact(s.signature_contact ?? "");
          setReplyDrafterPrompt(s.reply_drafter_prompt ?? "");
          try { setProductOfferings(JSON.parse(s.product_offerings ?? "[]") as ProductOffering[]); } catch { setProductOfferings([]); }
        }
        setLoading(false);

        const l = await logoPromise;
        setLogoPath(l.logo_path);
        setLogoUrl(l.logo_url);

        const users = await usersPromise;
        setIsSuperAdmin(users.find((u) => u.id === session?.user?.id)?.is_super_admin ?? false);
      } catch (e) {
        setError((e as Error).message);
        setLoading(false);
      }
    }
    void load();
  }, [isManager]);

  async function handleLogoPick(file: File | null) {
    if (!file) return;
    setLogoUploading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const res = await uploadLogo(token, file);
      setLogoPath(res.logo_path);
      setLogoUrl(res.logo_url);
      await patchSettings(token, { brand_logo_path: res.logo_path });
    } catch (e) { setError((e as Error).message); }
    finally { setLogoUploading(false); }
  }

  async function handleLogoRemove() {
    setLogoUploading(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      await removeLogo(token);
      setLogoPath(null);
      setLogoUrl(null);
      await patchSettings(token, { brand_logo_path: "" });
    } catch (e) { setError((e as Error).message); }
    finally { setLogoUploading(false); }
  }

  const onPersonalTab = section === "ai" && (aiSection === "my-writing" || aiSection === "my-signature");

  async function handleSave() {
    // Only validate Product Offerings completeness when the user is actually on that
    // tab. Without this scoping, a stale incomplete product sitting in Knowledge
    // Sources blocks saving on completely unrelated tabs (Email Template, Reply AI,
    // Email Footer) even when nothing about products was touched — confirmed live bug.
    if (section === "knowledge" && knowledgeSection === "products") {
      const incompleteProduct = productOfferings.find(
        (p) => !p.name.trim() || !p.description.trim()
      );
      if (incompleteProduct) {
        toast.error("Every product needs both a name and a description before saving.");
        return;
      }
    }

    setSaving(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";

      if (onPersonalTab) {
        // Personal settings — empty fields clear back to "inherit company default".
        const my = await patchMySettings(token, {
          draft_prompt: myDraftPrompt.trim() || null,
          reply_prompt: myReplyPrompt.trim() || null,
          signature:    mySignature.trim() || null,
          sender_name:  mySenderName.trim() || null,
        });
        setMyDefaults(my.defaults);
        toast.success("Your settings were saved");
      } else {
        await patchSettings(token, {
          default_sender_name:     senderName,
          client_industry:         clientIndustry,
          company_context:         companyContext,
          system_prompt:           systemPrompt,
          generic_email_subject:   genericSubject,
          generic_email_body:      genericBody,
          signature_contact:       sigContact,
          product_offerings:       JSON.stringify(productOfferings),
          reply_drafter_prompt:    replyDrafterPrompt,
        });
        toast.success("Company settings saved");
      }
    } catch (e) {
      toast.error((e as Error).message);
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function updateProduct(idx: number, field: keyof ProductOffering, value: string) {
    setProductOfferings((prev) => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  }

  function removeProduct(idx: number) {
    setProductOfferings((prev) => prev.filter((_, i) => i !== idx));
  }

  function addProduct() {
    setProductOfferings((prev) => [...prev, { name: "", description: "" }]);
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!userEmail) return;
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });
      if (reauthError) {
        toast.error("Current password is incorrect.");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSavingPassword(false);
    }
  }

  const contentSkeleton = loading ? (
    <div className="max-w-2xl mx-auto p-8 space-y-6 animate-pulse">
      <div className="h-5 w-32 bg-secondary rounded" />
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="h-9 bg-secondary rounded-lg" />
          <div className="h-9 bg-secondary rounded-lg" />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-6 h-24" />
    </div>
  ) : null;

  // Extra Documents has nothing to save (it's a static "coming soon" message) — hide
  // the save bar specifically for that sub-tab while keeping it for Company Details
  // and Product Offerings, which both still need it.
  const showSaveBar = !loading && (
    section === "ai" ||
    (section === "knowledge" && knowledgeSection !== "documents")
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Breadcrumb + page title */}
      <div className="px-8 py-5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Settings</span>
          {sectionLabel !== pageTitle && (
            <><ChevronRight className="size-3" /><span>{sectionLabel}</span></>
          )}
        </div>
        <h1 className="text-2xl font-bold mt-1">{pageTitle}</h1>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Primary sidebar */}
        <aside className="w-56 shrink-0 border-r border-border p-4 flex flex-col gap-1 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-2 mb-1">General</p>
          {navItems.map(({ id, label }) => (
            <button key={id} type="button" onClick={() => setSection(id)}
              className={cn("px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left w-full",
                section === id ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}>
              {label}
            </button>
          ))}
        </aside>

        {/* AI secondary sidebar */}
        {section === "ai" && (
          <aside className="w-56 shrink-0 border-r border-border p-4 flex flex-col gap-1 overflow-y-auto">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-2 mb-1">Personal</p>
            {PERSONAL_AI_NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setAiSection(id)}
                className={cn("px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left w-full flex items-center gap-2.5",
                  aiSection === id ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}>
                <Icon className="size-4 shrink-0" /><span className="truncate">{label}</span>
              </button>
            ))}
            {isManager && (
              <>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-2 mb-1 mt-4">Company defaults</p>
                {COMPANY_AI_NAV_ITEMS.map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" onClick={() => setAiSection(id)}
                    className={cn("px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left w-full flex items-center gap-2.5",
                      aiSection === id ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}>
                    <Icon className="size-4 shrink-0" /><span className="truncate">{label}</span>
                  </button>
                ))}
              </>
            )}
          </aside>
        )}

        {/* Knowledge secondary sidebar (managers only) */}
        {section === "knowledge" && isManager && (
          <aside className="w-56 shrink-0 border-r border-border p-4 flex flex-col gap-1 overflow-y-auto">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-2 mb-1">Knowledge Sources</p>
            {KNOWLEDGE_NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setKnowledgeSection(id)}
                className={cn("px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left w-full flex items-center gap-2.5",
                  knowledgeSection === id ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}>
                <Icon className="size-4 shrink-0" /><span className="truncate">{label}</span>
              </button>
            ))}
          </aside>
        )}

        {/* Content */}
        <div className="relative flex-1 overflow-y-auto">
          {contentSkeleton}

          {!loading && (
            <div className="mx-auto w-full max-w-5xl p-8 space-y-8">

              {/* ── Profile ── */}
              {section === "profile" && (
                <>
                  <div className="rounded-xl border border-border bg-card p-6 space-y-5">
                    <div className="flex items-center gap-4">
                      <div className="size-14 rounded-full bg-secondary border border-border flex items-center justify-center shrink-0">
                        <User className="size-6 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{userName || "Admin"}</p>
                        <p className="text-xs text-muted-foreground">{userEmail}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label>Display name</Label>
                        <Input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Admin" disabled />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Email address</Label>
                        <Input value={userEmail} disabled />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">Profile details are managed through your Supabase auth account.</p>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-6 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Role</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Your access level in this workspace.</p>
                    </div>
                    <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {isSuperAdmin ? "Super Admin" : role === "manager" ? "Manager" : role === "employee" ? "Employee" : "—"}
                    </span>
                  </div>
                  {/* Employees can mark themselves away (spec §2B). */}
                  {role === "employee" && <AvailabilityCard />}
                </>
              )}

              {/* ── AI & Outreach ── */}
              {section === "ai" && (
                <div className="space-y-6">
                  {aiSection === "my-writing" && (
                    <>
                      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <PenLine className="size-4 text-muted-foreground" />
                            <h3 className="text-sm font-semibold">My cold-email writing style</h3>
                          </div>
                          <span className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            myDraftPrompt.trim()
                              ? "border-primary/20 bg-primary/10 text-primary"
                              : "border-border bg-secondary text-muted-foreground",
                          )}>
                            {myDraftPrompt.trim() ? "Personal" : "Using company default"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground -mt-2">
                          Campaigns <strong>you create</strong> generate their emails with this prompt. Leave it empty to write with the company default — other people&apos;s campaigns are never affected by what you put here.
                        </p>
                        <RichTextEditor
                          label="My drafting prompt"
                          value={myDraftPrompt}
                          onChange={setMyDraftPrompt}
                          minHeight={320}
                          placeholder="Leave empty to use the company default, or write your own subject patterns, openings, offerings and tone here..."
                          helper="Product library, campaign context and safety rules are appended automatically."
                        />
                        {!myDraftPrompt.trim() && myDefaults.draft_prompt && (
                          <details className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                            <summary className="cursor-pointer select-none font-medium text-foreground">View the company default you&apos;re inheriting</summary>
                            <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans">{myDefaults.draft_prompt}</pre>
                          </details>
                        )}
                      </section>

                      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Bot className="size-4 text-muted-foreground" />
                            <h3 className="text-sm font-semibold">My reply writing style</h3>
                          </div>
                          <span className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            myReplyPrompt.trim()
                              ? "border-primary/20 bg-primary/10 text-primary"
                              : "border-border bg-secondary text-muted-foreground",
                          )}>
                            {myReplyPrompt.trim() ? "Personal" : "Using company default"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground -mt-2">
                          AI reply suggestions for <strong>your campaigns&apos;</strong> conversations follow this prompt. Empty = company default.
                        </p>
                        <RichTextEditor
                          label="My reply prompt"
                          value={myReplyPrompt}
                          onChange={setMyReplyPrompt}
                          minHeight={220}
                          placeholder="Leave empty to use the company default reply prompt..."
                          helper="Must return JSON with subject and body. Safety rules are appended automatically."
                        />
                        {!myReplyPrompt.trim() && myDefaults.reply_prompt && (
                          <details className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                            <summary className="cursor-pointer select-none font-medium text-foreground">View the company default you&apos;re inheriting</summary>
                            <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-sans">{myDefaults.reply_prompt}</pre>
                          </details>
                        )}
                      </section>
                    </>
                  )}

                  {aiSection === "my-signature" && (
                    <>
                      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Type className="size-4 text-muted-foreground" />
                            <h3 className="text-sm font-semibold">My signature</h3>
                          </div>
                          <span className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            mySignature.trim()
                              ? "border-primary/20 bg-primary/10 text-primary"
                              : "border-border bg-secondary text-muted-foreground",
                          )}>
                            {mySignature.trim() ? "Personal" : "Using company default"}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground -mt-2">
                          Appended to every email of campaigns <strong>you create</strong> (cold emails and replies). A campaign&apos;s own signature override still wins. Empty = company footer.
                        </p>
                        <RichTextEditor
                          label="Sign-off block"
                          value={mySignature}
                          onChange={setMySignature}
                          minHeight={160}
                          placeholder={"Your Name\nYour Title\nKuber Polyplast\n+91-XXXXXXXXXX"}
                        />
                        {!mySignature.trim() && myDefaults.signature && (
                          <details className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                            <summary className="cursor-pointer select-none font-medium text-foreground">View the company default you&apos;re inheriting</summary>
                            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans">{myDefaults.signature}</pre>
                          </details>
                        )}
                      </section>

                      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <div className="flex items-center gap-2">
                          <User className="size-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold">My sender name</h3>
                        </div>
                        <p className="text-xs text-muted-foreground -mt-2">
                          Pre-filled as the &quot;From&quot; name when you create a campaign. Empty = company default{myDefaults.sender_name ? ` (“${myDefaults.sender_name}”)` : ""}.
                        </p>
                        <div className="max-w-sm space-y-1.5">
                          <Label>Sender name</Label>
                          <Input value={mySenderName} onChange={(e) => setMySenderName(e.target.value)} placeholder={myDefaults.sender_name || "Kuber Polyplast"} maxLength={200} />
                        </div>
                      </section>
                    </>
                  )}

                  {isManager && aiSection === "template" && (
                    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <Bot className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold">AI Writing Instructions</h3>
                      </div>
                      <p className="text-xs text-muted-foreground -mt-2">
                        The <strong>company default</strong> prompt for outreach emails — used by every campaign whose owner hasn&apos;t set a personal writing style. Put subject-line patterns, opening/closing options, offerings, key strengths, and tone here.
                      </p>
                      <RichTextEditor
                        label="Base prompt"
                        value={systemPrompt}
                        onChange={setSystemPrompt}
                        minHeight={400}
                        placeholder="Write the full email template here including subject patterns, intro options, offerings, closing..."
                        helper="Campaign-level context and matched product details are appended automatically."
                      />
                    </section>
                  )}

                  {isManager && aiSection === "default" && (
                    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold">Default draft</h3>
                      </div>
                      <p className="text-xs text-muted-foreground -mt-2">
                        Exact subject and body sent to unenriched / Input Required leads (no company profile to personalise). Enriched leads still use AI Writing Instructions. Placeholders are filled per lead:{" "}
                        <code className="rounded bg-secondary px-1 py-0.5 text-[11px]">{"{{first_name}}"}</code>
                        {", "}
                        <code className="rounded bg-secondary px-1 py-0.5 text-[11px]">{"{{name}}"}</code>
                        {", "}
                        <code className="rounded bg-secondary px-1 py-0.5 text-[11px]">{"{{company}}"}</code>
                        . A greeting and signature are added automatically.
                      </p>
                      <div className="space-y-1.5">
                        <Label>Subject</Label>
                        <Input
                          value={genericSubject}
                          onChange={(e) => setGenericSubject(e.target.value)}
                          placeholder="Reliable masterbatch for {{company}}"
                          maxLength={300}
                        />
                      </div>
                      <RichTextEditor
                        label="Body"
                        value={genericBody}
                        onChange={setGenericBody}
                        minHeight={280}
                        placeholder="Write the exact email body. Use {{first_name}} and {{company}} where you want them filled in."
                        helper="This text is sent as-is after variable substitution — the AI does not rewrite it."
                      />
                    </section>
                  )}

                  {isManager && aiSection === "replies" && (
                    <section className="rounded-xl border border-border bg-card p-6 space-y-5">
                      <div className="flex items-center gap-2">
                        <Bot className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold">Reply AI</h3>
                      </div>
                      <p className="text-xs text-muted-foreground -mt-2">
                        Controls how follow-up replies are drafted after a prospect responds.
                      </p>

                      <RichTextEditor label="Reply drafter prompt" value={replyDrafterPrompt} onChange={setReplyDrafterPrompt} minHeight={220}
                        helper="Must return JSON with subject and body. Still in active use — this is what writes our human-reviewed reply drafts." />
                    </section>
                  )}

                  {isManager && aiSection === "footer" && (
                    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <PenLine className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold">Email Footer</h3>
                      </div>
                      <p className="text-xs text-muted-foreground -mt-2">Contact lines appended at the end of every generated email.</p>
                      <RichTextEditor label="Contact footer" value={sigContact} onChange={setSigContact} minHeight={160}
                        placeholder={"Kuber Polyplast\n+91-XXXXXXXXXX\nsales@kuberpolyplast.com"} />
                    </section>
                  )}

                  {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
              )}

              {/* ── Knowledge Sources (managers only) ── */}
              {section === "knowledge" && isManager && (
                <div className="space-y-6">

                  {/* Company Details */}
                  {knowledgeSection === "company" && (
                    <section className="rounded-xl border border-border bg-card p-6 space-y-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Building2 className="size-4 text-muted-foreground" />
                          <h3 className="text-sm font-semibold">Company Details</h3>
                        </div>
                        <span className="rounded-md bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">Context</span>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label>Default sender name</Label>
                          <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Kuber Polyplast" />
                          <p className="text-xs text-muted-foreground">Used as the &quot;From&quot; name in outreach emails.</p>
                        </div>
                        <div className="space-y-1.5">
                          <Label>Client industry</Label>
                          <Input value={clientIndustry} onChange={(e) => setClientIndustry(e.target.value)} placeholder="Plastics & Polymer Manufacturing" />
                        </div>
                      </div>

                      {/* Logo */}
                      <div className="rounded-lg border border-border bg-secondary/30 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold">Logo</p>
                            <p className="text-xs text-muted-foreground mt-0.5">PNG/JPG/WebP, up to 2 MB. Appears in the sidebar.</p>
                          </div>
                          {logoUrl
                            ? <img src={logoUrl} alt="Brand logo" className="size-10 rounded-lg border border-border bg-card object-contain shrink-0" />
                            : <div className="size-10 rounded-lg border border-border bg-card flex items-center justify-center shrink-0"><span className="text-xs font-bold text-muted-foreground">K</span></div>
                          }
                        </div>
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <label className={cn("inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors cursor-pointer h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90", logoUploading && "opacity-60 pointer-events-none")}>
                            {logoUploading ? "Uploading..." : (logoUrl ? "Replace logo" : "Upload logo")}
                            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => void handleLogoPick(e.target.files?.[0] ?? null)} />
                          </label>
                          {logoPath && (
                            <Button type="button" variant="outline" className="h-9" disabled={logoUploading} onClick={() => void handleLogoRemove()}>Remove</Button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label>Company context</Label>
                        <Textarea
                          value={companyContext}
                          onChange={(e) => setCompanyContext(e.target.value)}
                          placeholder="Who Kuber Polyplast is, what makes it credible, key accolades — background the AI can draw on in every email and reply."
                          className="min-h-32 text-sm resize-y"
                        />
                        <p className="text-xs text-muted-foreground">
                          Given to the AI as background for every draft and reply. Products belong in the Product Offerings tab — the AI reads that library directly.
                        </p>
                      </div>
                    </section>
                  )}

                  {/* Product Offerings */}
                  {knowledgeSection === "products" && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold">Product Offerings</h3>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            The AI picks the best-matching product for each lead and uses its description as context.
                          </p>
                        </div>
                        <Button type="button" size="sm" onClick={addProduct} className="gap-1.5 shrink-0">
                          <Plus className="size-3.5" /> Add product
                        </Button>
                      </div>

                      {productOfferings.length === 0 && (
                        <div className="rounded-xl border border-dashed border-border bg-secondary/10 p-10 text-center text-sm text-muted-foreground">
                          No products yet — click &quot;Add product&quot; to get started.
                        </div>
                      )}

                      <div className="space-y-3">
                        {productOfferings.map((product, idx) => (
                          <div key={idx} className="rounded-xl border border-border bg-card p-4 space-y-3">
                            <div className="flex items-center gap-2">
                              <Input
                                value={product.name}
                                onChange={(e) => updateProduct(idx, "name", e.target.value)}
                                placeholder="Product name"
                                className="h-9 text-sm font-medium flex-1"
                              />
                              <button type="button" onClick={() => removeProduct(idx)}
                                className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive">
                                <X className="size-3.5" />
                              </button>
                            </div>
                            <Textarea
                              value={product.description}
                              onChange={(e) => updateProduct(idx, "description", e.target.value)}
                              placeholder="Describe this product — what it is, who it fits, key benefits..."
                              className="min-h-32 text-sm resize-y"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Extra Documents */}
                  {knowledgeSection === "documents" && (
                    <section className="rounded-xl border border-border bg-card p-6 space-y-5">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold">Extra Documents</h3>
                      </div>
                      <div className="rounded-xl border border-dashed border-border p-8 text-center space-y-2">
                        <FileText className="size-8 text-muted-foreground mx-auto" />
                        <p className="text-sm font-medium">Document upload — coming soon</p>
                        <p className="text-xs text-muted-foreground">
                          You&apos;ll be able to upload PDFs, FAQs, and product specs here to give the AI additional context.
                        </p>
                      </div>
                    </section>
                  )}

                  {error && <p className="text-xs text-destructive">{error}</p>}
                </div>
              )}

              {/* ── Appearance ── */}
              {section === "appearance" && (
                <>
                  <div className="rounded-xl border border-border bg-card p-6 space-y-5">
                    <div className="flex items-center gap-2">
                      {mode === "light" ? <Sun className="size-4 text-muted-foreground" /> : <Moon className="size-4 text-muted-foreground" />}
                      <h3 className="text-sm font-semibold">Appearance mode</h3>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-3">Switch between a dark or light workspace background.</p>
                    <div className="grid grid-cols-2 gap-3 max-w-sm">
                      {(["dark", "light"] as const).map((m) => {
                        const active = mode === m;
                        const Icon = m === "dark" ? Moon : Sun;
                        return (
                          <button key={m} type="button" onClick={() => void setMode(m)} disabled={savingTheme}
                            className={cn("flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                              active ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground")}>
                            <Icon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="flex-1 text-sm font-medium capitalize">{m}</span>
                            {active && <Check className="size-4 text-primary shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-6 space-y-5">
                    <div className="flex items-center gap-2">
                      <Palette className="size-4 text-muted-foreground" />
                      <h3 className="text-sm font-semibold">Color theme</h3>
                    </div>
                    <p className="text-xs text-muted-foreground -mt-3">Choose an accent color for the workspace.</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {COLORS.map((t) => {
                        const active = theme === t.id;
                        return (
                          <button key={t.id} type="button" onClick={() => void setTheme(t.id)} disabled={savingTheme}
                            className={cn("flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                              active ? "border-primary bg-primary/10" : "border-border hover:border-muted-foreground")}>
                            <span className="size-7 shrink-0 rounded-full border border-border" style={{ backgroundColor: t.swatch }} />
                            <span className="flex-1 text-sm font-medium">{t.label}</span>
                            {active && <Check className="size-4 text-primary shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* ── Account ── */}
              {section === "account" && (
                <div className="space-y-6">
                  <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                    <h3 className="text-sm font-semibold">Change password</h3>
                    <form onSubmit={handleChangePassword} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label>Current password</Label>
                        <Input
                          type="password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          required
                          autoComplete="current-password"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>New password</Label>
                        <Input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          required
                          minLength={8}
                          autoComplete="new-password"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Confirm password</Label>
                        <Input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          required
                          minLength={8}
                          autoComplete="new-password"
                        />
                      </div>
                      <div className="sm:col-span-2 flex justify-end">
                        <Button type="submit" disabled={savingPassword}>
                          {savingPassword ? "Updating…" : "Update password"}
                        </Button>
                      </div>
                    </form>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                    <h3 className="text-sm font-semibold">Session</h3>
                    <div className="flex items-center justify-between py-3 border-t border-border">
                      <div>
                        <p className="text-sm font-medium">Signed in as</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{userEmail}</p>
                      </div>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Active</span>
                    </div>
                    <div className="flex items-center justify-between py-3 border-t border-border">
                      <div>
                        <p className="text-sm font-medium">Sign out</p>
                        <p className="text-xs text-muted-foreground mt-0.5">End your current session on this device.</p>
                      </div>
                      <button type="button" onClick={() => supabase.auth.signOut()}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-colors">
                        <LogOut className="size-3.5" /> Sign out
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {section === "team" && role === "manager" && (
                <div className="-m-8">
                  <TeamView />
                </div>
              )}

            </div>
          )}

          {showSaveBar && (
            <div className="sticky bottom-0 flex justify-end border-t border-border bg-background/95 px-8 py-4 backdrop-blur">
              <Button onClick={handleSave} disabled={saving} className="min-w-24">
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
