import { z } from "zod";

export const PatchSettingsSchema = z.object({
  default_sender_name: z.string().optional(),
  system_prompt: z.string().optional(),
  client_industry: z.string().optional(),
  client_products: z.string().optional(),
  client_target_markets: z.string().optional(),
  email_signature: z.string().optional(),
  signature_name:    z.string().max(200).optional(),
  signature_title:   z.string().max(200).optional(),
  signature_contact: z.string().max(500).optional(),
  signature_company: z.string().max(200).optional(),
});

export const SETTINGS_KEYS = [
  "default_sender_name",
  "system_prompt",
  "client_industry",
  "client_products",
  "client_target_markets",
  "email_signature",
  "signature_name",
  "signature_title",
  "signature_contact",
  "signature_company",
] as const;
