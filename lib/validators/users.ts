import { z } from "zod";

export const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  full_name: z.string().min(1).max(200),
  role: z.enum(["manager", "employee"]),
  territory: z.enum(["india", "foreign"]).nullable().optional(),
});

export const PatchUserSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  role: z.enum(["manager", "employee"]).optional(),
  territory: z.enum(["india", "foreign"]).nullable().optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});

export const PatchAssignmentSettingsSchema = z.object({
  strategy: z.enum(["round_robin", "territory", "manual"]),
});
