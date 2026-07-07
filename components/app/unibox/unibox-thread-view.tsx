"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import Link from "next/link";
import { ChevronDown, ExternalLink, Loader2, Reply, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { splitQuotedBody, emailPreview } from "@/lib/email-display";
import type { ReplyDraft, UniboxMessage } from "@/lib/api-client";
import { sendUniboxReply } from "@/lib/api-client";
import { ReplyDraftBox } from "@/components/app/reply-draft-box";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Avatar } from "@/components/leads/lead-ui";

type Props = {
  messages: UniboxMessage[];
  leadName: string;
  leadEmail: string | null;
  campaign: { id: string; name: string } | null;
  threadId: string;
  token: string;
  canReply: boolean;
  pendingDraft: ReplyDraft | null;
  replyToSubject: string | null;
  onChanged: () => void;
};

function QuotedBlock({ quoted, isHtml }: { quoted: string; isHtml: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2 pt-2 border-t border-border/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
      >
        <span className="tracking-widest">⋯</span>
        {open ? "Hide quoted text" : "Show quoted text"}
      </button>
      {open && (
        <div className="mt-2 pl-3 border-l-2 border-muted-foreground/30 text-muted-foreground/90 text-xs leading-relaxed">
          {isHtml ? (
            <div
              className="[&_p]:mb-1.5 [&_blockquote]:opacity-80"
              dangerouslySetInnerHTML={{ __html: quoted }}
            />
          ) : (
            <p className="whitespace-pre-wrap">{quoted}</p>
          )}
        </div>
      )}
    </div>
  );
}

function MessageRow({
  m,
  campaign,
  leadName,
  expanded,
  onToggle,
}: {
  m: UniboxMessage;
  campaign: { id: string; name: string } | null;
  leadName: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isOutbound = m.direction !== "received";
  const senderName = isOutbound ? "You" : leadName;
  const toLabel = isOutbound ? leadName : "me";
  const { main, quoted } = useMemo(
    () => splitQuotedBody(m.body_html, m.body_text),
    [m.body_html, m.body_text],
  );
  const isHtml = !!m.body_html;
  const snippet = useMemo(
    () => emailPreview(m.body_text, m.body_html, 100),
    [m.body_text, m.body_html],
  );
  const isUnread = m.is_unread && !isOutbound;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-2.5 text-left border-b border-border/60 hover:bg-secondary/40 transition-colors",
          isUnread && "bg-primary/5",
        )}
      >
        <Avatar name={senderName} size="sm" />
        <span className={cn("shrink-0 max-w-[160px] truncate text-sm", isUnread ? "font-semibold" : "font-medium text-foreground/90")}>
          {senderName}
        </span>
        <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">
          {snippet || "(empty message)"}
        </span>
        {isUnread && <span className="size-1.5 rounded-full bg-primary shrink-0" />}
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {format(new Date(m.timestamp_email), "MMM d")}
        </span>
      </button>
    );
  }

  return (
    <div className={cn("border-b border-border/60", isUnread && "bg-primary/5")}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-secondary/30 transition-colors"
      >
        <Avatar name={senderName} size="sm" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm">{senderName}</span>
            {isUnread && (
              <span className="text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/25">
                Unread
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate">to {toLabel}</p>
        </div>
        <div className="shrink-0 flex items-center gap-2 text-[11px] text-muted-foreground">
          {campaign && isOutbound && (
            <Link
              href={`/campaigns/${campaign.id}`}
              onClick={(e) => e.stopPropagation()}
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              {campaign.name}
              <ExternalLink className="size-2.5 opacity-70" />
            </Link>
          )}
          <span className="tabular-nums">{format(new Date(m.timestamp_email), "MMM d, h:mm a")}</span>
        </div>
      </button>
      <div className="px-4 pb-4 pl-[52px] text-sm">
        {main ? (
          isHtml ? (
            <div
              className="leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0"
              dangerouslySetInnerHTML={{ __html: main }}
            />
          ) : (
            <p className="whitespace-pre-wrap">{main}</p>
          )
        ) : (
          <p className="text-muted-foreground italic">(empty message)</p>
        )}
        {quoted && <QuotedBlock quoted={quoted} isHtml={isHtml} />}
        {m.step && isOutbound && (
          <span className="inline-block mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">
            Step {m.step}
          </span>
        )}
      </div>
    </div>
  );
}

function ManualReplyEditor({
  threadId,
  token,
  replyToSubject,
  onSent,
  onCancel,
}: {
  threadId: string;
  token: string;
  replyToSubject: string | null;
  onSent: () => void;
  onCancel: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    setSubject(replyToSubject ? `Re: ${replyToSubject.replace(/^Re:\s*/i, "")}` : "");
    setBody("");
  }, [threadId, replyToSubject]);

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      await sendUniboxReply(token, {
        thread_id: threadId,
        subject,
        body_html: body.replace(/\n/g, "<br>"),
        body_text: body.replace(/<[^>]+>/g, ""),
      });
      toast.success("Reply sent");
      onSent();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 overflow-hidden">
      <div className="px-4 py-2 border-b border-primary/10 flex items-center justify-between">
        <span className="text-xs font-semibold text-primary">Your reply</span>
        <button type="button" onClick={onCancel} className="text-[11px] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
      <div className="p-4 space-y-3">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="text-sm bg-background/60" />
        <RichTextEditor value={body} onChange={setBody} placeholder="Write your reply…" minHeight={120} />
        <div className="flex justify-end">
          <Button size="sm" disabled={sending} onClick={() => void handleSend()} className="gap-1.5">
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Send reply
          </Button>
        </div>
      </div>
    </div>
  );
}

export function UniboxThreadView({
  messages,
  leadName,
  campaign,
  threadId,
  token,
  canReply,
  pendingDraft,
  replyToSubject,
  onChanged,
}: Props) {
  const [replyOpen, setReplyOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const sorted = useMemo(
    () => [...messages].sort((a, b) => a.timestamp_email.localeCompare(b.timestamp_email)),
    [messages],
  );

  useEffect(() => {
    setReplyOpen(false);
    const last = sorted.length > 0 ? sorted[sorted.length - 1] : null;
    setExpandedIds(last ? new Set([last.id]) : new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  function toggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasDraftReady = pendingDraft && pendingDraft.status !== "generating" && pendingDraft.status !== "sent";
  const isGenerating = pendingDraft?.status === "generating";

  if (messages.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground text-center py-12">No messages in this thread yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="rounded-xl border border-border bg-card overflow-hidden mx-6 mt-6">
        {sorted.map((m) => (
          <MessageRow
            key={m.id}
            m={m}
            campaign={campaign}
            leadName={leadName}
            expanded={expandedIds.has(m.id)}
            onToggle={() => toggle(m.id)}
          />
        ))}
      </div>

      <div className="px-6 pb-6 pt-4">
        {canReply && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setReplyOpen((o) => !o)}
              className="gap-1.5 rounded-full px-4"
            >
              <Reply className="size-3.5" />
              Reply
              <ChevronDown className={cn("size-3.5 transition-transform", replyOpen && "rotate-180")} />
            </Button>
            {hasDraftReady && !replyOpen && (
              <button
                type="button"
                onClick={() => setReplyOpen(true)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors"
              >
                <Sparkles className="size-3" />
                AI reply ready
              </button>
            )}
            {isGenerating && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Generating draft…
              </span>
            )}
          </div>
        )}

        {replyOpen && canReply && (
          <div className="pl-0">
            {hasDraftReady ? (
              <ReplyDraftBox
                draft={pendingDraft!}
                token={token}
                onChanged={() => {
                  onChanged();
                  setReplyOpen(false);
                }}
              />
            ) : isGenerating ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="size-4 animate-spin" />
                Generating AI reply draft…
              </div>
            ) : (
              <ManualReplyEditor
                threadId={threadId}
                token={token}
                replyToSubject={replyToSubject}
                onSent={() => {
                  onChanged();
                  setReplyOpen(false);
                }}
                onCancel={() => setReplyOpen(false)}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
