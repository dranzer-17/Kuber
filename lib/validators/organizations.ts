import { z } from "zod";

export const CreateOrgSchema = z.object({
  name: z.string().min(1),
  domain: z.string().optional(),
  website: z.string().optional(),
  industry: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  employees: z.number().int().optional(),
  city: z.string().optional(),
  country: z.string().optional(),
});

export const PatchOrgSchema = z.object({
  name: z.string().min(1).optional(),
  domain: z.string().optional(),
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
