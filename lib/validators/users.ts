import { z } from "zod";
import { dbId } from "./id";

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

// Where a departing employee's leads and campaigns go when the account is
// deactivated. "manual" names one successor; "pool" hands everything back to
// the manager pool (the only option that works when nobody else is available);
// "round_robin" and "territory" reuse the same engines as normal assignment.
export const HandoverStrategySchema = z.enum(["manual", "pool", "round_robin", "territory"]);

export const PatchUserSchema = z
  .object({
    full_name: z.string().min(1).max(200).optional(),
    role: z.enum(["manager", "employee"]).optional(),
    territory_countries: TerritoryCountriesSchema.optional(),
    is_active: z.boolean().optional(),
    // Online/offline availability (spec §2B) — separate from is_active.
    availability_status: z.enum(["online", "offline"]).optional(),
    // The Instantly mailbox this person's leads are mailed from. null clears it,
    // which falls the user back to the company default sender. Checked against
    // the connected Instantly accounts in the route — a mailbox that isn't
    // connected would silently fail at send time instead.
    sending_email: z.string().trim().email().nullable().optional(),
    password: z.string().min(8).optional(),
    // How the held work is redistributed on deactivation. Omitting it while the
    // user still holds leads/campaigns is what triggers REASSIGN_REQUIRED.
    handover_strategy: HandoverStrategySchema.optional(),
    // The successor, for the "manual" strategy. A bare reassign_to with no
    // strategy still means "manual" — that was the only option this endpoint
    // had before handover_strategy existed.
    reassign_to: dbId.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.handover_strategy === "manual" && !data.reassign_to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reassign_to"],
        message: "Pick the employee who takes this work over",
      });
    }
  });

// Self-service availability toggle (spec §2B) — an employee marking themselves
// available/unavailable. Own profile only; enforced in the /me/availability route.
export const PatchMyAvailabilitySchema = z.object({
  availability_status: z.enum(["online", "offline"]),
});
