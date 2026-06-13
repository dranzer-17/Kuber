import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api-response";
import { complete } from "@/lib/services/llm";
import { KUBER_CONTEXT } from "@/lib/constants";
import { z } from "zod";

export const maxDuration = 55;

const Schema = z.object({
  lead_ids: z.array(z.string().uuid()).min(1).max(100),
  campaign_name: z.string().min(1),
  custom_instruction: z.string().optional(),
  // optional: regenerate a single lead
  single_lead_id: z.string().uuid().optional(),
});

const SYSTEM = (campaign_name: string, custom_instruction?: string) => `You are a B2B cold email specialist writing on behalf of Kuber Polyplast.

${KUBER_CONTEXT}

Campaign context: "${campaign_name}"

Your task: Write a concise, highly personalized cold outreach email for a specific B2B prospect. Rules:
- Open with a specific, relevant observation about their company or industry (never generic "I came across your company")
- Tie Kuber Polyplast's capabilities directly to what THEIR business likely needs (based on their description and end markets)
- 3–4 short paragraphs. Conversational, not corporate.
- End with one simple low-friction CTA: "Would you be open to a 15-minute call?" or similar
- Subject: specific, intriguing, ≤ 60 chars. No clickbait.
- Do NOT mention Kuber Polyplast's full name every sentence — use "we" after first mention.
- Do NOT use placeholder brackets like [Company Name] — use the actual details provided.
${custom_instruction ? `\nAdditional instruction from user: ${custom_instruction}` : ""}

Return ONLY valid JSON with no markdown or preamble:
{ "subject": "...", "body": "..." }
The body uses plain text with \\n between paragraphs.`;

export async function POST(req: NextRequest) {
  try { await requireAuth(req); } catch (r) { return r as Response; }

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "Invalid body", parsed.error.flatten());

  const { lead_ids, campaign_name, custom_instruction, single_lead_id } = parsed.data;

  const idsToGenerate = single_lead_id ? [single_lead_id] : lead_ids;

  const db = createAdminClient();
  const { data: leads, error } = await db
    .from("leads")
    .select(`
      id, first_name, last_name, email, title, headline, country,
      organizations ( name, domain, company_description, sells_to, description )
    `)
    .in("id", idsToGenerate);

  if (error) return fail(500, "INTERNAL", error.message);

  const system = SYSTEM(campaign_name, custom_instruction);

  type OrgData = { name?: string; domain?: string; company_description?: string; sells_to?: string; description?: string };
  type LeadRow = { id: string; first_name: string | null; last_name: string | null; email: string | null; title: string | null; headline: string | null; country: string | null; organizations: OrgData | OrgData[] | null };

  async function generateOne(lead: LeadRow): Promise<{ lead_id: string; subject: string; body: string }> {
    const rawOrg = lead.organizations;
    const org: OrgData | null = Array.isArray(rawOrg) ? (rawOrg[0] ?? null) : rawOrg;
    const userPrompt = `Prospect details:
Name: ${[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Unknown"}
Title: ${lead.title ?? lead.headline ?? "Unknown"}
Company: ${org?.name ?? "Unknown"}
Website: ${org?.domain ? `https://${org.domain}` : "N/A"}
What they do: ${org?.company_description ?? org?.description ?? "Not available"}
Their end markets / customers: ${org?.sells_to ?? "Not available"}
Country: ${lead.country ?? "Unknown"}`;

    const { json } = await complete<{ subject: string; body: string }>({ system, user: userPrompt });
    return {
      lead_id: lead.id,
      subject: json?.subject ?? `Masterbatch partnership – ${org?.name ?? "your company"}`,
      body: json?.body ?? "",
    };
  }

  const safeLeads = leads ?? [] as NonNullable<typeof leads>;
  const results = await Promise.allSettled(safeLeads.map(generateOne));

  const emails = results.map((r, i) => {
    const lead = safeLeads[i];
    const rawOrg2 = lead.organizations;
    const org: OrgData | null = Array.isArray(rawOrg2) ? (rawOrg2[0] ?? null) : rawOrg2;
    if (r.status === "fulfilled") return r.value;
    return {
      lead_id: lead.id,
      subject: `Masterbatch partnership – ${org?.name ?? "your company"}`,
      body: `Hi ${lead.first_name ?? "there"},\n\nI came across ${org?.name ?? "your company"} and thought Kuber Polyplast's masterbatch range could be a great fit for your production needs.\n\nWould you be open to a quick call?\n\nBest,\nKuber Polyplast Team`,
    };
  });

  return ok({ emails });
}
