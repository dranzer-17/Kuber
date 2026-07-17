import fs from "node:fs";

const envText = fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const line = envText.split("\n").find((l) => l.startsWith("OPENROUTER_API_KEY="));
const key = line.slice("OPENROUTER_API_KEY=".length).trim();

const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Kuber Polyplast",
  },
  body: JSON.stringify({
    model: "anthropic/claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      { role: "system", content: "Return ONLY valid JSON, no markdown fences: {\"company_description\": string | null, \"sells_to\": string | null}. If you cannot find real evidence for a field, return null." },
      { role: "user", content: "Company name: MRI Flexible Packaging\nWebsite content:\nMRI Flexible Packaging manufactures high-barrier flexible packaging films and laminates for the food, pharmaceutical, and industrial markets. We serve customers across North America with custom pouch and rollstock solutions." },
    ],
  }),
});

console.log("STATUS:", res.status);
const body = await res.text();
console.log("BODY:", body);
