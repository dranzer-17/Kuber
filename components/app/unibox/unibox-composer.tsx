"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { ReplyDraftBox } from "@/components/app/reply-draft-box";
import { sendUniboxReply, type ReplyDraft } from "@/lib/api-client";

type Props = {
  threadId: string;
  token: string;
  replyToSubject: string | null;
  pendingDraft: ReplyDraft | null;
  canReply: boolean;
  onSent: () => void;
};

export function UniboxComposer({
  threadId, token, replyToSubject, pendingDraft, canReply, onSent,
}: Props) {
  const [manual, setManual] = useState(!pendingDraft);
  const [subject, setSubject] = useState(replyToSubject ? `Re: ${replyToSubject.replace(/^Re:\s*/i, "")}` : "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);

  if (!canReply) {
    return (
      <div className="border-t border-border p-4 text-xs text-muted-foreground">
        No inbound message to reply to in this thread.
      </div>
    );
  }

  if (pendingDraft && !manual) {
    return (
      <div className="border-t border-border p-4 space-y-2">
        <ReplyDraftBox draft={pendingDraft} token={token} onChanged={onSent} />
        <button type="button" className="text-xs text-primary hover:underline" onClick={() => setManual(true)}>
          Write manually instead
        </button>
      </div>
    );
  }

  async function handleSend() {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    try {
      await sendUniboxReply(token, {
        thread_id: threadId,
        subject,
        body_html: body.replace(/\n/g, "<br>"),
        body_text: body.replace(/<[^>]+>/g, ""),
        reply_draft_id: pendingDraft?.status === "approved" ? pendingDraft.id : undefined,
      });
      toast.success("Reply sent");
      setBody("");
      onSent();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-t border-border p-4 space-y-3 bg-card/40">
      <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="h-8 text-sm" />
      <RichTextEditor value={body} onChange={setBody} placeholder="Write your reply…" />
      <div className="flex justify-end">
        <Button size="sm" disabled={sending} onClick={() => void handleSend()} className="gap-1.5">
          {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Send reply
        </Button>
      </div>
    </div>
  );
}
