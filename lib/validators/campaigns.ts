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
  followup_days: z.array(z.number().int().min(1).max(365)).optional(),

  // Campaign attachment fields (set by upload endpoint)
  attachment_path: z.string().optional(),
  attachment_name: z.string().optional(),
  attachment_mime: z.string().optional(),
  attachment_size: z.number().int().optional(),
  attachment_url:  z.string().optional().nullable(),
  // Per-admin signature
  signature_user_id: z.string().uuid().optional(),
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

});

export const AddLeadsToCampaignSchema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1),
});

export const CampaignLeadsQuerySchema = z.object({
  crm_status: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const PatchCampaignLeadSchema = z.object({
  campaign_lead_id: z.string().uuid(),
  crm_status: z.enum([
    "new", "enriched", "draft", "approved", "sent", "replied", "won", "closed", "failed", "skipped",
  ]),
});

export const CampaignStepInput = z.object({
  step_order: z.number().int().min(1),
  delay: z.number().int().min(0),
  delay_unit: z.enum(["minutes", "hours", "days"]).default("days"),
  subject: z.string().default(""),
  body: z.string().default(""),
});

export const CampaignStepsSchema = z.object({
  steps: z.array(CampaignStepInput).min(1).max(10),
});
