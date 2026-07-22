import { z } from "zod";

// Territory is a list of countries the employee receives leads for — the
// output of the same region/country picker the Apollo import uses. Names are
// canonicalised server-side (lib/territory.ts), so the picker's "UAE" and a
// stored "United Arab Emirates" are the same thing.
const TerritoryCountriesSchema = z.array(z.string().min(1)).max(300);

// Still REQUIRED for employees at creation (planning.md Phase 4 / Q8) —
// an employee covering nowhere is silently skipped by territory routing.
// Managers have none.
export const CreateUserSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    full_name: z.string().min(1).max(200),
    role: z.enum(["manager", "employee"]),
    territory_countries: TerritoryCountriesSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "employee" && !data.territory_countries?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["territory_countries"],
        message: "Pick at least one country — employees need a territory for lead routing",
      });
    }
  });

export const PatchUserSchema = z.object({
  full_name: z.string().min(1).max(200).optional(),
  role: z.enum(["manager", "employee"]).optional(),
  territory_countries: TerritoryCountriesSchema.optional(),
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
