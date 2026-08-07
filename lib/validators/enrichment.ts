import { z } from "zod";
import { dbId } from "./id";

export const ScrapeSchema = z.union([
  z.object({ all_pending: z.literal(true), limit: z.number().int().min(1).max(200).default(25) }),
  z.object({ organization_ids: z.array(dbId).min(1).max(200) }),
  z.object({ campaign_id: dbId, limit: z.number().int().min(1).max(200).default(25) }),
]);
