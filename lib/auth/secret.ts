import { timingSafeEqual } from "crypto";

/**
 * Constant-time comparison of a provided secret against the expected value.
 * Returns false if either side is missing or the lengths differ. Avoids the
 * timing side-channel of a plain `===`/`!==` string compare on shared secrets.
 */
export function safeSecretEqual(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
