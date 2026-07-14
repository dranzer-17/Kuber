import { z } from "zod";

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
  organization_domain: z.string().optional(),
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
  max_pages: z.number().int().min(1).max(20).default(5),
  titles: z.array(z.string()).nullable().optional(),
  seniorities: z.array(z.string()).nullable().optional(),
  batch_name: z.string().min(1),
  color: z.string().default("violet"),
  preview: z.boolean().optional(),
  assigned_to: z.string().uuid().nullable().optional(),
  assignment_strategy: ImportAssignmentStrategy,
});

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
