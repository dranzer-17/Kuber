"use client";

import { useEffect, useState } from "react";
import {
  Loader2, Lock, Save, User, Bot, LogOut,
  ChevronRight, Sparkles, PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/app/lead-forms";
import { fetchSettings, patchSettings } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

const PRODUCT_SUGGESTIONS = [
  "Masterbatch", "Color Concentrates", "White Masterbatch", "Black Masterbatch",
  "Additive Masterbatch", "Filler Masterbatch",
];

type Section = "profile" | "ai" | "account";

const NAV_ITEMS: { id: Section; label: string; description: string }[] = [
  { id: "profile", label: "My Profile",    description: "Admin account details" },
  { id: "ai",      label: "AI & Outreach", description: "Email AI configuration" },
  { id: "account", label: "Account",       description: "Sign out & security" },
];

export function SettingsView() {
  const [section, setSection] = useState<Section>("profile");

  // Settings data
  const [senderName,     setSenderName    ] = useState("");
  const [clientIndustry, setClientIndustry] = useState("");
  const [clientProducts, setClientProducts] = useState<string[]>([]);
  const [targetMarkets,  setTargetMarkets ] = useState("");
  const [systemPrompt,   setSystemPrompt  ] = useState("");

  // Signature fields
  const [sigName,    setSigName   ] = useState("");
  const [sigTitle,   setSigTitle  ] = useState("");
  const [sigContact, setSigContact] = useState("");

  // Auth
  const [userEmail, setUserEmail] = useState("");
  const [userName,  setUserName  ] = useState("");

  const [loading, setLoading] = useState(true);
  const [saving,  setSaving  ] = useState(false);
  const [saved,   setSaved   ] = useState(false);
  const [error,   setError   ] = useState("");

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
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? "";
      await patchSettings(token, {
        default_sender_name: senderName,
        client_industry:     clientIndustry,
        client_products:     clientProducts.join(", "),
        client_target_markets: targetMarkets,
        system_prompt:       systemPrompt,
        signature_name:      sigName,
        signature_title:     sigTitle,
        signature_contact:   sigContact,
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
                  ? "bg-white text-black font-semibold"
                  : "text-muted-foreground hover:text-white hover:bg-secondary/50",
              )}
            >
              {label}
            </button>
          ))}
        </aside>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {contentSkeleton}
          {!loading && <div className="max-w-2xl mx-auto p-8 space-y-8">

            {/* ── My Profile ── */}
            {section === "profile" && (
              <>
                <div>
                  <h2 className="text-lg font-semibold">My Profile</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">Your admin account information.</p>
                </div>

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
                <div>
                  <h2 className="text-lg font-semibold">AI & Outreach</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">Configure how Kuber generates outreach emails.</p>
                </div>

                <div className="rounded-xl border border-border bg-card p-6 space-y-5">
                  <div className="flex items-center gap-2">
                    <Bot className="size-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Company &amp; Client Info</h3>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Default sender name</Label>
                    <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Kuber Polyplast" />
                    <p className="text-xs text-muted-foreground">Used as the "From" name in outreach emails.</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Client industry</Label>
                    <Input value={clientIndustry} onChange={(e) => setClientIndustry(e.target.value)} placeholder="Plastics & Polymer Manufacturing" />
                  </div>
                  <TagInput
                    label="Client products"
                    pills={clientProducts}
                    suggestions={PRODUCT_SUGGESTIONS}
                    onChange={setClientProducts}
                    placeholder="Add product…"
                  />
                  <div className="space-y-1.5">
                    <Label>Target markets</Label>
                    <Input value={targetMarkets} onChange={(e) => setTargetMarkets(e.target.value)} placeholder="Packaging, Automotive, Agriculture" />
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-6 space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">AI System Prompt</h3>
                  </div>
                  <Textarea
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    rows={10}
                    className="text-sm leading-relaxed resize-y"
                  />
                  <p className="text-xs text-muted-foreground">
                    Base prompt used when generating all email drafts. Campaign-level context is appended on top.
                  </p>
                </div>

                <section className="rounded-xl border border-border bg-card p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <PenLine className="size-4 text-muted-foreground" />
                    <h3 className="text-sm font-semibold">Email Signature</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Used at the end of every generated email. Leave blank to use defaults.
                  </p>

                  <div className="space-y-1.5">
                    <Label>Sender name</Label>
                    <Input value={sigName} onChange={(e) => setSigName(e.target.value)}
                           placeholder="Kuber Polyplast Sales Team" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Title</Label>
                    <Input value={sigTitle} onChange={(e) => setSigTitle(e.target.value)}
                           placeholder="Business Development" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Contact information</Label>
                    <textarea
                      className="w-full rounded-lg border border-border bg-secondary/20 p-3 text-sm min-h-[90px] resize-y"
                      value={sigContact} onChange={(e) => setSigContact(e.target.value)}
                      placeholder={"Kuber Polyplast\n+91-XXXXXXXXXX\nsales@kuberpolyplast.com"} />
                  </div>

                  {/* Live preview */}
                  <div className="rounded-lg border border-border bg-secondary/10 p-3 text-sm whitespace-pre-line text-muted-foreground">
                    {["Best regards,", sigName || "Kuber Polyplast Sales Team", sigTitle || "Business Development", sigContact || "Kuber Polyplast\n+91-XXXXXXXXXX\nsales@kuberpolyplast.com"].join("\n")}
                  </div>
                </section>

                <div className="rounded-xl border border-border bg-secondary/20 p-6 space-y-2 opacity-50 pointer-events-none">
                  <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                    <Lock className="size-4" /> Knowledge Sources
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Upload PDFs, FAQs, or product specs to enrich AI context — coming soon.
                  </p>
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}
                {saved && <p className="text-sm text-green-400">Settings saved.</p>}

                <Button onClick={handleSave} disabled={saving} className="gap-1.5">
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Save settings
                </Button>
              </>
            )}

            {/* ── Account ── */}
            {section === "account" && (
              <>
                <div>
                  <h2 className="text-lg font-semibold">Account</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">Manage your session and account security.</p>
                </div>

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
        </div>
      </div>
    </div>
  );
}
