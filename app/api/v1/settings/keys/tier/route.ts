import { NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { SetLlmTierRolesSchema } from "@/lib/validators/provider-keys";
import { DEFAULT_LLM_TIER_ORDER } from "@/lib/services/providers/registry";

// Sets which LLM provider complete() tries first ("Primary") and second
// ("Fallback") — everything else configured still gets tried afterward, in
// DEFAULT_LLM_TIER_ORDER's relative order (see resolveLlmTierOrder()). This
// only reorders the front of the list, it never drops a provider.
export async function PUT(req: NextRequest) {
  let caller: Awaited<ReturnType<typeof requireSuperAdmin>>;
  try { caller = await requireSuperAdmin(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = SetLlmTierRolesSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());
  const { primary, fallback } = parsed.data;

  if (primary && !DEFAULT_LLM_TIER_ORDER.includes(primary as (typeof DEFAULT_LLM_TIER_ORDER)[number])) {
    return fail(400, "INVALID_PROVIDER", `Unknown LLM provider "${primary}"`);
  }
  if (fallback && !DEFAULT_LLM_TIER_ORDER.includes(fallback as (typeof DEFAULT_LLM_TIER_ORDER)[number])) {
    return fail(400, "INVALID_PROVIDER", `Unknown LLM provider "${fallback}"`);
  }
  if (primary && fallback && primary === fallback) {
    return fail(400, "VALIDATION_ERROR", "Primary and fallback must be different providers");
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("llm_tier_config")
    .upsert(
      { id: true, primary_provider: primary, fallback_provider: fallback, updated_by: caller.id, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    )
    .select("primary_provider, fallback_provider")
    .single();

  if (error) return fail(500, "INTERNAL", error.message);
  return ok({ primary: data.primary_provider, fallback: data.fallback_provider });
}
