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

export async function POST(req: NextRequest) {
  let _user: { id: string };
  try { _user = await requireAuth(req); } catch (r) { return r as Response; }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return fail(400, "VALIDATION_ERROR", "No file provided");
  if (!ALLOWED.has(file.type)) return fail(400, "VALIDATION_ERROR", `Unsupported file type: ${file.type}`);
  if (file.size > MAX_BYTES) return fail(400, "VALIDATION_ERROR", "File exceeds 10MB limit");

  const db = createAdminClient();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `uploads/${crypto.randomUUID()}/${safeName}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await db.storage
    .from("campaign-attachments")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) return fail(500, "INTERNAL", upErr.message);

  // Signed URL valid 1 year — the link is embedded in sent emails (Instantly has
  // no attachment API), so recipients must be able to open it long after send.
  const { data: signed } = await db.storage
    .from("campaign-attachments")
    .createSignedUrl(path, 60 * 60 * 24 * 365);

  return ok({
    attachment_path: path,
    attachment_name: file.name,
    attachment_mime: file.type,
    attachment_size: file.size,
    attachment_url: signed?.signedUrl ?? null,
  });
}
