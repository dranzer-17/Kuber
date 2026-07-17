"use client";

import { useRef, useState } from "react";
import { Loader2, RotateCcw, Save, Check, ThumbsDown, Send, Paperclip, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  editReplyDraft,
  approveReplyDraft,
  rejectReplyDraft,
  sendReplyDraft,
  regenerateReplyDraft,
  uploadCampaignAttachment,
  type ReplyDraft,
} from "@/lib/api-client";
import { normalizeReplyBodyHtml } from "@/lib/reply-body-html";

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
  onChanged: () => void;
  /** When true, starts with blank subject/body for manual composition instead of
   *  prefilling the AI-generated content — the user can opt into AI via the
   *  "Generate with AI" button instead. */
  startBlank?: boolean;
}

export function ReplyDraftBox({ draft, token, onChanged, startBlank = false }: ReplyDraftBoxProps) {
  const [status, setStatus] = useState(draft.status);
  const [subject, setSubject] = useState(startBlank ? "" : draft.subject ?? "");
  const [body, setBody] = useState(() => (startBlank ? "" : normalizeReplyBodyHtml(draft.body ?? "")));
  const [aiUsed, setAiUsed] = useState(!startBlank);
  const [error, setError] = useState(draft.error);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenQuery, setRegenQuery] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Instantly's reply API has no attachment support, so files are shared as a
  // hosted download link appended to the reply body.
  async function handleAttachFile(file: File) {
    setAttaching(true);
    try {
      const up = await uploadCampaignAttachment(token, file);
      if (!up.attachment_url) throw new Error("Upload succeeded but no link was returned");
      const link = `<p>📎 <a href="${up.attachment_url}" target="_blank" rel="noopener">${up.attachment_name}</a></p>`;
      setBody((prev) => `${prev}${link}`);
      toast.success(`${up.attachment_name} added as a download link — remember to Save`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Parent thread (Outbox / Unibox) owns the mail-style row after send —
  // do not flash a chat bubble here.
  if (status === "sent") return null;

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await editReplyDraft(token, draft.id, subject, body);
      setStatus(updated.status);
      toast.success("Reply draft saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove() {
    setSaving(true);
    try {
      const updated = await approveReplyDraft(token, draft.id, subject, body);
      setStatus(updated.status);
      toast.success("Reply approved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSend() {
    setSending(true);
    try {
      await sendReplyDraft(token, draft.id);
      setStatus("sent");
      toast.success("Reply sent");
      onChanged();
    } catch (e) {
      const msg = (e as Error).message ?? "Failed to send reply";
      toast.error(
        msg.includes("MISSING_THREAD")
          ? "Cannot send: the original email reference has expired in Instantly. Regenerate the reply to get a fresh thread reference."
          : msg,
      );
    } finally {
      setSending(false);
    }
  }

  async function handleReject() {
    setSaving(true);
    try {
      const updated = await rejectReplyDraft(token, draft.id);
      setStatus(updated.status);
      toast.success("Reply rejected");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const updated = await regenerateReplyDraft(token, draft.id, regenQuery || undefined);
      setSubject(updated.subject ?? "");
      setBody(normalizeReplyBodyHtml(updated.body ?? ""));
      setStatus(updated.status);
      setError(updated.error);
      setAiUsed(true);
      setRegenOpen(false);
      setRegenQuery("");
      toast.success(aiUsed ? "Reply regenerated" : "AI reply generated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div className="enter swatch-bar w-full rounded-xl rounded-br-sm border border-primary/20 bg-primary/5 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-primary/10 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="leading-tight">
            <p className="eyebrow">AI draft · review</p>
            <span className="font-display text-xs font-semibold text-primary">Your reply</span>
          </div>
          <Badge variant="outline" className={cn("rounded-md border-transparent font-mono text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5", DRAFT_STATUS_STYLE[status] ?? "")}>
            {status}
          </Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={regenerating}
          onClick={() => (aiUsed ? setRegenOpen((o) => !o) : void handleRegenerate())}
          className={cn(
            "h-6 gap-1 text-[11px] px-2",
            aiUsed ? "text-muted-foreground hover:text-foreground" : "text-primary hover:text-primary",
          )}
        >
          {regenerating ? (
            <Loader2 className="size-3 animate-spin" />
          ) : aiUsed ? (
            <RotateCcw className="size-3" />
          ) : (
            <Sparkles className="size-3" />
          )}
          {regenerating ? "Generating…" : aiUsed ? "Regenerate" : "Generate with AI"}
        </Button>
      </div>
      <div className="p-4 space-y-3">
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="text-sm font-medium" />
        <RichTextEditor value={body} onChange={setBody} minHeight={180} />

        <div className="flex items-center gap-2 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleAttachFile(f); }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={attaching}
            onClick={() => fileInputRef.current?.click()}
            className="gap-1.5"
            title="Insert a file as a download link (Instantly cannot send real attachments)"
          >
            {attaching ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />} Attach link
          </Button>
          <Button size="sm" variant="outline" disabled={saving} onClick={() => void handleSave()} className="gap-1.5">
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Save
          </Button>

          {status !== "approved" && (
            <Button size="sm" disabled={saving} onClick={() => void handleApprove()} className="gap-1.5">
              <Check className="size-3.5" /> Approve
            </Button>
          )}

          {status === "approved" && (
            <Button size="sm" disabled={sending} onClick={() => void handleSend()} className="gap-1.5 bg-green-600 hover:bg-green-700">
              {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Send reply
            </Button>
          )}

          {status === "draft" && (
            <Button size="sm" variant="outline" disabled={saving} onClick={() => void handleReject()} className="gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10">
              <ThumbsDown className="size-3.5" /> Reject
            </Button>
          )}
        </div>

        {regenOpen && (
          <div className="rounded-md border border-border bg-secondary/30 p-3 space-y-2">
            <p className="eyebrow">Regenerate instructions</p>
            <Input
              value={regenQuery}
              onChange={(e) => setRegenQuery(e.target.value)}
              placeholder={aiUsed ? "Optional instruction, e.g. Make it shorter…" : "Optional instruction, e.g. Focus on pricing…"}
              className="text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") void handleRegenerate(); }}
            />
            <Button size="sm" disabled={regenerating} onClick={() => void handleRegenerate()} className="gap-1.5">
              {regenerating ? <Loader2 className="size-3.5 animate-spin" /> : (aiUsed ? <RotateCcw className="size-3.5" /> : <Sparkles className="size-3.5" />)}
              {aiUsed ? "Regenerate" : "Generate with AI"}
            </Button>
          </div>
        )}

        {status === "failed" && error && (
          <p className="font-mono text-xs text-red-400 mt-1">Error: {error}</p>
        )}
      </div>
    </div>
  );
}
