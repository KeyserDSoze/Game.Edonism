import { expect, test } from "@playwright/test";

test("original city board loads with 30 spaces and selectable streets", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Una città da costruire/i })).toBeVisible();
  await expect(page.getByTestId("city-renderer")).toBeVisible();
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-board-version", "edonism-streets-v1");
  await expect(page.getByTestId("selected-street")).toHaveText("Gauss Avenue");
  await expect(page.getByTestId("street-slot-count")).toHaveText("8");
  await expect(page.getByTestId("selected-slot")).toHaveText("N-01");
  await page.getByTestId("slot-picker-N-03").click();
  await expect(page.getByTestId("selected-slot")).toHaveText("N-03");
  await page.getByTestId("street-picker-boson").click();
  await expect(page.getByTestId("street-slot-count")).toHaveText("4");
  await expect(page.getByTestId("selected-street")).toHaveText("Boson Street");
  await expect(page.getByTestId("selected-slot")).toHaveText("B-01");
  await expect(page.getByText("Nessuna partita, economia o azione PvP", { exact: false })).toBeVisible();
});

test("printed street graph offers valid adjacent choices only", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("street-picker-planck").click();
  await expect(page.getByTestId("adjacency-list").getByRole("button")).toHaveCount(3);
  await expect(page.getByTestId("adjacent-gauss")).toBeVisible();
  await expect(page.getByTestId("adjacent-einstein")).toBeVisible();
  await expect(page.getByTestId("adjacent-meson")).toBeVisible();
  await expect(page.getByTestId("adjacent-newton")).toHaveCount(0);
  await page.getByTestId("adjacent-einstein").click();
  await expect(page.getByTestId("selected-street")).toHaveText("Einstein Avenue");
  await expect(page.getByTestId("adjacent-main-square")).toBeVisible();
  await page.getByTestId("adjacent-main-square").click();
  await expect(page.getByTestId("selected-street")).toHaveText("Main Square");
  await expect(page.getByTestId("street-slot-count")).toHaveText("0");
  await expect(page.getByTestId("selected-slot")).toHaveText("Municipio");
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

test("language choice persists and board controls are translated", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByRole("heading", { name: /A city to build/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Dark" })).toBeVisible();
  await page.getByTestId("street-picker-main-square").click();
  await expect(page.getByTestId("selected-slot")).toHaveText("City Hall");
  await page.reload();
  await expect(page.getByRole("heading", { name: /A city to build/i })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Language" })).toHaveValue("en");
});

test("mobile layout keeps the board and accessible space picker usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("city-renderer")).toBeVisible();
  await page.getByTestId("street-picker-newton").click();
  await expect(page.getByTestId("street-slot-count")).toHaveText("3");
  await page.getByTestId("slot-picker-W-02").click();
  await expect(page.getByTestId("selected-slot")).toHaveText("W-02");
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflows).toBe(false);
});
