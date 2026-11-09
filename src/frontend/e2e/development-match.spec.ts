import { expect, test, type Page } from "@playwright/test";

type Seat = string;
const demoSeats = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"] as const;
type MockOptions = {
  conflictOnFirstMove?: boolean;
  creationFails?: boolean;
  sameStreet?: boolean;
  unknownStreet?: boolean;
  fallenHenchman?: boolean;
  badControlSlot?: boolean;
  unknownOwner?: boolean;
  missingBoardCard?: boolean;
  unknownSecretEvent?: boolean;
  playerCount?: number;
  noTurnOptions?: boolean;
  invalidTurnOptions?: boolean;
};

async function mockMatchApi(page: Page, options: MockOptions = {}) {
  const seats = demoSeats.slice(0, options.playerCount ?? 2);
  const tokenToSeat = new Map(seats.map((seat, index) =>
    [String.fromCharCode(97 + index).repeat(64), seat]));
  const mockStreets = ["gauss", "einstein", "planck", "newton", "meson", "boson", "main-square", "gauss"];
  const streets: Record<Seat, string> = Object.fromEntries(seats.map((id, index) => [
    id, index === 1 && options.unknownStreet ? "unmapped-road"
      : index === 1 && options.sameStreet ? "gauss" : mockStreets[index],
  ]));
  const moved: Record<Seat, boolean> = Object.fromEntries(seats.map((id) => [id, false]));
  let revision = 0;
  let phase = 0;
  let active: Seat | null = "alice";
  let conflictRaised = false;
  let rotationSequence = 0;
  const auditEvents: Array<{
    revision: number; round: number; kind: string; actorId: string;
    fromStreetId: string | null; toStreetId: string | null;
  }> = [
    { revision: 0, round: 1, kind: "match-created", actorId: "system",
      fromStreetId: null, toStreetId: null },
  ];
  const observedHeaders: Array<{ path: string; token: string | undefined }> = [];

  const snapshot = () => ({
    matchId: "00000000-0000-0000-0000-000000000020",
    boardVersion: "edonism-streets-v1",
    round: 1,
    revision,
    phase,
    activePlayerId: active,
    turnOrder: [...seats],
    proposedNextRoundOrder: [...seats.slice(-1), ...seats.slice(0, -1)],
    events: options.unknownSecretEvent
      ? [...auditEvents, { revision: 99, round: 1, kind: "private-action",
          actorId: "alice", fromStreetId: null, toStreetId: null }]
      : [...auditEvents],
    players: seats.map((playerId, index) => ({
      playerId,
      streetId: streets[playerId],
      startingSlotId: playerId === "alice" ? "N-01" : playerId === "bob" ? "S-01"
        : `N-${String(index + 1).padStart(2, "0")}`,
      hearts: 3,
      freeMoveUsed: moved[playerId],
    })),
    boardActivities: [
      { slotId: "N-01", cardId: "demo:activity:gauss", category: "culture" },
      ...(options.missingBoardCard
        ? []
        : [{ slotId: "S-01", cardId: "demo:activity:einstein", category: "transport" }]),
    ],
    controlledActivities: [
      { slotId: "N-01", ownerPlayerId: "alice", posture: 0 },
      {
        slotId: options.badControlSlot ? "does-not-exist" : "S-01",
        ownerPlayerId: options.unknownOwner ? "intruder" : "bob",
        posture: options.fallenHenchman ? 1 : 0,
      },
    ],
    grossSalaryQuotes: [
      { playerId: "alice", baseAtoms: 2, standingActivityAtoms: 1, grossAtoms: 3 },
      {
        playerId: "bob",
        baseAtoms: 2,
        standingActivityAtoms: options.fallenHenchman ? 0 : 1,
        grossAtoms: options.fallenHenchman ? 2 : 3,
      },
    ],
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
      expect(fixture.playerIds).toEqual(seats);
      expect(fixture.availableActivities).toHaveLength(46);
      expect(fixture.characters).toHaveLength(23);
      expect(fixture.actionCardIds).toHaveLength(58);
      expect(fixture.electionDayCardId).toBe("demo:election-day");
      return route.fulfill({
        status: 201,
        json: {
          matchId: snapshot().matchId,
          state: snapshot(),
          credentials: seats.map((playerId, index) => ({
            playerId, token: String.fromCharCode(97 + index).repeat(64),
          })),
        },
      });
    }

    const seat = token ? (tokenToSeat.get(token) as Seat | undefined) : undefined;
    if (!seat) return route.fulfill({ status: 404, json: { code: "match_not_found" } });

    if (path.endsWith("/turn-options")) {
      if (options.noTurnOptions)
        return route.fulfill({ status: 503, json: { code: "unavailable" } });
      const neighbors: Record<string, string[]> = {
        gauss: ["planck", "newton", "main-square"],
        planck: ["gauss", "einstein", "meson"],
        einstein: ["newton", "planck", "main-square"],
        newton: ["gauss", "einstein", "boson"],
        meson: ["planck", "boson"],
        boson: ["newton", "meson"],
        "main-square": ["gauss", "einstein"],
      };
      const isTurn = active === seat && phase === 0;
      return route.fulfill({
        status: 200, headers: { "Cache-Control": "no-store" },
        json: {
          matchId: snapshot().matchId,
          playerId: seat,
          revision: options.invalidTurnOptions ? revision + 999 : revision,
          canEndTurn: isTurn,
          freeMoveStreetIds: isTurn && !moved[seat] ? neighbors[streets[seat]] ?? [] : [],
        },
      });
    }

    if (path.endsWith("/hand")) {
      return route.fulfill({
        status: 200,
        json: {
          matchId: snapshot().matchId,
          playerId: seat,
          cardIds: Array.from({ length: 4 }, (_, index) =>
            `demo:action:${String((seat === "alice" ? 1 : 21 + (seats.indexOf(seat) - 1) * 4) + index).padStart(2, "0")}`),
        },
      });
    }


    if (path.endsWith("/rotate-token") && request.method() === "POST") {
      rotationSequence++;
      const fresh = "F".repeat(62)
        + (seats.indexOf(seat) + 1).toString(16).toUpperCase()
        + (rotationSequence % 16).toString(16).toUpperCase();
      tokenToSeat.delete(token!);
      tokenToSeat.set(fresh, seat);
      return route.fulfill({
        status: 200,
        headers: { "Cache-Control": "no-store" },
        json: { playerId: seat, token: fresh },
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
      const fromStreet = streets[seat];
      streets[seat] = payload.destinationStreetId!;
      moved[seat] = true;
      revision++;
      auditEvents.push({ revision, round: 1, kind: "free-move",
        actorId: seat, fromStreetId: fromStreet, toStreetId: streets[seat] });
      return route.fulfill({ status: 200, json: snapshot() });
    }

    if (path.endsWith("/end-turn")) {
      revision++;
      if (seats.indexOf(seat) < seats.length - 1) {
        active = seats[seats.indexOf(seat) + 1];
        auditEvents.push({ revision, round: 1, kind: "turn-ended",
          actorId: seat, fromStreetId: null, toStreetId: null });
      } else {
        active = null;
        phase = 1;
        auditEvents.push({ revision, round: 1, kind: "round-settlement-pending",
          actorId: seat, fromStreetId: null, toStreetId: null });
      }
      return route.fulfill({ status: 200, json: snapshot() });
    }

    return route.fulfill({ status: 404 });
  });

  return {
    observedHeaders,
    // Simulate a distinct server actor's command between browser polls.
    advanceOtherActor: () => {
      revision++;
      active = "bob";
      auditEvents.push({ revision, round: 1, kind: "turn-ended",
        actorId: "alice", fromStreetId: null, toStreetId: null });
    },
  };
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
  await expect(page.getByTestId("dev-move-meson")).toHaveCount(0);

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
    .toEqual(["a".repeat(64), "b".repeat(64)]);
  const keys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(keys.some((k) => /token|card|hand|match/i.test(k))).toBe(false);
  expect(await page.getByTestId("dev-session").textContent()).not.toContain("a".repeat(64));
  expect(await page.getByTestId("dev-session").textContent()).not.toContain("b".repeat(64));
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

test("public match markers follow only server-confirmed streets, not local seat selection", async ({ page }) => {
  await mockMatchApi(page);
  await page.goto("/");
  await expect(page.getByTestId("match-player-legend")).toHaveCount(0);
  await page.getByTestId("dev-create").click();
  const alice = page.getByTestId("match-player-alice");
  const bob = page.getByTestId("match-player-bob");
  await expect(page.getByTestId("match-player-legend")).toBeVisible();
  await expect(alice).toHaveAttribute("data-street-id", "gauss");
  await expect(bob).toHaveAttribute("data-street-id", "einstein");
  await expect(alice).toHaveAttribute("data-active", "true");
  await expect(bob).toHaveAttribute("data-active", "false");

  await page.getByTestId("dev-seat-bob").click();
  await expect(alice).toHaveAttribute("data-street-id", "gauss");
  await expect(bob).toHaveAttribute("data-street-id", "einstein");
  await expect(alice).toHaveAttribute("data-active", "true");

  // Changing inspector selection also must not move either player.
  await page.getByTestId("street-picker-boson").click();
  await expect(bob).toHaveAttribute("data-street-id", "einstein");

  await page.getByTestId("dev-seat-alice").click();
  await page.getByTestId("dev-move-planck").click();
  await expect(alice).toHaveAttribute("data-street-id", "planck");
  await expect(bob).toHaveAttribute("data-street-id", "einstein");
  await page.getByTestId("dev-end-turn").click();
  await expect(alice).toHaveAttribute("data-active", "false");
  await expect(bob).toHaveAttribute("data-active", "true");
  await expect(bob).toContainText("In turno");
});

test("shared streets render distinct player entries and unknown street IDs have no invented marker", async ({ page }) => {
  await mockMatchApi(page, { sameStreet: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(2);

  // A different fixture with a forged/unrecognised street must not render
  // the unknown player at a guessed default location.
  await mockMatchApi(page, { unknownStreet: true });
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("match-player-alice")).toHaveCount(1);
  await expect(page.getByTestId("match-player-bob")).toHaveCount(0);
});

test("WebGL fallback still exposes authoritative player streets and refresh on HTTP 409", async ({ page }) => {
  // Only suppress 3D contexts; preserving 2D is important for React/other
  // browser libraries that perform canvas feature detection at startup.
  await page.addInitScript(() => {
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (function (
      this: HTMLCanvasElement, contextId: string, ...args: unknown[]
    ) {
      if (contextId === "webgl" || contextId === "webgl2") return null;
      return Reflect.apply(nativeGetContext, this, [contextId, ...args]);
    }) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await mockMatchApi(page, { conflictOnFirstMove: true });
  await page.goto("/");
  await expect(page.getByTestId("city-renderer").getByRole("status"))
    .toContainText("3D non è disponibile");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "gauss");
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-error")).toContainText("stato aggiornato");
  await expect(page.getByTestId("dev-revision")).toHaveText("3");
  // Rejected move: roster and inspector remain on the server-confirmed street.
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("selected-street")).toHaveText("Gauss Avenue");
});

test("controlled lots, cards and standing henchmen stay server-owned after moves and seat switches", async ({ page }) => {
  await mockMatchApi(page);
  await page.goto("/");
  await expect(page.getByTestId("match-activity-roster")).toHaveCount(0);
  await page.getByTestId("dev-create").click();

  const alice = page.getByTestId("controlled-lot-N-01");
  const bob = page.getByTestId("controlled-lot-S-01");
  await expect(page.getByTestId("match-activity-roster")).toBeVisible();
  await expect(page.getByTestId("match-board-card-count")).toContainText("2");
  await expect(page.getByTestId("match-activity-roster").locator("li[data-owner-id]")).toHaveCount(2);
  await expect(alice).toHaveAttribute("data-owner-id", "alice");
  await expect(alice).toHaveAttribute("data-card-id", "demo:activity:gauss");
  await expect(alice).toHaveAttribute("data-posture", "standing");
  await expect(bob).toHaveAttribute("data-owner-id", "bob");
  await expect(bob).toHaveAttribute("data-posture", "standing");
  await expect(page.getByTestId("gross-salary-alice")).toHaveAttribute("data-gross-atoms", "3");
  await expect(page.getByTestId("gross-salary-bob")).toHaveAttribute("data-gross-atoms", "3");
  await expect(page.getByTestId("match-activity-roster")).toContainText("nessun salario accreditato");

  await page.getByTestId("dev-move-planck").click();
  await expect(alice).toHaveAttribute("data-owner-id", "alice");
  await expect(alice).toHaveAttribute("data-card-id", "demo:activity:gauss");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "planck");
  await page.getByTestId("dev-end-turn").click();
  await page.getByTestId("dev-seat-bob").click();
  await expect(alice).toHaveAttribute("data-posture", "standing");
  await expect(bob).toHaveAttribute("data-owner-id", "bob");

  const visible = await page.getByTestId("match-activity-roster").innerText();
  expect(visible).not.toContain("a".repeat(64));
  expect(visible).not.toContain("b".repeat(64));
  expect(visible).not.toContain("demo:action:");
});

test("fallen henchmen show explicit posture and gross quotes are not wallet credits", async ({ page }) => {
  await mockMatchApi(page, { fallenHenchman: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("controlled-lot-N-01")).toHaveAttribute("data-posture", "standing");
  await expect(page.getByTestId("controlled-lot-S-01")).toHaveAttribute("data-posture", "fallen");
  await expect(page.getByTestId("controlled-lot-S-01")).toContainText("Scagnozzo atterrato");
  await expect(page.getByTestId("gross-salary-bob")).toHaveAttribute("data-gross-atoms", "2");
  await expect(page.getByTestId("gross-salary-bob")).toContainText("2 atomi lordi");
});

test("unknown controlled slot, owner or missing placed card never creates a fake henchman", async ({ page }) => {
  await mockMatchApi(page, { badControlSlot: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("controlled-lot-N-01")).toHaveCount(1);
  await expect(page.getByTestId("controlled-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("match-activity-roster").locator("li[data-owner-id]")).toHaveCount(1);

  await mockMatchApi(page, { unknownOwner: true });
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("controlled-lot-S-01")).toHaveCount(0);

  await mockMatchApi(page, { missingBoardCard: true });
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("controlled-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("match-board-card-count")).toContainText("1");
});

test("activity ownership survives 409 refresh and is accessible without WebGL on mobile in English", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (function (
      this: HTMLCanvasElement, contextId: string, ...args: unknown[]
    ) {
      if (contextId === "webgl" || contextId === "webgl2") return null;
      return Reflect.apply(nativeGetContext, this, [contextId, ...args]);
    }) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await mockMatchApi(page, { conflictOnFirstMove: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByTestId("city-renderer").getByRole("status")).toContainText("3D is not available");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("controlled-lot-S-01")).toHaveAttribute("data-owner-id", "bob");
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("3");
  await expect(page.getByTestId("controlled-lot-S-01")).toHaveAttribute("data-owner-id", "bob");
  await expect(page.getByTestId("controlled-lot-N-01")).toHaveAttribute("data-posture", "standing");
  await expect(page.getByTestId("match-activity-roster")).toContainText("Gross salary quotes");
  await expect(page.getByTestId("match-activity-roster")).toContainText("no salary credited");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
  expect(overflow).toBe(false);
});

test("public audit timeline follows accepted server moves and turn ends, not local seat switches", async ({ page }) => {
  await mockMatchApi(page);
  await page.goto("/");
  await expect(page.getByTestId("dev-audit-panel")).toHaveCount(0);
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("dev-audit-event-0")).toContainText("Partita creata");
  await expect(page.getByTestId("dev-next-order").locator("li")).toHaveText(["1.bob", "2.alice"]);
  await expect(page.getByTestId("dev-audit-panel")).toContainText("nessun nuovo round");

  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await page.getByTestId("dev-seat-alice").click();
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-audit-event-1")).toHaveAttribute("data-event-kind", "free-move");
  await expect(page.getByTestId("dev-audit-event-1")).toContainText("Gauss Avenue");
  await expect(page.getByTestId("dev-audit-event-1")).toContainText("Planck Avenue");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-audit-event-2")).toHaveAttribute("data-event-kind", "turn-ended");
  await page.getByTestId("dev-seat-bob").click();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-audit-event-3")).toHaveAttribute("data-event-kind", "round-settlement-pending");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-next-order").locator("li")).toHaveText(["1.bob", "2.alice"]);
});

test("unknown private audit event kinds never render, and revisions do not leak card ids", async ({ page }) => {
  await mockMatchApi(page, { unknownSecretEvent: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("dev-audit-event-99")).toHaveCount(0);
  await expect(page.getByTestId("dev-audit-list")).not.toContainText("private-action");
  const text = await page.getByTestId("dev-audit-panel").innerText();
  expect(text).not.toContain("demo:action:");
  expect(text).not.toContain("a".repeat(64));
  expect(text).not.toContain("b".repeat(64));
});

test("409 reconciliation does not invent audit events and works without WebGL in English", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (function (
      this: HTMLCanvasElement, contextId: string, ...args: unknown[]
    ) {
      if (contextId === "webgl" || contextId === "webgl2") return null;
      return Reflect.apply(nativeGetContext, this, [contextId, ...args]);
    }) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await mockMatchApi(page, { conflictOnFirstMove: true });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByTestId("city-renderer").getByRole("status")).toContainText("3D is not available");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("3");
  await expect(page.getByTestId("dev-error")).toContainText("state refreshed");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("dev-next-order")).toContainText("bob");
  await expect(page.getByTestId("dev-audit-panel")).toContainText("no next round");
});

test("join by seat token accepts only the server's identity and keeps one private hand", async ({ page }) => {
  await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const matchId = await page.getByTestId("dev-match-id").textContent();
  expect(matchId?.trim()).toBe("00000000-0000-0000-0000-000000000020");
  await expect(page.getByTestId("dev-copy-seat-alice")).toBeVisible();
  await expect(page.getByTestId("dev-copy-seat-bob")).toBeVisible();
  await page.getByTestId("dev-join-id").fill(matchId!.trim());
  await page.getByTestId("dev-join-token").fill("b".repeat(64));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-seat-alice")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-hand")).not.toContainText("demo:action:01");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await expect(page.getByTestId("dev-join-token")).toHaveValue("");
  const values = await page.evaluate(() => ({
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
    url: location.href,
  }));
  expect(JSON.stringify(values)).not.toContain("b".repeat(64));
  expect(await page.getByTestId("dev-session").textContent()).not.toContain("b".repeat(64));
});

test("invalid Development match token does not establish a seat or reveal public state", async ({ page }) => {
  await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-join-id").fill("00000000-0000-0000-0000-000000000020");
  await page.getByTestId("dev-join-token").fill("INVALID");
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-error")).toContainText("non validi");
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await page.getByTestId("dev-join-token").fill("0".repeat(64));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-error")).toContainText("Accesso negato");
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
});

test("a separate server actor's turn is polled into the UI without a local command", async ({ page }) => {
  const fake = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-active-player")).toHaveText("alice");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  fake.advanceOtherActor();
  await expect(page.getByTestId("dev-revision")).toHaveText("1", { timeout: 8000 });
  await expect(page.getByTestId("dev-active-player")).toHaveText("bob");
  await expect(page.getByTestId("dev-audit-event-1")).toHaveAttribute("data-event-kind", "turn-ended");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
});

test("Development join is usable on mobile in English without WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = (function (this: HTMLCanvasElement,
      contextId: string, ...args: unknown[]) {
      if (contextId === "webgl" || contextId === "webgl2") return null;
      return Reflect.apply(nativeGetContext, this, [contextId, ...args]);
    }) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-join-id").fill("00000000-0000-0000-0000-000000000020");
  await page.getByTestId("dev-join-token").fill("b".repeat(64));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-join-form")).toContainText("Join the match");
  await expect(page.getByTestId("city-renderer").getByRole("status")).toContainText("3D is not available");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
});

test("eight Development seats: quota-safe fixture, private actor switching, mobile and English", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { observedHeaders } = await mockMatchApi(page, { playerCount: 8 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByTestId("dev-player-count")).toHaveAccessibleName("Number of players");
  await page.getByTestId("dev-player-count").selectOption("8");

  const fixturePosted = page.waitForRequest((request) =>
    new URL(request.url()).pathname.endsWith("/from-full-deck") && request.method() === "POST");
  await page.getByTestId("dev-create").click();
  const fixture = fixturePosted.then((request) => request.postDataJSON() as {
    playerIds: readonly string[];
    characters: readonly { startingActivityCardId: string }[];
  });
  const payload = await fixture;
  expect(payload.playerIds).toEqual(demoSeats);
  expect(payload.characters).toHaveLength(23);
  const quotas = new Map([
    ["public-financing", 5], ["private-financing", 5], ["black-market", 4],
    ["corruption", 4], ["culture", 4], ["sport", 2], ["transport", 3], ["bishopric", 3],
  ]);
  const counts = new Map<string, number>();
  for (const character of payload.characters) {
    const category = character.startingActivityCardId.split(":")[1];
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  for (const [category, count] of counts) expect(count).toBeLessThanOrEqual(quotas.get(category)!);

  await expect(page.getByTestId("dev-session")).toBeVisible();
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(8);
  for (const id of demoSeats) {
    await expect(page.getByTestId(`dev-seat-${id}`)).toBeVisible();
    await expect(page.getByTestId(`dev-copy-seat-${id}`)).toBeVisible();
  }
  await page.getByTestId("dev-seat-heidi").click();
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:45");
  await expect(page.getByTestId("dev-hand")).not.toContainText("demo:action:01");
  expect(observedHeaders.some(({ path, token }) =>
    path.endsWith("/hand") && token === "h".repeat(64))).toBe(true);

  const storage = await page.evaluate(() => ({
    local: Object.values(localStorage), session: Object.values(sessionStorage), url: location.href,
  }));
  for (let i = 0; i < 8; i++) {
    const token = String.fromCharCode(97 + i).repeat(64);
    expect(JSON.stringify(storage)).not.toContain(token);
    expect(await page.locator("body").innerText()).not.toContain(token);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
});

test("Development seat rotation invalidates old capability without touching match state", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { observedHeaders } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-session")).toBeVisible();
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  const rotation = page.waitForResponse((res) => new URL(res.url()).pathname.endsWith("/rotate-token"));
  await expect(page.getByTestId("dev-rotate-token")).toHaveText("Rotate bob token");
  await page.getByTestId("dev-rotate-token").click();
  const response = await rotation;
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const changed = await response.json() as { playerId: string; token: string };
  expect(changed.playerId).toBe("bob");
  expect(changed.token).toMatch(/^[A-F0-9]{64}$/);
  expect(changed.token).not.toBe("b".repeat(64));

  await expect(page.getByTestId("dev-rotation-notice")).toContainText("Previous copies no longer work");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-active-player")).toHaveText("alice");
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-hand")).not.toContainText("demo:action:01");
  expect(observedHeaders.some(({ path, token }) =>
    path.endsWith("/hand") && token === changed.token)).toBe(true);

  const access = await page.evaluate(async ({ fresh }) => {
    const old = await fetch("/api/dev/matches/00000000-0000-0000-0000-000000000020/hand", {
      headers: { "X-Edonism-Dev-Token": "b".repeat(64) },
    });
    const next = await fetch("/api/dev/matches/00000000-0000-0000-0000-000000000020/hand", {
      headers: { "X-Edonism-Dev-Token": fresh },
    });
    return { stale: old.status, valid: next.status };
  }, { fresh: changed.token });
  expect(access).toEqual({ stale: 404, valid: 200 });
  const storage = await page.evaluate(() => ({
    local: Object.values(localStorage), session: Object.values(sessionStorage), url: location.href,
  }));
  expect(JSON.stringify(storage)).not.toContain(changed.token);
  expect(await page.locator("body").innerText()).not.toContain(changed.token);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
});

test("Domain options are required: missing or wrong revision prevents browser commands", async ({ page }) => {
  await mockMatchApi(page, { noTurnOptions: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-session")).toBeVisible();
  await expect(page.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await mockMatchApi(page, { invalidTurnOptions: true });
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
});

test("actor-scoped options follow seat and revision, not the locally selected street", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await expect(page.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
  await page.getByTestId("dev-seat-alice").click();
  await page.getByTestId("street-picker-boson").click();
  await expect(page.getByTestId("dev-move-planck")).toBeEnabled();
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  expect(observedHeaders.filter(({ path }) => path.endsWith("/turn-options"))
    .some(({ token }) => token === "b".repeat(64))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
});
