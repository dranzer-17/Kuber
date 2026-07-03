import { chromium } from "playwright";
import { mkdirSync } from "fs";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const LOGIN_EMAIL = process.env.LOGIN_EMAIL ?? "kuber@admin.com";
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD ?? "Kuber123";
const OUT_DIR = "./ui-screenshots";
const VIEWPORT = { width: 1600, height: 1000 };

mkdirSync(OUT_DIR, { recursive: true });

let shotCount = 0;
async function shot(page, name) {
  shotCount += 1;
  const filename = `${String(shotCount).padStart(2, "0")}-${name}.png`;
  await page.waitForTimeout(400); // let animations/transitions settle
  await page.screenshot({ path: `${OUT_DIR}/${filename}`, fullPage: true });
  console.log(`Saved ${filename}`);
}

async function safe(label, fn) {
  try {
    await fn();
  } catch (err) {
    console.error(`Skipped "${label}":`, err.message);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  // ── Login ──────────────────────────────────────────────────────────────
  await safe("login", async () => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder(/admin@company\.com/i).fill(LOGIN_EMAIL);
    await page.locator('input[type="password"]').fill(LOGIN_PASSWORD);
    await shot(page, "login-page");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/dashboard/, { timeout: 30000 });
    await shot(page, "dashboard");
  });

  // ── Leads — list view ─────────────────────────────────────────────────
  await safe("leads-list", async () => {
    await page.goto(`${BASE_URL}/leads`);
    await page.waitForLoadState("networkidle");
    await shot(page, "leads-list");
  });

  // Leads — search
  await safe("leads-search", async () => {
    await page.goto(`${BASE_URL}/leads`);
    const searchBox = page.getByPlaceholder(/search leads/i);
    if (await searchBox.count()) {
      await searchBox.fill("rud");
      await page.waitForTimeout(700);
      await shot(page, "leads-search-result");
      await searchBox.fill("");
      await page.waitForTimeout(500);
    }
  });

  // Leads — kanban toggle
  await safe("leads-kanban", async () => {
    await page.goto(`${BASE_URL}/leads`);
    const kanbanToggle = page.getByRole("button", { name: /kanban/i }).first();
    if (await kanbanToggle.count()) {
      await kanbanToggle.click();
      await page.waitForTimeout(600);
      await shot(page, "leads-kanban");
      await page.getByRole("button", { name: /list/i }).first().click();
      await page.waitForTimeout(400);
    }
  });

  // Leads — filters panel
  await safe("leads-filters", async () => {
    await page.goto(`${BASE_URL}/leads`);
    const filtersBtn = page.getByRole("button", { name: /filters/i });
    if (await filtersBtn.count()) {
      await filtersBtn.click();
      await page.waitForTimeout(400);
      await shot(page, "leads-filters-open");
      await page.keyboard.press("Escape");
      await page.mouse.click(10, 10);
      await page.waitForTimeout(500);
    }
  });

  // Leads — select two rows, capture selection bug context
  await safe("leads-select", async () => {
    await page.goto(`${BASE_URL}/leads`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    const rowCheckboxes = page.locator('table input[type="checkbox"]');
    const checkboxCount = await rowCheckboxes.count();
    if (checkboxCount > 2) {
      await rowCheckboxes.nth(1).check({ force: true });
      await rowCheckboxes.nth(2).check({ force: true });
      await page.waitForTimeout(300);
      await shot(page, "leads-two-selected");
    }
  });

  // Leads — open a single lead detail
  await safe("lead-detail", async () => {
    await page.goto(`${BASE_URL}/leads`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    const firstLeadLink = page.locator("table tbody tr").first();
    if (await firstLeadLink.count()) {
      await firstLeadLink.click({ force: true });
      await page.waitForTimeout(700);
      await shot(page, "lead-detail");
      await page.goBack();
      await page.waitForTimeout(500);
    }
  });

  // Leads — Add leads flow
  await safe("leads-add", async () => {
    await page.goto(`${BASE_URL}/leads/add`);
    await page.waitForLoadState("networkidle");
    await shot(page, "leads-add-page");
  });

  // ── Campaigns — list ──────────────────────────────────────────────────
  await safe("campaigns-list", async () => {
    await page.goto(`${BASE_URL}/campaigns`);
    await page.waitForLoadState("networkidle");
    await shot(page, "campaigns-list");
  });

  // Campaigns — open the first campaign detail
  await safe("campaign-detail", async () => {
    await page.goto(`${BASE_URL}/campaigns`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    const firstCampaignCard = page.locator("a, [role='button']").filter({ hasText: /LIVE|DRAFT|PAUSED/i }).first();
    const campaignRows = page.locator("main a").first();
    const openedCampaign =
      (await firstCampaignCard.count())
        ? firstCampaignCard
        : campaignRows;

    if (await openedCampaign.count()) {
      await openedCampaign.click();
      await page.waitForTimeout(800);
      await shot(page, "campaign-detail-leads-tab");

      for (const tabName of ["Kanban", "Report", "Replies"]) {
        const tab = page.getByRole("button", { name: new RegExp(tabName, "i") }).first();
        if (await tab.count()) {
          await tab.click();
          await page.waitForTimeout(700);
          await shot(page, `campaign-detail-${tabName.toLowerCase()}-tab`);
        }
      }

      // Show config panel if present
      const showConfig = page.getByText(/show config/i);
      if (await showConfig.count()) {
        await showConfig.click();
        await page.waitForTimeout(400);
        await shot(page, "campaign-detail-config-open");
      }
    }
  });

  // ── Create Campaign modal (from Leads page, needs 1+ eligible lead selected) ──
  await safe("create-campaign-modal", async () => {
    await page.goto(`${BASE_URL}/leads`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    const anyCheckbox = page.locator('table input[type="checkbox"]').nth(1);
    if (await anyCheckbox.count()) {
      await anyCheckbox.check({ force: true });
      await page.waitForTimeout(300);
      const createCampaignBtn = page.getByRole("button", { name: /create campaign/i });
      if (await createCampaignBtn.count()) {
        await createCampaignBtn.click({ force: true });
        await page.waitForTimeout(700);
        await shot(page, "create-campaign-modal");
      }
    }
  });

  // ── Settings — every section and sub-section ─────────────────────────
  await safe("settings", async () => {
    await page.goto(`${BASE_URL}/settings`);
    await page.waitForLoadState("networkidle");
    await shot(page, "settings-my-profile");

    const settingsSections = [
      { label: "AI & Outreach", subTabs: ["Email Template", "Reply AI", "Subject Line", "Email Footer"] },
      { label: "Knowledge Sources", subTabs: ["Company Details", "Product Offerings", "Extra Documents"] },
      { label: "Appearance", subTabs: [] },
      { label: "Account", subTabs: [] },
    ];

    for (const sec of settingsSections) {
      const navBtn = page.getByRole("button", { name: sec.label }).first();
      if (await navBtn.count()) {
        await navBtn.click({ force: true });
        await page.waitForTimeout(500);
        const slug = sec.label.toLowerCase().replace(/[^a-z]+/g, "-");
        await shot(page, `settings-${slug}`);

        for (const sub of sec.subTabs) {
          const subBtn = page.getByRole("button", { name: sub }).first();
          if (await subBtn.count()) {
            await subBtn.click({ force: true });
            await page.waitForTimeout(500);
            const subSlug = sub.toLowerCase().replace(/[^a-z]+/g, "-");
            await shot(page, `settings-${slug}-${subSlug}`);
          }
        }
      }
    }
  });

  await browser.close();
  console.log(`\nDone. ${shotCount} screenshots saved to ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
