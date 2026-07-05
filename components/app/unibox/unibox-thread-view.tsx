"use client";

import { format } from "date-fns";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { UniboxMessage } from "@/lib/api-client";

type Props = {
  messages: UniboxMessage[];
  leadName: string;
  leadEmail: string | null;
  campaign: { id: string; name: string } | null;
};

export function UniboxThreadView({ messages, campaign }: Props) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {messages.map((m) => {
        const isOutbound = m.direction !== "received";
        return (
          <div key={m.id} className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] space-y-1", isOutbound ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "rounded-2xl px-4 py-3 text-sm",
                  isOutbound
                    ? "rounded-br-sm bg-primary/10 border border-primary/20"
                    : "rounded-bl-sm bg-secondary border border-border",
                )}
              >
                {m.body_html ? (
                  <div
                    className="leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0"
                    dangerouslySetInnerHTML={{ __html: m.body_html }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap">{m.body_text}</p>
                )}
                {m.step && isOutbound && (
                  <span className="inline-block mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Step {m.step}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground px-1">
                {format(new Date(m.timestamp_email), "MMM d, h:mm a")}
                {campaign && isOutbound && (
                  <> · <Link href={`/campaigns/${campaign.id}`} className="text-primary hover:underline">{campaign.name}</Link></>
                )}
              </p>
            </div>
          </div>
        );
      })}
      {messages.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-12">No messages in this thread yet.</p>
      )}
    </div>
  );
}
