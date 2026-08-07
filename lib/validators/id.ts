import { z } from "zod";

/**
 * A database identifier: any 8-4-4-4-12 hex string, which is exactly what the
 * Postgres `uuid` type stores and compares.
 *
 * NOT z.string().uuid(). zod 4 enforces the RFC 9562 version and variant
 * nibbles, and a Postgres uuid column does not — it accepts any 128-bit value.
 * The internal workspace migration derived its ids by hashing rather than
 * calling gen_random_uuid(), so 411 leads and 288 organizations in the client
 * workspace hold ids like 64f677eb-2b45-449d-4de8-bfa2ae118476: unique, valid,
 * stored and joined without complaint by Postgres, and rejected as "Invalid
 * UUID" by every route that validated them.
 *
 * That turned a whole batch of the client's leads into rows they could see and
 * select but not act on — adding them to a campaign, bulk assigning, bulk
 * deleting and generating drafts all returned 400 VALIDATION_ERROR.
 *
 * Validate the shape the database actually uses, not the shape the RFC prefers.
 */
export const dbId = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Invalid id");
