import { z } from "zod";

const TerritorySchema = z.enum(["india", "europe", "foreign"]);

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
        message: "Territory is required for employees (india / europe / foreign)",
      });
    }
  });

export const PatchUserSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  role: z.enum(["manager", "employee"]).optional(),
  territory: TerritorySchema.nullable().optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8).optional(),
});
