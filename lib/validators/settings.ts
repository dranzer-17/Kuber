import { z } from "zod";

const THEME_IDS = ["monochrome", "blue", "green", "purple", "orange", "rose"] as const;
const THEME_MODES = ["dark", "light"] as const;

export const PatchSettingsSchema = z.object({
  default_sender_name: z.string().optional(),
  system_prompt: z.string().optional(),
  client_industry: z.string().optional(),
  client_products: z.string().optional(),
  client_target_markets: z.string().optional(),
  email_signature: z.string().optional(),
  brand_logo_path: z.string().optional(),
  signature_name:    z.string().max(200).optional(),
  signature_title:   z.string().max(200).optional(),
  signature_contact: z.string().max(500).optional(),
  signature_company: z.string().max(200).optional(),
  theme: z.enum(THEME_IDS).optional(),
  theme_mode: z.enum(THEME_MODES).optional(),
  // Cold outreach template (fixed body the AI personalizes around)
  email_template_intro: z.string().optional(),
  email_template_offerings: z.string().optional(),
  email_template_closing_with_attachment: z.string().optional(),
  email_template_closing_no_attachment: z.string().optional(),
  // Per-product addenda + AI fit hints, one pair per masterbatch type
  product_black_section: z.string().optional(),
  product_black_hint: z.string().optional(),
  product_white_section: z.string().optional(),
  product_white_hint: z.string().optional(),
  product_color_section: z.string().optional(),
  product_color_hint: z.string().optional(),
  product_additive_section: z.string().optional(),
  product_additive_hint: z.string().optional(),
  // Reply handling prompts
  reply_classifier_prompt: z.string().optional(),
  reply_drafter_prompt: z.string().optional(),
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
  "email_template_intro",
  "email_template_offerings",
  "email_template_closing_with_attachment",
  "email_template_closing_no_attachment",
  "product_black_section",
  "product_black_hint",
  "product_white_section",
  "product_white_hint",
  "product_color_section",
  "product_color_hint",
  "product_additive_section",
  "product_additive_hint",
  "reply_classifier_prompt",
  "reply_drafter_prompt",
] as const;
