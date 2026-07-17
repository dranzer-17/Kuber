import { z } from "zod";

export const CreateProviderKeySchema = z.object({
  provider: z.string().min(1),
  label: z.string().min(1),
  secret: z.string().min(1),
});

export const PatchProviderKeySchema = z.object({
  label: z.string().min(1).optional(),
  priority: z.number().int().optional(),
  is_active: z.boolean().optional(),
  status: z.enum(["healthy", "cooling_off", "dead"]).optional(),
});

export const ReorderProviderKeysSchema = z.object({
  provider: z.string().min(1),
  orderedIds: z.array(z.string().uuid()).min(1),
});

export const SetProviderModelSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).nullable(),
});

export const SetLlmTierRolesSchema = z.object({
  primary: z.string().min(1).nullable(),
  fallback: z.string().min(1).nullable(),
});
