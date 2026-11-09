import { expect, test, type Page } from "@playwright/test";

type Seat = "alice" | "bob";
type MockOptions = { conflictOnFirstMove?: boolean; creationFails?: boolean };

async function mockMatchApi(page: Page, options: MockOptions = {}) {
  const tokenToSeat = new Map([["alice-token", "alice"], ["bob-token", "bob"]]);
  const streets: Record<Seat, string> = { alice: "gauss", bob: "einstein" };
  const moved: Record<Seat, boolean> = { alice: false, bob: false };
  let revision = 0;
  let phase = 0;
  let active: Seat | null = "alice";
  let conflictRaised = false;
  const observedHeaders: Array<{ path: string; token: string | undefined }> = [];

  const snapshot = () => ({
    matchId: "00000000-0000-0000-0000-000000000020",
    boardVersion: "edonism-streets-v1",
    round: 1,
    revision,
    phase,
    activePlayerId: active,
    players: (["alice", "bob"] as const).map((playerId) => ({
      playerId,
      streetId: streets[playerId],
      startingSlotId: playerId === "alice" ? "N-01" : "S-01",
      hearts: 3,
      freeMoveUsed: moved[playerId],
    })),
  });

  await page.route("**/api/dev/matches/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const token = request.headers()["x-edonism-dev-token"];
    observedHeaders.push({ path, token });

    if (path.endsWith("/from-full-deck")) {
      if (options.creationFails) return route.abort("failed");
      const fixture = request.postDataJSON() as {
        playerIds: string[];
        availableActivities: unknown[];
        characters: unknown[];
        actionCardIds: string[];
        electionDayCardId: string;
      };
      expect(fixture.playerIds).toEqual(["alice", "bob"]);
      expect(fixture.availableActivities).toHaveLength(46);
      expect(fixture.characters).toHaveLength(23);
      expect(fixture.actionCardIds).toHaveLength(58);
      expect(fixture.electionDayCardId).toBe("demo:election-day");
      return route.fulfill({
        status: 201,
        json: {
          matchId: snapshot().matchId,
          state: snapshot(),
          credentials: [
            { playerId: "alice", token: "alice-token" },
            { playerId: "bob", token: "bob-token" },
          ],
        },
      });
    }

    const seat = token ? (tokenToSeat.get(token) as Seat | undefined) : undefined;
    if (!seat) return route.fulfill({ status: 404, json: { code: "match_not_found" } });

    if (path.endsWith("/hand")) {
      return route.fulfill({
        status: 200,
        json: {
          matchId: snapshot().matchId,
          playerId: seat,
          cardIds: seat === "alice"
            ? ["demo:action:01", "demo:action:02", "demo:action:03", "demo:action:04"]
            : ["demo:action:21", "demo:action:22", "demo:action:23", "demo:action:24"],
        },
      });
    }

    if (request.method() === "GET") {
      return route.fulfill({ status: 200, json: snapshot() });
    }

    const payload = request.postDataJSON() as {
      expectedRevision: number;
      destinationStreetId?: string;
    };

    if (options.conflictOnFirstMove && path.endsWith("/free-move") && !conflictRaised) {
      conflictRaised = true;
      revision = 3; // A competing actor/worker updated the server.
      return route.fulfill({ status: 409, json: { code: "revision_conflict" } });
    }

    if (payload.expectedRevision !== revision || active !== seat || phase !== 0) {
      return route.fulfill({ status: 409, json: { code: "revision_conflict" } });
    }

    if (path.endsWith("/free-move")) {
      if (moved[seat]) {
        return route.fulfill({ status: 409, json: { code: "free_move_already_used" } });
      }
      const neighbors: Record<string, string[]> = {
        gauss: ["planck", "newton", "main-square"],
        planck: ["gauss", "einstein", "meson"],
        einstein: ["newton", "planck", "main-square"],
      };
      if (!(neighbors[streets[seat]] ?? []).includes(payload.destinationStreetId ?? "")) {
        return route.fulfill({ status: 409, json: { code: "not_adjacent" } });
      }
      streets[seat] = payload.destinationStreetId!;
      moved[seat] = true;
      revision++;
      return route.fulfill({ status: 200, json: snapshot() });
    }

    if (path.endsWith("/end-turn")) {
      revision++;
      if (active === "alice") {
        active = "bob";
      } else {
        active = null;
        phase = 1;
      }
      return route.fulfill({ status: 200, json: snapshot() });
    }

    return route.fulfill({ status: 404 });
  });

  return { observedHeaders };
}

test("Development match HUD uses the server for moving and ending both turns", async ({ page }) => {
  await mockMatchApi(page);
  await page.goto("/");
  await expect(page.getByTestId("dev-match-lab")).toBeVisible();
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-session")).toBeVisible();
  await expect(page.getByTestId("dev-active-player")).toHaveText("alice");
  await expect(page.getByTestId("dev-position")).toHaveText("Gauss Avenue");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");

  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-position")).toHaveText("Planck Avenue");
  await expect(page.getByTestId("selected-street")).toHaveText("Planck Avenue");
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-move-meson")).toBeDisabled();

  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-active-player")).toHaveText("bob");
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-position")).toHaveText("Einstein Avenue");

  await page.getByTestId("dev-move-newton").click();
  await expect(page.getByTestId("dev-position")).toHaveText("Newton Avenue");
  await expect(page.getByTestId("dev-revision")).toHaveText("3");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("4");
  await expect(page.getByTestId("dev-active-player")).toContainText("In attesa");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
});

test("two Development seat tokens fetch disjoint private hands without browser storage", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();

  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-hand")).not.toContainText("demo:action:21");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-hand")).not.toContainText("demo:action:01");

  expect(observedHeaders.filter((r) => r.path.endsWith("/hand")).map((r) => r.token))
    .toEqual(["alice-token", "bob-token"]);
  const keys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(keys.some((k) => /token|card|hand|match/i.test(k))).toBe(false);
  expect(await page.getByTestId("dev-session").textContent()).not.toContain("alice-token");
  expect(await page.getByTestId("dev-session").textContent()).not.toContain("bob-token");
});

test("HTTP 409 refreshes authoritative snapshot instead of guessing a move", async ({ page }) => {
  await mockMatchApi(page, { conflictOnFirstMove: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-position")).toHaveText("Gauss Avenue");
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-error")).toContainText("stato aggiornato");
  await expect(page.getByTestId("dev-revision")).toHaveText("3");
  await expect(page.getByTestId("dev-position")).toHaveText("Gauss Avenue");
});

test("the lab displays a safe API-unavailable state without a backend", async ({ page }) => {
  await mockMatchApi(page, { creationFails: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toContainText("Impossibile avviare");
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-create")).toBeEnabled();
});

test("Development match HUD is accessible on mobile and translated to English", async ({ page }) => {
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByRole("heading", { name: "Match laboratory" })).toBeVisible();
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-active-player")).toHaveText("alice");
  await expect(page.getByRole("group", { name: "Test seat to impersonate" })).toBeVisible();
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 2,
  );
  expect(overflow).toBe(false);
});
