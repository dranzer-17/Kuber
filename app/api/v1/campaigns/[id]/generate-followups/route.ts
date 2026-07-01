import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { ok, fail } from "@/lib/api-response";
import { internalAppBaseUrl } from "@/lib/internal-url";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try { await requireAuth(req); } catch (r) { return r as Response; }
  const { id } = await params;
  const { step_number } = await req.json().catch(() => ({ step_number: 2 }));

  if (!process.env.INTERNAL_SECRET) return fail(500, "INTERNAL", "INTERNAL_SECRET not set");

  const baseUrl = internalAppBaseUrl(req);
  const res = await fetch(`${baseUrl}/api/enrich/generate-drafts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": process.env.INTERNAL_SECRET,
    },
    body: JSON.stringify({ campaign_id: id, step_number }),
  });

  if (!res.ok) {
    const err = await res.text();
    return fail(502, "INTERNAL", err);
  }

  return ok(await res.json());
}
