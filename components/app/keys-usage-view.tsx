"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ApolloUsageView } from "@/components/app/keys-usage-apollo";
import { InstantlyUsageView } from "@/components/app/keys-usage-instantly";
import { AiUsageView } from "@/components/app/keys-usage-ai";

type UsageTab = "apollo" | "instantly" | "ai";

const TABS: { id: UsageTab; label: string }[] = [
  { id: "apollo", label: "Apollo" },
  { id: "instantly", label: "Instantly" },
  { id: "ai", label: "AI" },
];

export function KeysUsageView() {
  const [tab, setTab] = useState<UsageTab>("apollo");

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 enter">
      <div className="space-y-1">
        <p className="eyebrow px-1">Settings · Keys · Usage</p>
        <h2 className="font-display text-lg font-semibold px-1">Usage &amp; limits</h2>
        <p className="text-xs text-muted-foreground px-1">
          Detailed, per-provider usage — credits, sends, and generations — for what Credentials manages.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as UsageTab)}>
        <TabsList className="w-full max-w-sm">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="apollo" className="mt-6">
          <ApolloUsageView />
        </TabsContent>
        <TabsContent value="instantly" className="mt-6">
          <InstantlyUsageView />
        </TabsContent>
        <TabsContent value="ai" className="mt-6">
          <AiUsageView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
