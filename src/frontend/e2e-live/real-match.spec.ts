import { expect, test, type Page } from "@playwright/test";

type Seat = string;
type PublicPlayer = Readonly<{
  playerId: Seat;
  streetId: string;
  startingSlotId: string;
  freeMoveUsed: boolean;
  hearts: number;
}>;
type PublicMatch = Readonly<{
  matchId: string;
  revision: number;
  round: number;
  phase: number;
  activePlayerId: Seat | null;
  players: readonly PublicPlayer[];
  boardActivities: readonly { slotId: string; cardId: string; category: string }[];
  controlledActivities: readonly { slotId: string; ownerPlayerId: Seat; posture: number }[];
  grossSalaryQuotes: readonly {
    playerId: Seat; baseAtoms: number; standingActivityAtoms: number; grossAtoms: number
  }[];
  assignedCharacters: readonly { playerId: Seat; characterId: string }[];
  turnOrder: readonly Seat[];
  proposedNextRoundOrder: readonly Seat[];
  events: readonly {
    revision: number;
    round: number;
    kind: string;
    actorId: string;
    fromStreetId: string | null;
    toStreetId: string | null;
  }[];
}>;
type CreatedMatch = Readonly<{
  matchId: string;
  state: PublicMatch;
  credentials: readonly { playerId: Seat; token: string }[];
}>;
type Hand = Readonly<{ matchId: string; playerId: Seat; cardIds: readonly string[] }>;

/**
 * Unlike e2e/development-match.spec.ts, these tests DO NOT mock fetch.
 * The UI talks to the real ASP.NET Core Development API via the Vite proxy.
 * Run only after starting .NET on 127.0.0.1:5080.
 */
async function startRealMatch(page: Page): Promise<CreatedMatch> {
  await page.goto("/");
  await expect(page.getByTestId("dev-match-lab")).toBeVisible();
  const created = page.waitForResponse(
    (res) => new URL(res.url()).pathname === "/api/dev/matches/from-full-deck"
      && res.request().method() === "POST",
  );
  await page.getByTestId("dev-create").click();
  const response = await created;
  expect(response.status(), "Real Development API should create a full-deck fixture").toBe(201);
  const match = (await response.json()) as CreatedMatch;
  expect(match.credentials).toHaveLength(2);
  expect(match.state.players).toHaveLength(2);
  await expect(page.getByTestId("dev-session")).toBeVisible();
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("dev-audit-event-0")).toHaveAttribute(
    "data-event-kind", "match-created");
  await expect(page.getByTestId("dev-next-order").locator("li"))
    .toHaveText(match.state.proposedNextRoundOrder.map((id, i) => `${i + 1}.${id}`));
  // These labels are derived from the same public snapshot as the 3D pawns.
  await expect(page.getByTestId("match-player-legend")).toBeVisible();
  await expect(page.getByTestId("match-activity-roster")).toBeVisible();
  expect(match.state.boardActivities).toHaveLength(30);
  expect(match.state.controlledActivities).toHaveLength(2);
  await expect(page.getByTestId("match-board-card-count")).toContainText("30");
  for (const control of match.state.controlledActivities) {
    const lot = page.getByTestId(`controlled-lot-${control.slotId}`);
    const card = match.state.boardActivities.find((a) => a.slotId === control.slotId);
    expect(card).toBeDefined();
    await expect(lot).toHaveAttribute("data-owner-id", control.ownerPlayerId);
    await expect(lot).toHaveAttribute("data-card-id", card!.cardId);
    await expect(lot).toHaveAttribute("data-posture", control.posture === 0 ? "standing" : "fallen");
  }
  for (const quote of match.state.grossSalaryQuotes) {
    await expect(page.getByTestId(`gross-salary-${quote.playerId}`))
      .toHaveAttribute("data-gross-atoms", String(quote.grossAtoms));
  }
  for (const player of match.state.players) {
    await expect(page.getByTestId(`match-player-${player.playerId}`))
      .toHaveAttribute("data-street-id", player.streetId);
  }
  return match;
}

function tokenFor(match: CreatedMatch, seat: Seat): string {
  const token = match.credentials.find((item) => item.playerId === seat)?.token;
  expect(token).toMatch(/^[A-F0-9]{64}$/);
  return token!;
}

function auth(token: string) {
  return { "X-Edonism-Dev-Token": token };
}

test("real .NET + React: server draws a match, moves two players and stops before settlement", async ({
  page,
  request,
}) => {
  const created = await startRealMatch(page);
  const { matchId } = created;
  expect(created.state.boardActivities).toHaveLength(30);
  expect(created.state.assignedCharacters).toHaveLength(2);
  expect(created.state.players.map((p) => p.playerId)).toEqual(["alice", "bob"]);
  expect(created.state.revision).toBe(0);

  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const aliceStart = created.state.players[0].streetId;
  const aliceStreet = page.getByTestId("dev-position");
  await expect(aliceStreet).toBeVisible();
  await expect(page.getByTestId("dev-active-player")).toHaveText("alice");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");

  // Click an adjacent street chosen by the real board. Do not predict
  // positions from a browser-only mock or from a UI hard-coded value.
  const moveAlice = page.locator('[data-testid^="dev-move-"]:not([disabled])').first();
  const aliceDestination = (await moveAlice.getAttribute("data-testid"))!.replace("dev-move-", "");
  expect(aliceDestination).not.toBe(aliceStart);
  await moveAlice.click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-position")).not.toBeEmpty();
  const aliceRead = await request.get(`http://127.0.0.1:5080/api/dev/matches/${matchId}`, {
    headers: auth(aliceToken),
  });
  expect(aliceRead.status()).toBe(200);
  const afterMove = (await aliceRead.json()) as PublicMatch;
  expect(afterMove.players[0].streetId).toBe(aliceDestination);
  await expect(page.getByTestId("match-player-alice"))
    .toHaveAttribute("data-street-id", aliceDestination);
  expect(afterMove.players[0].freeMoveUsed).toBe(true);
  expect(afterMove.events).toHaveLength(2);
  await expect(page.getByTestId("dev-audit-event-1")).toHaveAttribute(
    "data-event-kind", "free-move");
  await expect(page.getByTestId("dev-audit-event-1")).toContainText("alice");
  expect(afterMove.players[0].startingSlotId).toBe(created.state.players[0].startingSlotId);
  expect(afterMove.controlledActivities).toEqual(created.state.controlledActivities);
  expect(afterMove.grossSalaryQuotes).toEqual(created.state.grossSalaryQuotes);
  for (const control of afterMove.controlledActivities) {
    await expect(page.getByTestId(`controlled-lot-${control.slotId}`))
      .toHaveAttribute("data-owner-id", control.ownerPlayerId);
  }
  await expect(page.getByTestId("dev-move-" + aliceDestination)).toHaveCount(0);

  // A second free move is forbidden by the .NET Domain even with a valid token.
  const extraMove = await request.post(
    `http://127.0.0.1:5080/api/dev/matches/${matchId}/free-move`,
    { headers: auth(aliceToken), data: { destinationStreetId: aliceStart, expectedRevision: 1 } },
  );
  expect(extraMove.status()).toBe(409);
  expect((await extraMove.json()).code).toBe("free_move_already_used");

  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  await expect(page.getByTestId("dev-active-player")).toHaveText("bob");
  await page.getByTestId("dev-seat-bob").click();

  const moveBob = page.locator('[data-testid^="dev-move-"]:not([disabled])').first();
  const bobDestination = (await moveBob.getAttribute("data-testid"))!.replace("dev-move-", "");
  await moveBob.click();
  await expect(page.getByTestId("dev-revision")).toHaveText("3");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("4");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();

  const finalRead = await request.get(`http://127.0.0.1:5080/api/dev/matches/${matchId}`, {
    headers: auth(bobToken),
  });
  expect(finalRead.status()).toBe(200);
  const final = (await finalRead.json()) as PublicMatch;
  expect(final.phase).toBe(1);
  expect(final.activePlayerId).toBeNull();
  expect(final.round).toBe(1);
  expect(final.players[1].streetId).toBe(bobDestination);
  await expect(page.getByTestId("match-player-bob"))
    .toHaveAttribute("data-street-id", bobDestination);
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "false");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "false");
  expect(final.revision).toBe(4);
  expect(final.events.map((e) => e.kind)).toEqual([
    "match-created", "free-move", "turn-ended", "free-move", "round-settlement-pending",
  ]);
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(final.events.length);
  await expect(page.getByTestId("dev-audit-event-4"))
    .toHaveAttribute("data-event-kind", "round-settlement-pending");
  expect(final.controlledActivities).toEqual(created.state.controlledActivities);
  expect(final.grossSalaryQuotes).toEqual(created.state.grossSalaryQuotes);
  expect(final.boardActivities).toEqual(created.state.boardActivities);
});

test("real .NET: token isolation, secret hand privacy and no token in browser storage", async ({
  page,
  request,
}) => {
  const created = await startRealMatch(page);
  const { matchId } = created;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const origin = "http://127.0.0.1:5080";

  const unauthorized = await request.get(`${origin}/api/dev/matches/${matchId}/hand`);
  expect(unauthorized.status()).toBe(404);
  const forged = await request.get(`${origin}/api/dev/matches/${matchId}/hand`, {
    headers: auth("0".repeat(64)),
  });
  expect(forged.status()).toBe(404);

  const aliceResponse = await request.get(`${origin}/api/dev/matches/${matchId}/hand`, {
    headers: auth(aliceToken),
  });
  const bobResponse = await request.get(`${origin}/api/dev/matches/${matchId}/hand?playerId=alice`, {
    headers: auth(bobToken),
  });
  expect(aliceResponse.status()).toBe(200);
  expect(bobResponse.status()).toBe(200);
  const aliceHand = (await aliceResponse.json()) as Hand;
  const bobHand = (await bobResponse.json()) as Hand;
  expect(aliceHand.playerId).toBe("alice");
  expect(bobHand.playerId).toBe("bob");
  expect(aliceHand.cardIds).toHaveLength(4);
  expect(bobHand.cardIds).toHaveLength(4);
  expect(new Set([...aliceHand.cardIds, ...bobHand.cardIds]).size).toBe(8);

  const publicResponse = await request.get(`${origin}/api/dev/matches/${matchId}`, {
    headers: auth(aliceToken),
  });
  const publicJson = await publicResponse.text();
  expect(publicResponse.status()).toBe(200);
  for (const card of [...aliceHand.cardIds, ...bobHand.cardIds]) {
    expect(publicJson).not.toContain(card);
  }
  expect(publicJson).not.toContain("remainingDrawPile");
  expect(publicJson).not.toContain("cardIds");

  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-hand")).toContainText(aliceHand.cardIds[0]);
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-hand")).toContainText(bobHand.cardIds[0]);
  for (const card of aliceHand.cardIds) {
    await expect(page.getByTestId("dev-hand")).not.toContainText(card);
  }

  const storage = await page.evaluate(() => ({
    local: Object.values(window.localStorage),
    session: Object.values(window.sessionStorage),
    location: window.location.href,
  }));
  for (const token of [aliceToken, bobToken]) {
    expect([...storage.local, ...storage.session, storage.location].join("|")).not.toContain(token);
    expect((await page.locator("body").innerText())).not.toContain(token);
  }
});

test("real .NET rejects stale revisions and out-of-turn commands without mutation", async ({
  page,
  request,
}) => {
  const created = await startRealMatch(page);
  const { matchId } = created;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const url = `http://127.0.0.1:5080/api/dev/matches/${matchId}`;

  const notYourTurn = await request.post(`${url}/end-turn`, {
    headers: auth(bobToken),
    data: { expectedRevision: 0 },
  });
  expect(notYourTurn.status()).toBe(409);
  expect((await notYourTurn.json()).code).toBe("not_your_turn");

  const invalid = await request.post(`${url}/free-move`, {
    headers: auth(aliceToken),
    data: { destinationStreetId: "not-a-printed-street", expectedRevision: 0 },
  });
  expect(invalid.status()).toBe(409);
  expect((await invalid.json()).code).toBe("unknown_street");

  const accepted = await request.post(`${url}/end-turn`, {
    headers: auth(aliceToken),
    data: { expectedRevision: 0 },
  });
  expect(accepted.status()).toBe(200);

  const stale = await request.post(`${url}/end-turn`, {
    headers: auth(bobToken),
    data: { expectedRevision: 0 },
  });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).code).toBe("revision_conflict");

  const read = await request.get(url, { headers: auth(bobToken) });
  const state = (await read.json()) as PublicMatch;
  expect(state.revision).toBe(1); // only one successful command
  expect(state.activePlayerId).toBe("bob");
  expect(state.phase).toBe(0);
  expect(state.players[0].freeMoveUsed).toBe(false);
  expect(state.controlledActivities).toEqual(created.state.controlledActivities);
  expect(state.grossSalaryQuotes).toEqual(created.state.grossSalaryQuotes);

  // With #25 the browser is no longer reliably stale: authenticated
  // background polling learns that Alice ended her turn and disables her
  // command, instead of sending an unnecessary 409-producing mutation.
  // The direct HTTP checks above still assert server-side 409 semantics;
  // the mocked UI suite exercises the separate 409 recovery path.
  await expect(page.getByTestId("dev-revision")).toHaveText("1", { timeout: 12000 });
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await expect(page.getByTestId("dev-audit-event-1"))
    .toHaveAttribute("data-event-kind", "turn-ended");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "false");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("match-player-alice"))
    .toHaveAttribute("data-street-id", state.players[0].streetId);
  for (const control of state.controlledActivities) {
    await expect(page.getByTestId(`controlled-lot-${control.slotId}`))
      .toHaveAttribute("data-owner-id", control.ownerPlayerId);
  }
});

test("real .NET Development audit verification matches the browser history and rejects missing credentials", async ({
  page, request,
}) => {
  const created = await startRealMatch(page);
  const { matchId } = created;
  const path = `http://127.0.0.1:5080/api/dev/matches/${matchId}/audit`;
  const anonymous = await request.get(path);
  expect(anonymous.status()).toBe(404);
  const invented = await request.get(path, { headers: auth("0".repeat(64)) });
  expect(invented.status()).toBe(404);

  const token = tokenFor(created, "alice");
  const initial = await request.get(path, { headers: auth(token) });
  expect(initial.status()).toBe(200);
  const initialReport = await initial.json() as {
    isValid: boolean; verifiedRevision: number; activePlayerId: string;
  };
  expect(initialReport.isValid).toBe(true);
  expect(initialReport.verifiedRevision).toBe(0);
  expect(initialReport.activePlayerId).toBe("alice");

  await page.locator('[data-testid^="dev-move-"]:not([disabled])').first().click();
  await expect(page.getByTestId("dev-audit-event-1"))
    .toHaveAttribute("data-event-kind", "free-move");
  const audited = await request.get(path + "?playerId=bob", { headers: auth(token) });
  expect(audited.status()).toBe(200);
  const report = await audited.json() as {
    isValid: boolean; verifiedRevision: number;
    players: readonly { playerId: string; streetId: string; freeMoveUsed: boolean }[];
  };
  expect(report.isValid).toBe(true);
  expect(report.verifiedRevision).toBe(1);
  const publicState = await request.get(
    `http://127.0.0.1:5080/api/dev/matches/${matchId}`, { headers: auth(token) });
  expect(publicState.status()).toBe(200);
  const state = await publicState.json() as PublicMatch;
  expect(report.verifiedRevision).toBe(state.revision);
  expect(state.events).toHaveLength(2);
  expect(report.players.map((p) => p.streetId))
    .toEqual(state.players.map((p) => p.streetId));
  const text = await audited.text();
  expect(text).not.toContain(token);
  expect(text).not.toContain("cardIds");
  expect(text).not.toContain("demo:action:");
});

test("two real isolated browsers join one .NET match and observe each other's turns", async ({ browser }) => {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alice = await aliceContext.newPage();
    const bob = await bobContext.newPage();
    const created = await startRealMatch(alice);
    const aliceToken = tokenFor(created, "alice");
    const bobToken = tokenFor(created, "bob");
    await bob.goto("/");
    await bob.getByTestId("dev-join-id").fill(created.matchId);
    await bob.getByTestId("dev-join-token").fill(bobToken);
    await bob.getByTestId("dev-join").click();
    await expect(bob.getByTestId("dev-session")).toBeVisible();
    await expect(bob.getByTestId("dev-seat-bob")).toBeVisible();
    await expect(bob.getByTestId("dev-seat-alice")).toHaveCount(0);
    await expect(bob.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    await expect(alice.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    const aliceCards = await alice.getByTestId("dev-hand").locator("li").allTextContents();
    const bobCards = await bob.getByTestId("dev-hand").locator("li").allTextContents();
    expect(aliceCards).toHaveLength(4);
    expect(bobCards).toHaveLength(4);
    expect(new Set([...aliceCards, ...bobCards]).size).toBe(8);
    for (const card of aliceCards) {
      await expect(bob.getByTestId("dev-hand")).not.toContainText(card);
    }
    await expect(bob.getByTestId("dev-revision")).toHaveText("0");
    await expect(bob.getByTestId("dev-end-turn")).toBeDisabled();

    // Alice moves in browser A; browser B observes it through authenticated
    // polling, not through a shared browser session or a test HTTP mock.
    const aliceMove = alice.locator('[data-testid^="dev-move-"]:not([disabled])').first();
    const firstDestination = (await aliceMove.getAttribute("data-testid"))!.slice("dev-move-".length);
    await aliceMove.click();
    await expect(alice.getByTestId("dev-revision")).toHaveText("1");
    await expect(bob.getByTestId("dev-revision")).toHaveText("1", { timeout: 12000 });
    await expect(bob.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", firstDestination);

    await alice.getByTestId("dev-end-turn").click();
    await expect(bob.getByTestId("dev-active-player")).toHaveText("bob", { timeout: 12000 });
    await expect(bob.getByTestId("dev-revision")).toHaveText("2", { timeout: 12000 });
    await expect(bob.getByTestId("dev-end-turn")).toBeEnabled();
    await expect(alice.getByTestId("dev-end-turn")).toBeDisabled();

    const bobMove = bob.locator('[data-testid^="dev-move-"]:not([disabled])').first();
    const secondDestination = (await bobMove.getAttribute("data-testid"))!.slice("dev-move-".length);
    await bobMove.click();
    await expect(bob.getByTestId("dev-revision")).toHaveText("3");
    await expect(alice.getByTestId("dev-revision")).toHaveText("3", { timeout: 12000 });
    await expect(alice.getByTestId("match-player-bob")).toHaveAttribute("data-street-id", secondDestination);

    await bob.getByTestId("dev-end-turn").click();
    await expect(alice.getByTestId("dev-revision")).toHaveText("4", { timeout: 12000 });
    await expect(alice.getByTestId("dev-audit-event-4"))
      .toHaveAttribute("data-event-kind", "round-settlement-pending");
    await expect(bob.getByTestId("dev-end-turn")).toBeDisabled();

    for (const [page, token] of [[alice, aliceToken], [bob, bobToken]] as const) {
      const values = await page.evaluate(() => ({
        local: Object.values(localStorage),
        session: Object.values(sessionStorage),
        url: location.href,
      }));
      expect(JSON.stringify(values)).not.toContain(token);
      expect(await page.getByTestId("dev-session").textContent()).not.toContain(token);
    }
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

test("real .NET eight-seat match supports private join and all sequential turns", async ({
  page, browser, request,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("dev-player-count")).toHaveValue("2");
  await page.getByTestId("dev-player-count").selectOption("8");
  const creation = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/from-full-deck")
      && response.request().method() === "POST");
  await page.getByTestId("dev-create").click();
  const response = await creation;
  expect(response.status()).toBe(201);
  const created = await response.json() as CreatedMatch;
  const seatIds = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
  expect(created.state.players.map((p) => p.playerId)).toEqual(seatIds);
  expect(created.credentials.map((p) => p.playerId)).toEqual(seatIds);
  expect(created.state.boardActivities).toHaveLength(30);
  expect(created.state.controlledActivities).toHaveLength(8);
  expect(created.state.assignedCharacters).toHaveLength(8);
  expect(created.state.grossSalaryQuotes).toHaveLength(8);
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(8);
  await expect(page.getByTestId("match-activity-roster").locator("li[data-owner-id]")).toHaveCount(8);

  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    const guestToken = tokenFor(created, "heidi");
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(created.matchId);
    await guest.getByTestId("dev-join-token").fill(guestToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-session")).toBeVisible();
    await expect(guest.getByTestId("dev-seat-heidi")).toBeVisible();
    await expect(guest.getByTestId("dev-seat-alice")).toHaveCount(0);
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    const heidiHand = await guest.getByTestId("dev-hand").locator("li").allTextContents();

    const origin = `http://127.0.0.1:5080/api/dev/matches/${created.matchId}`;
    const hands: string[] = [];
    for (const seat of seatIds) {
      const secret = tokenFor(created, seat);
      const handResponse = await request.get(`${origin}/hand`, { headers: auth(secret) });
      expect(handResponse.status()).toBe(200);
      const hand = await handResponse.json() as Hand;
      expect(hand.playerId).toBe(seat);
      expect(hand.cardIds).toHaveLength(4);
      hands.push(...hand.cardIds);
    }
    expect(new Set(hands).size).toBe(32);
    const publicResponse = await request.get(origin, {
      headers: auth(tokenFor(created, "alice")),
    });
    expect(publicResponse.status()).toBe(200);
    const publicJson = await publicResponse.text();
    for (const card of hands) expect(publicJson).not.toContain(card);
    for (const card of hands.slice(0, 4)) {
      await expect(guest.getByTestId("dev-hand")).not.toContainText(card);
    }
    expect(heidiHand).toHaveLength(4);

    for (const [revision, seat] of seatIds.entries()) {
      const done = await request.post(`${origin}/end-turn`, {
        headers: auth(tokenFor(created, seat)), data: { expectedRevision: revision },
      });
      expect(done.status(), `turn ${revision + 1} by ${seat}`).toBe(200);
      const updated = await done.json() as PublicMatch;
      expect(updated.revision).toBe(revision + 1);
      expect(updated.activePlayerId).toBe(seatIds[revision + 1] ?? null);
    }
    await expect(page.getByTestId("dev-revision")).toHaveText("8", { timeout: 12000 });
    await expect(guest.getByTestId("dev-revision")).toHaveText("8", { timeout: 12000 });
    await expect(guest.getByTestId("dev-active-player")).not.toHaveText("heidi");
    const final = await request.get(origin, { headers: auth(guestToken) });
    const state = await final.json() as PublicMatch;
    expect(state.phase).toBe(1);
    expect(state.events).toHaveLength(9);
    expect(state.events.at(-1)?.kind).toBe("round-settlement-pending");

    const storage = await guest.evaluate(() => ({
      url: location.href, local: Object.values(localStorage), session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(storage)).not.toContain(guestToken);
    expect(await guest.locator("body").innerText()).not.toContain(guestToken);
  } finally {
    await guestContext.close();
  }
});

test("real .NET: joined browser rotates only its own Development seat token", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const oldBob = tokenFor(created, "bob");
  const aliceToken = tokenFor(created, "alice");
  const api = `http://127.0.0.1:5080/api/dev/matches/${created.matchId}`;
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(created.matchId);
    await guest.getByTestId("dev-join-token").fill(oldBob);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-seat-bob")).toBeVisible();
    await expect(guest.getByTestId("dev-seat-alice")).toHaveCount(0);
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    const oldHand = await guest.getByTestId("dev-hand").locator("li").allTextContents();

    const rotation = guest.waitForResponse((res) =>
      new URL(res.url()).pathname.endsWith("/rotate-token") && res.request().method() === "POST");
    await guest.getByTestId("dev-rotate-token").click();
    const tokenResponse = await rotation;
    expect(tokenResponse.status()).toBe(200);
    const newCredential = await tokenResponse.json() as { playerId: string; token: string };
    expect(newCredential.playerId).toBe("bob");
    expect(newCredential.token).toMatch(/^[A-F0-9]{64}$/);
    expect(newCredential.token).not.toBe(oldBob);
    await expect(guest.getByTestId("dev-rotation-notice")).toBeVisible();
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    expect(await guest.getByTestId("dev-hand").locator("li").allTextContents()).toEqual(oldHand);

    for (const url of [api, `${api}/hand`, `${api}/audit`]) {
      const stale = await request.get(url, { headers: auth(oldBob) });
      expect(stale.status()).toBe(404);
    }
    const staleTurn = await request.post(`${api}/end-turn`, {
      headers: auth(oldBob), data: { expectedRevision: 0 },
    });
    expect(staleTurn.status()).toBe(404);
    const newRead = await request.get(api, { headers: auth(newCredential.token) });
    expect(newRead.status()).toBe(200);
    const before = await newRead.json() as PublicMatch;
    expect(before.revision).toBe(0);
    expect(before.events).toHaveLength(1);
    const aliceRead = await request.get(api, { headers: auth(aliceToken) });
    expect(aliceRead.status()).toBe(200);

    await page.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-active-player")).toHaveText("bob", { timeout: 12000 });
    await guest.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("2");
    const final = await request.get(api, { headers: auth(newCredential.token) });
    const state = await final.json() as PublicMatch;
    expect(state.phase).toBe(1);
    expect(state.revision).toBe(2);
    expect(state.events.map((e) => e.kind)).toEqual([
      "match-created", "turn-ended", "round-settlement-pending",
    ]);
    const storage = await guest.evaluate(() => ({
      local: Object.values(localStorage), session: Object.values(sessionStorage), url: location.href,
    }));
    expect(JSON.stringify(storage)).not.toContain(newCredential.token);
    expect(await guest.locator("body").innerText()).not.toContain(newCredential.token);
  } finally {
    await guestContext.close();
  }
});

test("real .NET Domain turn-options control what two browsers may send", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const api = `http://127.0.0.1:5080/api/dev/matches/${created.matchId}`;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const aliceOptions = await request.get(`${api}/turn-options?playerId=bob`, {
    headers: auth(aliceToken),
  });
  expect(aliceOptions.status()).toBe(200);
  expect(aliceOptions.headers()["cache-control"]).toContain("no-store");
  const initial = await aliceOptions.json() as {
    playerId: string; revision: number; canEndTurn: boolean; freeMoveStreetIds: string[];
  };
  expect(initial.playerId).toBe("alice");
  expect(initial.revision).toBe(0);
  expect(initial.canEndTurn).toBe(true);
  expect(initial.freeMoveStreetIds.length).toBeGreaterThan(0);
  const denied = await request.get(`${api}/turn-options`);
  expect(denied.status()).toBe(404);

  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(created.matchId);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-seat-bob")).toBeVisible();
    await expect(guest.getByTestId("dev-end-turn")).toBeDisabled();
    await expect(guest.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
    await expect(page.getByTestId(`dev-move-${initial.freeMoveStreetIds[0]}`)).toBeEnabled();
    await page.getByTestId(`dev-move-${initial.freeMoveStreetIds[0]}`).click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
    const used = await request.get(`${api}/turn-options`, { headers: auth(aliceToken) });
    const usedOptions = await used.json() as typeof initial;
    expect(usedOptions.revision).toBe(1);
    expect(usedOptions.canEndTurn).toBe(true);
    expect(usedOptions.freeMoveStreetIds).toEqual([]);
    await page.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("2", { timeout: 12000 });
    await expect(guest.getByTestId("dev-end-turn")).toBeEnabled();
    await guest.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("3", { timeout: 12000 });
    const finished = await request.get(`${api}/turn-options`, { headers: auth(bobToken) });
    const after = await finished.json() as typeof initial;
    expect(after.canEndTurn).toBe(false);
    expect(after.freeMoveStreetIds).toEqual([]);
  } finally {
    await context.close();
  }
});

test("real .NET conditional snapshots: 304 authorized, revision update and browser polling", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const api = `http://127.0.0.1:5080/api/dev/matches/${created.matchId}`;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const first = await request.get(api, { headers: auth(aliceToken) });
  expect(first.status()).toBe(200);
  const etag = first.headers()["etag"];
  expect(etag).toBe('W/"edonism-revision-0"');
  expect(first.headers()["cache-control"]).toContain("no-store");

  const unchanged = await request.get(api, {
    headers: { ...auth(bobToken), "If-None-Match": etag },
  });
  expect(unchanged.status()).toBe(304);
  expect((await unchanged.body()).length).toBe(0);
  const unauthenticated = await request.get(api, { headers: { "If-None-Match": etag } });
  expect(unauthenticated.status()).toBe(404);

  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    const polls: Array<{ path: string; tag: string | undefined }> = [];
    guest.on("request", req => {
      if (new URL(req.url()).pathname === `/api/dev/matches/${created.matchId}`
        && req.method() === "GET") {
        polls.push({ path: req.url(), tag: req.headers()["if-none-match"] });
      }
    });
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(created.matchId);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-seat-bob")).toBeVisible();
    await expect.poll(() => polls.some(p => p.tag === etag),
      { timeout: 12000 }).toBe(true);
    await page.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("1", { timeout: 12000 });
    const updated = await request.get(api, {
      headers: { ...auth(bobToken), "If-None-Match": etag },
    });
    expect(updated.status()).toBe(200);
    const nextEtag = updated.headers()["etag"];
    expect(nextEtag).toBe('W/"edonism-revision-1"');
    const nextBody = await updated.json() as PublicMatch;
    expect(nextBody.activePlayerId).toBe("bob");
    await expect.poll(() => polls.some(p => p.tag === nextEtag),
      { timeout: 12000 }).toBe(true);
    const storage = await guest.evaluate(() => ({
      url: location.href, local: Object.values(localStorage), session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(storage)).not.toContain(bobToken);
    expect(JSON.stringify(storage)).not.toContain(nextEtag);
  } finally {
    await guestContext.close();
  }
});

test("real .NET: revoked guest loses visible hand, then rejoins using rotated token", async ({
  page, browser, request,
}) => {
  const match = await startRealMatch(page);
  const previousBob = tokenFor(match, "bob");
  const api = `http://127.0.0.1:5080/api/dev/matches/${match.matchId}`;
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(match.matchId);
    await guest.getByTestId("dev-join-token").fill(previousBob);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    const originalHand = await guest.getByTestId("dev-hand").locator("li").allTextContents();

    await page.getByTestId("dev-seat-bob").click();
    const rotation = page.waitForResponse((res) =>
      new URL(res.url()).pathname.endsWith("/rotate-token")
      && res.request().method() === "POST");
    await page.getByTestId("dev-rotate-token").click();
    const response = await rotation;
    expect(response.status()).toBe(200);
    const credential = await response.json() as { playerId: string; token: string };
    expect(credential.playerId).toBe("bob");
    expect(credential.token).toMatch(/^[A-F0-9]{64}$/);
    expect(credential.token).not.toBe(previousBob);

    const old = await request.get(api, {
      headers: { ...auth(previousBob), "If-None-Match": 'W/"edonism-revision-0"' },
    });
    expect(old.status()).toBe(404);
    await guest.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(guest.getByTestId("dev-session")).toHaveCount(0, { timeout: 12000 });
    await expect(guest.getByTestId("dev-error")).toContainText("revocato");
    await expect(guest.getByTestId("dev-hand")).toHaveCount(0);
    await expect(guest.getByTestId("match-player-legend")).toHaveCount(0);

    await guest.getByTestId("dev-join-id").fill(match.matchId);
    await guest.getByTestId("dev-join-token").fill(credential.token);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-seat-bob")).toBeVisible();
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    expect(await guest.getByTestId("dev-hand").locator("li").allTextContents()).toEqual(originalHand);
    await expect(guest.getByTestId("dev-error")).toHaveCount(0);

    await page.getByTestId("dev-seat-alice").click();
    await page.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-active-player")).toHaveText("bob", { timeout: 12000 });
    await guest.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("2");
    const final = await request.get(api, { headers: auth(credential.token) });
    const state = await final.json() as PublicMatch;
    expect(state.phase).toBe(1);
    expect(state.revision).toBe(2);
    const storage = await guest.evaluate(() => ({
      url: location.href, local: Object.values(localStorage), session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(storage)).not.toContain(credential.token);
    expect(JSON.stringify(storage)).not.toContain(previousBob);
  } finally {
    await guestContext.close();
  }
});

test("real .NET: creator keeps Alice when remote Bob rotates their capability", async ({
  page, browser, request,
}) => {
  const match = await startRealMatch(page);
  const bobToken = tokenFor(match, "bob");
  const aliceToken = tokenFor(match, "alice");
  const api = `http://127.0.0.1:5080/api/dev/matches/${match.matchId}`;
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(match.matchId);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    await page.getByTestId("dev-seat-bob").click();
    await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);

    const rotation = guest.waitForResponse((res) =>
      new URL(res.url()).pathname.endsWith("/rotate-token")
      && res.request().method() === "POST");
    await guest.getByTestId("dev-rotate-token").click();
    const response = await rotation;
    expect(response.status()).toBe(200);
    const credential = await response.json() as { playerId: string; token: string };
    expect(credential.playerId).toBe("bob");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect(page.getByTestId("dev-seat-bob")).toHaveCount(0, { timeout: 12000 });
    await expect(page.getByTestId("dev-seat-alice")).toBeVisible();
    await expect(page.getByTestId("dev-error")).toContainText("revocato");
    await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    const freshHand = await request.get(`${api}/hand`, { headers: auth(aliceToken) });
    const aliceCards = (await freshHand.json() as Hand).cardIds;
    expect(await page.getByTestId("dev-hand").locator("li").allTextContents()).toEqual(aliceCards);

    await page.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-active-player")).toHaveText("bob", { timeout: 12000 });
    await guest.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("2", { timeout: 12000 });
    const state = await request.get(api, { headers: auth(credential.token) });
    const json = await state.json() as PublicMatch;
    expect(json.phase).toBe(1);
    expect(json.events).toHaveLength(3);
    expect(await page.locator("body").innerText()).not.toContain(credential.token);
  } finally {
    await guestContext.close();
  }
});

test("real .NET atomic join provides matching state, private hand and options in one request", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const bobToken = tokenFor(created, "bob");
  const aliceToken = tokenFor(created, "alice");
  const api = `http://127.0.0.1:5080/api/dev/matches/${id}`;

  const denied = await request.get(`${api}/seat`);
  expect(denied.status()).toBe(404);
  const own = await request.get(`${api}/seat?playerId=alice`, { headers: auth(bobToken) });
  expect(own.status()).toBe(200);
  expect(own.headers()["cache-control"]).toContain("no-store");
  const bootstrap = await own.json() as {
    matchId: string; playerId: string; state: PublicMatch; hand: Hand;
    turnOptions: { playerId: string; revision: number; canEndTurn: boolean; freeMoveStreetIds: string[] };
  };
  expect(bootstrap.matchId).toBe(id);
  expect(bootstrap.playerId).toBe("bob");
  expect(bootstrap.hand.playerId).toBe("bob");
  expect(bootstrap.turnOptions.playerId).toBe("bob");
  expect(bootstrap.turnOptions.revision).toBe(bootstrap.state.revision);
  expect(bootstrap.turnOptions.canEndTurn).toBe(false);
  expect(bootstrap.hand.cardIds).toHaveLength(4);
  const raw = await own.text();
  expect(raw).not.toContain(bobToken);
  expect(raw).not.toContain(aliceToken);
  expect(raw).not.toContain("tokenDigests");
  const aliceHand = await request.get(`${api}/hand`, { headers: auth(aliceToken) });
  const aliceCards = (await aliceHand.json() as Hand).cardIds;
  for (const secret of aliceCards) expect(bootstrap.hand.cardIds).not.toContain(secret);

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await context.newPage();
    const requests: string[] = [];
    guest.on("request", req => {
      if (req.url().includes(`/api/dev/matches/${id}/`))
        requests.push(new URL(req.url()).pathname);
    });
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(id);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-seat-bob")).toBeVisible();
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    expect(await guest.getByTestId("dev-hand").locator("li").allTextContents())
      .toEqual(bootstrap.hand.cardIds);
    expect(requests.filter(path => path.endsWith("/seat"))).toHaveLength(1);
    expect(requests.filter(path => path.endsWith("/hand") || path.endsWith("/turn-options")))
      .toHaveLength(0);

    await page.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("1", { timeout: 12000 });
    await expect(guest.getByTestId("dev-end-turn")).toBeEnabled();
    await guest.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("2");
    const updated = await request.get(`${api}/seat`, { headers: auth(bobToken) });
    expect(updated.status()).toBe(200);
    const after = await updated.json() as typeof bootstrap;
    expect(after.state.revision).toBe(2);
    expect(after.turnOptions.revision).toBe(2);
    expect(after.turnOptions.canEndTurn).toBe(false);
    const storage = await guest.evaluate(() => ({
      local: Object.values(localStorage), session: Object.values(sessionStorage), url: location.href,
    }));
    expect(JSON.stringify(storage)).not.toContain(bobToken);
  } finally {
    await context.close();
  }
});

test("real .NET: private bearer issuance, hands, 304 and errors never permit HTTP caching", async ({
  page, request,
}) => {
  const creation = page.waitForResponse(response =>
    new URL(response.url()).pathname === "/api/dev/matches/from-full-deck"
    && response.request().method() === "POST");
  const match = await startRealMatch(page);
  const issued = await creation;
  const check = (headers: Record<string, string>) => {
    expect(headers["cache-control"]).toBe("no-store");
    expect(headers["pragma"]).toBe("no-cache");
    expect(headers["expires"]).toBe("0");
  };
  expect(issued.status()).toBe(201);
  check(issued.headers());
  const aliceToken = tokenFor(match, "alice");
  const bobToken = tokenFor(match, "bob");
  const issueBody = await issued.text();
  expect(issueBody).toContain(aliceToken);
  expect(issueBody).toContain(bobToken);
  const api = `http://127.0.0.1:5080/api/dev/matches/${match.matchId}`;

  const snapshot = await request.get(api, { headers: auth(aliceToken) });
  expect(snapshot.status()).toBe(200);
  check(snapshot.headers());
  const etag = snapshot.headers()["etag"];
  expect(etag).toBe('W/"edonism-revision-0"');
  const unchanged = await request.get(api, {
    headers: { ...auth(aliceToken), "If-None-Match": etag },
  });
  expect(unchanged.status()).toBe(304);
  check(unchanged.headers());
  expect((await unchanged.body()).length).toBe(0);

  for (const suffix of ["/hand", "/seat", "/turn-options", "/audit"]) {
    const own = await request.get(api + suffix, { headers: auth(bobToken) });
    expect(own.status()).toBe(200);
    check(own.headers());
  }

  const wrongTurn = await request.post(api + "/end-turn", {
    headers: auth(bobToken), data: { expectedRevision: 0 },
  });
  expect(wrongTurn.status()).toBe(409);
  check(wrongTurn.headers());
  const finishedAlice = await request.post(api + "/end-turn", {
    headers: auth(aliceToken), data: { expectedRevision: 0 },
  });
  expect(finishedAlice.status()).toBe(200);
  check(finishedAlice.headers());

  const rotate = await request.post(api + "/rotate-token", { headers: auth(bobToken) });
  expect(rotate.status()).toBe(200);
  check(rotate.headers());
  const replacement = await rotate.json() as { playerId: string; token: string };
  expect(replacement.playerId).toBe("bob");
  expect(replacement.token).toMatch(/^[A-F0-9]{64}$/);
  const forbidden = await request.get(api + "/hand", { headers: auth(bobToken) });
  expect(forbidden.status()).toBe(404);
  check(forbidden.headers());
  const newHand = await request.get(api + "/hand", { headers: auth(replacement.token) });
  expect(newHand.status()).toBe(200);
  check(newHand.headers());
  const badFixture = await request.post("http://127.0.0.1:5080/api/dev/matches/from-full-deck", {
    headers: { "Content-Type": "application/json" }, data: "{",
  });
  expect(badFixture.status()).toBe(400);
  check(badFixture.headers());

  const stored = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage), session: Object.values(sessionStorage),
  }));
  for (const token of [aliceToken, bobToken, replacement.token])
    expect(JSON.stringify(stored)).not.toContain(token);
});

test("real .NET long poll: two browsers wake on first-round turn instead of waiting for periodic timeout", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const api = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    const polls: Array<{ tag: string | undefined; prefer: string | undefined }> = [];
    guest.on("request", req => {
      if (new URL(req.url()).pathname === `/api/dev/matches/${id}`
        && req.method() === "GET") {
        polls.push({
          tag: req.headers()["if-none-match"],
          prefer: req.headers()["prefer"],
        });
      }
    });
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(id);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-seat-bob")).toBeVisible();
    await expect.poll(() => polls.some(p => p.tag === 'W/"edonism-revision-0"'
      && p.prefer === "wait=5"), { timeout: 10000 }).toBe(true);

    const responseTask = request.get(api, {
      headers: {
        ...auth(bobToken),
        "If-None-Match": 'W/"edonism-revision-0"',
        Prefer: "wait=5",
      },
      timeout: 9000,
    });
    await page.waitForTimeout(200);
    await page.getByTestId("dev-end-turn").click();
    const changed = await responseTask;
    expect(changed.status()).toBe(200);
    expect(changed.headers()["etag"]).toBe('W/"edonism-revision-1"');
    expect(changed.headers()["cache-control"]).toBe("no-store");
    const state = await changed.json() as PublicMatch;
    expect(state.activePlayerId).toBe("bob");
    expect(state.revision).toBe(1);
    await expect(guest.getByTestId("dev-revision")).toHaveText("1", { timeout: 6000 });
    await expect(guest.getByTestId("dev-end-turn")).toBeEnabled();
    await guest.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("2", { timeout: 6000 });

    const oldTag = await request.get(api, {
      headers: { ...auth(aliceToken), "If-None-Match": 'W/"edonism-revision-0"',
        Prefer: "wait=10" },
      timeout: 5000,
    });
    expect(oldTag.status()).toBe(200);
    expect(oldTag.headers()["etag"]).toBe('W/"edonism-revision-2"');
    const storage = await guest.evaluate(() => ({
      url: location.href, local: Object.values(localStorage), session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(storage)).not.toContain(bobToken);
  } finally {
    await context.close();
  }
});

test("real .NET: lost command ACK is retried with same UUID and commits exactly one turn", async ({
  page, request,
}) => {
  const match = await startRealMatch(page);
  const aliceToken = tokenFor(match, "alice");
  const id = match.matchId;
  const api = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  const commandPath = `/api/dev/matches/${id}/end-turn`;
  const attemptedKeys: string[] = [];
  let intercepted = 0;

  // Unlike the mock UI tests, the first request actually reaches the real
  // .NET API and commits; only the HTTP response is destroyed en route.
  await page.route(`**${commandPath}`, async route => {
    const requestHeaders = route.request().headers();
    attemptedKeys.push(requestHeaders["idempotency-key"] ?? "");
    intercepted++;
    if (intercepted === 1) {
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      await route.abort("failed");
    } else {
      await route.continue();
    }
  });
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1", { timeout: 12000 });
  await expect(page.getByTestId("dev-active-player")).toHaveText("bob");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(2);
  expect(attemptedKeys).toHaveLength(2);
  expect(attemptedKeys[0]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(attemptedKeys[1]).toBe(attemptedKeys[0]);

  const current = await request.get(api, { headers: auth(aliceToken) });
  expect(current.status()).toBe(200);
  const state = await current.json() as PublicMatch;
  expect(state.revision).toBe(1);
  expect(state.events).toHaveLength(2);
  expect(state.events[1].kind).toBe("turn-ended");

  // An explicit third request with the same actor/key/payload is still 200
  // and returns current state without appending an event or second turn.
  const replay = await request.post(`${api}/end-turn`, {
    headers: { ...auth(aliceToken), "Idempotency-Key": attemptedKeys[0] },
    data: { expectedRevision: 0 },
  });
  expect(replay.status()).toBe(200);
  expect(replay.headers()["cache-control"]).toBe("no-store");
  expect((await replay.json() as PublicMatch).revision).toBe(1);

  const wrongPayload = await request.post(`${api}/end-turn`, {
    headers: { ...auth(aliceToken), "Idempotency-Key": attemptedKeys[0] },
    data: { expectedRevision: 1 },
  });
  expect(wrongPayload.status()).toBe(409);
  const repeated = await request.get(api, { headers: auth(aliceToken) });
  const last = await repeated.json() as PublicMatch;
  expect(last.revision).toBe(1);
  expect(last.events).toHaveLength(2);

  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain(aliceToken);
  expect(JSON.stringify(storage)).not.toContain(attemptedKeys[0]);
});

test("real .NET: full Alice long-poll quota returns 429 without starving Bob browser", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const api = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  const waiting = {
    ...auth(aliceToken),
    "If-None-Match": 'W/"edonism-revision-0"',
    Prefer: "wait=5",
  };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await context.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(id);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-seat-bob")).toBeVisible();
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);

    // The creator's own Alice browser can already hold one long poll,
    // so up to three of the following four requests may be pending. A
    // surplus 429 is expected and must never affect Bob's separate quota.
    const all = Array.from({ length: 4 }, () => request.get(api, {
      headers: waiting,
      timeout: 8000,
    }));
    await page.waitForTimeout(450);
    const rejected = await request.get(api, { headers: waiting, timeout: 3000 });
    expect(rejected.status()).toBe(429);
    expect(rejected.headers()["retry-after"]).toBe("1");
    expect(rejected.headers()["cache-control"]).toBe("no-store");
    expect(rejected.headers()["pragma"]).toBe("no-cache");
    expect(rejected.headers()["expires"]).toBe("0");
    expect(rejected.headers()["etag"]).toBeUndefined();
    expect((await rejected.body()).length).toBe(0);

    await page.getByTestId("dev-end-turn").click();
    const done = await Promise.all(all);
    expect(done.filter(r => r.status() === 200).length).toBeGreaterThanOrEqual(3);
    for (const response of done) {
      if (response.status() === 429) {
        // The creator's own in-flight poll may be the fourth subscriber.
        expect(response.headers()["retry-after"]).toBe("1");
        expect(response.headers()["cache-control"]).toBe("no-store");
        expect(response.headers()["etag"]).toBeUndefined();
        continue;
      }
      expect(response.status()).toBe(200);
      expect(response.headers()["etag"]).toBe('W/"edonism-revision-1"');
      expect((await response.json() as PublicMatch).revision).toBe(1);
    }
    await expect(guest.getByTestId("dev-revision")).toHaveText("1", { timeout: 7000 });
    await expect(guest.getByTestId("dev-active-player")).toHaveText("bob");
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    await expect(guest.getByTestId("dev-end-turn")).toBeEnabled();

    const state = await request.get(api, { headers: auth(aliceToken) });
    expect(state.status()).toBe(200);
    const authoritative = await state.json() as PublicMatch;
    expect(authoritative.revision).toBe(1);
    expect(authoritative.events).toHaveLength(2);
    const storage = await guest.evaluate(() => ({
      url: location.href, local: Object.values(localStorage),
      session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(storage)).not.toContain(bobToken);
    expect(JSON.stringify(storage)).not.toContain(aliceToken);
  } finally {
    await context.close();
  }
});

test("real .NET: two browsers inspect verified first-round history without changing live moves", async ({
  page, browser, request,
}) => {
  const match = await startRealMatch(page);
  const id = match.matchId;
  const aliceToken = tokenFor(match, "alice");
  const bobToken = tokenFor(match, "bob");
  const aliceStart = match.state.players.find(p => p.playerId === "alice")!.streetId;
  const api = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await expect(page.getByTestId("dev-history-revision"))
      .toContainText("#0");
    await expect(page.getByTestId("dev-history-positions")
      .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", aliceStart);
    const aliceMove = page.locator('[data-testid^="dev-move-"]:not([disabled])').first();
    const destination = (await aliceMove.getAttribute("data-testid"))!.replace("dev-move-", "");
    await aliceMove.click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
    await expect(page.getByTestId("dev-history-positions")
      .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", destination);
    await page.getByTestId("dev-history-previous").click();
    await expect(page.getByTestId("dev-history-revision")).toContainText("#0");
    await expect(page.getByTestId("dev-history-positions")
      .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", aliceStart);
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", destination);
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("dev-end-turn")).toBeEnabled();

    const guest = await context.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(id);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-seat-bob")).toBeVisible();
    await expect(guest.getByTestId("dev-history-revision")).toContainText("#1");
    await expect(guest.getByTestId("dev-history-positions")
      .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", destination);
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);

    const fromApi = await request.get(api + "/history", { headers: auth(bobToken) });
    expect(fromApi.status()).toBe(200);
    expect(fromApi.headers()["cache-control"]).toBe("no-store");
    const verified = await fromApi.json() as {
      verifiedRevision: number;
      frames: { revision: number; kind: string;
        players: { playerId: string; streetId: string }[] }[];
    };
    expect(verified.verifiedRevision).toBe(1);
    expect(verified.frames.map(f => f.revision)).toEqual([0, 1]);
    expect(verified.frames[0].players.find(p => p.playerId === "alice")?.streetId).toBe(aliceStart);
    expect(verified.frames[1].players.find(p => p.playerId === "alice")?.streetId).toBe(destination);
    expect(JSON.stringify(verified)).not.toContain(aliceToken);
    expect(JSON.stringify(verified)).not.toContain(bobToken);
    expect(JSON.stringify(verified)).not.toContain("cardIds");

    await page.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("2", { timeout: 9000 });
    await expect(guest.getByTestId("dev-history-revision")).toContainText("#2");
    await expect(guest.getByTestId("dev-history-active")).toContainText("bob");
    await guest.getByTestId("dev-history-previous").click();
    await guest.getByTestId("dev-history-previous").click();
    await expect(guest.getByTestId("dev-history-positions")
      .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", aliceStart);
    await expect(guest.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", destination);
    await expect(guest.getByTestId("dev-end-turn")).toBeEnabled();

    const oldHistory = await request.get(api + "/history", { headers: auth(aliceToken) });
    expect(oldHistory.status()).toBe(200);
    const rotate = await request.post(api + "/rotate-token", { headers: auth(aliceToken) });
    expect(rotate.status()).toBe(200);
    const replacement = await rotate.json() as { playerId: string; token: string };
    const revoked = await request.get(api + "/history", { headers: auth(aliceToken) });
    expect(revoked.status()).toBe(404);
    const newHistory = await request.get(api + "/history", { headers: auth(replacement.token) });
    expect(newHistory.status()).toBe(200);
    expect((await newHistory.json()).verifiedRevision).toBe(2);

    const guestStorage = await guest.evaluate(() => ({
      url: location.href, local: Object.values(localStorage),
      session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(guestStorage)).not.toContain(bobToken);
    expect(JSON.stringify(guestStorage)).not.toContain(aliceToken);
    expect(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
      .toBe(false);
  } finally {
    await context.close();
  }
});

test("real .NET: two-browser authenticated seat activity follows heartbeat and revocation", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const presencePath = `http://127.0.0.1:5080/api/dev/matches/${id}/presence`;
  const asState = async (token: string) => {
    const response = await request.get(presencePath, { headers: auth(token) });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const raw = await response.text();
    expect(raw).not.toContain(aliceToken);
    expect(raw).not.toContain(bobToken);
    expect(raw).not.toContain("lastSeen");
    expect(raw).not.toContain("cardIds");
    return JSON.parse(raw) as { matchId: string;
      seats: { playerId: string; isActive: boolean }[] };
  };

  await expect.poll(async () => (await asState(bobToken))
    .seats.find(s => s.playerId === "alice")?.isActive, {
    timeout: 9000,
  }).toBe(true);
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-presence", "active");
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(id);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-seat-bob")).toBeVisible();
    await expect(guest.getByTestId("dev-presence-seats")
      .locator('[data-player-id="bob"]')).toHaveAttribute("data-presence", "active");
    await expect(guest.getByTestId("dev-presence-seats")
      .locator('[data-player-id="alice"]')).toHaveAttribute("data-presence", "active");
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    const both = await asState(bobToken);
    expect(both.seats).toEqual([
      { playerId: "alice", isActive: true },
      { playerId: "bob", isActive: true },
    ]);
    await expect(guest.getByTestId("dev-revision")).toHaveText("0");
    await expect(guest.getByTestId("dev-active-player")).toHaveText("alice");

    const rotated = await request.post(
      `http://127.0.0.1:5080/api/dev/matches/${id}/rotate-token`,
      { headers: auth(aliceToken) });
    expect(rotated.status()).toBe(200);
    const replacement = await rotated.json() as { playerId: string; token: string };
    expect(replacement.playerId).toBe("alice");
    expect(replacement.token).not.toBe(aliceToken);
    const stale = await request.post(presencePath, { headers: auth(aliceToken) });
    expect(stale.status()).toBe(404);
    expect(stale.headers()["cache-control"]).toBe("no-store");
    expect((await asState(bobToken)).seats).toEqual([
      { playerId: "alice", isActive: false },
      { playerId: "bob", isActive: true },
    ]);
    const renewed = await request.post(presencePath, {
      headers: auth(replacement.token),
    });
    expect(renewed.status()).toBe(200);
    expect((await asState(bobToken)).seats.every(s => s.isActive)).toBe(true);
    await expect(guest.getByTestId("dev-revision")).toHaveText("0");
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    const state = await request.get(
      `http://127.0.0.1:5080/api/dev/matches/${id}`,
      { headers: auth(bobToken) });
    expect(state.status()).toBe(200);
    const snapshot = await state.json() as PublicMatch;
    expect(snapshot.revision).toBe(0);
    expect(snapshot.events).toHaveLength(1);
    const storage = await guest.evaluate(() => ({
      url: location.href, local: Object.values(localStorage),
      session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(storage)).not.toContain(bobToken);
    expect(JSON.stringify(storage)).not.toContain(aliceToken);
    expect(await guest.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
      .toBe(false);
  } finally {
    await guestContext.close();
  }
});

test("real .NET + two browsers: leaving a local seat hides secrets without ending the match", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const api = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(id);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);

    await page.getByTestId("dev-leave").click();
    await expect(page.getByTestId("dev-session")).toHaveCount(0);
    await expect(page.getByTestId("dev-hand")).toHaveCount(0);
    await expect(page.getByTestId("match-player-alice")).toHaveCount(0);
    await expect(page.getByTestId("dev-join-token")).toHaveValue("");
    await expect(guest.getByTestId("dev-session")).toBeVisible();
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);

    // No API command is sent by the local UI exit. The old bearer remains
    // valid until explicitly rotated, and the match state is untouched.
    const state = await request.get(api, { headers: auth(aliceToken) });
    expect(state.status()).toBe(200);
    expect(state.headers()["cache-control"]).toBe("no-store");
    const unchanged = await state.json() as PublicMatch;
    expect(unchanged.revision).toBe(0);
    expect(unchanged.events).toHaveLength(1);
    const oldSeat = await request.get(api + "/seat", { headers: auth(aliceToken) });
    expect(oldSeat.status()).toBe(200);
    expect((await oldSeat.json()).hand.playerId).toBe("alice");

    await page.getByTestId("dev-join-id").fill(id);
    await page.getByTestId("dev-join-token").fill(aliceToken);
    await page.getByTestId("dev-join").click();
    await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    const storage = await page.evaluate(() => ({
      url: location.href, local: Object.values(localStorage),
      session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(storage)).not.toContain(aliceToken);
    expect(JSON.stringify(storage)).not.toContain(bobToken);
  } finally {
    await guestContext.close();
  }
});

test("real .NET: malformed command UUID checks bearer before key, including revoked seat", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const root = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  const guestContext = await browser.newContext();
  try {
    const bob = await guestContext.newPage();
    await bob.goto("/");
    await bob.getByTestId("dev-join-id").fill(id);
    await bob.getByTestId("dev-join-token").fill(bobToken);
    await bob.getByTestId("dev-join").click();
    await expect(bob.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    const commands = [
      { kind: "end-turn", data: { expectedRevision: 0 } },
      { kind: "free-move", data: { expectedRevision: 0, destinationStreetId: "planck" } },
    ] as const;

    for (const command of commands) {
      const url = `${root}/${command.kind}`;
      const headers = { "Idempotency-Key": "not-a-uuid" };
      const anonymous = await request.post(url, { headers, data: command.data });
      expect(anonymous.status()).toBe(404);
      expect(anonymous.headers()["cache-control"]).toBe("no-store");
      expect(await anonymous.text()).not.toContain(aliceToken);

      const forged = await request.post(url, {
        headers: { ...headers, ...auth("f".repeat(64)) }, data: command.data,
      });
      expect(forged.status()).toBe(404);

      const validSeatBadHeader = await request.post(url, {
        headers: { ...headers, ...auth(aliceToken) }, data: command.data,
      });
      expect(validSeatBadHeader.status()).toBe(400);
      expect(validSeatBadHeader.headers()["cache-control"]).toBe("no-store");
      expect((await validSeatBadHeader.json()).code).toBe("invalid_idempotency_key");
    }

    const rotate = await request.post(root + "/rotate-token", { headers: auth(aliceToken) });
    expect(rotate.status()).toBe(200);
    const refreshed = await rotate.json() as { playerId: string; token: string };
    expect(refreshed.playerId).toBe("alice");
    for (const command of commands) {
      const url = `${root}/${command.kind}`;
      const stale = await request.post(url, {
        headers: { ...auth(aliceToken), "Idempotency-Key": "" }, data: command.data,
      });
      expect(stale.status()).toBe(404);
      const renewedBad = await request.post(url, {
        headers: { ...auth(refreshed.token), "Idempotency-Key": "bad-key" },
        data: command.data,
      });
      expect(renewedBad.status()).toBe(400);
    }
    const stillZero = await request.get(root, { headers: auth(bobToken) });
    expect(stillZero.status()).toBe(200);
    const before = await stillZero.json() as PublicMatch;
    expect(before.revision).toBe(0);
    expect(before.events).toHaveLength(1);
    await expect(bob.getByTestId("dev-hand").locator("li")).toHaveCount(4);

    const accepted = await request.post(root + "/end-turn", {
      headers: { ...auth(refreshed.token), "Idempotency-Key": crypto.randomUUID() },
      data: { expectedRevision: 0 },
    });
    expect(accepted.status()).toBe(200);
    const after = await accepted.json() as PublicMatch;
    expect(after.revision).toBe(1);
    expect(after.events).toHaveLength(2);
    await expect(bob.getByTestId("dev-revision")).toHaveText("1", { timeout: 9000 });
    await expect(bob.getByTestId("dev-end-turn")).toBeEnabled();
    const storage = await bob.evaluate(() => ({
      url: location.href, local: Object.values(localStorage),
      session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(storage)).not.toContain(aliceToken);
    expect(JSON.stringify(storage)).not.toContain(bobToken);
    expect(JSON.stringify(storage)).not.toContain(refreshed.token);
  } finally {
    await guestContext.close();
  }
});

test("real .NET: two browser turn badge follows server and clears after round or local exit", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const baseTitle = "Edonism — City Preview";
  await expect(page.getByTestId("dev-turn-signal")).toHaveAttribute("data-turn-state", "mine");
  await expect.poll(() => page.title()).toBe(`È il tuo turno · ${baseTitle}`);

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByRole("combobox", { name: "Lingua" }).selectOption("en");
    await guest.getByTestId("dev-join-id").fill(id);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-turn-signal")).toHaveAttribute("data-turn-state", "other");
    await expect(guest.getByTestId("dev-turn-signal-text")).toContainText("alice");
    await expect.poll(() => guest.title()).toBe(baseTitle);

    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("dev-turn-signal")).toHaveAttribute("data-turn-state", "other");
    await expect.poll(() => page.title()).toBe(baseTitle);
    // No synthetic UI timer decides the turn: Bob learns about Alice's
    // authoritative command through the real authenticated .NET long poll.
    await expect(guest.getByTestId("dev-revision")).toHaveText("1", { timeout: 9000 });
    await expect(guest.getByTestId("dev-turn-signal")).toHaveAttribute("data-turn-state", "mine");
    await expect(guest.getByTestId("dev-turn-signal-text")).toHaveText("It's your turn");
    await expect.poll(() => guest.title()).toBe(`Your turn · ${baseTitle}`);
    await expect(guest.getByTestId("dev-end-turn")).toBeEnabled();
    await guest.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("2");
    await expect(guest.getByTestId("dev-turn-signal")).toHaveAttribute("data-turn-state", "pending");
    await expect.poll(() => guest.title()).toBe(baseTitle);
    await expect(page.getByTestId("dev-revision")).toHaveText("2", { timeout: 9000 });
    await expect(page.getByTestId("dev-turn-signal")).toHaveAttribute("data-turn-state", "pending");

    const state = await request.get(`http://127.0.0.1:5080/api/dev/matches/${id}`, {
      headers: auth(aliceToken),
    });
    expect(state.status()).toBe(200);
    const final = await state.json() as PublicMatch;
    expect(final.revision).toBe(2);
    expect(final.phase).toBe(1);
    expect(final.events).toHaveLength(3);
    await guest.getByTestId("dev-leave").click();
    await expect(guest.getByTestId("dev-turn-signal")).toHaveCount(0);
    await expect.poll(() => guest.title()).toBe(baseTitle);
    const stored = await guest.evaluate(() => ({
      url: location.href, local: Object.values(localStorage),
      session: Object.values(sessionStorage), title: document.title,
    }));
    expect(JSON.stringify(stored)).not.toContain(aliceToken);
    expect(JSON.stringify(stored)).not.toContain(bobToken);
  } finally {
    await guestContext.close();
  }
});
