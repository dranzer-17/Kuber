import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Company-scoped service-role client.
 *
 * The app has ~500 `.from(...)` call sites. Requiring every one of them to
 * remember `.eq("company_id", ...)` would make a cross-tenant leak the default
 * failure mode — one forgotten filter and Company B sees Company A's leads.
 * This wrapper inverts that: every read is filtered and every write is stamped
 * automatically, so a route has to go *out of its way* (by using
 * `createAdminClient()` directly) to cross a tenant boundary.
 *
 * Deliberately returns `SupabaseClient` so it is a drop-in replacement for
 * `createAdminClient()` — call sites need no other change.
 *
 * Cross-company work (cron, watchdogs, the enrichment relay) keeps using
 * `createAdminClient()` and carries company_id explicitly from the row it is
 * processing. That opt-out is intentional and should stay rare and obvious.
 */

/**
 * Tables with no company_id column of their own. The proxy must pass these
 * through untouched — adding `.eq("company_id", ...)` to a table that has no
 * such column errors at the database.
 *
 * `system_state` holds cross-tenant process state (the shared Instantly sync
 * cursor, cached provider-credit readings) and is reached from BOTH scoped
 * callers (service-health) and unscoped ones (the enrichment relay, the unibox
 * cron), so it has to be exempt here rather than only avoided by convention.
 */
const GLOBAL_TABLES = new Set(["companies", "system_state"]);

/**
 * Tables whose upsert conflict target is already globally unique — an id minted
 * by Instantly, or a user id. Prefixing company_id onto these would defeat the
 * dedupe and let the same inbound Instantly email land twice.
 */
const GLOBAL_CONFLICT_TABLES = new Set([
  "reply_events", // event_uid — Instantly's event id
  "unibox_emails", // instantly_email_id
  "instantly_campaigns", // instantly_campaign_id
  "user_settings", // user_id is the PK
  "user_signatures", // user_id is the PK
]);

type Row = Record<string, unknown>;
type UpsertOptions = { onConflict?: string } & Record<string, unknown>;

function stamp<T>(rows: T, companyId: string): T {
  if (Array.isArray(rows)) {
    return rows.map((r) => ({ ...(r as Row), company_id: companyId })) as T;
  }
  return { ...(rows as Row), company_id: companyId } as T;
}

function scopeConflict(table: string, options: UpsertOptions | undefined, _companyId: string) {
  if (!options?.onConflict || GLOBAL_CONFLICT_TABLES.has(table)) return options;
  const parts = options.onConflict.split(",").map((s) => s.trim());
  if (parts.includes("company_id")) return options;
  return { ...options, onConflict: ["company_id", ...parts].join(",") };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function scopeBuilder(builder: any, table: string, companyId: string) {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;

      switch (prop) {
        // Reads and mutations gain the tenant filter. The builder these return
        // is the raw one, so any further .eq()/.in()/.order() from the call
        // site simply ANDs onto it.
        case "select":
        case "update":
        case "delete":
          return (...args: any[]) => value.apply(target, args).eq("company_id", companyId);

        // Writes are stamped. Note the builder returned here is raw, so a
        // trailing `.select()` on an insert is NOT filtered — which is correct,
        // it is reading back the rows just written.
        case "insert":
          return (rows: any, ...rest: any[]) => value.call(target, stamp(rows, companyId), ...rest);

        case "upsert":
          return (rows: any, options?: UpsertOptions, ...rest: any[]) =>
            value.call(target, stamp(rows, companyId), scopeConflict(table, options, companyId), ...rest);

        default:
          return value.bind(target);
      }
    },
  });
}

/**
 * The client a route handler should use after requireAuth/requireManager.
 *
 * Falls back to the unscoped admin client only for the service-role bearer
 * (companyId null), which is the internal server-to-server identity — those
 * callers are already full-trust and operate across companies by design.
 */
export function dbForUser(user: { companyId: string | null }): SupabaseClient {
  return user.companyId ? createScopedClient(user.companyId) : createAdminClient();
}

export function createScopedClient(companyId: string): SupabaseClient {
  if (!companyId) {
    throw new Error("createScopedClient requires a companyId — use createAdminClient() for cross-company work");
  }
  const db = createAdminClient();

  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop !== "from") return Reflect.get(target, prop, receiver);
      return (table: string) => {
        const builder = (target as any).from(table);
        return GLOBAL_TABLES.has(table) ? builder : scopeBuilder(builder, table, companyId);
      };
    },
  }) as SupabaseClient;
}
