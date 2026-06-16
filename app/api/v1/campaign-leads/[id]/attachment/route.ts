import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export const maxDuration = 30;

const ALLOWED = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png", "image/jpeg",
]);
const MAX_BYTES = 10 * 1024 * 1024;

/** POST = set/replace the per-lead attachment override */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return fail(400, "NO_FILE", "No file provided");
  if (!ALLOWED.has(file.type)) return fail(400, "BAD_TYPE", `Unsupported type: ${file.type}`);
  if (file.size > MAX_BYTES) return fail(400, "TOO_LARGE", "File exceeds 10MB");

  const db = createAdminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `campaign-leads/${id}/${crypto.randomUUID()}-${safeName}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await db.storage
    .from("campaign-attachments")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) return fail(500, "UPLOAD_FAILED", upErr.message);

  const { data: signed } = await db.storage
    .from("campaign-attachments")
    .createSignedUrl(path, 60 * 60 * 24 * 7);

  const { error: updErr } = await db.from("campaign_leads").update({
    attachment_path: path,
    attachment_name: file.name,
    attachment_mime: file.type,
    attachment_size: file.size,
    attachment_url: signed?.signedUrl ?? null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (updErr) return fail(500, "INTERNAL", updErr.message);

  return ok({
    attachment_name: file.name,
    attachment_size: file.size,
    attachment_mime: file.type,
    attachment_url: signed?.signedUrl ?? null,
  });
}

/** DELETE = clear the per-lead override → fall back to the campaign default */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;
  const db = createAdminClient();

  // best-effort remove the stored object
  const { data: row } = await db.from("campaign_leads")
    .select("attachment_path").eq("id", id).maybeSingle();
  if (row?.attachment_path) {
    await db.storage.from("campaign-attachments").remove([row.attachment_path]).catch(() => {});
  }

  const { error } = await db.from("campaign_leads").update({
    attachment_path: null, attachment_name: null, attachment_mime: null,
    attachment_size: null, attachment_url: null, updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) return fail(500, "INTERNAL", error.message);

  return ok({ cleared: true });
}
