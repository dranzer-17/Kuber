import { z } from "zod";

export const CreateCampaignSchema = z.object({
  name: z.string().min(1),
  human_in_loop: z.boolean().default(true),
  send_mode: z.enum(["now", "scheduled"]).default("now"),
  schedule_start_at: z.string().datetime().optional(),
  window_from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  window_to: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  send_days: z.record(z.string(), z.boolean()).optional(),
  schedule_timezone: z.string().optional(),
  daily_limit: z.number().int().min(1).max(500).default(30),
  ai_prompt_context: z.string().optional(),
  sender_name: z.string().optional(),
  follow_up_pattern: z
    .array(z.object({ step: z.number().int(), delay: z.number().int().min(0) }))
    .optional(),
});

export const PatchCampaignSchema = z.object({
  name: z.string().min(1).optional(),
  human_in_loop: z.boolean().optional(),
  send_mode: z.enum(["now", "scheduled"]).optional(),
  schedule_start_at: z.string().datetime().optional(),
  window_from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  window_to: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  send_days: z.record(z.string(), z.boolean()).optional(),
  schedule_timezone: z.string().optional(),
  daily_limit: z.number().int().min(1).max(500).optional(),
  follow_up_pattern: z
    .array(z.object({ step: z.number().int(), delay: z.number().int().min(0) }))
    .optional(),
});

export const AddLeadsToCampaignSchema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1),
});

export const CampaignLeadsQuerySchema = z.object({
  crm_status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
