"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  fetchCampaigns,
  fetchUniboxThread,
  fetchUniboxThreads,
  markThreadRead,
  setThreadStatus,
  syncUnibox,
  type ReplyDraft,
  type UniboxMessage,
  type UniboxThreadSummary,
} from "@/lib/api-client";
import { UniboxFilterRail } from "@/components/app/unibox/unibox-filter-rail";
import { UniboxThreadList } from "@/components/app/unibox/unibox-thread-list";
import { UniboxThreadView } from "@/components/app/unibox/unibox-thread-view";
import { UniboxTemperatureBadge } from "@/components/app/unibox/unibox-temperature-badge";
import { UniboxInstantlyInterestMenu } from "@/components/app/unibox/unibox-instantly-interest-menu";
import type { UniboxInterestFilter, UniboxReadStateFilter } from "@/components/app/unibox/unibox-status-filter";
import { Avatar } from "@/components/leads/lead-ui";

function pickPendingDraft(messages: UniboxMessage[], drafts: ReplyDraft[]): ReplyDraft | null {
  const received = messages.filter((m) => m.direction === "received");
  const latest = received[received.length - 1];
  const eventId = latest?.reply_event_id;
  const candidates = drafts.filter((d) => d.status !== "sent" && d.status !== "rejected");
  if (eventId) {
    const matched = candidates.filter((d) => d.reply_event_id === eventId);
    if (matched.length > 0) return matched[matched.length - 1];
  }
  return candidates[candidates.length - 1] ?? null;
}

export function UniboxClient() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState("");
  const [campaignIds, setCampaignIds] = useState<string[]>(() => {
    const id = searchParams.get("campaign_id");
    return id ? [id] : [];
  });
  const [eaccount, setEaccount] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [readState, setReadState] = useState<UniboxReadStateFilter>("all");
  const [interest, setInterest] = useState<UniboxInterestFilter>("all");
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [threads, setThreads] = useState<UniboxThreadSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [campaigns, setCampaigns] = useState<Array<{ id: string; name: string }>>([]);
  const [threadDetail, setThreadDetail] = useState<Awaited<ReturnType<typeof fetchUniboxThread>> | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setToken(data.session.access_token);
    });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const eaccounts = useMemo(
    () => [...new Set(threads.map((t) => t.eaccount).filter(Boolean))] as string[],
    [threads],
  );

  const loadThreads = useCallback(async (append = false) => {
    if (!token) return;
    setLoading(!append);
    try {
      const params: Record<string, string | undefined> = {
        eaccount: eaccount ?? undefined,
        q: debouncedSearch || undefined,
        cursor: append && cursor ? cursor : undefined,
      };
      if (campaignIds.length > 0) {
        params.campaign_ids = campaignIds.join(",");
      }
      if (readState !== "all") {
        params.status = readState;
      }
      if (interest !== "all") {
        params.interest = interest === "lead" ? "lead" : String(interest);
      }

      const data = await fetchUniboxThreads(token, params);
      setThreads((prev) => (append ? [...prev, ...data.threads] : data.threads));
      setCursor(data.next_cursor);
      if (!append) setUnreadTotal(data.counts.unread_total);
      if (!append && data.threads.length > 0) {
        setSelectedId((cur) => cur ?? data.threads[0].thread_id);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, campaignIds, eaccount, debouncedSearch, readState, interest, cursor]);

  useEffect(() => { void loadThreads(false); }, [token, campaignIds, eaccount, debouncedSearch, readState, interest]);

  useEffect(() => {
    if (!token) return;
    fetchCampaigns(token).then((c) => setCampaigns(c.map((x) => ({ id: x.id, name: x.name })))).catch(() => {});
  }, [token]);

  const loadDetail = useCallback(async (threadId: string) => {
    if (!token) return;
    setDetailLoading(true);
    try {
      const detail = await fetchUniboxThread(token, threadId, true);
      setThreadDetail(detail);
      if (readTimer.current) clearTimeout(readTimer.current);
      readTimer.current = setTimeout(() => {
        void markThreadRead(token, threadId).catch(() => {});
      }, 1000);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  async function handleSync() {
    if (!token) return;
    setSyncing(true);
    try {
      const r = await syncUnibox(token);
      toast.success(`Synced ${r.ingested} emails (${r.pages} pages)`);
      await loadThreads(false);
      if (selectedId) await loadDetail(selectedId);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  const selectedSummary = threads.find((t) => t.thread_id === selectedId);
  const leadName = selectedSummary
    ? [selectedSummary.lead?.first_name, selectedSummary.lead?.last_name].filter(Boolean).join(" ") || selectedSummary.lead_email || "Unknown"
    : "";

  const pendingDraft = useMemo(
    () => pickPendingDraft(threadDetail?.messages ?? [], threadDetail?.reply_drafts ?? []),
    [threadDetail],
  );

  const leadTemperature = threadDetail?.lead_temperature ?? selectedSummary?.lead_temperature ?? null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Unibox</h1>
          <p className="text-xs text-muted-foreground">All conversations across campaigns and inboxes</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={syncing}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {syncing ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            Sync now
          </button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <UniboxFilterRail
          campaignIds={campaignIds}
          eaccount={eaccount}
          campaigns={campaigns}
          eaccounts={eaccounts}
          onCampaigns={setCampaignIds}
          onEaccount={setEaccount}
        />
        <UniboxThreadList
          threads={threads}
          selectedId={selectedId}
          search={search}
          loading={loading}
          readState={readState}
          interest={interest}
          unreadTotal={unreadTotal}
          onReadState={setReadState}
          onInterest={setInterest}
          onSearch={setSearch}
          onSelect={setSelectedId}
          hasMore={!!cursor}
          onLoadMore={() => void loadThreads(true)}
        />
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          {selectedSummary ? (
            <>
              <div className="border-b border-border px-6 py-3 flex items-center justify-between gap-4 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={leadName} size="sm" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{leadName}</p>
                    <p className="text-xs text-muted-foreground truncate">{selectedSummary.lead_email}</p>
                  </div>
                  {selectedSummary.campaign && (
                    <Link
                      href={`/campaigns/${selectedSummary.campaign.id}`}
                      className="inline-flex items-center gap-1 shrink-0 rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-primary/10 transition-colors"
                    >
                      {selectedSummary.campaign.name}
                      <ExternalLink className="size-3 opacity-70" />
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <UniboxTemperatureBadge temperature={leadTemperature} />
                  <UniboxInstantlyInterestMenu
                    interestStatus={threadDetail?.interest_status ?? selectedSummary.interest_status}
                    onChange={(v) => {
                      if (!token || !selectedId) return;
                      void setThreadStatus(token, selectedId, v, selectedSummary.lead_email ?? undefined)
                        .then(() => { void loadThreads(false); void loadDetail(selectedId); })
                        .catch((e) => toast.error((e as Error).message));
                    }}
                  />
                </div>
              </div>
              {detailLoading ? (
                <div className="flex-1 flex items-center justify-center min-h-0"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="flex-1 overflow-y-auto min-h-0">
                  <UniboxThreadView
                    key={selectedId}
                    messages={threadDetail?.messages ?? []}
                    leadName={leadName}
                    leadEmail={selectedSummary.lead_email}
                    campaign={selectedSummary.campaign}
                    threadId={selectedId!}
                    token={token}
                    canReply={!!threadDetail?.reply_to_uuid}
                    pendingDraft={pendingDraft}
                    replyToSubject={threadDetail?.messages?.find((m) => m.direction === "received")?.subject ?? null}
                    onChanged={() => { void loadThreads(false); void loadDetail(selectedId!); }}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
