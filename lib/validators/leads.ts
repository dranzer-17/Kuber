import { z } from "zod";
import { domainField } from "@/lib/validators/organizations";

export const CreateLeadSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email(),
  title: z.string().optional(),
  headline: z.string().optional(),
  linkedin_url: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  organization_name: z.string().min(1),
  organization_domain: domainField.optional(),
  organization_industry: z.string().optional(),
  organization_country: z.string().optional(),
  batch_name: z.string().optional(),
  color: z.string().optional(),
  import_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
});

export const PatchLeadSchema = z.object({
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  headline: z.string().optional(),
  linkedin_url: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  email_status: z.string().optional(),
  status: z.enum(["new", "enriching", "enriched", "input_required", "open", "closed"]).optional(),
  // Single-lead reassignment (manager-only, enforced in the route) — the
  // previous only way to move one lead was bulk-assign or a campaign-assign
  // side effect (review §3.2). null = return to the pool.
  assigned_to: z.string().uuid().nullable().optional(),
});

export const LeadListQuerySchema = z.object({
  country: z.string().optional(),
  email_status: z.string().optional(),
  lead_source: z.enum(["apollo", "excel", "manual"]).optional(),
  organization_id: z.string().uuid().optional(),
  email_domain_catchall: z.enum(["true", "false"]).optional(),
  import_id: z.string().uuid().optional(),
  created_after: z.string().datetime().optional(),
  assigned_to: z.string().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(2000).default(50),
});

// Imports can distribute leads as they land (planning.md Phase 4 / Q5):
// `assigned_to` = manual target (legacy, still supported); `assignment_strategy`
// = spread the batch round-robin or by territory instead.
const ImportAssignmentStrategy = z.enum(["round_robin", "territory"]).optional();

export const ApolloSearchSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1),
  locations: z.array(z.string()).default([]),
  // No max_pages: search depth is derived from the caps below, not chosen.
  // Apollo's search endpoint spends no lead credits, so a page budget could
  // only ever stop an import short of the cap the manager asked for — see
  // apollo-search/route.ts.
  titles: z.array(z.string()).nullable().optional(),
  seniorities: z.array(z.string()).nullable().optional(),
  batch_name: z.string().min(1),
  color: z.string().default("violet"),
  preview: z.boolean().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  assignment_strategy: ImportAssignmentStrategy,
  // Every lead inserted here eventually gets a paid Apollo bulk_match call —
  // these are the actual credit-spend ceilings for the import, enforced
  // server-side in apollo-search/route.ts regardless of what the client sends.
  max_total_leads: z.number().int().min(25).max(1000).default(200),
  max_leads_per_keyword: z.union([z.literal(25), z.literal(50)]).default(50),
  // Strict mode trades range for safety: only the tightest tiers are allowed.
  strict_cap: z.boolean().default(false),
}).refine(
  (data) => !data.strict_cap || [25, 50, 100].includes(data.max_total_leads),
  { message: "Strict mode only allows 25, 50, or 100 total leads", path: ["max_total_leads"] },
);

export const ExcelImportSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("headers"), storage_path: z.string().min(1) }),
  z.object({
    mode: z.literal("import"),
    storage_path: z.string().min(1),
    mapping: z.record(z.string(), z.string()),
    batch_name: z.string().min(1),
    color: z.string().default("violet"),
    assigned_to: z.string().uuid().nullable().optional(),
    assignment_strategy: ImportAssignmentStrategy,
  }),
  z.object({
    mode: z.literal("direct"),
    rows: z.array(z.record(z.string(), z.unknown())),
    mapping: z.record(z.string(), z.string()),
    batch_name: z.string().min(1),
    color: z.string().default("violet"),
    assigned_to: z.string().uuid().nullable().optional(),
    assignment_strategy: ImportAssignmentStrategy,
  }),
]);

export const EnrichSchema = z.union([
  z.object({
    campaign_id: z.string().uuid(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  z.object({
    lead_ids: z.array(z.string().uuid()).min(1).max(200),
  }),
  z.object({
    import_id: z.string().uuid(),
  }),
]);
