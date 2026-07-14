import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";
import { getUniboxScope } from "@/lib/auth/scope";
import { getUnreadCount } from "@/lib/services/unibox";

export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireAuth>>;
  try { user = await requireAuth(req); } catch (r) { return r as Response; }
  const db = createAdminClient();
  const scope = (await getUniboxScope(db, user)) ?? undefined;
  const count = await getUnreadCount(db, scope);
  return ok({ unread: count });
}
