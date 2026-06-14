"use client";

import { cn } from "@/lib/utils";
import { Avatar } from "@/components/leads/lead-ui";
import {
  CAMPAIGN_KANBAN_COLS,
  campaignBucket,
  type CampaignBucket,
} from "@/lib/campaign-status";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type CampaignKanbanLead = {
  id: string;
  crm_status: string;
  leads: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    title: string | null;
  } | null;
  email_drafts: { id: string; status: string } | null;
};

export function CampaignKanban({
  leads,
  selectedId,
  onSelect,
  onSetStatus,
}: {
  leads: CampaignKanbanLead[];
  selectedId: string | null;
  onSelect: (campaignLeadId: string) => void;
  onSetStatus?: (campaignLeadId: string, status: "won" | "closed") => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-4 min-h-0 flex-1 p-2">
      {CAMPAIGN_KANBAN_COLS.map((col) => {
        const colLeads = leads.filter((cl) => campaignBucket(cl) === col.id);
        return (
          <div
            key={col.id}
            className="shrink-0 flex flex-col gap-2"
            style={{
              width: `calc((100% - ${(CAMPAIGN_KANBAN_COLS.length - 1) * 8}px) / ${CAMPAIGN_KANBAN_COLS.length})`,
              minWidth: "140px",
            }}
          >
            <div className={cn("flex items-center gap-1.5 px-2.5 py-2 rounded-lg border bg-card", col.header)}>
              <span className={cn("size-2 rounded-full shrink-0", col.dot)} />
              <span className="text-xs font-semibold truncate">{col.label}</span>
              <span className="ml-auto text-[10px] font-medium text-muted-foreground bg-secondary rounded-full px-1.5 py-0.5 tabular-nums shrink-0">
                {colLeads.length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              {colLeads.map((cl) => {
                const lead = cl.leads;
                const name = [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || "Unknown";
                const failed = cl.email_drafts?.status === "failed";
                const isSelected = selectedId === cl.id;
                return (
                  <div
                    key={cl.id}
                    className={cn(
                      "rounded-lg border bg-card p-2.5 cursor-pointer transition-colors",
                      failed ? "border-red-500/50" : "border-border",
                      isSelected ? "ring-1 ring-primary/50 bg-primary/5" : "hover:bg-secondary/40",
                    )}
                    onClick={() => onSelect(cl.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(cl.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex items-start gap-2">
                      <Avatar name={name} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {lead?.title || lead?.email}
                        </p>
                      </div>
                    </div>
                    {onSetStatus && (
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        <Select
                          value={cl.crm_status === "won" || cl.crm_status === "closed" ? cl.crm_status : ""}
                          onValueChange={(v) => {
                            if (v === "won" || v === "closed") onSetStatus(cl.id, v);
                          }}
                        >
                          <SelectTrigger className="h-6 text-[10px] w-full">
                            <SelectValue placeholder="Set outcome" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="won">Won</SelectItem>
                            <SelectItem value="closed">Closed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function countByBucket(leads: CampaignKanbanLead[]): Record<CampaignBucket, number> {
  const counts: Record<CampaignBucket, number> = {
    pending: 0,
    draft: 0,
    approved: 0,
    sent: 0,
    replied: 0,
    won: 0,
    closed: 0,
  };
  for (const cl of leads) counts[campaignBucket(cl)]++;
  return counts;
}
