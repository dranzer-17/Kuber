import { z } from "zod";

const THEME_IDS = ["monochrome", "blue", "green", "purple", "orange", "rose"] as const;
const THEME_MODES = ["dark", "light"] as const;

export const PatchSettingsSchema = z.object({
  default_sender_name:   z.string().optional(),
  system_prompt:         z.string().optional(),
  client_industry:       z.string().optional(),
  client_products:       z.string().optional(),
  client_target_markets: z.string().optional(),
  email_signature:       z.string().optional(),
  brand_logo_path:       z.string().optional(),
  signature_name:        z.string().max(200).optional(),
  signature_title:       z.string().max(200).optional(),
  signature_contact:     z.string().max(500).optional(),
  signature_company:     z.string().max(200).optional(),
  theme:                 z.enum(THEME_IDS).optional(),
  theme_mode:            z.enum(THEME_MODES).optional(),
  email_subject_template:  z.string().max(300).optional(), // supports {product} and {company}
  product_offerings:       z.string().optional(), // JSON: [{name, description}]
  reply_classifier_prompt: z.string().optional(),
  reply_drafter_prompt:    z.string().optional(),
  draft_template_config:   z.string().optional(), // JSON: DraftTemplateConfig (see lib/services/settings.ts)
});

export const SETTINGS_KEYS = [
  "default_sender_name",
  "system_prompt",
  "client_industry",
  "client_products",
  "client_target_markets",
  "email_signature",
  "brand_logo_path",
  "signature_name",
  "signature_title",
  "signature_contact",
  "signature_company",
  "theme",
  "theme_mode",
  "email_subject_template",
  "product_offerings",
  "reply_classifier_prompt",
  "reply_drafter_prompt",
  "draft_template_config",
] as const;
