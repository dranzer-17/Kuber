// Guards lib/validators/id.ts.
// Run: node --experimental-strip-types scripts/check-db-id.mjs
//
// The ids in the first group are real rows from the client workspace, written
// by the internal workspace migration. Postgres stores and joins them fine;
// zod's .uuid() rejects them because their version/variant nibbles are not
// RFC 9562 compliant. If this file starts failing, something swapped dbId back
// to a strict UUID check and a batch of the client's leads just became
// unusable again.
import assert from "node:assert/strict";
import { dbId } from "../lib/validators/id.ts";

const mustPass = [
  "64f677eb-2b45-449d-4de8-bfa2ae118476", // migrated lead, variant nibble '4'
  "f4fbc084-f115-4723-f9dc-a21e831b9767", // migrated lead, variant nibble 'f'
  "6cb4e36c-8d23-86c2-6fc1-55bc0f9b6444", // migrated lead, version nibble '8'
  "26191753-286b-a814-1635-ecd8304969c2", // the migration's own import id
  "da9b678f-3d43-49cd-8446-6494965f3703", // ordinary gen_random_uuid() v4
  "00000000-0000-0000-0000-00000000000b", // the Kuber company id
  "F4FBC084-F115-4723-F9DC-A21E831B9767", // uppercase
];

const mustFail = [
  "",
  "not-a-uuid",
  "64f677eb2b45449d4de8bfa2ae118476",              // unhyphenated
  "64f677eb-2b45-449d-4de8-bfa2ae11847",           // too short
  "64f677eb-2b45-449d-4de8-bfa2ae1184767",         // too long
  "64f677eb-2b45-449d-4de8-bfa2ae11847g",          // non-hex
  "64f677eb-2b45-449d-4de8-bfa2ae118476 OR 1=1",   // trailing junk
  " 64f677eb-2b45-449d-4de8-bfa2ae118476",         // leading space
];

for (const id of mustPass) {
  assert.equal(dbId.safeParse(id).success, true, `should accept ${JSON.stringify(id)}`);
}
for (const id of mustFail) {
  assert.equal(dbId.safeParse(id).success, false, `should reject ${JSON.stringify(id)}`);
}

console.log(`ok — ${mustPass.length} accepted, ${mustFail.length} rejected`);
