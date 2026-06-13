import { z } from "zod";

export const GenerateDraftsSchema = z.object({
  campaign_id: z.string().uuid(),
  lead_ids: z.array(z.string().uuid()).optional(),
  limit: z.number().int().min(1).max(200).default(25),
});

export const DraftsQuerySchema = z.object({
  campaign_id: z.string().uuid().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const PatchDraftSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), rejection_reason: z.string().min(1) }),
  z.object({ action: z.literal("edit"), subject: z.string().min(1), body: z.string().min(1) }),
]);
