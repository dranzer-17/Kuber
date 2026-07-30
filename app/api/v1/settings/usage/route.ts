import { NextRequest } from "next/server";
import { requireManager } from "@/lib/auth/api-auth";
import { ok } from "@/lib/api-response";
import {
  checkApolloCredits, checkFirecrawlCredits, checkOpenRouterCredits, checkInstantlyCredits,
  type CreditCheck,
} from "@/lib/services/provider-credits";
import { dbForUser } from "@/lib/supabase/scoped";

type UsageStatus = "ok" | "low" | "out" | "unknown";

function statusFor(check: CreditCheck): UsageStatus {
  if (check.remaining == null) return check.ok ? "ok" : "low";
  if (check.remaining <= 0) return "out";
  return check.ok ? "ok" : "low";
}

const PROVIDERS: Array<{ id: string; label: string; check: (db: ReturnType<typeof dbForUser>) => Promise<CreditCheck> }> = [
  { id: "apollo", label: "Apollo", check: checkApolloCredits },
  { id: "firecrawl", label: "Firecrawl", check: checkFirecrawlCredits },
  { id: "openrouter", label: "OpenRouter", check: checkOpenRouterCredits },
  { id: "instantly", label: "Instantly", check: checkInstantlyCredits },
];

// Every manager can see whether a provider is running low; only super admins
// get the exact remaining number — trimmed here, server-side, rather than
// trusting the client to hide a number it already received.
export async function GET(req: NextRequest) {
  let user: Awaited<ReturnType<typeof requireManager>>;
  try { user = await requireManager(req); } catch (r) { return r as Response; }

  const db = dbForUser(user);
  const checks = await Promise.all(PROVIDERS.map((p) => p.check(db)));

  const providers = PROVIDERS.map((p, i) => {
    const check = checks[i];
    return {
      id: p.id,
      label: p.label,
      status: statusFor(check),
      remaining: user.isSuperAdmin ? check.remaining : null,
      message: check.message,
    };
  });

  return ok({ providers });
}
