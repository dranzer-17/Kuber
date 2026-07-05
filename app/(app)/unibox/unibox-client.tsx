"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Loader2, RefreshCw } from "lucide-react";
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
  type UniboxThreadSummary,
} from "@/lib/api-client";
import type { UniboxStatusFilter } from "@/lib/services/unibox";
import { UniboxFilterRail } from "@/components/app/unibox/unibox-filter-rail";
import { UniboxThreadList } from "@/components/app/unibox/unibox-thread-list";
import { UniboxThreadView } from "@/components/app/unibox/unibox-thread-view";
import { UniboxComposer } from "@/components/app/unibox/unibox-composer";
import { UniboxStatusDropdown } from "@/components/app/unibox/unibox-status-dropdown";
import { Avatar } from "@/components/leads/lead-ui";

export function UniboxClient() {
  const searchParams = useSearchParams();
  const [token, setToken] = useState("");
  const [tab, setTab] = useState<"primary" | "others">("primary");
  const [status, setStatus] = useState<UniboxStatusFilter | null>(null);
  const [campaignId, setCampaignId] = useState<string | null>(searchParams.get("campaign_id"));
  const [eaccount, setEaccount] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(searchParams.get("unread_only") === "1");
  const [threads, setThreads] = useState<UniboxThreadSummary[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
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
      const data = await fetchUniboxThreads(token, {
        tab,
        status: status ?? undefined,
        campaign_id: campaignId ?? undefined,
        eaccount: eaccount ?? undefined,
        q: debouncedSearch || undefined,
        unread_only: unreadOnly ? "1" : undefined,
        cursor: append && cursor ? cursor : undefined,
      });
      setThreads((prev) => (append ? [...prev, ...data.threads] : data.threads));
      setCounts(data.counts.by_status);
      setCursor(data.next_cursor);
      if (!append && data.threads.length > 0) {
        setSelectedId((cur) => cur ?? data.threads[0].thread_id);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [token, tab, status, campaignId, eaccount, debouncedSearch, unreadOnly, cursor]);

  useEffect(() => { void loadThreads(false); }, [token, tab, status, campaignId, eaccount, debouncedSearch, unreadOnly]);

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

  const pendingDraft = (threadDetail?.reply_drafts ?? [])
    .filter((d) => d.status !== "sent")
    .slice(-1)[0] as ReplyDraft | undefined ?? null;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border px-6 py-3 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Unibox</h1>
          <p className="text-xs text-muted-foreground">All conversations across campaigns and inboxes</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            Unread only
          </label>
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
          status={status}
          campaignId={campaignId}
          eaccount={eaccount}
          counts={counts}
          campaigns={campaigns}
          eaccounts={eaccounts}
          onStatus={setStatus}
          onCampaign={setCampaignId}
          onEaccount={setEaccount}
        />
        <UniboxThreadList
          tab={tab}
          threads={threads}
          selectedId={selectedId}
          search={search}
          loading={loading}
          onTab={setTab}
          onSearch={setSearch}
          onSelect={setSelectedId}
          hasMore={!!cursor}
          onLoadMore={() => void loadThreads(true)}
        />
        <div className="flex-1 flex flex-col min-w-0">
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
                    <a href={`/campaigns/${selectedSummary.campaign.id}`} className="text-xs text-primary hover:underline shrink-0">
                      {selectedSummary.campaign.name}
                    </a>
                  )}
                </div>
                <UniboxStatusDropdown
                  interestStatus={threadDetail?.interest_status ?? selectedSummary.interest_status}
                  onChange={(v) => {
                    if (!token || !selectedId) return;
                    void setThreadStatus(token, selectedId, v, selectedSummary.lead_email ?? undefined)
                      .then(() => loadThreads(false))
                      .catch((e) => toast.error((e as Error).message));
                  }}
                />
              </div>
              {detailLoading ? (
                <div className="flex-1 flex items-center justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <UniboxThreadView
                  messages={threadDetail?.messages ?? []}
                  leadName={leadName}
                  leadEmail={selectedSummary.lead_email}
                  campaign={selectedSummary.campaign}
                />
              )}
              <UniboxComposer
                threadId={selectedId!}
                token={token}
                replyToSubject={threadDetail?.messages?.find((m) => m.direction === "received")?.subject ?? null}
                pendingDraft={pendingDraft}
                canReply={!!threadDetail?.reply_to_uuid}
                onSent={() => { void loadThreads(false); void loadDetail(selectedId!); }}
              />
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
