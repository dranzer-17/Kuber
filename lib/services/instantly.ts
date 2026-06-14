const BASE = "https://api.instantly.ai/api/v2";

function h() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.INSTANTLY_API_KEY}`,
  };
}

async function iJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) throw new Error((data as { message?: string }).message ?? `Instantly ${res.status}`);
  return data as T;
}

export async function createInstantlyCampaign(name: string, opts: {
  dailyLimit: number;
  windowFrom: string;
  windowTo: string;
  timezone: string;
  sendDays: Record<string, boolean>;
}): Promise<string> {
  const res = await fetch(`${BASE}/campaigns`, {
    method: "POST",
    headers: h(),
    body: JSON.stringify({
      name,
      campaign_schedule: {
        schedules: [{
          name: "Default",
          timing: { from: opts.windowFrom, to: opts.windowTo },
          days: opts.sendDays,
          timezone: opts.timezone,
        }],
      },
      daily_limit: opts.dailyLimit,
      sequences: [{
        steps: [{
          type: "email",
          delay: 0,
          variants: [{
            subject: "{{customSubject}}",
            body: "{{customBody}}",
          }],
        }],
      }],
    }),
  });
  const data = await iJson<{ id: string }>(res);
  return data.id;
}

export async function addLeadsToInstantly(campaignId: string, leads: Array<{
  email: string;
  firstName: string;
  lastName: string;
  subject: string;
  body: string;
  senderName?: string;
}>): Promise<void> {
  const res = await fetch(`${BASE}/campaign-lead`, {
    method: "POST",
    headers: h(),
    body: JSON.stringify({
      campaign_id: campaignId,
      leads: leads.map((l) => ({
        email: l.email,
        first_name: l.firstName,
        last_name: l.lastName,
        variables: {
          customSubject: l.subject,
          customBody: l.body.replace(/\n/g, "<br>"),
          ...(l.senderName ? { senderName: l.senderName } : {}),
        },
      })),
    }),
  });
  await iJson<unknown>(res);
}

export async function activateInstantlyCampaign(campaignId: string): Promise<void> {
  const res = await fetch(`${BASE}/campaigns/${campaignId}/activate`, {
    method: "POST",
    headers: h(),
    body: JSON.stringify({}),
  });
  await iJson<unknown>(res);
}
