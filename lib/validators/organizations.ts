import { z } from "zod";

// A domain never contains "@" — this rejects the classic spreadsheet/form
// column-misalignment mistake (an email typed into a domain field) at the
// API boundary instead of letting it reach normalizeDomain() to silently
// discard, so the caller gets a clear 400 instead of a quietly-nulled field.
export const domainField = z.string().refine((v) => !v.includes("@"), {
  message: "Domain must not contain \"@\" — this looks like an email address, not a domain",
});

export const CreateOrgSchema = z.object({
  name: z.string().min(1),
  domain: domainField.optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  employees: z.number().int().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
});

export const PatchOrgSchema = z.object({
  name: z.string().min(1).optional(),
  domain: domainField.optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  employees: z.number().int().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
  description: z.string().optional(),
  primary_products: z.array(z.string()).optional(),
  unsubscribed: z.boolean().optional(),
});

export const OrgListQuerySchema = z.object({
  search: z.string().optional(),
  industry: z.string().optional(),
  has_scraped: z.enum(["true", "false"]).optional(),
  unsubscribed: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
