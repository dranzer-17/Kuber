"use client";

import { useEffect, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { sendUniboxReply } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";

/**
 * Plain human-written reply — no AI, no reply_drafts row. Shared by Unibox and
 * campaign Outbox so both surfaces can answer a thread without an AI draft
 * existing first, which is the normal state now that drafting is opt-in.
 */
export function ManualReplyBox({
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
    <div className="enter swatch-bar mt-4 rounded-xl border border-primary/20 bg-primary/5 overflow-hidden">
      <div className="px-4 py-2 border-b border-primary/10 flex items-center justify-between">
        <div>
          <p className="eyebrow">Manual reply</p>
          <span className="font-display text-xs font-semibold text-primary">Your reply</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-auto px-0 py-0 text-[11px] font-normal text-muted-foreground hover:text-foreground hover:bg-transparent"
        >
          Cancel
        </Button>
      </div>
      <div className="p-4 space-y-3">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="text-sm" />
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
