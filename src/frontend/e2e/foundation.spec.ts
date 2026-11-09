import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("city shell and selectable hex work without a backend", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Una città da costruire/i })).toBeVisible();
  await expect(page.getByTestId("city-renderer")).toBeVisible();
  await expect(page.getByTestId("selected-coordinate")).toHaveText("0, 0");
  await page.getByTestId("tile-picker-1:0").click();
  await expect(page.getByTestId("selected-coordinate")).toHaveText("1, 0");
  await expect(page.getByText("Nessuna economia o regola PvP", { exact: false })).toBeVisible();
});

test("dark, light and system theme selectors persist on reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Scuro" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "Chiaro" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await page.getByRole("button", { name: "Sistema" }).click();
  await expect(page.getByRole("button", { name: "Sistema" })).toHaveAttribute("aria-pressed", "true");
});

test("language choice persists and controls are translated", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByRole("heading", { name: /A city to build/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dark" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /A city to build/i })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Language" })).toHaveValue("en");
});

test("mobile layout keeps the preview and accessible tile picker usable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("city-renderer")).toBeVisible();
  await page.getByTestId("tile-picker-0:1").click();
  await expect(page.getByTestId("selected-coordinate")).toHaveText("0, 1");
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflows).toBe(false);
});
