"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import Link from "next/link";
import { ChevronDown, ExternalLink, Loader2, Reply, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { splitQuotedBody } from "@/lib/email-display";
import type { ReplyDraft, UniboxMessage } from "@/lib/api-client";
import { sendUniboxReply } from "@/lib/api-client";
import { ReplyDraftBox } from "@/components/app/reply-draft-box";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";

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

function MessageBubble({
  m,
  campaign,
  leadName,
}: {
  m: UniboxMessage;
  campaign: { id: string; name: string } | null;
  leadName: string;
}) {
  const isOutbound = m.direction !== "received";
  const { main, quoted } = useMemo(
    () => splitQuotedBody(m.body_html, m.body_text),
    [m.body_html, m.body_text],
  );
  const isHtml = !!m.body_html;

  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-1", isOutbound ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm relative",
            isOutbound
              ? "rounded-br-sm bg-primary/10 border border-primary/20"
              : "rounded-bl-sm bg-secondary border border-border",
            m.is_unread && !isOutbound && "ring-2 ring-primary/40 ring-offset-1 ring-offset-background",
          )}
        >
          {m.is_unread && !isOutbound && (
            <span
              className="absolute -left-2 top-3 size-2 rounded-full bg-primary"
              title="Unread"
            />
          )}
          {main ? (
            isHtml ? (
              <div
                className="leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0 [&_p:last-child]:leading-snug"
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
        <p className="text-[10px] text-muted-foreground px-1 flex items-center gap-1 flex-wrap">
          <span>
            {isOutbound ? "You" : leadName} · {format(new Date(m.timestamp_email), "MMM d, h:mm a")}
          </span>
          {campaign && isOutbound && (
            <>
              <span>·</span>
              <Link
                href={`/campaigns/${campaign.id}`}
                className="text-primary hover:underline inline-flex items-center gap-0.5"
              >
                {campaign.name}
                <ExternalLink className="size-2.5 opacity-70" />
              </Link>
            </>
          )}
          {m.is_unread && !isOutbound && (
            <span className="text-primary font-medium">Unread</span>
          )}
        </p>
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
  const [expanded, setExpanded] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);

  useEffect(() => {
    setReplyOpen(false);
    setExpanded(false);
  }, [threadId]);

  const sorted = useMemo(
    () => [...messages].sort((a, b) => a.timestamp_email.localeCompare(b.timestamp_email)),
    [messages],
  );

  const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const older = sorted.length > 1 ? sorted.slice(0, -1) : [];
  const hiddenCount = older.length;

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
    <div className="p-6 space-y-4">
      {latest && (
        <>
          <MessageBubble m={latest} campaign={campaign} leadName={leadName} />

          {canReply && (
            <div className="flex items-center gap-2 pt-1">
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
        </>
      )}

      {hiddenCount > 0 && (
        <>
          <div className="flex justify-center py-1">
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-full px-4 py-1.5 bg-card/60 hover:bg-secondary/40 transition-colors"
            >
              <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} />
              {expanded ? "Hide messages" : `${hiddenCount} more message${hiddenCount === 1 ? "" : "s"}`}
            </button>
          </div>

          {expanded && (
            <div className="space-y-4 pt-1 border-t border-border/50">
              {older.map((m) => (
                <MessageBubble key={m.id} m={m} campaign={campaign} leadName={leadName} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
