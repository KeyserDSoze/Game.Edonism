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
  brokenSeatBootstrap?: "wrong-player" | "wrong-revision";
  bootstrapUnavailable?: boolean;
  noTurnOptions?: boolean;
  invalidTurnOptions?: boolean;
  delayFirstAliceOptions?: boolean;
  dropFirstEndTurnResponse?: boolean;
  http503FirstEndTurn?: boolean;
  overloadFirstConditionalWait?: boolean;
  historyUnavailable?: boolean;
  corruptHistory?: boolean;
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
  const startingStreets: Record<Seat, string> = { ...streets };
  const moved: Record<Seat, boolean> = Object.fromEntries(seats.map((id) => [id, false]));
  let revision = 0;
  let phase = 0;
  let active: Seat | null = "alice";
  let conflictRaised = false;
  let rotationSequence = 0;
  let snapshotFailure = false;
  let delayRevokedResponse = false;
  let delayedRevokedResponse = false;
  let delayedAliceOptions = false;
  let firstResponseDropped = false;
  let firstHttp503 = false;
  let firstOverloadedPoll = false;
  const acceptedKeys = new Map<string, {
    kind: string; expectedRevision: number; destinationStreetId?: string;
  }>();
  const auditEvents: Array<{
    revision: number; round: number; kind: string; actorId: string;
    fromStreetId: string | null; toStreetId: string | null;
  }> = [
    { revision: 0, round: 1, kind: "match-created", actorId: "system",
      fromStreetId: null, toStreetId: null },
  ];
  const observedHeaders: Array<{
    path: string; token: string | undefined; idempotencyKey: string | undefined;
  }> = [];
  const observedPolls: Array<{ status: number; supplied: string | null; etag: string; prefer: string | null }> = [];

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

  const verifiedHistory = () => {
    const past: Record<Seat, string> = { ...startingStreets };
    const used: Record<Seat, boolean> = Object.fromEntries(seats.map(id => [id, false]));
    let turn: Seat | null = seats[0];
    let pastPhase = 0;
    const frames = auditEvents.map(entry => {
      if (entry.kind === "free-move") {
        past[entry.actorId] = entry.toStreetId!;
        used[entry.actorId] = true;
      } else if (entry.kind === "turn-ended") {
        turn = seats[seats.indexOf(entry.actorId) + 1];
      } else if (entry.kind === "round-settlement-pending") {
        turn = null;
        pastPhase = 1;
      }
      return {
        revision: entry.revision, kind: entry.kind, actorId: entry.actorId,
        phase: pastPhase, activePlayerId: turn,
        players: seats.map(playerId => ({
          playerId, streetId: past[playerId], freeMoveUsed: used[playerId],
        })),
      };
    });
    return {
      matchId: snapshot().matchId,
      verifiedRevision: revision,
      frames: options.corruptHistory
        ? frames.map((frame, index) => index === 0
          ? { ...frame, kind: "secret-action" } : frame)
        : frames,
    };
  };

  await page.route("**/api/dev/matches/**", async (route) => {
    // Mirror the server-wide #33 cache policy in browser mocks. Only the
    // full-stack suite can assert the actual ASP.NET Core response headers.
    const reply = (payload: NonNullable<Parameters<typeof route.fulfill>[0]>) =>
      route.fulfill({
        ...payload,
        headers: {
          ...payload.headers,
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const token = request.headers()["x-edonism-dev-token"];
    observedHeaders.push({ path, token, idempotencyKey: request.headers()["idempotency-key"] });

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
      return reply({
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
    if (!seat) {
      if (delayRevokedResponse && !delayedRevokedResponse
        && request.method() === "GET" && !path.endsWith("/hand")
        && !path.endsWith("/turn-options")) {
        delayedRevokedResponse = true;
        await new Promise((resolve) => setTimeout(resolve, 900));
      }
      return reply({ status: 404, json: { code: "match_not_found" } });
    }

    if (path.endsWith("/seat")) {
      if (options.bootstrapUnavailable)
        return reply({ status: 503, json: { code: "unavailable" } });
      const seatHasTurn = phase === 0 && active === seat;
      const adjacent: Record<string, string[]> = {
        gauss: ["planck", "newton", "main-square"],
        planck: ["gauss", "einstein", "meson"],
        einstein: ["newton", "planck", "main-square"],
        newton: ["gauss", "einstein", "boson"],
        meson: ["planck", "boson"],
        boson: ["newton", "meson"],
        "main-square": ["gauss", "einstein"],
      };
      return reply({
        status: 200, headers: { "Cache-Control": "no-store" },
        json: {
          matchId: snapshot().matchId,
          playerId: options.brokenSeatBootstrap === "wrong-player" ? "alice" : seat,
          state: snapshot(),
          hand: {
            matchId: snapshot().matchId,
            playerId: seat,
            cardIds: Array.from({ length: 4 }, (_, index) =>
              `demo:action:${String((seat === "alice" ? 1
                : 21 + (seats.indexOf(seat) - 1) * 4) + index).padStart(2, "0")}`),
          },
          turnOptions: {
            matchId: snapshot().matchId,
            playerId: seat,
            revision: options.brokenSeatBootstrap === "wrong-revision" ? revision + 1 : revision,
            canEndTurn: seatHasTurn,
            freeMoveStreetIds: seatHasTurn && !moved[seat]
              ? adjacent[streets[seat]] ?? [] : [],
          },
        },
      });
    }

    if (path.endsWith("/history")) {
      if (options.historyUnavailable)
        return reply({ status: 503, json: { code: "unavailable" } });
      return reply({ status: 200, json: verifiedHistory() });
    }

    if (path.endsWith("/turn-options")) {
      if (options.delayFirstAliceOptions && seat === "alice" && !delayedAliceOptions) {
        delayedAliceOptions = true;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (options.noTurnOptions)
        return reply({ status: 503, json: { code: "unavailable" } });
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
      return reply({
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
      return reply({
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
      return reply({
        status: 200,
        headers: { "Cache-Control": "no-store" },
        json: { playerId: seat, token: fresh },
      });
    }

    if (request.method() === "GET") {
      const etag = `W/"edonism-revision-${revision}"`;
      if (snapshotFailure) {
        observedPolls.push({ status: 503, supplied: null, etag, prefer: request.headers()["prefer"] ?? null });
        return reply({ status: 503, json: { code: "temporarily_unavailable" } });
      }
      const supplied = request.headers()["if-none-match"] ?? null;
      if (options.overloadFirstConditionalWait && !firstOverloadedPoll
        && supplied === etag && request.headers()["prefer"] === "wait=5") {
        firstOverloadedPoll = true;
        observedPolls.push({ status: 429, supplied, etag, prefer: "wait=5" });
        return reply({ status: 429, headers: { "Retry-After": "1" }, body: "" });
      }
      const status = supplied === etag ? 304 : 200;
      observedPolls.push({ status, supplied, etag, prefer: request.headers()["prefer"] ?? null });
      return reply(status === 304
        ? { status, headers: { ETag: etag, "Cache-Control": "no-store" }, body: "" }
        : { status, headers: { ETag: etag, "Cache-Control": "no-store" }, json: snapshot() });
    }

    const payload = request.postDataJSON() as {
      expectedRevision: number;
      destinationStreetId?: string;
    };
    const key = request.headers()["idempotency-key"];
    const kind = path.endsWith("/free-move") ? "free-move" : "end-turn";
    const receiptId = `${seat}:${key}`;
    const previous = key ? acceptedKeys.get(receiptId) : undefined;
    if (previous) {
      if (previous.kind !== kind || previous.expectedRevision !== payload.expectedRevision
        || previous.destinationStreetId !== payload.destinationStreetId)
        return reply({ status: 409, json: { code: "idempotency_key_reused" } });
      return reply({ status: 200, json: snapshot() });
    }
    if (options.http503FirstEndTurn && kind === "end-turn" && !firstHttp503) {
      firstHttp503 = true;
      return reply({ status: 503, json: { code: "temporarily_unavailable" } });
    }
    const complete = () => {
      if (key) acceptedKeys.set(receiptId, {
        kind, expectedRevision: payload.expectedRevision,
        destinationStreetId: payload.destinationStreetId,
      });
      if (options.dropFirstEndTurnResponse && kind === "end-turn"
        && !firstResponseDropped) {
        firstResponseDropped = true;
        // Server has committed but the HTTP ACK is lost in transit.
        return route.abort("failed");
      }
      return reply({ status: 200, json: snapshot() });
    };

    if (options.conflictOnFirstMove && path.endsWith("/free-move") && !conflictRaised) {
      conflictRaised = true;
      revision = 3; // A competing actor/worker updated the server.
      return reply({ status: 409, json: { code: "revision_conflict" } });
    }

    if (payload.expectedRevision !== revision || active !== seat || phase !== 0) {
      return reply({ status: 409, json: { code: "revision_conflict" } });
    }

    if (path.endsWith("/free-move")) {
      if (moved[seat]) {
        return reply({ status: 409, json: { code: "free_move_already_used" } });
      }
      const neighbors: Record<string, string[]> = {
        gauss: ["planck", "newton", "main-square"],
        planck: ["gauss", "einstein", "meson"],
        einstein: ["newton", "planck", "main-square"],
      };
      if (!(neighbors[streets[seat]] ?? []).includes(payload.destinationStreetId ?? "")) {
        return reply({ status: 409, json: { code: "not_adjacent" } });
      }
      const fromStreet = streets[seat];
      streets[seat] = payload.destinationStreetId!;
      moved[seat] = true;
      revision++;
      auditEvents.push({ revision, round: 1, kind: "free-move",
        actorId: seat, fromStreetId: fromStreet, toStreetId: streets[seat] });
      return complete();
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
      return complete();
    }

    return reply({ status: 404 });
  });

  return {
    observedHeaders,
    observedPolls,
    setSnapshotFailure: (value: boolean) => { snapshotFailure = value; },
    delayNextRevokedSnapshot: () => { delayRevokedResponse = true; },
    didDelayRevokedSnapshot: () => delayedRevokedResponse,
    // Invalidate a seat as if another browser had rotated its bearer.
    // The old token never receives the replacement by polling.
    revokeSeat: (seat: Seat) => {
      const previous = [...tokenToSeat.entries()].find(([, id]) => id === seat)?.[0];
      expect(previous).toBeTruthy();
      tokenToSeat.delete(previous!);
      rotationSequence++;
      const fresh = "F".repeat(62)
        + (seats.indexOf(seat) + 1).toString(16).toUpperCase()
        + (rotationSequence % 16).toString(16).toUpperCase();
      tokenToSeat.set(fresh, seat);
      return fresh;
    },
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

test("a delayed option response for Alice cannot enable actions on Bob's seat", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { delayFirstAliceOptions: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect.poll(() => observedHeaders.some(({ path, token }) =>
    path.endsWith("/turn-options") && token === "a".repeat(64))).toBe(true);
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await expect(page.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
  await expect.poll(() => observedHeaders.some(({ path, token }) =>
    path.endsWith("/turn-options") && token === "b".repeat(64))).toBe(true);
  // Delayed Alice response may arrive after Bob's options; it cannot alter
  // the active actor or grant Bob a command before his turn.
  await page.waitForTimeout(1150);
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await expect(page.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
  await page.getByTestId("dev-seat-alice").click();
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
});

test("authorized conditional polling uses 304 until a second actor changes the revision", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { observedPolls, advanceOtherActor } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect.poll(() => observedPolls.some(p => p.status === 200 && p.etag ===
    'W/"edonism-revision-0"'), { timeout: 10000 }).toBe(true);
  await expect.poll(() => observedPolls.some(p => p.status === 304 && p.supplied ===
    'W/"edonism-revision-0"'), { timeout: 10000 }).toBe(true);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  advanceOtherActor();
  // Simulate focus returning after a background tab: refresh immediately.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByTestId("dev-revision")).toHaveText("1", { timeout: 10000 });
  await expect.poll(() => observedPolls.some(p => p.status === 200 && p.supplied ===
    'W/"edonism-revision-0"' && p.etag === 'W/"edonism-revision-1"'),
  { timeout: 10000 }).toBe(true);
  await expect.poll(() => observedPolls.some(p => p.status === 304 && p.supplied ===
    'W/"edonism-revision-1"'), { timeout: 10000 }).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  const keys = await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)]);
  expect(keys.some(k => /match|token|etag/i.test(k))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
});

test("revoked single-seat join hides private hand and can rejoin with a new bearer", async ({ page }) => {
  const { revokeSeat } = await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  const id = "00000000-0000-0000-0000-000000000020";
  await page.getByTestId("dev-join-id").fill(id);
  await page.getByTestId("dev-join-token").fill("b".repeat(64));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  const freshToken = revokeSeat("bob");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-session")).toHaveCount(0, { timeout: 12000 });
  await expect(page.getByTestId("dev-error")).toContainText("Seat access revoked");
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("match-player-legend")).toHaveCount(0);
  await page.getByTestId("dev-join-id").fill(id);
  await page.getByTestId("dev-join-token").fill(freshToken);
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage), session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain(freshToken);
  expect(JSON.stringify(storage)).not.toContain("b".repeat(64));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
});

test("creator loses only revoked seat, keeping other bearer and match state", async ({ page }) => {
  const { revokeSeat } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  revokeSeat("bob");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-seat-bob")).toHaveCount(0, { timeout: 12000 });
  await expect(page.getByTestId("dev-seat-alice")).toBeVisible();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-hand")).not.toContainText("demo:action:21");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await expect(page.getByTestId("dev-error")).toContainText("revocato");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
});

test("temporary API 503 never discards a valid in-memory seat", async ({ page }) => {
  const { setSnapshotFailure, observedPolls } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-join-id").fill("00000000-0000-0000-0000-000000000020");
  await page.getByTestId("dev-join-token").fill("b".repeat(64));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  setSnapshotFailure(true);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => observedPolls.some((p) => p.status === 503),
    { timeout: 12000 }).toBe(true);
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  setSnapshotFailure(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
});

test("late 404 for old revoked actor cannot invalidate another live seat", async ({ page }) => {
  const { revokeSeat, delayNextRevokedSnapshot, didDelayRevokedSnapshot } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  revokeSeat("alice");
  delayNextRevokedSnapshot();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(didDelayRevokedSnapshot, { timeout: 6000 }).toBe(true);
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await page.waitForTimeout(1250);
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-session")).toBeVisible();
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
});

test("atomic join bootstraps one seat hand and turn permissions without duplicate reads", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-join-id").fill("00000000-0000-0000-0000-000000000020");
  await page.getByTestId("dev-join-token").fill("b".repeat(64));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  const paths = observedHeaders.map((x) => x.path);
  expect(paths.filter((x) => x.endsWith("/seat"))).toHaveLength(1);
  expect(paths.filter((x) => x.endsWith("/hand") || x.endsWith("/turn-options"))).toHaveLength(0);
  expect(observedHeaders.find(x => x.path.endsWith("/seat"))?.token).toBe("b".repeat(64));
  await expect(page.getByTestId("dev-seat-alice")).toHaveCount(0);
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("b".repeat(64));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
});

test("inconsistent or failed atomic bootstrap never installs a session or private hand", async ({ page }) => {
  await mockMatchApi(page, { brokenSeatBootstrap: "wrong-revision" });
  await page.goto("/");
  await page.getByTestId("dev-join-id").fill("00000000-0000-0000-0000-000000000020");
  await page.getByTestId("dev-join-token").fill("b".repeat(64));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-error")).toContainText("Accesso negato");
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await mockMatchApi(page, { brokenSeatBootstrap: "wrong-player" });
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await mockMatchApi(page, { bootstrapUnavailable: true });
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
});

test("mocked private responses remain no-store across creator seat changes", async ({ page }) => {
  const responses: Array<{ path: string; status: number; headers: Record<string, string> }> = [];
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith("/api/dev/matches/"))
      responses.push({ path, status: response.status(), headers: response.headers() });
  });
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-hand")).not.toContainText("demo:action:01");
  await page.getByTestId("dev-seat-alice").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect.poll(() => responses.filter(r => r.path.endsWith("/hand")).length)
    .toBeGreaterThanOrEqual(3);
  const selected = responses.filter(r => r.path.endsWith("/hand")
    || r.path.endsWith("/from-full-deck"));
  expect(selected.some(r => r.status === 201)).toBe(true);
  for (const response of selected) {
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["pragma"]).toBe("no-cache");
    expect(response.headers["expires"]).toBe("0");
  }
  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage), session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain("a".repeat(64));
  expect(JSON.stringify(storage)).not.toContain("b".repeat(64));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("conditional polling uses Prefer wait only for authenticated, known revisions", async ({ page }) => {
  const { observedPolls, advanceOtherActor } = await mockMatchApi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.supplied === null && p.prefer === null),
    { timeout: 8000 }).toBe(true);
  await expect.poll(() => observedPolls.some(p => p.status === 304
    && p.supplied === 'W/"edonism-revision-0"' && p.prefer === "wait=5"),
  { timeout: 9000 }).toBe(true);

  advanceOtherActor();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-revision")).toHaveText("1", { timeout: 10000 });
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.prefer === "wait=5"
      && p.supplied === 'W/"edonism-revision-0"'
      && p.etag === 'W/"edonism-revision-1"'), { timeout: 9000 }).toBe(true);
  await expect.poll(() => observedPolls.some(p =>
    p.status === 304 && p.supplied === 'W/"edonism-revision-1"'
      && p.prefer === "wait=5"), { timeout: 9000 }).toBe(true);
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage), session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain("a".repeat(64));
  expect(JSON.stringify(storage)).not.toContain("b".repeat(64));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("conditional wait preference remains scoped to current bearer after seat rotation", async ({ page }) => {
  const { observedPolls } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect.poll(() => observedPolls.some(p => p.prefer === "wait=5"),
    { timeout: 9000 }).toBe(true);
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  const matches = observedPolls.filter(p => p.supplied !== null && p.prefer !== null);
  expect(matches.every(p => p.prefer === "wait=5")).toBe(true);
});

test("lost HTTP ACK retries end-turn with identical UUID but only one authoritative event", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { dropFirstEndTurnResponse: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-active-player")).toHaveText("bob");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(2);
  const posts = observedHeaders.filter(x => x.path.endsWith("/end-turn"));
  expect(posts).toHaveLength(2);
  expect(posts[0].idempotencyKey).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(posts[1].idempotencyKey).toBe(posts[0].idempotencyKey);
  expect(posts[0].token).toBe(posts[1].token);
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain(posts[0].token);
  expect(JSON.stringify(storage)).not.toContain(posts[0].idempotencyKey);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("HTTP 503 does not retry, mutate, or grant optimistic command success", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { http503FirstEndTurn: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-error")).toBeVisible();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-active-player")).toHaveText("alice");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  const posts = observedHeaders.filter(x => x.path.endsWith("/end-turn"));
  expect(posts).toHaveLength(1);
  expect(posts[0].idempotencyKey).toBeTruthy();
});

test("saturated conditional polling recovers without revoking private hand or retry storm", async ({ page }) => {
  const { observedPolls } = await mockMatchApi(page,
    { overloadFirstConditionalWait: true });
  const throttled: Array<{ status: number; headers: Record<string, string> }> = [];
  page.on("response", response => {
    const path = new URL(response.url()).pathname;
    if (path === "/api/dev/matches/00000000-0000-0000-0000-000000000020"
      && response.status() === 429) {
      throttled.push({ status: response.status(), headers: response.headers() });
    }
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-seat-alice")).toBeVisible();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");

  await expect.poll(() => observedPolls.some(p =>
    p.status === 429 && p.prefer === "wait=5"), { timeout: 10000 }).toBe(true);
  await expect.poll(() => observedPolls.some(p =>
    p.status === 304 && p.prefer === null && p.supplied === 'W/"edonism-revision-0"'),
  { timeout: 10000 }).toBe(true);
  expect(throttled).toHaveLength(1);
  expect(throttled[0].headers["retry-after"]).toBe("1");
  expect(throttled[0].headers["cache-control"]).toBe("no-store");
  expect(throttled[0].headers["pragma"]).toBe("no-cache");
  expect(observedPolls.filter(p => p.status === 429)).toHaveLength(1);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await expect(page.getByTestId("dev-error")).toHaveCount(0);

  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-active-player")).toHaveText("bob");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
  const data = await page.evaluate(() => ({
    url: location.href,
    local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(data)).not.toContain("a".repeat(64));
  expect(JSON.stringify(data)).not.toContain("b".repeat(64));
});

test("verified read-only history scrubs first-round streets without moving the live city", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-history-revision"))
    .toContainText("Historical revision #0");
  await expect(page.getByTestId("dev-history-positions")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", "gauss");
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-history-revision"))
    .toContainText("Historical revision #1");
  await expect(page.getByTestId("dev-history-positions")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", "planck");

  await page.getByTestId("dev-history-previous").click();
  await expect(page.getByTestId("dev-history-revision"))
    .toContainText("Historical revision #0");
  await expect(page.getByTestId("dev-history-positions")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-position")).not.toBeEmpty();
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "planck");
  await expect(page.getByTestId("dev-history-warning"))
    .toContainText("does not change the live match");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-history-next").click();
  await expect(page.getByTestId("dev-history-positions")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", "planck");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-history-revision"))
    .toContainText("Historical revision #2");
  await expect(page.getByTestId("dev-history-active")).toContainText("bob's turn");
  await page.getByTestId("dev-history-previous").click();
  await page.getByTestId("dev-history-previous").click();
  await expect(page.getByTestId("dev-history-positions")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "planck");
  await page.getByTestId("dev-history-latest").click();
  await expect(page.getByTestId("dev-history-revision"))
    .toContainText("Historical revision #2");
  expect(observedHeaders.filter(v => v.path.endsWith("/history")).length)
    .toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("invalid public history fails closed without disabling server-confirmed commands", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { corruptHistory: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-history-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-history-positions")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-history-unavailable")).toBeVisible();
  expect(observedHeaders.some(v => v.path.endsWith("/history"))).toBe(true);
});

test("history is token-bound and creator seat switch discards the prior inspected frame", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
  await page.getByTestId("dev-history-previous").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#0");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  const historyCalls = observedHeaders.filter(v => v.path.endsWith("/history"));
  expect(historyCalls.some(v => v.token === "a".repeat(64))).toBe(true);
  expect(historyCalls.some(v => v.token === "b".repeat(64))).toBe(true);
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
});

test("successful credential rotation resets replay selection without changing live revision", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
  await page.getByTestId("dev-history-previous").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#0");
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "planck");
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  const historyCalls = observedHeaders.filter(v => v.path.endsWith("/history"));
  expect(historyCalls.some(v => v.token === "a".repeat(64))).toBe(true);
  expect(historyCalls.some(v => v.token?.startsWith("F".repeat(62)))).toBe(true);
});
