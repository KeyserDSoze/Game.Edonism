import { expect, test, type Page } from "@playwright/test";

type Seat = "alice" | "bob";
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
