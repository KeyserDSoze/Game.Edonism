import { expect, test, type Page } from "@playwright/test";

/**
 * #72: independent, unsigned, allowlisted first-round evidence. The browser
 * under test has no session, bearer, mocked API or live match state.
 */
const PRIMARY = "dev-public-audit-import-file";
const SECONDARY = "dev-public-audit-compare-file";
const IMPORT_STATUS = "dev-public-audit-import-status";
const COMPARE_STATUS = "dev-public-audit-compare-status";
const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function publicGenesis(matchId: string): Buffer {
  return Buffer.from(JSON.stringify({
    format: "edonism-public-audit-v1",
    matchId,
    round: 1,
    verifiedRevision: 0,
    events: [{
      revision: 0,
      round: 1,
      kind: "match-created",
      actorId: "system",
      fromStreetId: null,
      toStreetId: null,
    }],
    frames: [{
      revision: 0,
      kind: "match-created",
      actorId: "system",
      phase: 0,
      activePlayerId: "alice",
      players: [
        { playerId: "alice", streetId: "newton", freeMoveUsed: false },
        { playerId: "bob", streetId: "planck", freeMoveUsed: false },
      ],
    }],
  }));
}

async function upload(page: Page, input: string, name: string, buffer: Buffer) {
  await page.getByTestId(input).setInputFiles({
    name, mimeType: "application/json", buffer,
  });
}

/**
 * Intercept only selected File.text() calls and keep their promises unresolved
 * until the test releases them. Resolving after the new selection ensures the
 * old callback really executes late, not merely that two uploads are fast.
 */
async function holdSelectedFileReads(page: Page) {
  await page.evaluate(() => {
    const original = File.prototype.text;
    const held = new Map<string, () => Promise<void>>();
    (window as Window & {
      releaseEdonismAuditRead?: (name: string) => Promise<void>;
    }).releaseEdonismAuditRead = async (name: string) => {
      const release = held.get(name);
      if (!release) throw new Error(`Missing delayed read: ${name}`);
      held.delete(name);
      await release();
    };
    File.prototype.text = function (this: File): Promise<string> {
      if (!this.name.startsWith("delayed-")) return original.call(this);
      return new Promise<string>((resolve, reject) => {
        held.set(this.name, async () => {
          try { resolve(await original.call(this)); }
          catch (error) { reject(error); }
        });
      });
    };
  });
}

async function releaseAndFlush(page: Page, name: string) {
  await page.evaluate(async filename => {
    const browser = window as Window & {
      releaseEdonismAuditRead: (filename: string) => Promise<void>;
    };
    await browser.releaseEdonismAuditRead(filename);
    // Wait for File.text() continuation and React rendering, not only upload.
    await new Promise<void>(resolve =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, name);
}

test("stale secondary File.text does not override the newer public comparison (#72)",
  async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    let apiCalls = 0;
    await page.route("**/api/**", route => {
      apiCalls++;
      return route.abort();
    });
    await page.goto("/");
    await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
    await holdSelectedFileReads(page);

    const first = publicGenesis(FIRST_ID);
    const other = publicGenesis(OTHER_ID);
    const compared = page.getByTestId(COMPARE_STATUS);
    await upload(page, PRIMARY, "primary.json", first);
    await expect(page.getByTestId(IMPORT_STATUS)).toHaveAttribute("data-check", "valid");
    await expect(page.getByTestId("dev-session")).toHaveCount(0);

    await upload(page, SECONDARY, "delayed-old.json", first);
    await expect(compared).toHaveAttribute("data-compare", "checking");
    await upload(page, SECONDARY, "newer-different-match.json", other);
    await expect(compared).toHaveAttribute("data-compare", "different-match");
    await releaseAndFlush(page, "delayed-old.json");
    await expect(compared).toHaveAttribute("data-compare", "different-match");

    expect(apiCalls).toBe(0);
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
  });

test("changing the primary or rejecting another secondary wins over late file reads (#72)",
  async ({ page }) => {
    let apiCalls = 0;
    await page.route("**/api/**", route => {
      apiCalls++;
      return route.abort();
    });
    await page.goto("/");
    await holdSelectedFileReads(page);
    const first = publicGenesis(FIRST_ID);
    const other = publicGenesis(OTHER_ID);
    const compared = page.getByTestId(COMPARE_STATUS);
    const status = page.getByTestId(IMPORT_STATUS);

    await upload(page, PRIMARY, "first.json", first);
    await expect(status).toHaveAttribute("data-check", "valid");

    await upload(page, SECONDARY, "delayed-before-valid-primary.json", first);
    await expect(compared).toHaveAttribute("data-compare", "checking");
    await upload(page, PRIMARY, "different-valid-primary.json", other);
    await expect(status).toHaveAttribute("data-check", "valid");
    await expect(compared).toHaveCount(0);
    await releaseAndFlush(page, "delayed-before-valid-primary.json");
    await expect(compared).toHaveCount(0);

    await upload(page, SECONDARY, "delayed-before-invalid-primary.json", other);
    await expect(compared).toHaveAttribute("data-compare", "checking");
    await upload(page, PRIMARY, "malformed-primary.json", Buffer.from("{bad json"));
    await expect(status).toHaveAttribute("data-check", "invalid");
    await expect(compared).toHaveCount(0);
    await expect(page.getByTestId("dev-offline-timeline")).toHaveCount(0);
    await releaseAndFlush(page, "delayed-before-invalid-primary.json");
    await expect(compared).toHaveCount(0);
    await expect(page.getByTestId("dev-offline-timeline")).toHaveCount(0);

    await upload(page, PRIMARY, "restored-primary.json", first);
    await expect(status).toHaveAttribute("data-check", "valid");
    await upload(page, SECONDARY, "delayed-before-unsafe.json", first);
    await expect(compared).toHaveAttribute("data-compare", "checking");
    const unsafe = JSON.parse(first.toString("utf8")) as {
      privateToken?: string;
    };
    unsafe.privateToken = "forbidden-private-value";
    await upload(page, SECONDARY, "unsafe.json", Buffer.from(JSON.stringify(unsafe)));
    await expect(compared).toHaveAttribute("data-compare", "invalid");
    await releaseAndFlush(page, "delayed-before-unsafe.json");
    await expect(compared).toHaveAttribute("data-compare", "invalid");
    await expect(compared).not.toContainText(unsafe.privateToken);

    await upload(page, SECONDARY, "delayed-before-oversized.json", first);
    await expect(compared).toHaveAttribute("data-compare", "checking");
    await upload(page, SECONDARY, "oversized.json", Buffer.alloc(64 * 1024 + 1, "x"));
    await expect(compared).toHaveAttribute("data-compare", "invalid");
    await releaseAndFlush(page, "delayed-before-oversized.json");
    await expect(compared).toHaveAttribute("data-compare", "invalid");
    await expect(page.getByTestId("dev-session")).toHaveCount(0);
    expect(apiCalls).toBe(0);
  });
