import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";

export async function GET(_req: NextRequest) {
  const db = createAdminClient();

  let dbStatus = "ok";
  try {
    const { error } = await db.from("organizations").select("id").limit(1);
    if (error) dbStatus = error.message;
  } catch (e) {
    dbStatus = String(e);
  }

  const env = {
    apollo: !!process.env.APOLLO_API_KEY,
    firecrawl: !!process.env.FIRECRAWL_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    supabase_service_role: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    supabase_jwt_secret: !!process.env.SUPABASE_JWT_SECRET,
  };

  if (dbStatus !== "ok") {
    return fail(503, "DB_ERROR", dbStatus);
  }

  return ok({ status: "ok", db: dbStatus, env });
}
