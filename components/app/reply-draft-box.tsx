"use client";

import { useState } from "react";
import { Loader2, RotateCcw, Save, Check, ThumbsDown, Send, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { cn } from "@/lib/utils";
import {
  editReplyDraft,
  approveReplyDraft,
  rejectReplyDraft,
  sendReplyDraft,
  regenerateReplyDraft,
  type ReplyDraft,
} from "@/lib/api-client";

const DRAFT_STATUS_STYLE: Record<string, string> = {
  generating: "bg-secondary text-muted-foreground",
  draft: "bg-blue-500/15 text-blue-400",
  approved: "bg-cyan-500/15 text-cyan-400",
  sent: "bg-green-500/15 text-green-400",
  failed: "bg-red-500/15 text-red-400",
  rejected: "bg-red-500/10 text-red-400/70",
};

interface ReplyDraftBoxProps {
  draft: ReplyDraft;
  token: string;
  onChanged: () => void; // parent re-fetches threads after any successful action
}

export function ReplyDraftBox({ draft, token, onChanged }: ReplyDraftBoxProps) {
  // Local state, initialized directly from the draft prop. Because this component is
  // rendered with key={draft.id} by the parent, React fully remounts it (and re-runs
  // these useState initializers) whenever the draft changes — e.g. after Regenerate
  // creates a new draft row with a new id. No manual sync effect needed.
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body ?? "");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenQuery, setRegenQuery] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  if (draft.status === "sent") {
    return (
      <div className="flex items-end gap-2 justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-3">
          <div
            className="text-sm leading-relaxed [&_p]:mb-2 [&_p:last-child]:mb-0"
            dangerouslySetInnerHTML={{ __html: draft.body ?? "" }}
          />
        </div>
        <div className="flex items-center gap-1.5 pr-1">
          <CheckCircle2 className="size-3 text-green-400" />
          <p className="text-[10px] text-green-400">Sent</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full rounded-2xl rounded-br-sm border border-primary/20 bg-primary/5 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-primary/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-primary">Your reply</span>
          <span className={cn("text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full", DRAFT_STATUS_STYLE[draft.status] ?? "")}>
            {draft.status}
          </span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setRegenOpen((o) => !o)} className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground px-2">
          <RotateCcw className="size-3" /> Regenerate
        </Button>
      </div>
      <div className="p-4 space-y-3">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="text-sm font-medium bg-background/60" />
        <RichTextEditor value={body} onChange={setBody} minHeight={180} />
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="outline" disabled={saving} onClick={async () => {
            setSaving(true); setError("");
            try { await editReplyDraft(token, draft.id, subject, body); onChanged(); }
            catch (e) { setError((e as Error).message); }
            finally { setSaving(false); }
          }} className="gap-1.5">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
          </Button>

          {draft.status !== "approved" && (
            <Button size="sm" disabled={saving} onClick={async () => {
              setSaving(true); setError("");
              try { await approveReplyDraft(token, draft.id, subject, body); onChanged(); }
              catch (e) { setError((e as Error).message); }
              finally { setSaving(false); }
            }} className="gap-1.5">
              <Check className="size-3.5" /> Approve
            </Button>
          )}

          {draft.status === "approved" && (
            <Button size="sm" disabled={sending} onClick={async () => {
              setSending(true); setError("");
              try { await sendReplyDraft(token, draft.id); onChanged(); }
              catch (e) {
                const msg = (e as Error).message ?? "Failed to send reply";
                setError(msg.includes("MISSING_THREAD")
                  ? "Cannot send: the original email reference has expired in Instantly. Regenerate the reply to get a fresh thread reference."
                  : msg);
              } finally { setSending(false); }
            }} className="gap-1.5 bg-green-600 hover:bg-green-700">
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send reply
            </Button>
          )}

          {draft.status === "draft" && (
            <Button size="sm" variant="outline" disabled={saving} onClick={async () => {
              setSaving(true); setError("");
              try { await rejectReplyDraft(token, draft.id); onChanged(); }
              catch (e) { setError((e as Error).message); }
              finally { setSaving(false); }
            }} className="gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10">
              <ThumbsDown className="size-3.5" /> Reject
            </Button>
          )}
        </div>

        {regenOpen && (
          <div className="rounded-lg border border-border bg-background/60 p-3 space-y-2">
            <Input
              value={regenQuery}
              onChange={(e) => setRegenQuery(e.target.value)}
              placeholder="Optional instruction, e.g. Make it shorter…"
              className="text-sm"
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                (async () => {
                  setRegenerating(true); setError("");
                  try {
                    await regenerateReplyDraft(token, draft.id, regenQuery || undefined);
                    setRegenOpen(false); setRegenQuery("");
                    onChanged();
                  } catch (e) { setError((e as Error).message); }
                  finally { setRegenerating(false); }
                })();
              }}
            />
            <Button size="sm" disabled={regenerating} onClick={async () => {
              setRegenerating(true); setError("");
              try {
                await regenerateReplyDraft(token, draft.id, regenQuery || undefined);
                setRegenOpen(false); setRegenQuery("");
                onChanged();
              } catch (e) { setError((e as Error).message); }
              finally { setRegenerating(false); }
            }} className="gap-1.5">
              {regenerating ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />} Regenerate
            </Button>
          </div>
        )}

        {draft.status === "failed" && draft.error && (
          <p className="text-xs text-red-400 mt-1">Error: {draft.error}</p>
        )}
      </div>
    </div>
  );
}
