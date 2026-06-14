"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock, Save, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/app/lead-forms";
import { fetchSettings, patchSettings } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";

const PRODUCT_SUGGESTIONS = [
  "Masterbatch", "Color Concentrates", "White Masterbatch", "Black Masterbatch",
  "Additive Masterbatch", "Filler Masterbatch",
];

export function SettingsView() {
  const [senderName, setSenderName] = useState("");
  const [clientIndustry, setClientIndustry] = useState("");
  const [clientProducts, setClientProducts] = useState<string[]>([]);
  const [targetMarkets, setTargetMarkets] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? "";
        const s = await fetchSettings(token);
        setSenderName(s.default_sender_name ?? "");
        setClientIndustry(s.client_industry ?? "");
        setClientProducts(
          (s.client_products ?? "").split(",").map((p) => p.trim()).filter(Boolean),
        );
        setTargetMarkets(s.client_target_markets ?? "");
        setSystemPrompt(s.system_prompt ?? "");
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
        client_industry: clientIndustry,
        client_products: clientProducts.join(", "),
        client_target_markets: targetMarkets,
        system_prompt: systemPrompt,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" /> Loading settings…
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-8">
      <div>
        <p className="text-sm text-muted-foreground mb-1">Configuration</p>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="size-6" /> Settings
        </h1>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <h2 className="text-sm font-semibold">Company &amp; Client Info</h2>
        <div className="space-y-1.5">
          <Label>Default sender name</Label>
          <Input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Kuber Polyplast" />
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
        <h2 className="text-sm font-semibold">AI System Prompt</h2>
        <Textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={10}
          className="text-sm leading-relaxed resize-y"
        />
        <p className="text-xs text-muted-foreground">
          This is the base prompt used when generating all email drafts. Campaign-level context is appended on top.
        </p>
      </div>

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
    </div>
  );
}
