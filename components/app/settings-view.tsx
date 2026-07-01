"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
  Lock, User, Bot, LogOut,
  ChevronRight, Sparkles, PenLine, Bold, Italic, Underline,
  List, ListOrdered, Link2, Undo2, Redo2, Eraser, Type, Palette, Check, Sun, Moon,
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

type Section = "profile" | "ai" | "appearance" | "account";
type AiSection = "context" | "drafts" | "template" | "products" | "replies" | "footer" | "knowledge";

const PRODUCT_TYPES = [
  { id: "black",    label: "Black Masterbatch" },
  { id: "white",    label: "White Masterbatch" },
  { id: "color",    label: "Color Masterbatch" },
  { id: "additive", label: "Additive Masterbatch" },
] as const;

const NAV_ITEMS: { id: Section; label: string; description: string }[] = [
  { id: "profile",    label: "My Profile",    description: "Admin account details" },
  { id: "ai",         label: "AI & Outreach", description: "Email AI configuration" },
  { id: "appearance", label: "Appearance",    description: "Color theme" },
  { id: "account",    label: "Account",       description: "Sign out & security" },
];

const AI_NAV_ITEMS: {
  id: AiSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "context", label: "Company Context", icon: Bot },
  { id: "drafts", label: "Draft Editor", icon: Type },
  { id: "template", label: "Cold Email Template", icon: PenLine },
  { id: "products", label: "Product Sections", icon: Sparkles },
  { id: "replies", label: "Reply AI", icon: Bot },
  { id: "footer", label: "Email Footer", icon: PenLine },
  { id: "knowledge", label: "Knowledge Sources", icon: Lock },
];

type EditorCommand =
  | "bold"
  | "italic"
  | "underline"
  | "insertUnorderedList"
  | "insertOrderedList"
  | "undo"
  | "redo"
  | "removeFormat";

function textToHtml(value: string) {
  const escaped = value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n/g, "<br />"))
    .map((paragraph) => `<p>${paragraph || "<br />"}</p>`)
    .join("");
}

function RichTextEditor({
  label,
  value,
  onChange,
  placeholder,
  minHeight = 240,
  helper,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  helper?: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastSyncedValue = useRef<string | null>(null);

  useEffect(() => {
    if (!editorRef.current) return;
    const current = editorRef.current.innerText.replace(/\n{3,}/g, "\n\n").trimEnd();
    if (lastSyncedValue.current === value && current === value) return;
    editorRef.current.innerHTML = textToHtml(value);
    lastSyncedValue.current = value;
  }, [value]);

  function syncValue() {
    const next = editorRef.current?.innerText.replace(/\n{3,}/g, "\n\n").trimEnd() ?? "";
    lastSyncedValue.current = next;
    onChange(next);
  }

  function runCommand(command: EditorCommand) {
    editorRef.current?.focus();
    document.execCommand(command);
    syncValue();
  }

  function addLink() {
    editorRef.current?.focus();
    const url = window.prompt("Paste a URL");
    if (!url) return;
    document.execCommand("createLink", false, url);
    syncValue();
  }

  const toolbar = [
    { label: "Bold", icon: Bold, command: "bold" as const },
    { label: "Italic", icon: Italic, command: "italic" as const },
    { label: "Underline", icon: Underline, command: "underline" as const },
    { label: "Bulleted list", icon: List, command: "insertUnorderedList" as const },
    { label: "Numbered list", icon: ListOrdered, command: "insertOrderedList" as const },
    { label: "Undo", icon: Undo2, command: "undo" as const },
    { label: "Redo", icon: Redo2, command: "redo" as const },
    { label: "Clear formatting", icon: Eraser, command: "removeFormat" as const },
  ];

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-secondary/20 p-1.5">
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground">
            <Type className="size-3.5" />
            Compose
          </span>
          <div className="mx-1 h-5 w-px bg-border" />
          {toolbar.map(({ label: buttonLabel, icon: Icon, command }) => (
            <button
              key={command}
              type="button"
              aria-label={buttonLabel}
              title={buttonLabel}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runCommand(command)}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Icon className="size-4" />
            </button>
          ))}
          <button
            type="button"
            aria-label="Add link"
            title="Add link"
            onMouseDown={(event) => event.preventDefault()}
            onClick={addLink}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Link2 className="size-4" />
          </button>
        </div>

        <div
          ref={editorRef}
          role="textbox"
          aria-label={label}
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          data-placeholder={placeholder}
          onInput={syncValue}
          onBlur={syncValue}
          className="rich-editor min-w-0 bg-card px-4 py-3 text-sm leading-6 text-foreground outline-none"
          style={{ minHeight }}
        />
      </div>

      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}

export function SettingsView() {
  const { theme, mode, setTheme, setMode, savingTheme } = useTheme();
  const [section, setSection] = useState<Section>("profile");
  const [aiSection, setAiSection] = useState<AiSection>("context");

  // Settings data
  const [senderName,     setSenderName    ] = useState("");
  const [clientIndustry, setClientIndustry] = useState("");
  const [clientProducts, setClientProducts] = useState<string[]>([]);
  const [targetMarkets,  setTargetMarkets ] = useState("");
  const [systemPrompt,   setSystemPrompt  ] = useState("");
  const [logoPath,       setLogoPath      ] = useState<string | null>(null);
  const [logoUrl,        setLogoUrl       ] = useState<string | null>(null);
  const [logoUploading,  setLogoUploading ] = useState(false);

  // Signature fields
  const [sigName,    setSigName   ] = useState("");
  const [sigTitle,   setSigTitle  ] = useState("");
  const [sigContact, setSigContact] = useState("");

  // Cold email template (fixed body the AI personalizes around)
  const [emailIntro,           setEmailIntro          ] = useState("");
  const [emailOfferings,       setEmailOfferings      ] = useState("");
  const [closingWithAttachment, setClosingWithAttachment] = useState("");
  const [closingNoAttachment,   setClosingNoAttachment  ] = useState("");

  // Per-product addenda + AI fit hints
  const [productSections, setProductSections] = useState<Record<string, { section: string; hint: string }>>(
    Object.fromEntries(PRODUCT_TYPES.map((p) => [p.id, { section: "", hint: "" }])),
  );

  // Reply handling prompts
  const [replyClassifierPrompt, setReplyClassifierPrompt] = useState("");
  const [replyDrafterPrompt,    setReplyDrafterPrompt   ] = useState("");

  // Auth
  const [userEmail, setUserEmail] = useState("");
  const [userName,  setUserName  ] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving  ] = useState(false);
  const [saved,   setSaved   ] = useState(false);
  const [error,   setError   ] = useState("");
  const activeAiNavItem = AI_NAV_ITEMS.find((item) => item.id === aiSection);

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
        setClientProducts(
          (s.client_products ?? "").split(",").map((p) => p.trim()).filter(Boolean),
        );
        setTargetMarkets(s.client_target_markets ?? "");
        setSystemPrompt(s.system_prompt ?? "");
        setSigName(s.signature_name ?? "");
        setSigTitle(s.signature_title ?? "");
        setSigContact(s.signature_contact ?? "");

        setEmailIntro(s.email_template_intro ?? "");
        setEmailOfferings(s.email_template_offerings ?? "");
        setClosingWithAttachment(s.email_template_closing_with_attachment ?? "");
        setClosingNoAttachment(s.email_template_closing_no_attachment ?? "");
        setProductSections(Object.fromEntries(
          PRODUCT_TYPES.map((p) => [
            p.id,
            { section: s[`product_${p.id}_section`] ?? "", hint: s[`product_${p.id}_hint`] ?? "" },
          ]),
        ));
        setReplyClassifierPrompt(s.reply_classifier_prompt ?? "");
        setReplyDrafterPrompt(s.reply_drafter_prompt ?? "");

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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLogoUploading(false);
    }
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
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      const productPatch = Object.fromEntries(
        PRODUCT_TYPES.flatMap((p) => [
          [`product_${p.id}_section`, productSections[p.id]?.section ?? ""],
          [`product_${p.id}_hint`, productSections[p.id]?.hint ?? ""],
        ]),
      );
      await patchSettings(token, {
        default_sender_name: senderName,
        client_industry:     clientIndustry,
        client_products:     clientProducts.join(", "),
        client_target_markets: targetMarkets,
        system_prompt:       systemPrompt,
        signature_name:      sigName,
        signature_title:     sigTitle,
        signature_contact:   sigContact,
        email_template_intro: emailIntro,
        email_template_offerings: emailOfferings,
        email_template_closing_with_attachment: closingWithAttachment,
        email_template_closing_no_attachment: closingNoAttachment,
        reply_classifier_prompt: replyClassifierPrompt,
        reply_drafter_prompt: replyDrafterPrompt,
        ...productPatch,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // Content skeleton — sidebar and breadcrumb are always rendered immediately
  const contentSkeleton = loading ? (
    <div className="max-w-2xl mx-auto p-8 space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-5 w-32 bg-secondary rounded" />
        <div className="h-3 w-56 bg-secondary/60 rounded" />
      </div>
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-4">
          <div className="size-14 rounded-full bg-secondary shrink-0" />
          <div className="space-y-2">
            <div className="h-4 w-28 bg-secondary rounded" />
            <div className="h-3 w-40 bg-secondary/60 rounded" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="h-3 w-20 bg-secondary rounded" />
            <div className="h-9 bg-secondary rounded-lg" />
          </div>
          <div className="space-y-2">
            <div className="h-3 w-24 bg-secondary rounded" />
            <div className="h-9 bg-secondary rounded-lg" />
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <div className="h-4 w-16 bg-secondary rounded" />
        <div className="h-3 w-full bg-secondary/60 rounded" />
        <div className="h-3 w-3/4 bg-secondary/60 rounded" />
      </div>
    </div>
  ) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header breadcrumb */}
      <div className="px-8 py-5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span>Settings</span>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground font-medium">
            {NAV_ITEMS.find((n) => n.id === section)?.label}
          </span>
          {section === "ai" && activeAiNavItem && (
            <>
              <ChevronRight className="size-3.5" />
              <span className="text-foreground font-medium">{activeAiNavItem.label}</span>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 border-r border-border p-4 flex flex-col gap-1 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-2 mb-1">General</p>
          {NAV_ITEMS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn(
                "px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left w-full",
                section === id
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              {label}
            </button>
          ))}
        </aside>

        {section === "ai" && (
          <aside className="w-56 shrink-0 border-r border-border p-4 flex flex-col gap-1 overflow-y-auto">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-2 mb-1">AI &amp; Outreach</p>
            {AI_NAV_ITEMS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setAiSection(id)}
                className={cn(
                  "px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left w-full flex items-center gap-2.5",
                  aiSection === id
                    ? "bg-primary text-primary-foreground font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0" /> : <span className="size-4 shrink-0" />}
                <span className="truncate">{label}</span>
              </button>
            ))}
          </aside>
        )}

        {/* Content */}
        <div className="relative flex-1 overflow-y-auto">
          {contentSkeleton}
          {!loading && <div className="mx-auto w-full max-w-5xl p-8 space-y-8">

            {/* ── My Profile ── */}
            {section === "profile" && (
              <>
                {/* Avatar + name block */}
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
                      <Input
                        value={userName}
                        onChange={(e) => setUserName(e.target.value)}
                        placeholder="Admin"
                        disabled
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Email address</Label>
                      <Input value={userEmail} disabled />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Profile details are managed through your Supabase auth account.
                  </p>
                </div>

                {/* Role badge */}
                <div className="rounded-xl border border-border bg-card p-6 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Role</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Your access level in this workspace.</p>
                  </div>
                  <span className="text-[11px] font-semibold uppercase tracking-wide px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                    Admin
                  </span>
                </div>
              </>
            )}

            {/* ── AI & Outreach ── */}
            {section === "ai" && (
              <>
                <div className="min-w-0 space-y-6">
                    {aiSection === "context" && (
                      <section className="rounded-xl border border-border bg-card p-6 space-y-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <Bot className="size-4 text-muted-foreground" />
                              <h3 className="text-sm font-semibold">Company &amp; Client Info</h3>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              These details are appended to draft generation so emails stay grounded in the right business context.
                            </p>
                          </div>
                          <span className="rounded-md bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
                            Context
                          </span>
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
                        <div className="rounded-lg border border-border bg-secondary/10 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">Logo</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                Upload a square logo (PNG/JPG/WebP, up to 2MB). It will appear in the app sidebar.
                              </p>
                            </div>
                            {logoUrl ? (
                              <img
                                src={logoUrl}
                                alt="Brand logo"
                                className="size-10 rounded-lg border border-border bg-card object-contain shrink-0"
                              />
                            ) : (
                              <div className="size-10 rounded-lg border border-border bg-card flex items-center justify-center shrink-0">
                                <span className="text-xs font-bold text-muted-foreground">K</span>
                              </div>
                            )}
                          </div>

                          <div className="mt-3 flex items-center gap-2 flex-wrap">
                            <label className={cn(
                              "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors",
                              "h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90",
                              logoUploading && "opacity-60 pointer-events-none",
                            )}>
                              {logoUploading ? "Uploading..." : (logoUrl ? "Replace logo" : "Upload logo")}
                              <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                onChange={(e) => void handleLogoPick(e.target.files?.[0] ?? null)}
                              />
                            </label>

                            {logoPath && (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-9"
                                disabled={logoUploading}
                                onClick={() => void handleLogoRemove()}
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        </div>
                        <TagInput
                          label="Client products"
                          pills={clientProducts}
                          suggestions={PRODUCT_SUGGESTIONS}
                          onChange={setClientProducts}
                          placeholder="Add product..."
                        />
                        <div className="space-y-1.5">
                          <Label>Target markets</Label>
                          <Input value={targetMarkets} onChange={(e) => setTargetMarkets(e.target.value)} placeholder="Packaging, Automotive, Agriculture" />
                        </div>
                      </section>
                    )}

                    {aiSection === "drafts" && (
                      <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-sm font-semibold">Email Draft Instructions</h3>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Control the style, constraints, and structure used when Kuber generates outreach drafts.
                            </p>
                          </div>
                        </div>
                        <RichTextEditor
                          label="Base prompt"
                          value={systemPrompt}
                          onChange={setSystemPrompt}
                          minHeight={360}
                          placeholder="Tell the AI how to write concise, personalized B2B outreach..."
                          helper="Campaign-level context is appended on top of this base prompt."
                        />
                      </section>
                    )}

                    {aiSection === "template" && (
                      <section className="rounded-xl border border-border bg-card p-6 space-y-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <PenLine className="size-4 text-muted-foreground" />
                              <h3 className="text-sm font-semibold">Cold Email Template</h3>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              This client-approved copy is sent as-is on every cold email. The AI only
                              writes a short personalized opening line and picks the matching product
                              section &mdash; it never rewrites this text.
                            </p>
                          </div>
                        </div>
                        <RichTextEditor
                          label="Company intro"
                          value={emailIntro}
                          onChange={setEmailIntro}
                          minHeight={120}
                          helper="Appears right after the AI-personalized opening line."
                        />
                        <RichTextEditor
                          label="Offerings & key strengths"
                          value={emailOfferings}
                          onChange={setEmailOfferings}
                          minHeight={260}
                        />
                        <RichTextEditor
                          label="Closing (with brochure attached)"
                          value={closingWithAttachment}
                          onChange={setClosingWithAttachment}
                          minHeight={100}
                          helper="Used when the campaign or lead has an attachment configured."
                        />
                        <RichTextEditor
                          label="Closing (no attachment)"
                          value={closingNoAttachment}
                          onChange={setClosingNoAttachment}
                          minHeight={100}
                          helper="Used when there is no attachment for this email."
                        />
                      </section>
                    )}

                    {aiSection === "products" && (
                      <div className="space-y-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <Sparkles className="size-4 text-muted-foreground" />
                            <h3 className="text-sm font-semibold">Product Sections</h3>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            For each masterbatch type, the AI reads the &quot;fit hint&quot; to decide whether
                            it matches a lead&apos;s company, then passes the section details to the AI as context to write a natural product recommendation.
                          </p>
                        </div>
                        {PRODUCT_TYPES.map(({ id, label }) => (
                          <section key={id} className="rounded-xl border border-border bg-card p-6 space-y-4">
                            <h4 className="text-sm font-semibold">{label}</h4>
                            <div className="space-y-1.5">
                              <Label>AI fit hint</Label>
                              <Textarea
                                value={productSections[id]?.hint ?? ""}
                                onChange={(e) =>
                                  setProductSections((prev) => ({
                                    ...prev,
                                    [id]: { ...prev[id], hint: e.target.value },
                                  }))
                                }
                                placeholder="When does this product fit a lead's company? e.g. buys/uses carbon black, needs UV protection..."
                                className="min-h-16"
                              />
                              <p className="text-xs text-muted-foreground">
                                Short description of the kind of company this product fits &mdash; used by the AI to match leads, not shown in the email.
                              </p>
                            </div>
                            <RichTextEditor
                              label="Section copy"
                              value={productSections[id]?.section ?? ""}
                              onChange={(value) =>
                                setProductSections((prev) => ({
                                  ...prev,
                                  [id]: { ...prev[id], section: value },
                                }))
                              }
                              minHeight={220}
                              helper="Provided to the AI as context when this product is matched — not copy-pasted verbatim."
                            />
                          </section>
                        ))}
                      </div>
                    )}

                    {aiSection === "replies" && (
                      <section className="rounded-xl border border-border bg-card p-6 space-y-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <Bot className="size-4 text-muted-foreground" />
                              <h3 className="text-sm font-semibold">Reply AI</h3>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Controls how inbound replies are classified (hot/warm/cold/etc.) and how
                              follow-up replies are drafted.
                            </p>
                          </div>
                        </div>
                        <RichTextEditor
                          label="Reply classifier prompt"
                          value={replyClassifierPrompt}
                          onChange={setReplyClassifierPrompt}
                          minHeight={280}
                          helper="Must return JSON with temperature, interest_status, and reasoning — see existing prompt for the exact shape."
                        />
                        <RichTextEditor
                          label="Reply drafter prompt"
                          value={replyDrafterPrompt}
                          onChange={setReplyDrafterPrompt}
                          minHeight={220}
                          helper="Must return JSON with subject and body."
                        />
                      </section>
                    )}

                    {aiSection === "footer" && (
                      <section className="rounded-xl border border-border bg-card p-6 space-y-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2">
                              <PenLine className="size-4 text-muted-foreground" />
                              <h3 className="text-sm font-semibold">Email Footer</h3>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Add the contact lines appended at the end of generated emails.
                            </p>
                          </div>
                          <span className="rounded-md bg-secondary px-2 py-1 text-[11px] font-medium text-muted-foreground">
                            Signature
                          </span>
                        </div>

                        <RichTextEditor
                          label="Contact footer"
                          value={sigContact}
                          onChange={setSigContact}
                          minHeight={190}
                          placeholder={"Kuber Polyplast\n+91-XXXXXXXXXX\nsales@kuberpolyplast.com"}
                        />
                      </section>
                    )}

                    {aiSection === "knowledge" && (
                      <section className="rounded-xl border border-border bg-secondary/20 p-6 space-y-3 opacity-60">
                        <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                          <Lock className="size-4" /> Knowledge Sources
                        </div>
                        <p className="max-w-xl text-sm text-muted-foreground">
                          Upload PDFs, FAQs, or product specs to enrich AI context. This area is reserved for the upcoming knowledge workflow.
                        </p>
                        <div className="rounded-lg border border-dashed border-border bg-background/40 p-6 text-center text-sm text-muted-foreground">
                          Coming soon
                        </div>
                      </section>
                    )}
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}
                {saved && <p className="text-sm text-green-400">Settings saved.</p>}

              </>
            )}

            {/* ── Appearance ── */}
            {section === "appearance" && (
              <>
                <div className="rounded-xl border border-border bg-card p-6 space-y-5">
                  <div className="flex items-center gap-2">
                    {mode === "light" ? <Sun className="size-4 text-muted-foreground" /> : <Moon className="size-4 text-muted-foreground" />}
                    <h3 className="text-sm font-semibold">Appearance mode</h3>
                  </div>
                  <p className="text-xs text-muted-foreground -mt-3">
                    Switch between a dark or light workspace background.
                  </p>
                  <div className="grid grid-cols-2 gap-3 max-w-sm">
                    {(["dark", "light"] as const).map((m) => {
                      const active = mode === m;
                      const Icon = m === "dark" ? Moon : Sun;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => void setMode(m)}
                          disabled={savingTheme}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                            active
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-muted-foreground",
                          )}
                        >
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
                  <p className="text-xs text-muted-foreground -mt-3">
                    Choose an accent color for the background, sidebar, cards, and highlights across the workspace.
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {COLORS.map((t) => {
                      const active = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => void setTheme(t.id)}
                          disabled={savingTheme}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                            active
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-muted-foreground",
                          )}
                        >
                          <span
                            className="size-7 shrink-0 rounded-full border border-border"
                            style={{ backgroundColor: t.swatch }}
                          />
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
              <>
                <div className="rounded-xl border border-border bg-card p-6 space-y-4">
                  <h3 className="text-sm font-semibold">Session</h3>
                  <div className="flex items-center justify-between py-3 border-t border-border">
                    <div>
                      <p className="text-sm font-medium">Signed in as</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{userEmail}</p>
                    </div>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                      Active
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-3 border-t border-border">
                    <div>
                      <p className="text-sm font-medium">Sign out</p>
                      <p className="text-xs text-muted-foreground mt-0.5">End your current session on this device.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => supabase.auth.signOut()}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5 transition-colors"
                    >
                      <LogOut className="size-3.5" />
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            )}

          </div>}
          {!loading && section === "ai" && (
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
