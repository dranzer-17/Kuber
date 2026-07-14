import { z } from "zod";

const TerritorySchema = z.enum(["india", "foreign"]);

// Territory is REQUIRED for employees at creation (planning.md Phase 4 / Q8) —
// otherwise territory-based routing silently skips them. Managers have none.
export const CreateUserSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    full_name: z.string().min(1).max(200),
    role: z.enum(["manager", "employee"]),
    territory: TerritorySchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "employee" && !data.territory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["territory"],
        message: "Territory is required for employees (india / foreign)",
      });
    }
  });

export const PatchUserSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  role: z.enum(["manager", "employee"]).optional(),
  territory: TerritorySchema.nullable().optional(),
  is_active: z.boolean().optional(),
  // Online/offline availability (spec §2B) — separate from is_active.
  availability_status: z.enum(["online", "offline"]).optional(),
  password: z.string().min(8).optional(),
  // Required when deactivating someone who still holds leads/campaigns —
  // the manager must explicitly pick who inherits that work.
  reassign_to: z.string().uuid().optional(),
});

// Self-service availability toggle (spec §2B) — an employee marking themselves
// available/unavailable. Own profile only; enforced in the /me/availability route.
export const PatchMyAvailabilitySchema = z.object({
  availability_status: z.enum(["online", "offline"]),
});
