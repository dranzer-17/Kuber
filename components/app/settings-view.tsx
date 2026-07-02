"use client";

import type React from "react";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import {
  User, Bot, LogOut, Plus, Mail,
  ChevronRight, PenLine, Bold, Italic, Underline,
  List, ListOrdered, Link2, Undo2, Redo2, Eraser, Type, Palette, Check, Sun, Moon,
  Building2, Package, FileText, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/app/lead-forms";
import { fetchLogo, fetchSettings, patchSettings, removeLogo, uploadLogo } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { COLORS } from "@/lib/branding";
import { useTheme } from "@/lib/theme-context";

const PRODUCT_SUGGESTIONS = [
  "Masterbatch", "Color Concentrates", "White Masterbatch", "Black Masterbatch",
  "Additive Masterbatch", "Filler Masterbatch",
];

type Section = "profile" | "ai" | "knowledge" | "appearance" | "account";
type AiSection = "template" | "replies" | "subject" | "footer";
type KnowledgeSection = "company" | "products" | "documents";
type ProductOffering = { name: string; description: string };

const NAV_ITEMS: { id: Section; label: string }[] = [
  { id: "profile",    label: "My Profile" },
  { id: "ai",         label: "AI & Outreach" },
  { id: "knowledge",  label: "Knowledge Sources" },
  { id: "appearance", label: "Appearance" },
  { id: "account",    label: "Account" },
];

const AI_NAV_ITEMS: { id: AiSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "template", label: "Email Template", icon: PenLine },
  { id: "replies",  label: "Reply AI",       icon: Bot },
  { id: "subject",  label: "Subject Line",   icon: Mail },
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
      <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
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

export function SettingsView() {
  const { theme, mode, setTheme, setMode, savingTheme } = useTheme();
  const [section, setSection] = useState<Section>("profile");
  const [aiSection, setAiSection] = useState<AiSection>("template");
  const [knowledgeSection, setKnowledgeSection] = useState<KnowledgeSection>("company");

  const [senderName,     setSenderName    ] = useState("");
  const [clientIndustry, setClientIndustry] = useState("");
  const [clientProducts, setClientProducts] = useState<string[]>([]);
  const [targetMarkets,  setTargetMarkets ] = useState("");
  const [systemPrompt,   setSystemPrompt  ] = useState("");
  const [logoPath,       setLogoPath      ] = useState<string | null>(null);
  const [logoUrl,        setLogoUrl       ] = useState<string | null>(null);
  const [logoUploading,  setLogoUploading ] = useState(false);

  const [sigContact, setSigContact] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState("");

  const [productOfferings, setProductOfferings] = useState<ProductOffering[]>([]);

  const [replyClassifierPrompt, setReplyClassifierPrompt] = useState("");
  const [replyDrafterPrompt,    setReplyDrafterPrompt   ] = useState("");

  const [docFiles, setDocFiles] = useState<File[]>([]);

  const [userEmail, setUserEmail] = useState("");
  const [userName,  setUserName  ] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving  ] = useState(false);
  const [error,   setError   ] = useState("");

  const activeAiNavItem        = AI_NAV_ITEMS.find((i) => i.id === aiSection);
  const activeKnowledgeNavItem = KNOWLEDGE_NAV_ITEMS.find((i) => i.id === knowledgeSection);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        setUserEmail(session?.user?.email ?? "");
        setUserName(session?.user?.user_metadata?.full_name ?? session?.user?.user_metadata?.name ?? "");
        const s = await fetchSettings(token);
        setSenderName(s.default_sender_name ?? "");
        setClientIndustry(s.client_industry ?? "");
        setClientProducts((s.client_products ?? "").split(",").map((p: string) => p.trim()).filter(Boolean));
        setTargetMarkets(s.client_target_markets ?? "");
        setSystemPrompt(s.system_prompt ?? "");
        setSubjectTemplate(s.email_subject_template ?? "");
        setSigContact(s.signature_contact ?? "");
        setReplyClassifierPrompt(s.reply_classifier_prompt ?? "");
        setReplyDrafterPrompt(s.reply_drafter_prompt ?? "");
        try { setProductOfferings(JSON.parse(s.product_offerings ?? "[]") as ProductOffering[]); } catch { setProductOfferings([]); }
        const l = await fetchLogo(token).catch(() => ({ logo_path: null, logo_url: null }));
        setLogoPath(l.logo_path);
        setLogoUrl(l.logo_url);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

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

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      await patchSettings(token, {
        default_sender_name:     senderName,
        client_industry:         clientIndustry,
        client_products:         clientProducts.join(", "),
        client_target_markets:   targetMarkets,
        system_prompt:           systemPrompt,
        email_subject_template:  subjectTemplate,
        signature_contact:       sigContact,
        product_offerings:       JSON.stringify(productOfferings),
        reply_classifier_prompt: replyClassifierPrompt,
        reply_drafter_prompt:    replyDrafterPrompt,
      });
      toast.success("Settings saved");
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

  const contentSkeleton = loading ? (
    <div className="max-w-2xl mx-auto p-8 space-y-6 animate-pulse">
      <div className="h-5 w-32 bg-secondary rounded" />
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="h-9 bg-secondary rounded-lg" />
          <div className="h-9 bg-secondary rounded-lg" />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-secondary/20 p-6 h-24" />
    </div>
  ) : null;

  const showSaveBar = !loading && (section === "ai" || section === "knowledge");

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Breadcrumb */}
      <div className="px-8 py-5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span>Settings</span>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground font-medium">{NAV_ITEMS.find((n) => n.id === section)?.label}</span>
          {section === "ai" && activeAiNavItem && (
            <><ChevronRight className="size-3.5" /><span className="text-foreground font-medium">{activeAiNavItem.label}</span></>
          )}
          {section === "knowledge" && activeKnowledgeNavItem && (
            <><ChevronRight className="size-3.5" /><span className="text-foreground font-medium">{activeKnowledgeNavItem.label}</span></>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Primary sidebar */}
        <aside className="w-56 shrink-0 border-r border-border p-4 flex flex-col gap-1 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-2 mb-1">General</p>
          {NAV_ITEMS.map(({ id, label }) => (
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
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-2 mb-1">AI &amp; Outreach</p>
            {AI_NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" onClick={() => setAiSection(id)}
                className={cn("px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left w-full flex items-center gap-2.5",
                  aiSection === id ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50")}>
                <Icon className="size-4 shrink-0" /><span className="truncate">{label}</span>
              </button>
            ))}
          </aside>
        )}

        {/* Knowledge secondary sidebar */}
        {section === "knowledge" && (
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
                    <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">Admin</span>
                  </div>
                </>
              )}

              {/* ── AI & Outreach ── */}
              {section === "ai" && (
                <div className="space-y-6">
                  {aiSection === "template" && (
                    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <Bot className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold">AI Writing Instructions</h3>
                      </div>
                      <p className="text-xs text-muted-foreground -mt-2">
                        The base prompt the AI follows when generating every outreach email. Include your email structure, intro, closing, and tone here.
                      </p>
                      <RichTextEditor
                        label="Base prompt"
                        value={systemPrompt}
                        onChange={setSystemPrompt}
                        minHeight={400}
                        placeholder="Write the full email template here including intro, offerings summary, closing..."
                        helper="Campaign-level context and matched product details are appended automatically."
                      />
                    </section>
                  )}

                  {aiSection === "subject" && (
                    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                      <div className="flex items-center gap-2">
                        <Mail className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold">Subject Line</h3>
                      </div>
                      <p className="text-xs text-muted-foreground -mt-2">
                        This exact subject line is used on every outreach email. Leave blank to let the AI generate one per email.
                      </p>
                      <div className="space-y-2">
                        <Label>Subject line</Label>
                        <Input
                          value={subjectTemplate}
                          onChange={(e) => setSubjectTemplate(e.target.value)}
                          placeholder="e.g. Masterbatch solutions for your production line — Kuber Polyplast"
                        />
                      </div>
                    </section>
                  )}

                  {aiSection === "replies" && (
                    <section className="rounded-xl border border-border bg-card p-6 space-y-5">
                      <div className="flex items-center gap-2">
                        <Bot className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold">Reply AI</h3>
                      </div>
                      <p className="text-xs text-muted-foreground -mt-2">
                        Controls how inbound replies are classified and how follow-up replies are drafted.
                      </p>
                      <RichTextEditor label="Reply classifier prompt" value={replyClassifierPrompt} onChange={setReplyClassifierPrompt} minHeight={280}
                        helper="Must return JSON with temperature, interest_status, and reasoning." />
                      <RichTextEditor label="Reply drafter prompt" value={replyDrafterPrompt} onChange={setReplyDrafterPrompt} minHeight={220}
                        helper="Must return JSON with subject and body." />
                    </section>
                  )}

                  {aiSection === "footer" && (
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

              {/* ── Knowledge Sources ── */}
              {section === "knowledge" && (
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
                      <div className="rounded-lg border border-border bg-secondary/10 p-4">
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

                      <TagInput label="Client products" pills={clientProducts} suggestions={PRODUCT_SUGGESTIONS} onChange={setClientProducts} placeholder="Add product..." />
                      <div className="space-y-1.5">
                        <Label>Target markets</Label>
                        <Input value={targetMarkets} onChange={(e) => setTargetMarkets(e.target.value)} placeholder="Packaging, Automotive, Agriculture" />
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

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {productOfferings.map((product, idx) => (
                          <div key={idx} className="rounded-xl border border-border bg-card p-4 space-y-3">
                            <div className="flex items-center gap-2">
                              <Input
                                value={product.name}
                                onChange={(e) => updateProduct(idx, "name", e.target.value)}
                                placeholder="Product name"
                                className="h-8 text-sm font-medium flex-1"
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
                              className="min-h-24 resize-none text-sm"
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
                      <p className="text-xs text-muted-foreground -mt-2">
                        Upload PDFs, FAQs, or product specs to give the AI additional context.
                      </p>
                      <label className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/10 p-10 text-center cursor-pointer transition-colors hover:border-primary/40 hover:bg-primary/5")}>
                        <Upload className="size-8 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-foreground">Drop files here or click to upload</p>
                          <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, TXT — up to 10 MB each</p>
                        </div>
                        <input type="file" multiple accept=".pdf,.docx,.txt" className="hidden"
                          onChange={(e) => { setDocFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
                      </label>
                      {docFiles.length > 0 && (
                        <div className="space-y-2">
                          {docFiles.map((file, idx) => (
                            <div key={`${file.name}-${idx}`} className="flex items-center gap-3 rounded-lg border border-border bg-secondary/20 px-4 py-2.5">
                              <FileText className="size-4 shrink-0 text-muted-foreground" />
                              <span className="flex-1 truncate text-sm">{file.name}</span>
                              <span className="text-xs text-muted-foreground shrink-0">{(file.size / 1024).toFixed(0)} KB</span>
                              <button type="button" onClick={() => setDocFiles((prev) => prev.filter((_, i) => i !== idx))}
                                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                                <X className="size-3.5" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">Document ingestion is coming soon.</p>
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
