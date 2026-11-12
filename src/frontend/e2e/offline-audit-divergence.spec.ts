
import { expect, test, type Page } from "@playwright/test";

// #73: Both input files are individually consistent, unsigned, public-only
// first-round evidence. Neither origin nor "which one is real" is proved.
const FIRST = "dev-public-audit-import-file";
const SECOND = "dev-public-audit-compare-file";
const MATCH = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type AuditOptions = {
  seats: 2 | 8;
  matchId?: string;
  revision?: 0 | 1;
  action?: "free-move" | "turn-ended";
  initialStreet?: string;
  reverseOrder?: boolean;
};

function publicAudit(options: AuditOptions): Buffer {
  const { seats, matchId = MATCH, revision = 0, action = "free-move",
    initialStreet = "newton", reverseOrder = false } = options;
  const order = Array.from({ length: seats }, (_, i) => "seat-" + i);
  if (reverseOrder) order.reverse();
  const initial = order.map((playerId, index) => ({
    playerId,
    streetId: index === 0 ? initialStreet : "planck",
    freeMoveUsed: false,
  }));
  const events: Array<{
    revision: number; round: number; kind: string; actorId: string;
    fromStreetId: string | null; toStreetId: string | null;
  }> = [{
    revision: 0, round: 1, kind: "match-created", actorId: "system",
    fromStreetId: null, toStreetId: null,
  }];
  const frames = [{
    revision: 0, kind: "match-created", actorId: "system", phase: 0,
    activePlayerId: order[0], players: initial,
  }];
  if (revision === 1) {
    events.push({
      revision: 1, round: 1, kind: action, actorId: order[0],
      fromStreetId: action === "free-move" ? initialStreet : null,
      toStreetId: action === "free-move" ? "gauss" : null,
    });
    frames.push({
      revision: 1, kind: action, actorId: order[0], phase: 0,
      activePlayerId: action === "free-move" ? order[0] : order[1],
      players: initial.map((player, i) =>
        i === 0 && action === "free-move"
          ? { ...player, streetId: "gauss", freeMoveUsed: true }
          : { ...player }),
    });
  }
  return Buffer.from(JSON.stringify({
    format: "edonism-public-audit-v1", matchId, round: 1,
    verifiedRevision: revision, events, frames,
  }));
}

async function upload(page: Page, id: string, bytes: Buffer) {
  await page.getByTestId(id).setInputFiles({
    name: "unsigned-public-replay.json", mimeType: "application/json",
    buffer: bytes,
  });
}

for (const seats of [2, 8] as const) {
  test("first divergent event and ordered player states for " + seats + " seats (#73)",
    async ({ page }) => {
      let apiCalls = 0;
      await page.route("**/api/**", async route => {
        apiCalls++;
        await route.abort();
      });
      if (seats === 8)
        await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/");
      if (seats === 8)
        await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");

      const leftFile = publicAudit({ seats, revision: 1, action: "free-move" });
      const rightFile = publicAudit({ seats, revision: 1, action: "turn-ended" });
      const status = page.getByTestId("dev-public-audit-compare-status");
      const detail = page.getByTestId("dev-public-audit-diff");

      await upload(page, FIRST, leftFile);
      await expect(page.getByTestId("dev-public-audit-import-status"))
        .toHaveAttribute("data-check", "valid");
      await upload(page, SECOND, rightFile);
      await expect(status).toHaveAttribute("data-compare", "divergent");
      await expect(detail).toBeVisible();
      await expect(page.getByTestId("dev-public-audit-diff-revision"))
        .toContainText("#1");
      const left = page.getByTestId("dev-public-audit-diff-left");
      const right = page.getByTestId("dev-public-audit-diff-right");
      await expect(left.getByTestId("dev-public-audit-diff-left-event"))
        .toContainText("free-move");
      await expect(right.getByTestId("dev-public-audit-diff-right-event"))
        .toContainText("turn-ended");
      await expect(left.getByTestId("dev-public-audit-diff-left-route"))
        .toContainText("newton");
      await expect(left.getByTestId("dev-public-audit-diff-left-route"))
        .toContainText("gauss");
      await expect(left.getByTestId("dev-public-audit-diff-player")).toHaveCount(seats);
      await expect(right.getByTestId("dev-public-audit-diff-player")).toHaveCount(seats);
      await expect(left.getByTestId("dev-public-audit-diff-player").first())
        .toContainText("gauss");
      await expect(right.getByTestId("dev-public-audit-diff-player").first())
        .toContainText("newton");
      await expect(left.getByTestId("dev-public-audit-diff-left-active"))
        .toContainText("seat-0");
      await expect(right.getByTestId("dev-public-audit-diff-right-active"))
        .toContainText("seat-1");

      // These cases must NOT leave a divergent frame visible.
      await upload(page, SECOND, leftFile);
      await expect(status).toHaveAttribute("data-compare", "identical");
      await expect(detail).toHaveCount(0);
      await upload(page, SECOND, publicAudit({ seats }));
      await expect(status).toHaveAttribute("data-compare", "right-prefix");
      await expect(detail).toHaveCount(0);
      await upload(page, SECOND, publicAudit({
        seats, matchId: OTHER, revision: 1,
      }));
      await expect(status).toHaveAttribute("data-compare", "different-match");
      await expect(detail).toHaveCount(0);
      const unsafe = JSON.parse(rightFile.toString("utf8")) as { token?: string };
      unsafe.token = "never-show-private-token";
      await upload(page, SECOND, Buffer.from(JSON.stringify(unsafe)));
      await expect(status).toHaveAttribute("data-compare", "invalid");
      await expect(detail).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(unsafe.token);
      expect(apiCalls).toBe(0);
      await expect(page.getByTestId("dev-session")).toHaveCount(0);
      if (seats === 8)
        expect(await page.evaluate(() =>
          document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
    });

  test("divergence at genesis and reset on primary replacement for " + seats + " seats (#73)",
    async ({ page }) => {
      await page.route("**/api/**", route => route.abort());
      await page.goto("/");
      const status = page.getByTestId("dev-public-audit-compare-status");
      const detail = page.getByTestId("dev-public-audit-diff");

      await upload(page, FIRST, publicAudit({ seats }));
      await expect(page.getByTestId("dev-public-audit-import-status"))
        .toHaveAttribute("data-check", "valid");
      await upload(page, SECOND, publicAudit({ seats, initialStreet: "boson" }));
      await expect(status).toHaveAttribute("data-compare", "divergent");
      await expect(page.getByTestId("dev-public-audit-diff-revision"))
        .toContainText("#0");
      await expect(page.getByTestId("dev-public-audit-diff-left")
        .getByTestId("dev-public-audit-diff-player").first()).toContainText("newton");
      await expect(page.getByTestId("dev-public-audit-diff-right")
        .getByTestId("dev-public-audit-diff-player").first()).toContainText("boson");

      await upload(page, SECOND, publicAudit({ seats, reverseOrder: true }));
      await expect(status).toHaveAttribute("data-compare", "divergent");
      await expect(page.getByTestId("dev-public-audit-diff-left")
        .getByTestId("dev-public-audit-diff-player").first()).toContainText("seat-0");
      await expect(page.getByTestId("dev-public-audit-diff-right")
        .getByTestId("dev-public-audit-diff-player").first()).toContainText(
          "seat-" + (seats - 1));
      await upload(page, FIRST, Buffer.from("{not-json"));
      await expect(page.getByTestId("dev-public-audit-import-status"))
        .toHaveAttribute("data-check", "invalid");
      await expect(detail).toHaveCount(0);
      await expect(status).toHaveCount(0);
      await expect(page.getByTestId("dev-offline-timeline")).toHaveCount(0);
    });
}

test("public first-divergence changed field paths are canonical and localized (#74)",
  async ({ page }) => {
    let apiCalls = 0;
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto("/");
    const input = page.getByTestId("dev-public-audit-changes");
    const paths = async () => input.getByTestId("dev-public-audit-changed-field")
      .evaluateAll(nodes => nodes.map(node => node.getAttribute("data-field-path")));

    const left = publicAudit({ seats: 2, revision: 1, action: "free-move" });
    const right = publicAudit({ seats: 2, revision: 1, action: "turn-ended" });
    await upload(page, FIRST, left);
    await expect(page.getByTestId("dev-public-audit-import-status"))
      .toHaveAttribute("data-check", "valid");
    await upload(page, SECOND, right);
    await expect(page.getByTestId("dev-public-audit-compare-status"))
      .toHaveAttribute("data-compare", "divergent");
    await expect(input).toBeVisible();
    expect(await paths()).toEqual([
      "kind", "fromStreetId", "toStreetId", "activePlayerId",
      "players[0].streetId", "players[0].freeMoveUsed",
    ]);
    await expect(input).toContainText("Tipo evento");
    await expect(input).toContainText("Posto 1: Strada del giocatore");

    await upload(page, SECOND, left);
    await expect(input).toHaveCount(0);
    await upload(page, SECOND, publicAudit({ seats: 2, revision: 0 }));
    await expect(input).toHaveCount(0);
    await upload(page, SECOND, publicAudit({ seats: 2, matchId: OTHER }));
    await expect(input).toHaveCount(0);
    const unsafe = JSON.parse(right.toString("utf8")) as { privateHand?: string };
    unsafe.privateHand = "secret-action-card";
    await upload(page, SECOND, Buffer.from(JSON.stringify(unsafe)));
    await expect(page.getByTestId("dev-public-audit-compare-status"))
      .toHaveAttribute("data-compare", "invalid");
    await expect(input).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(unsafe.privateHand);
    expect(apiCalls).toBe(0);
    await expect(page.getByTestId("dev-session")).toHaveCount(0);
  });

test("mobile English public field diff distinguishes genesis position and seat order (#74)",
  async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    let apiCalls = 0;
    await page.route("**/api/**", route => { apiCalls++; return route.abort(); });
    await page.goto("/");
    await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
    const changed = page.getByTestId("dev-public-audit-changed-field");
    const paths = async () => changed.evaluateAll(
      nodes => nodes.map(node => node.getAttribute("data-field-path")));

    await upload(page, FIRST, publicAudit({ seats: 8 }));
    await expect(page.getByTestId("dev-public-audit-import-status"))
      .toHaveAttribute("data-check", "valid");
    await upload(page, SECOND, publicAudit({ seats: 8, initialStreet: "boson" }));
    await expect(page.getByTestId("dev-public-audit-compare-status"))
      .toHaveAttribute("data-compare", "divergent");
    expect(await paths()).toEqual(["players[0].streetId"]);
    await expect(changed.first()).toContainText("Seat 1: Player street");

    await upload(page, SECOND, publicAudit({ seats: 8, reverseOrder: true }));
    await expect(page.getByTestId("dev-public-audit-compare-status"))
      .toHaveAttribute("data-compare", "divergent");
    // Reordering the seats also changes who is the active first player.
    // This is a genuine, public turn difference, not only an ID permutation.
    expect(await paths()).toEqual([
      "activePlayerId",
      ...Array.from({ length: 8 }, (_, i) => `players[${i}].playerId`),
    ]);
    await expect(changed.first()).toContainText("Seat 1: Seat identity");
    await expect(changed.last()).toContainText("Seat 8: Seat identity");

    await upload(page, FIRST, Buffer.from("{bad json"));
    await expect(page.getByTestId("dev-public-audit-import-status"))
      .toHaveAttribute("data-check", "invalid");
    await expect(page.getByTestId("dev-public-audit-changes")).toHaveCount(0);
    await expect(page.getByTestId("dev-public-audit-diff")).toHaveCount(0);
    expect(apiCalls).toBe(0);
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
  });
