import { readFile } from "node:fs/promises";
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
  assignedCharacters: readonly {
    playerId: Seat; characterId: string; printedInitialHearts: number
  }[];
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
  // #59: the live Domain setup must expose only the canonical 30 public
  // face-up activities with printed per-category quotas and unique character
  // cards/hearts. Nothing here permits a client to rewrite those values.
  const printedQuotas: Record<string, number> = {
    "public-financing": 5, "private-financing": 5,
    "black-market": 4, corruption: 4, culture: 4,
    sport: 2, transport: 3, bishopric: 3,
  };
  expect(created.state.boardActivities).toHaveLength(30);
  expect(new Set(created.state.boardActivities.map(x => x.slotId)).size).toBe(30);
  expect(new Set(created.state.boardActivities.map(x => x.cardId)).size).toBe(30);
  for (const [category, expected] of Object.entries(printedQuotas))
    expect(created.state.boardActivities.filter(x => x.category === category)).toHaveLength(expected);
  expect(created.state.boardActivities.every(x => x.category in printedQuotas)).toBe(true);
  expect(new Set(created.state.assignedCharacters.map(x => x.characterId)).size).toBe(2);
  for (const assigned of created.state.assignedCharacters) {
    expect(assigned.printedInitialHearts).toBeGreaterThanOrEqual(1);
    expect(assigned.printedInitialHearts).toBeLessThanOrEqual(5);
    expect(created.state.players.find(x => x.playerId === assigned.playerId)?.hearts)
      .toBe(assigned.printedInitialHearts);
  }
  expect(created.state.players.map((p) => p.playerId)).toEqual(["alice", "bob"]);
  expect(created.state.revision).toBe(0);

  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");

  // #58: real .NET first-round commands must never reshuffle, swap or leak
  // the four cards that were originally assigned to each private seat.
  const handUrl = `http://127.0.0.1:5080/api/dev/matches/${matchId}/hand`;
  const originalAliceReply = await request.get(handUrl, { headers: auth(aliceToken) });
  const originalBobReply = await request.get(handUrl, { headers: auth(bobToken) });
  expect(originalAliceReply.status()).toBe(200);
  expect(originalBobReply.status()).toBe(200);
  const originalAliceHand = (await originalAliceReply.json() as Hand).cardIds;
  const originalBobHand = (await originalBobReply.json() as Hand).cardIds;
  expect(originalAliceHand).toHaveLength(4);
  expect(originalBobHand).toHaveLength(4);
  expect(originalAliceHand.every(card => !originalBobHand.includes(card))).toBe(true);

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
  const afterAliceReply = await request.get(handUrl, { headers: auth(aliceToken) });
  const afterBobReply = await request.get(handUrl, { headers: auth(bobToken) });
  expect(afterAliceReply.status()).toBe(200);
  expect(afterBobReply.status()).toBe(200);
  expect((await afterAliceReply.json() as Hand).cardIds).toEqual(originalAliceHand);
  expect((await afterBobReply.json() as Hand).cardIds).toEqual(originalBobHand);
  const publicJson = JSON.stringify(final);
  for (const secret of [...originalAliceHand, ...originalBobHand])
    expect(publicJson).not.toContain(secret);
});

test("real .NET: rejects spoofable and oversized technical player IDs before issuing seats", async ({
  page, request,
}) => {
  const api = "http://127.0.0.1:5080/api/dev/matches/";
  for (const invalidId of ["A".repeat(65), "alice\nother",
    "alice\u202Eother", "alice\u{E0001}other"]) {
    const rejected = await request.post(api, {
      data: {
        players: [
          { playerId: invalidId, startingSlotId: "N-01" },
          { playerId: "bob", startingSlotId: "S-01" },
        ],
      },
    });
    expect(rejected.status()).toBe(400);
    expect(rejected.headers()["cache-control"]).toBe("no-store");
    const body = await rejected.json() as Record<string, unknown>;
    expect(body.code).toBe("invalid_preview_setup");
    expect(body).not.toHaveProperty("credentials");
    expect(body).not.toHaveProperty("state");
  }

  // A valid two-seat full-deck fixture must still be admitted and authorized.
  // The browser stays actor-scoped; no secret is placed in localStorage.
  const created = await startRealMatch(page);
  expect(created.state.players).toHaveLength(2);
  expect(created.credentials).toHaveLength(2);
  await expect(page.getByTestId("dev-seat-alice")).toBeVisible();
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
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

    // #60: each bearer MUST map to exactly one physical seat. Bob's
    // capability rotation never grants Alice's private cards to Bob, or
    // changes Alice's own authenticated hand.
    const beforeAlice = await request.get(`${api}/hand`, { headers: auth(aliceToken) });
    const beforeBob = await request.get(`${api}/hand`, { headers: auth(oldBob) });
    expect(beforeAlice.status()).toBe(200);
    expect(beforeBob.status()).toBe(200);
    const aliceCards = (await beforeAlice.json() as Hand).cardIds;
    const bobCards = (await beforeBob.json() as Hand).cardIds;
    expect(aliceCards).toHaveLength(4);
    expect(bobCards).toHaveLength(4);
    expect(aliceCards.every(c => !bobCards.includes(c))).toBe(true);

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
    const afterAlice = await request.get(`${api}/hand`, { headers: auth(aliceToken) });
    const afterBob = await request.get(`${api}/hand?playerId=alice`, {
      headers: auth(newCredential.token),
    });
    expect(afterAlice.status()).toBe(200);
    expect(afterBob.status()).toBe(200);
    expect((await afterAlice.json() as Hand).cardIds).toEqual(aliceCards);
    expect((await afterBob.json() as Hand).cardIds).toEqual(bobCards);
    expect(await guest.getByTestId("dev-hand").locator("li").allTextContents())
      .toEqual(bobCards);

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
  const bobToken = tokenFor(match, "bob");
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

  // #61: two different seats may legally submit the SAME UUID, but must
  // still produce distinct increasing accepted revisions. An Alice retry
  // after Bob commits must never append another event or access Bob's hand.
  const bobBefore = await request.get(`${api}/hand`, { headers: auth(bobToken) });
  expect(bobBefore.status()).toBe(200);
  const bobCards = (await bobBefore.json() as Hand).cardIds;
  const bobEnd = await request.post(`${api}/end-turn`, {
    headers: { ...auth(bobToken), "Idempotency-Key": attemptedKeys[0] },
    data: { expectedRevision: 1 },
  });
  expect(bobEnd.status()).toBe(200);
  expect((await bobEnd.json() as PublicMatch).revision).toBe(2);
  const aliceAfterBob = await request.post(`${api}/end-turn`, {
    headers: { ...auth(aliceToken), "Idempotency-Key": attemptedKeys[0] },
    data: { expectedRevision: 0 },
  });
  expect(aliceAfterBob.status()).toBe(200);
  const final = await aliceAfterBob.json() as PublicMatch;
  expect(final.revision).toBe(2);
  expect(final.events).toHaveLength(3);
  expect(final.events[2].kind).toBe("round-settlement-pending");
  const bobAfter = await request.get(`${api}/hand?playerId=alice`, {
    headers: auth(bobToken),
  });
  expect(bobAfter.status()).toBe(200);
  expect((await bobAfter.json() as Hand).cardIds).toEqual(bobCards);

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

    // The creator's Alice browser may already hold a long poll, and
    // Playwright/CI can schedule HTTP requests at different moments. Never
    // rely on the FIFTH request being the surplus one: oversubscribe the
    // actor's four-waiter quota and inspect the whole response set.
    // Bob has his own quota and must continue receiving revisions.
    const all = Array.from({ length: 10 }, () => request.get(api, {
      headers: waiting,
      timeout: 10000,
    }));
    await page.waitForTimeout(1000);
    await page.getByTestId("dev-end-turn").click();
    const done = await Promise.all(all);
    expect(done.some(r => r.status() === 429)).toBe(true);
    expect(done.some(r => r.status() === 200)).toBe(true);
    for (const response of done) {
      if (response.status() === 429) {
        expect(response.headers()["retry-after"]).toBe("1");
        expect(response.headers()["cache-control"]).toBe("no-store");
        expect(response.headers()["pragma"]).toBe("no-cache");
        expect(response.headers()["expires"]).toBe("0");
        expect(response.headers()["etag"]).toBeUndefined();
        expect((await response.body()).length).toBe(0);
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

test("real .NET public audits compare as append-only across an authorized move",
  async ({ page, browser, request }) => {
    const match = await startRealMatch(page);
    const matchId = match.matchId;
    const alice = tokenFor(match, "alice");
    const bob = tokenFor(match, "bob");
    const url = `http://127.0.0.1:5080/api/dev/matches/${matchId}`;
    const exportButton = page.getByTestId("dev-public-audit-export");
    await expect(exportButton).toBeEnabled();

    const initialDownload = page.waitForEvent("download");
    await exportButton.click();
    const r0 = await initialDownload;
    const zero = await readFile(await r0.path());
    const move = page.locator('[data-testid^="dev-move-"]:not([disabled])').first();
    await move.click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
    await expect(exportButton).toBeEnabled();
    const laterDownload = page.waitForEvent("download");
    await exportButton.click();
    const r1 = await laterDownload;
    const one = await readFile(await r1.path());

    const stateBefore = await request.get(url, { headers: auth(bob) });
    expect(stateBefore.status()).toBe(200);
    const before = await stateBefore.json() as { revision: number; activePlayerId: string };
    expect(before.revision).toBe(1);
    await page.close();

    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const offline = await context.newPage();
      let apiCalls = 0;
      await offline.route("**/api/**", async route => {
        apiCalls++;
        await route.abort();
      });
      await offline.goto("/");
      await expect(offline.getByTestId("dev-session")).toHaveCount(0);
      const upload = async (testId: string, buffer: Buffer) =>
        offline.getByTestId(testId).setInputFiles({
          name: "public-evidence.json", mimeType: "application/json", buffer,
        });
      await upload("dev-public-audit-import-file", zero);
      await expect(offline.getByTestId("dev-public-audit-import-status"))
        .toHaveAttribute("data-check", "valid");
      await upload("dev-public-audit-compare-file", one);
      const comparison = offline.getByTestId("dev-public-audit-compare-status");
      await expect(comparison).toHaveAttribute("data-compare", "left-prefix");
      await expect(comparison).toContainText("versione precedente");
      await upload("dev-public-audit-compare-file", zero);
      await expect(comparison).toHaveAttribute("data-compare", "identical");
      await upload("dev-public-audit-import-file", one);
      await expect(comparison).toHaveCount(0);
      await expect(offline.getByTestId("dev-public-audit-import-status"))
        .toHaveAttribute("data-check", "valid");
      await upload("dev-public-audit-compare-file", zero);
      await expect(comparison).toHaveAttribute("data-compare", "right-prefix");
      expect(apiCalls).toBe(0);
      await expect(offline.getByTestId("dev-session")).toHaveCount(0);
    } finally {
      await context.close();
    }
    const stateAfter = await request.get(url, { headers: auth(bob) });
    expect(stateAfter.status()).toBe(200);
    const after = await stateAfter.json() as { revision: number; activePlayerId: string };
    expect(after).toEqual(before);
    const hand = await request.get(url + "/hand", { headers: auth(alice) });
    expect(hand.status()).toBe(200);
    const privateHand = await hand.json() as Hand;
    for (const card of privateHand.cardIds) {
      expect(zero.toString("utf8")).not.toContain(card);
      expect(one.toString("utf8")).not.toContain(card);
    }
    expect(one.toString("utf8")).not.toContain(alice);
    expect(one.toString("utf8")).not.toContain(bob);
  });

test("real .NET public replay download is internally consistent offline without a bearer",
  async ({ page, browser, request }) => {
    const match = await startRealMatch(page);
    const matchId = match.matchId;
    const aliceToken = tokenFor(match, "alice");
    const bobToken = tokenFor(match, "bob");
    const move = page.locator('[data-testid^="dev-move-"]:not([disabled])').first();
    await move.click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("dev-public-audit-export")).toBeEnabled();

    const pending = page.waitForEvent("download");
    await page.getByTestId("dev-public-audit-export").click();
    const download = await pending;
    const file = await readFile(await download.path());
    const payload = JSON.parse(file.toString("utf8")) as {
      matchId: string; verifiedRevision: number;
      events: readonly unknown[]; frames: readonly unknown[];
    };
    const historyResponse = await request.get(
      `http://127.0.0.1:5080/api/dev/matches/${matchId}/history`,
      { headers: auth(bobToken) });
    expect(historyResponse.status()).toBe(200);
    const history = await historyResponse.json() as { frames: readonly unknown[] };
    expect(payload.matchId).toBe(matchId);
    expect(payload.verifiedRevision).toBe(1);
    expect(payload.frames).toEqual(history.frames);

    const offlineContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
    try {
      const offline = await offlineContext.newPage();
      let apiCalls = 0;
      await offline.route("**/api/**", async route => {
        apiCalls++;
        await route.abort();
      });
      await offline.goto("/");
      await expect(offline.getByTestId("dev-session")).toHaveCount(0);
      await offline.getByTestId("dev-public-audit-import-file").setInputFiles({
        name: "other-player-public-replay.json",
        mimeType: "application/json",
        buffer: file,
      });
      const result = offline.getByTestId("dev-public-audit-import-status");
      await expect(result).toHaveAttribute("data-check", "valid");
      await expect(result).toContainText("2 giocatori");
      await expect(result).toContainText("Origine non verificata");
      const timeline = offline.getByTestId("dev-offline-timeline");
      const revision = offline.getByTestId("dev-offline-timeline-revision");
      const previous = offline.getByTestId("dev-offline-timeline-previous");
      const next = offline.getByTestId("dev-offline-timeline-next");
      await expect(timeline).toBeVisible();
      await expect(revision).toHaveText("#0 / #1");
      await expect(previous).toBeDisabled();
      const initialStreet = (payload.frames[0] as {
        players: Array<{ streetId: string }>;
      }).players[0].streetId;
      const afterStreet = (payload.frames[1] as {
        players: Array<{ streetId: string }>;
      }).players[0].streetId;
      await expect(timeline.getByTestId("dev-offline-timeline-player").first())
        .toContainText(initialStreet);
      await next.click();
      await expect(revision).toHaveText("#1 / #1");
      await expect(next).toBeDisabled();
      await expect(timeline.getByTestId("dev-offline-timeline-event"))
        .toContainText(afterStreet);
      await expect(timeline.getByTestId("dev-offline-timeline-player").first())
        .toContainText(afterStreet);
      await previous.click();
      await expect(revision).toHaveText("#0 / #1");
      expect(apiCalls).toBe(0);
      await expect(offline.getByTestId("dev-session")).toHaveCount(0);
      expect(await offline.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
        .toBe(false);
    } finally {
      await offlineContext.close();
    }
    const handResponse = await request.get(
      `http://127.0.0.1:5080/api/dev/matches/${matchId}/hand`,
      { headers: auth(aliceToken) });
    expect(handResponse.status()).toBe(200);
    const hand = await handResponse.json() as Hand;
    for (const card of hand.cardIds) expect(file.toString("utf8")).not.toContain(card);
    expect(file.toString("utf8")).not.toContain(aliceToken);
    expect(file.toString("utf8")).not.toContain(bobToken);
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  });

test("real .NET: verified first-round audit exports only public events and positions", async ({
  page, request,
}) => {
  const match = await startRealMatch(page);
  const token = tokenFor(match, "alice");
  const otherToken = tokenFor(match, "bob");
  const matchId = match.matchId;
  const url = `http://127.0.0.1:5080/api/dev/matches/${matchId}`;
  await expect(page.getByTestId("dev-public-audit-export")).toBeEnabled();

  const move = page.locator('[data-testid^="dev-move-"]:not([disabled])').first();
  const destination = (await move.getAttribute("data-testid"))!.replace("dev-move-", "");
  await move.click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
  await expect(page.getByTestId("dev-public-audit-export")).toBeEnabled();

  const pending = page.waitForEvent("download");
  await page.getByTestId("dev-public-audit-export").click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe(
    `edonism-public-audit-${matchId}-r1.json`);
  const exportedText = await readFile(await download.path(), "utf8");
  const payload = JSON.parse(exportedText) as {
    format: string; matchId: string; round: number; verifiedRevision: number;
    events: readonly unknown[]; frames: readonly unknown[];
  };
  const liveHistory = await request.get(url + "/history", { headers: auth(otherToken) });
  const liveState = await request.get(url, { headers: auth(otherToken) });
  expect(liveHistory.status()).toBe(200);
  expect(liveState.status()).toBe(200);
  const serverHistory = await liveHistory.json() as {
    matchId: string; verifiedRevision: number; frames: readonly unknown[];
  };
  const serverState = await liveState.json() as {
    events: readonly unknown[]; revision: number;
  };
  expect(payload.format).toBe("edonism-public-audit-v1");
  expect(payload.matchId).toBe(matchId);
  expect(payload.round).toBe(1);
  expect(payload.verifiedRevision).toBe(1);
  expect(payload.verifiedRevision).toBe(serverHistory.verifiedRevision);
  expect(payload.verifiedRevision).toBe(serverState.revision);
  expect(payload.events).toEqual(serverState.events);
  expect(payload.frames).toEqual(serverHistory.frames);

  const hand = await request.get(url + "/hand", { headers: auth(token) });
  expect(hand.status()).toBe(200);
  const privateHand = await hand.json() as Hand;
  for (const card of privateHand.cardIds)
    expect(exportedText).not.toContain(card);
  expect(exportedText).not.toContain(token);
  expect(exportedText).not.toContain(otherToken);
  expect(exportedText).not.toMatch(/cardIds|token|credentials|digest|drawPile|idempotency|faction/i);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
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
    await page.getByTestId("dev-history-focus-alice").click();
    await expect(page.getByTestId("city-historical-focus")).toBeVisible();
    await expect(page.getByTestId("city-renderer"))
      .toHaveAttribute("data-history-street", aliceStart);
    await expect(page.getByTestId("city-historical-target")).toContainText("alice");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", destination);
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await page.getByTestId("dev-history-next").click();
    await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
    await page.getByTestId("dev-history-previous").click();
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
    // Jump from actual public .NET audit into the already verified timeline,
    // without changing public LIVE player positions or actor turn permissions.
    await expect(guest.getByTestId("dev-audit-jump-0")).toBeEnabled();
    await guest.getByTestId("dev-audit-jump-0").click();
    await expect(guest.getByTestId("dev-history-revision")).toContainText("#0");
    await expect(guest.getByTestId("city-historical-focus")).toHaveCount(0);
    await expect(guest.getByTestId("dev-audit-jump-1")).toBeEnabled();
    await guest.getByTestId("dev-audit-jump-1").click();
    await expect(guest.getByTestId("dev-history-revision")).toContainText("#1");
    await expect(guest.getByTestId("city-renderer"))
      .toHaveAttribute("data-history-street", destination);
    await expect(guest.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", destination);
    await expect(guest.getByTestId("dev-revision")).toHaveText("1");
    await expect(guest.getByTestId("dev-end-turn")).toBeDisabled();

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
    await guest.getByTestId("dev-history-focus-alice").click();
    await expect(guest.getByTestId("city-renderer"))
      .toHaveAttribute("data-history-street", aliceStart);
    await expect(guest.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", destination);
    await expect(guest.getByTestId("dev-end-turn")).toBeEnabled();
    await guest.getByTestId("city-clear-historical-focus").click();
    await expect(guest.getByTestId("city-historical-focus")).toHaveCount(0);
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

test("real .NET settlement preview is authenticated, gross-only and consistent in two browsers", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const path = `http://127.0.0.1:5080/api/dev/matches/${id}/settlement-preview`;
  const initial = await request.get(path, { headers: auth(aliceToken) });
  expect(initial.status()).toBe(409);
  expect(initial.headers()["cache-control"]).toBe("no-store");
  expect((await initial.json()).code).toBe("round_not_pending");
  const forbidden = await request.get(path);
  expect(forbidden.status()).toBe(404);

  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const second = await secondContext.newPage();
    await second.goto("/");
    await second.getByRole("combobox", { name: "Lingua" }).selectOption("en");
    await second.getByTestId("dev-join-id").fill(id);
    await second.getByTestId("dev-join-token").fill(bobToken);
    await second.getByTestId("dev-join").click();
    await expect(second.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    await page.getByTestId("dev-end-turn").click();
    await expect(second.getByTestId("dev-revision")).toHaveText("1", { timeout: 9000 });
    await second.getByTestId("dev-end-turn").click();
    await expect(second.getByTestId("dev-revision")).toHaveText("2");
    await expect(page.getByTestId("dev-revision")).toHaveText("2", { timeout: 9000 });
    await expect(page.getByTestId("dev-settlement-gross").locator("li")).toHaveCount(2);
    await expect(second.getByTestId("dev-settlement-gross").locator("li")).toHaveCount(2);
    await expect(second.getByTestId("dev-settlement-warning"))
      .toContainText("no salary paid");
    const first = await request.get(path, { headers: auth(aliceToken) });
    const other = await request.get(path, { headers: auth(bobToken) });
    expect(first.status()).toBe(200);
    expect(other.status()).toBe(200);
    expect(first.headers()["cache-control"]).toBe("no-store");
    const a = await first.json() as { matchId: string; round: number; verifiedRevision: number;
      nextTurnOrder: string[];
      grossSalaryQuotes: { playerId: string; baseAtoms: number;
        standingActivityAtoms: number; grossAtoms: number }[] };
    const b = await other.json();
    expect(b).toEqual(a);
    expect(a.matchId).toBe(id);
    expect(a.round).toBe(1);
    expect(a.verifiedRevision).toBe(2);
    expect(a.nextTurnOrder).toEqual(["bob", "alice"]);
    expect(a.grossSalaryQuotes).toHaveLength(2);
    expect(a.grossSalaryQuotes.every(q => q.baseAtoms === 2
      && q.standingActivityAtoms === 1 && q.grossAtoms === 3)).toBe(true);
    expect(JSON.stringify(a)).not.toContain(aliceToken);
    expect(JSON.stringify(a)).not.toContain(bobToken);
    expect(JSON.stringify(a)).not.toContain("cardIds");
    const stateResponse = await request.get(path.replace("/settlement-preview", ""),
      { headers: auth(aliceToken) });
    expect(stateResponse.status()).toBe(200);
    const snapshot = await stateResponse.json() as PublicMatch;
    expect(snapshot.revision).toBe(2);
    expect(snapshot.phase).toBe(1);
    expect(snapshot.events).toHaveLength(3);
    expect(snapshot.players.every(p => p.freeMoveUsed === false)).toBe(true);
    // No credit: each player still owns the initial four atoms.
    expect((snapshot.players as unknown as { atoms: number }[])
      .every(p => p.atoms === 4)).toBe(true);
    await second.getByTestId("dev-leave").click();
    await expect(second.getByTestId("dev-settlement-panel")).toHaveCount(0);
  } finally {
    await secondContext.close();
  }
});

test("real .NET turn progress authenticates both browsers and never skips a player", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const path = `http://127.0.0.1:5080/api/dev/matches/${id}/turn-progress`;
  const denied = await request.get(path);
  expect(denied.status()).toBe(404);
  expect(denied.headers()["cache-control"]).toBe("no-store");
  const forged = await request.get(path, { headers: auth("f".repeat(64)) });
  expect(forged.status()).toBe(404);
  const aliceInitial = await request.get(path, { headers: auth(aliceToken) });
  expect(aliceInitial.status()).toBe(200);
  expect(aliceInitial.headers()["cache-control"]).toBe("no-store");
  const start = await aliceInitial.json() as {
    matchId: string; round: number; verifiedRevision: number; phase: number;
    activePlayerId: string | null; totalTurns: number; completedTurns: number;
    completedPlayerIds: string[]; remainingPlayerIds: string[];
  };
  expect(start.matchId).toBe(id);
  expect(start.round).toBe(1);
  expect(start.completedTurns).toBe(0);
  expect(start.totalTurns).toBe(2);
  expect(start.activePlayerId).toBe("alice");
  expect(start.completedPlayerIds).toEqual([]);
  expect(start.remainingPlayerIds).toEqual(["alice", "bob"]);
  await expect(page.getByTestId("dev-turn-progress-count")).toContainText("0 di 2");

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByRole("combobox", { name: "Lingua" }).selectOption("en");
    await guest.getByTestId("dev-join-id").fill(id);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-turn-progress-count")).toContainText("0 of 2");
    await expect(guest.getByTestId("dev-turn-progress-seats").locator('[data-player-id="alice"]'))
      .toHaveAttribute("data-progress-state", "active");
    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("dev-turn-progress-count")).toContainText("1 di 2");
    await expect(guest.getByTestId("dev-revision")).toHaveText("1", { timeout: 9000 });
    await expect(guest.getByTestId("dev-turn-progress-count")).toContainText("1 of 2");
    await expect(guest.getByTestId("dev-turn-progress-seats").locator('[data-player-id="bob"]'))
      .toHaveAttribute("data-progress-state", "active");

    const both = await Promise.all([
      request.get(path, { headers: auth(aliceToken) }),
      request.get(path, { headers: auth(bobToken) }),
    ]);
    expect(both.every(r => r.status() === 200)).toBe(true);
    const aliceProgress = await both[0].json();
    const bobProgress = await both[1].json();
    expect(aliceProgress).toEqual(bobProgress);
    expect(aliceProgress.verifiedRevision).toBe(1);
    expect(aliceProgress.completedPlayerIds).toEqual(["alice"]);
    expect(aliceProgress.remainingPlayerIds).toEqual(["bob"]);

    await guest.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("2");
    await expect(guest.getByTestId("dev-turn-progress-count")).toContainText("2 of 2");
    await expect(page.getByTestId("dev-revision")).toHaveText("2", { timeout: 9000 });
    await expect(page.getByTestId("dev-turn-progress-count")).toContainText("2 di 2");
    const finalR = await request.get(path, { headers: auth(bobToken) });
    expect(finalR.status()).toBe(200);
    const final = await finalR.json();
    expect(final.completedTurns).toBe(2);
    expect(final.phase).toBe(1);
    expect(final.activePlayerId).toBeNull();
    expect(final.completedPlayerIds).toEqual(["alice", "bob"]);
    expect(final.remainingPlayerIds).toEqual([]);
    expect(JSON.stringify(final)).not.toContain(aliceToken);
    expect(JSON.stringify(final)).not.toContain(bobToken);
    expect(JSON.stringify(final)).not.toContain("cardIds");
    expect(JSON.stringify(final)).not.toContain("atoms");

    const rotate = await request.post(
      `http://127.0.0.1:5080/api/dev/matches/${id}/rotate-token`,
      { headers: auth(aliceToken) },
    );
    expect(rotate.status()).toBe(200);
    const newAliceToken = (await rotate.json() as { token: string }).token;
    const revoked = await request.get(path, { headers: auth(aliceToken) });
    expect(revoked.status()).toBe(404);
    const renewed = await request.get(path, { headers: auth(newAliceToken) });
    expect(renewed.status()).toBe(200);
    expect(await renewed.json()).toEqual(final);
    const state = await request.get(
      `http://127.0.0.1:5080/api/dev/matches/${id}`,
      { headers: auth(bobToken) },
    );
    expect(state.status()).toBe(200);
    const snapshot = await state.json() as PublicMatch;
    expect(snapshot.revision).toBe(2);
    expect(snapshot.events).toHaveLength(3);
    expect((snapshot.players as unknown as { atoms: number }[])
      .every(p => p.atoms === 4)).toBe(true);
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    await guest.getByTestId("dev-leave").click();
    await expect(guest.getByTestId("dev-turn-progress")).toHaveCount(0);
  } finally {
    await guestContext.close();
  }
});

test("real .NET two browsers display only newly verified public opponent events", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const endpoint = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  await expect(page.getByTestId("dev-unread-activity-count")).toContainText("0");
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByRole("combobox", { name: "Lingua" }).selectOption("en");
    await guest.getByTestId("dev-join-id").fill(id);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    const guestUnread = guest.getByTestId("dev-unread-activity-count");
    await expect(guestUnread).toContainText("0");
    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(guest.getByTestId("dev-revision")).toHaveText("1", { timeout: 12000 });
    await expect(guestUnread).toContainText("1", { timeout: 12000 });
    await expect(guest.getByTestId("dev-unread-activity-event-1"))
      .toContainText("alice ended their turn");
    await guest.getByTestId("dev-unread-activity-mark-seen").click();
    await expect(guestUnread).toContainText("0");
    await expect(guest.getByTestId("dev-revision")).toHaveText("1");
    const move = guest.locator('button[data-testid^="dev-move-"]').first();
    await expect(move).toBeEnabled();
    await move.click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("2");
    await expect(guestUnread).toContainText("0");
    await expect(page.getByTestId("dev-revision")).toHaveText("2", { timeout: 12000 });
    await expect(page.getByTestId("dev-unread-activity-count")).toContainText("1");
    await expect(page.getByTestId("dev-unread-activity-event-2")).toContainText("bob si è mosso");
    await guest.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("3");
    await expect(page.getByTestId("dev-revision")).toHaveText("3", { timeout: 12000 });
    await expect(page.getByTestId("dev-unread-activity-count")).toContainText("2");
    await expect(page.getByTestId("dev-unread-activity-event-3"))
      .toContainText("bob ha completato il round");
    await expect(guestUnread).toContainText("0");

    const stateBefore = await request.get(endpoint, { headers: auth(aliceToken) });
    expect(stateBefore.status()).toBe(200);
    const before = await stateBefore.json() as PublicMatch;
    expect(before.revision).toBe(3);
    expect(before.events).toHaveLength(4);
    await page.getByTestId("dev-unread-activity-mark-seen").click();
    await expect(page.getByTestId("dev-unread-activity-count")).toContainText("0");
    const stateAfter = await request.get(endpoint, { headers: auth(aliceToken) });
    expect(stateAfter.status()).toBe(200);
    const after = await stateAfter.json() as PublicMatch;
    expect(after.revision).toBe(before.revision);
    expect(after.events).toEqual(before.events);
    const hand = await request.get(endpoint + "/hand", { headers: auth(bobToken) });
    expect(hand.status()).toBe(200);
    expect((await hand.json() as { cardIds: string[] }).cardIds).toHaveLength(4);
    const storage = await guest.evaluate(() => ({
      url: location.href, local: Object.values(localStorage),
      session: Object.values(sessionStorage),
    }));
    expect(JSON.stringify(storage)).not.toContain(aliceToken);
    expect(JSON.stringify(storage)).not.toContain(bobToken);
    await guest.getByTestId("dev-leave").click();
    await expect(guest.getByTestId("dev-unread-activity-panel")).toHaveCount(0);
  } finally {
    await guestContext.close();
  }
});

test("real .NET: malformed commands never reveal binding details before bearer authentication", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const base = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(id);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-session")).toBeVisible();

    for (const kind of ["free-move", "end-turn"]) {
      const path = `${base}/${kind}`;
      for (const headers of [
        { "content-type": "application/json" },
        { ...auth("f".repeat(64)), "content-type": "application/json" },
      ]) {
        const forbidden = await request.post(path, { headers, data: "{" });
        expect(forbidden.status()).toBe(404);
        expect(forbidden.headers()["cache-control"]).toBe("no-store");
        expect((await forbidden.json() as { code: string }).code).toBe("match_not_found");
      }
      const validBadBody = await request.post(path, {
        headers: { ...auth(bobToken), "content-type": "application/json" }, data: "{",
      });
      expect(validBadBody.status()).toBe(400);
      expect(validBadBody.headers()["cache-control"]).toBe("no-store");
    }

    const rotated = await request.post(`${base}/rotate-token`,
      { headers: auth(bobToken) });
    expect(rotated.status()).toBe(200);
    const newBob = (await rotated.json() as { token: string }).token;
    for (const kind of ["free-move", "end-turn"]) {
      const revoked = await request.post(`${base}/${kind}`, {
        headers: { ...auth(bobToken), "content-type": "application/json" },
        data: "{",
      });
      expect(revoked.status()).toBe(404);
      expect((await revoked.json() as { code: string }).code).toBe("match_not_found");
      const renewed = await request.post(`${base}/${kind}`, {
        headers: { ...auth(newBob), "content-type": "application/json" },
        data: "{",
      });
      expect(renewed.status()).toBe(400);
    }

    // Pre-binding authorization and rotation do not advance the game.
    const before = await request.get(base, { headers: auth(aliceToken) });
    const initial = await before.json() as PublicMatch;
    expect(initial.revision).toBe(0);
    expect(initial.events).toHaveLength(1);
    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    const bobEnd = await request.post(`${base}/end-turn`, {
      headers: auth(newBob), data: { expectedRevision: 1 },
    });
    expect(bobEnd.status()).toBe(200);
    await expect(page.getByTestId("dev-revision")).toHaveText("2", { timeout: 12000 });
    const after = await request.get(base, { headers: auth(aliceToken) });
    const final = await after.json() as PublicMatch;
    expect(final.revision).toBe(2);
    expect(final.events).toHaveLength(3);
    expect(final.phase).toBe(1);
    const stateText = JSON.stringify(final);
    expect(stateText).not.toContain(aliceToken);
    expect(stateText).not.toContain(bobToken);
    expect(stateText).not.toContain(newBob);
    const aliceHand = await request.get(`${base}/hand`, {
      headers: auth(aliceToken),
    });
    expect(aliceHand.status()).toBe(200);
    expect((await aliceHand.json() as { cardIds: string[] }).cardIds).toHaveLength(4);
  } finally {
    await guestContext.close();
  }
});

test("real .NET creators reject oversized payload before binding, but two browser seats still play", async ({
  page, browser, request,
}) => {
  const creator = "http://127.0.0.1:5080/api/dev/matches/from-full-deck";
  const oversize = await request.post(creator, {
    headers: { "Content-Type": "application/json" },
    data: "x".repeat(131073),
  });
  expect(oversize.status()).toBe(413);
  expect(oversize.headers()["cache-control"]).toBe("no-store");
  const rejected = await oversize.json() as { code: string; credentials?: unknown };
  expect(rejected.code).toBe("dev_create_payload_too_large");
  expect(rejected.credentials).toBeUndefined();

  const created = await startRealMatch(page);
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(created.matchId);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-session")).toBeVisible();
    await page.getByTestId("dev-end-turn").click();
    await expect(guest.getByTestId("dev-revision")).toHaveText("1", { timeout: 12000 });
    await guest.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("2", { timeout: 12000 });
    const state = await request.get(
      `http://127.0.0.1:5080/api/dev/matches/${created.matchId}`,
      { headers: auth(aliceToken) },
    );
    expect(state.status()).toBe(200);
    const snapshot = await state.json() as PublicMatch;
    expect(snapshot.revision).toBe(2);
    expect(snapshot.phase).toBe(1);
    expect(snapshot.events).toHaveLength(3);
    expect(JSON.stringify(snapshot)).not.toContain(aliceToken);
    expect(JSON.stringify(snapshot)).not.toContain(bobToken);
  } finally {
    await guestContext.close();
  }
});


test("real .NET: a second fixture creation never invalidates the first PvP seat", async ({
  page, browser, request,
}) => {
  const first = await startRealMatch(page);
  const aliceToken = tokenFor(first, "alice");
  const bobToken = tokenFor(first, "bob");

  const second = await request.post("http://127.0.0.1:5080/api/dev/matches/", {
    data: { players: [
      { playerId: "carol", startingSlotId: "N-01" },
      { playerId: "dan", startingSlotId: "S-01" },
    ] },
  });
  expect(second.status()).toBe(201);
  expect(second.headers()["cache-control"]).toBe("no-store");
  const another = await second.json() as CreatedMatch;
  expect(another.matchId).not.toBe(first.matchId);

  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByTestId("dev-join-id").fill(first.matchId);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-session")).toBeVisible();
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);

    const oldSeat = await request.get(
      `http://127.0.0.1:5080/api/dev/matches/${first.matchId}/seat`,
      { headers: auth(aliceToken) },
    );
    expect(oldSeat.status()).toBe(200);
    const seat = await oldSeat.json() as { playerId: string; state: PublicMatch };
    expect(seat.playerId).toBe("alice");
    expect(seat.state.revision).toBe(0);
  } finally {
    await guestContext.close();
  }
});

test("real .NET: two browser street route plans follow public activity ownership without commands", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const alice = tokenFor(created, "alice");
  const bob = tokenFor(created, "bob");
  const endpoint = `http://127.0.0.1:5080/api/dev/matches/${created.matchId}/uncontrolled-routes`;
  await expect(page.getByTestId("dev-routes-count")).toContainText("28 attività non controllate");
  await expect(page.getByTestId("dev-routes-list").locator("li")).toHaveCount(5);
  await expect(page.getByTestId("dev-routes-note")).toContainText("Non sono turni stimati");

  const anonymous = await request.get(endpoint);
  expect(anonymous.status()).toBe(404);
  expect(anonymous.headers()["cache-control"]).toBe("no-store");
  const first = await request.get(endpoint, { headers: auth(alice) });
  expect(first.status()).toBe(200);
  expect(first.headers()["cache-control"]).toBe("no-store");
  const firstPlan = await first.json() as {
    matchId: string; playerId: string; verifiedRevision: number; fromStreetId: string;
    routes: { slotId: string; cardId: string; category: string;
      streetId: string; streetSteps: number; streetPath: string[] }[];
  };
  expect(firstPlan.playerId).toBe("alice");
  expect(firstPlan.verifiedRevision).toBe(0);
  expect(firstPlan.fromStreetId).toBe(created.state.players[0].streetId);
  expect(firstPlan.routes).toHaveLength(28);
  for (const route of firstPlan.routes) {
    expect(route.streetPath[0]).toBe(firstPlan.fromStreetId);
    expect(route.streetPath.at(-1)).toBe(route.streetId);
    expect(route.streetPath).toHaveLength(route.streetSteps + 1);
  }
  expect(JSON.stringify(firstPlan)).not.toContain(alice);
  expect(JSON.stringify(firstPlan)).not.toContain(bob);
  expect(JSON.stringify(firstPlan)).not.toContain("atoms");
  for (const route of firstPlan.routes.slice(0, 5)) {
    await expect(page.getByTestId(`dev-route-${route.slotId}`))
      .toHaveAttribute("data-steps", String(route.streetSteps));
    await expect(page.getByTestId(`dev-route-${route.slotId}`))
      .toHaveAttribute("data-path", route.streetPath.join(">"));
    if (route.slotId === firstPlan.routes[0].slotId) {
      await page.getByTestId(`dev-focus-activity-${route.slotId}`).click();
      await expect(page.getByTestId("city-renderer")).toHaveAttribute(
        "data-focus-path", route.streetPath.join(">"));
      await expect(page.getByTestId("city-tactical-target"))
        .toContainText(`Attività osservata: ${route.slotId}`);
      await page.getByTestId("city-clear-tactical-focus").click();
    }
    await expect(page.getByTestId(`dev-route-path-${route.slotId}`)).toBeVisible();
  }

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByRole("combobox", { name: "Lingua" }).selectOption("en");
    await guest.getByTestId("dev-join-id").fill(created.matchId);
    await guest.getByTestId("dev-join-token").fill(bob);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-routes-count")).toContainText("28 uncontrolled");
    await expect(guest.getByTestId("dev-routes-note")).toContainText("not turn estimates");
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    const second = await request.get(endpoint, { headers: auth(bob) });
    expect(second.status()).toBe(200);
    const bobPlan = await second.json() as typeof firstPlan;
    expect(bobPlan.playerId).toBe("bob");
    expect(bobPlan.fromStreetId).toBe(created.state.players[1].streetId);
    expect(bobPlan.routes).toHaveLength(28);

    await page.locator('[data-testid^="dev-move-"]:not([disabled])').first().click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    const moved = await request.get(endpoint, { headers: auth(alice) });
    expect(moved.status()).toBe(200);
    const movedPlan = await moved.json() as typeof firstPlan;
    expect(movedPlan.verifiedRevision).toBe(1);
    expect(movedPlan.fromStreetId).not.toBe(firstPlan.fromStreetId);
    await expect(page.getByTestId("dev-routes-count")).toContainText("28 attività non controllate");
    for (const route of movedPlan.routes.slice(0, 5)) {
      await expect(page.getByTestId(`dev-route-${route.slotId}`))
        .toHaveAttribute("data-steps", String(route.streetSteps));
    }
    await expect(guest.getByTestId("dev-revision")).toHaveText("1", { timeout: 9000 });
    await expect(guest.getByTestId("dev-routes-count")).toContainText("28 uncontrolled");
    const snapshot = await request.get(
      `http://127.0.0.1:5080/api/dev/matches/${created.matchId}`,
      { headers: auth(bob) },
    );
    expect(snapshot.status()).toBe(200);
    const state = await snapshot.json() as PublicMatch;
    expect(state.revision).toBe(1);
    expect(state.events).toHaveLength(2);
    expect(state.players.every(p => p.hearts > 0)).toBe(true);
    await guest.getByTestId("dev-leave").click();
    await expect(guest.getByTestId("dev-route-planner")).toHaveCount(0);
  } finally {
    await guestContext.close();
  }
});


test("real .NET: public opponent dossier follows a move in two browsers without revealing hands", async ({
  page, browser, request,
}) => {
  const created = await startRealMatch(page);
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const endpoint = `http://127.0.0.1:5080/api/dev/matches/${created.matchId}/other-player-routes`;
  await expect(page.getByTestId("dev-other-seats-count")).toContainText("1 altri giocatori");
  await expect(page.getByTestId("dev-other-seat-bob")).toHaveAttribute("data-owned", "1");
  await expect(page.getByTestId("dev-other-seat-bob")).toHaveAttribute("data-standing", "1");

  const anonymous = await request.get(endpoint);
  expect(anonymous.status()).toBe(404);
  expect(anonymous.headers()["cache-control"]).toBe("no-store");
  const response = await request.get(endpoint, { headers: auth(aliceToken) });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const plan = await response.json() as {
    playerId: string; verifiedRevision: number; fromStreetId: string;
    others: { otherPlayerId: string; streetId: string; streetSteps: number;
      streetPath: string[]; controlledActivities: number; standingHenchmen: number }[];
  };
  expect(plan.playerId).toBe("alice");
  expect(plan.verifiedRevision).toBe(0);
  expect(plan.fromStreetId).toBe(created.state.players[0].streetId);
  expect(plan.others).toHaveLength(1);
  const other = plan.others[0];
  expect(other.otherPlayerId).toBe("bob");
  expect(other.streetPath).toHaveLength(other.streetSteps + 1);
  await expect(page.getByTestId("dev-other-seat-bob"))
    .toHaveAttribute("data-path", other.streetPath.join(">"));
  await page.getByTestId("dev-focus-player-bob").click();
  await expect(page.getByTestId("city-tactical-target")).toContainText("Giocatore osservato: bob");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute(
    "data-focus-path", other.streetPath.join(">"));
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(JSON.stringify(plan)).not.toContain(aliceToken);
  expect(JSON.stringify(plan)).not.toContain(bobToken);
  expect(JSON.stringify(plan)).not.toContain("cardIds");
  expect(JSON.stringify(plan)).not.toContain("faction");

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage();
    await guest.goto("/");
    await guest.getByRole("combobox", { name: "Lingua" }).selectOption("en");
    await guest.getByTestId("dev-join-id").fill(created.matchId);
    await guest.getByTestId("dev-join-token").fill(bobToken);
    await guest.getByTestId("dev-join").click();
    await expect(guest.getByTestId("dev-other-seats-count")).toContainText("1 other players");
    await expect(guest.getByTestId("dev-other-seat-alice")).toHaveAttribute("data-owned", "1");
    await guest.getByTestId("dev-focus-player-alice").click();
    await expect(guest.getByTestId("city-tactical-target")).toContainText("Observed player: alice");
    await expect(guest.getByTestId("city-renderer")).toHaveAttribute(
      "data-focus-path", String(await guest.getByTestId("dev-other-seat-alice")
        .getAttribute("data-path")));
    await expect(guest.getByTestId("dev-hand").locator("li")).toHaveCount(4);
    const bobPlanResponse = await request.get(endpoint, { headers: auth(bobToken) });
    expect(bobPlanResponse.status()).toBe(200);
    const bobPlan = await bobPlanResponse.json() as typeof plan;
    expect(bobPlan.playerId).toBe("bob");
    expect(bobPlan.others[0].otherPlayerId).toBe("alice");

    await page.locator('[data-testid^="dev-move-"]:not([disabled])').first().click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
    const moved = await request.get(endpoint, { headers: auth(aliceToken) });
    expect(moved.status()).toBe(200);
    const movedPlan = await moved.json() as typeof plan;
    expect(movedPlan.verifiedRevision).toBe(1);
    expect(movedPlan.fromStreetId).not.toBe(plan.fromStreetId);
    await expect(page.getByTestId("dev-other-seat-bob"))
      .toHaveAttribute("data-path", movedPlan.others[0].streetPath.join(">"));
    await expect(guest.getByTestId("dev-revision")).toHaveText("1", { timeout: 10000 });
    await expect(guest.getByTestId("city-tactical-focus")).toHaveCount(0);
    await expect(guest.getByTestId("dev-other-seat-alice"))
      .toHaveAttribute("data-owned", "1");
    await guest.getByTestId("dev-leave").click();
    await expect(guest.getByTestId("dev-other-seats")).toHaveCount(0);
    await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  } finally {
    await guestContext.close();
  }
});


test("real .NET: opponent-controlled lot routes are bearer-bound and focusable without mutation",
  async ({ page, request }) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const endpoint = `http://127.0.0.1:5080/api/dev/matches/${id}/opponent-controlled-routes`;
  const missing = await request.get(endpoint);
  expect(missing.status()).toBe(404);
  expect(missing.headers()["cache-control"]).toBe("no-store");

  const response = await request.get(endpoint, { headers: auth(aliceToken) });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const result = await response.json() as {
    matchId: string; playerId: string; verifiedRevision: number; fromStreetId: string;
    routes: { slotId: string; ownerPlayerId: string; posture: number;
      streetId: string; streetSteps: number; streetPath: string[] }[];
  };
  expect(result.matchId).toBe(id);
  expect(result.playerId).toBe("alice");
  expect(result.verifiedRevision).toBe(0);
  expect(result.fromStreetId).toBe(created.state.players[0].streetId);
  expect(result.routes).toHaveLength(1);
  const bobLot = created.state.controlledActivities.find(c => c.ownerPlayerId === "bob")!;
  const route = result.routes[0];
  expect(route.ownerPlayerId).toBe("bob");
  expect(route.slotId).toBe(bobLot.slotId);
  expect(route.posture).toBe(bobLot.posture);
  expect(route.streetPath).toHaveLength(route.streetSteps + 1);
  const serialized = JSON.stringify(result);
  for (const secret of [aliceToken, bobToken, "cardIds", "faction"])
    expect(serialized).not.toContain(secret);

  const row = page.getByTestId(`dev-opponent-lot-${route.slotId}`);
  await expect(row).toHaveAttribute("data-owner", "bob");
  await expect(row).toHaveAttribute("data-path", route.streetPath.join(">"));
  await page.getByTestId(`dev-focus-opponent-lot-${route.slotId}`).click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await expect(page.getByTestId("city-tactical-target")).toContainText(route.slotId);
  await expect(page.getByTestId("city-renderer"))
    .toHaveAttribute("data-focus-path", route.streetPath.join(">"));
  await expect(page.getByTestId("dev-revision")).toHaveText("0");

  const unchanged = await request.get(
    `http://127.0.0.1:5080/api/dev/matches/${id}`,
    { headers: auth(aliceToken) });
  expect(unchanged.status()).toBe(200);
  const state = await unchanged.json() as PublicMatch;
  expect(state.revision).toBe(0);
  expect(state.events).toHaveLength(1);
});


test("real .NET: nearby rival-lot filter leaves authorized state and audit unchanged",
  async ({ page, request }) => {
  const created = await startRealMatch(page);
  const id = created.matchId;
  const endpoint = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  const aliceToken = tokenFor(created, "alice");
  const baseline = await request.get(endpoint, { headers: auth(aliceToken) });
  expect(baseline.status()).toBe(200);
  const before = await baseline.json() as PublicMatch;
  const reply = await request.get(`${endpoint}/opponent-controlled-routes`, {
    headers: auth(aliceToken),
  });
  expect(reply.status()).toBe(200);
  const result = await reply.json() as { routes: {
    slotId: string; streetSteps: number; ownerPlayerId: string;
  }[] };
  const nearby = result.routes.filter(route => route.streetSteps <= 1);
  const toggle = page.getByTestId("dev-opponent-lots-nearby-toggle");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li"))
    .toHaveCount(result.routes.length);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li"))
    .toHaveCount(nearby.length);
  for (const lot of nearby)
    await expect(page.getByTestId(`dev-opponent-lot-${lot.slotId}`)).toBeVisible();
  if (nearby.length === 0)
    await expect(page.getByTestId("dev-opponent-lots-no-nearby")).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li"))
    .toHaveCount(result.routes.length);
  const unchanged = await request.get(endpoint, { headers: auth(aliceToken) });
  expect(unchanged.status()).toBe(200);
  expect(await unchanged.json()).toEqual(before);
});


test("real .NET: both authenticated seats' rival-lot paths match all pinned street pairs",
  async ({ page, request }) => {
  const created = await startRealMatch(page);
  const url = `http://127.0.0.1:5080/api/dev/matches/${created.matchId}`;
  const contract = JSON.parse(await readFile(
    new URL("../../shared/board/canonical-street-paths.v1.json", import.meta.url),
    "utf8",
  )) as {
    format: string; boardVersion: string;
    paths: { from: string; to: string; path: string[] }[];
  };
  expect(contract.format).toBe("edonism-canonical-street-paths-v1");
  const golden = new Map(contract.paths.map(route => [
    `${route.from}:${route.to}`, route.path,
  ]));
  expect(golden.size).toBe(49);
  const unauthorized = await request.get(`${url}/opponent-controlled-routes`);
  expect(unauthorized.status()).toBe(404);
  expect(unauthorized.headers()["cache-control"]).toBe("no-store");

  const firstToken = tokenFor(created, created.state.players[0].playerId);
  const before = await request.get(url, { headers: auth(firstToken) });
  expect(before.status()).toBe(200);
  const snapshot = await before.json() as PublicMatch;
  for (const seat of created.state.players) {
    const response = await request.get(`${url}/opponent-controlled-routes`, {
      headers: auth(tokenFor(created, seat.playerId)),
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const projection = await response.json() as {
      playerId: string; fromStreetId: string; verifiedRevision: number;
      routes: { ownerPlayerId: string; slotId: string; streetId: string;
        streetPath: string[]; streetSteps: number }[];
    };
    expect(projection.playerId).toBe(seat.playerId);
    expect(projection.fromStreetId).toBe(seat.streetId);
    expect(projection.verifiedRevision).toBe(snapshot.revision);
    expect(projection.routes).toHaveLength(created.state.players.length - 1);
    for (const route of projection.routes) {
      expect(route.ownerPlayerId).not.toBe(seat.playerId);
      const expected = golden.get(`${seat.streetId}:${route.streetId}`);
      expect(expected).toBeDefined();
      expect(route.streetPath).toEqual(expected);
      expect(route.streetSteps).toBe(expected!.length - 1);
    }
  }
  const after = await request.get(url, { headers: auth(firstToken) });
  expect(after.status()).toBe(200);
  expect(await after.json()).toEqual(snapshot);
});

test("real .NET: tactical overview bundles all three scoped read-only public projections",
  async ({ page, request }) => {
  const created = await startRealMatch(page);
  const url = `http://127.0.0.1:5080/api/dev/matches/${created.matchId}`;
  const denied = await request.get(`${url}/tactical-overview`);
  expect(denied.status()).toBe(404);
  expect(denied.headers()["cache-control"]).toBe("no-store");

  const initial = await request.get(url, { headers: auth(tokenFor(created, "alice")) });
  expect(initial.status()).toBe(200);
  const baseline = await initial.json() as PublicMatch;
  for (const seat of ["alice", "bob"]) {
    const headers = auth(tokenFor(created, seat));
    const response = await request.get(`${url}/tactical-overview?playerId=${seat === "alice" ? "bob" : "alice"}`, {
      headers,
    });
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("no-store");
    const overview = await response.json() as {
      matchId: string; playerId: string; round: number; verifiedRevision: number;
      fromStreetId: string;
      uncontrolled: { matchId: string; playerId: string; verifiedRevision: number;
        fromStreetId: string; routes: unknown[] };
      otherPlayers: { matchId: string; playerId: string; verifiedRevision: number;
        fromStreetId: string; others: unknown[] };
      opponentControlledLots: { matchId: string; playerId: string; verifiedRevision: number;
        fromStreetId: string; routes: unknown[] };
    };
    expect(overview.playerId).toBe(seat);
    expect(overview.matchId).toBe(created.matchId);
    expect(overview.round).toBe(1);
    expect(overview.verifiedRevision).toBe(0);
    expect(overview.fromStreetId).toBe(baseline.players.find(p => p.playerId === seat)!.streetId);
    for (const [field, legacy] of [
      ["uncontrolled", "uncontrolled-routes"],
      ["otherPlayers", "other-player-routes"],
      ["opponentControlledLots", "opponent-controlled-routes"],
    ] as const) {
      const part = overview[field];
      expect(part.playerId).toBe(seat);
      expect(part.matchId).toBe(created.matchId);
      expect(part.verifiedRevision).toBe(overview.verifiedRevision);
      expect(part.fromStreetId).toBe(overview.fromStreetId);
      const separately = await request.get(`${url}/${legacy}`, { headers });
      expect(separately.status()).toBe(200);
      expect(part).toEqual(await separately.json());
    }
    expect(overview.uncontrolled.routes).toHaveLength(28);
    expect(overview.otherPlayers.others).toHaveLength(1);
    expect(overview.opponentControlledLots.routes).toHaveLength(1);
    const serialized = JSON.stringify(overview);
    for (const secret of [tokenFor(created, "alice"), tokenFor(created, "bob"),
      "cardIds", "drawPile", "faction", "atoms"]) expect(serialized).not.toContain(secret);
  }

  await expect(page.getByTestId("dev-other-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lots-count")).toBeVisible();
  await expect(page.getByTestId("dev-routes-count")).toBeVisible();
  const finalResponse = await request.get(url, { headers: auth(tokenFor(created, "alice")) });
  expect(finalResponse.status()).toBe(200);
  expect(await finalResponse.json()).toEqual(baseline);
});

test("#88: two real browser seats use one atomic tactical GET per revision and rotation",
  async ({ page, browser, request }) => {
  type Read = { path: string; token: string | undefined };
  const aliceReads: Read[] = [];
  const track = (reads: Read[], browserPage: Page) => {
    browserPage.on("request", req => {
      if (req.method() !== "GET") return;
      const path = new URL(req.url()).pathname;
      if (/\/(tactical-overview|uncontrolled-routes|other-player-routes|opponent-controlled-routes)$/.test(path))
        reads.push({ path, token: req.headers()["x-edonism-dev-token"] });
    });
  };
  const tactical = (reads: Read[]) => reads.filter(r => r.path.endsWith("/tactical-overview"));
  const legacy = (reads: Read[]) => reads.filter(r =>
    /\/(uncontrolled-routes|other-player-routes|opponent-controlled-routes)$/.test(r.path));
  track(aliceReads, page);
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const url = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  await expect(page.getByTestId("dev-other-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("dev-routes-count")).toBeVisible();
  await expect.poll(() => tactical(aliceReads).length).toBe(1);
  expect(tactical(aliceReads)[0].token).toBe(aliceToken);
  expect(legacy(aliceReads)).toHaveLength(0);

  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const bobPage = await secondContext.newPage();
    const bobReads: Read[] = [];
    track(bobReads, bobPage);
    await bobPage.goto("/");
    await bobPage.getByTestId("dev-join-id").fill(id);
    await bobPage.getByTestId("dev-join-token").fill(bobToken);
    await bobPage.getByTestId("dev-join").click();
    await expect(bobPage.getByTestId("dev-seat-bob")).toBeVisible();
    await expect(bobPage.getByTestId("dev-other-seat-alice")).toBeVisible();
    await expect(bobPage.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(1);
    await expect(bobPage.getByTestId("dev-routes-count")).toBeVisible();
    await expect.poll(() => tactical(bobReads).length).toBe(1);
    expect(tactical(bobReads)[0].token).toBe(bobToken);
    expect(legacy(bobReads)).toHaveLength(0);

    // Real .NET match mutation updates both independently authenticated
    // browsers, but must yield only one new atomic tactical view each.
    await page.locator('[data-testid^="dev-move-"]:not([disabled])').first().click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(bobPage.getByTestId("dev-revision")).toHaveText("1", { timeout: 12000 });
    await expect(page.getByTestId("dev-other-seat-bob")).toBeVisible();
    await expect(bobPage.getByTestId("dev-other-seat-alice")).toBeVisible();
    await expect.poll(() => tactical(aliceReads).length).toBe(2);
    await expect.poll(() => tactical(bobReads).length).toBe(2);
    expect(legacy(aliceReads)).toHaveLength(0);
    expect(legacy(bobReads)).toHaveLength(0);

    const before = await request.get(url, { headers: auth(aliceToken) });
    expect(before.status()).toBe(200);
    const matchBeforeRotation = await before.json() as PublicMatch;
    const auditBefore = await request.get(`${url}/audit`, { headers: auth(aliceToken) });
    expect(auditBefore.status()).toBe(200);
    const auditProof = await auditBefore.json();

    await page.getByTestId("dev-rotate-token").click();
    await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
    await expect(page.getByTestId("dev-other-seat-bob")).toBeVisible();
    await expect.poll(() => tactical(aliceReads).length).toBe(3);
    const rotatedToken = tactical(aliceReads)[2].token;
    expect(rotatedToken).toMatch(/^[A-F0-9]{64}$/i);
    expect(rotatedToken).not.toBe(aliceToken);
    expect(tactical(bobReads)).toHaveLength(2);
    expect(legacy(aliceReads)).toHaveLength(0);
    expect(legacy(bobReads)).toHaveLength(0);

    const old = await request.get(`${url}/tactical-overview`, {
      headers: auth(aliceToken),
    });
    expect(old.status()).toBe(404);
    expect(old.headers()["cache-control"]).toBe("no-store");
    const rotatedOverview = await request.get(`${url}/tactical-overview`, {
      headers: auth(rotatedToken!),
    });
    expect(rotatedOverview.status()).toBe(200);
    expect((await rotatedOverview.json()).verifiedRevision).toBe(1);
    const after = await request.get(url, { headers: auth(rotatedToken!) });
    expect(after.status()).toBe(200);
    expect(await after.json()).toEqual(matchBeforeRotation);
    const auditAfter = await request.get(`${url}/audit`, { headers: auth(rotatedToken!) });
    expect(auditAfter.status()).toBe(200);
    expect(await auditAfter.json()).toEqual(auditProof);
  } finally {
    await secondContext.close();
  }
});

test("#89: real .NET owner and nearby tactical filters are browser-only across token rotation",
  async ({ page, request }) => {
  const tacticalReads: { token: string | undefined; path: string }[] = [];
  page.on("request", req => {
    if (req.method() !== "GET") return;
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/tactical-overview"))
      tacticalReads.push({ token: req.headers()["x-edonism-dev-token"], path });
  });
  const created = await startRealMatch(page);
  const id = created.matchId;
  const alice = tokenFor(created, "alice");
  const bob = tokenFor(created, "bob");
  const url = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  const first = await request.get(url, { headers: auth(alice) });
  const auditFirst = await request.get(`${url}/audit`, { headers: auth(alice) });
  expect(first.status()).toBe(200);
  expect(auditFirst.status()).toBe(200);
  const publicBefore = await first.json() as PublicMatch;
  const auditBefore = await auditFirst.json();

  const response = await request.get(`${url}/tactical-overview`, { headers: auth(alice) });
  expect(response.status()).toBe(200);
  const overview = await response.json() as {
    playerId: string;
    verifiedRevision: number;
    otherPlayers: { others: { otherPlayerId: string }[] };
    opponentControlledLots: { routes: {
      slotId: string; ownerPlayerId: string; streetSteps: number; streetPath: string[];
    }[] };
  };
  expect(overview.playerId).toBe("alice");
  expect(overview.verifiedRevision).toBe(0);
  expect(overview.otherPlayers.others.map(x => x.otherPlayerId)).toEqual(["bob"]);
  expect(overview.opponentControlledLots.routes).toHaveLength(1);
  const bobLot = overview.opponentControlledLots.routes[0];
  expect(bobLot.ownerPlayerId).toBe("bob");

  const filter = page.getByTestId("dev-opponent-lots-owner-filter");
  await expect(filter).toHaveValue("");
  await expect(filter.locator('option[value="alice"]')).toHaveCount(0);
  await expect(page.getByTestId(`dev-opponent-lot-${bobLot.slotId}`)).toBeVisible();
  expect(tacticalReads).toHaveLength(1);
  await filter.selectOption("bob");
  await expect(page.getByTestId("dev-opponent-lots-owner-filtered-count"))
    .toContainText("bob");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(1);
  await page.getByTestId(`dev-focus-opponent-lot-${bobLot.slotId}`).click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();

  const nearby = page.getByTestId("dev-opponent-lots-nearby-toggle");
  await nearby.click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li"))
    .toHaveCount(bobLot.streetSteps <= 1 ? 1 : 0);
  if (bobLot.streetSteps > 1)
    await expect(page.getByTestId("dev-opponent-lots-no-owner")).toBeVisible();
  await nearby.click();
  await expect(page.getByTestId(`dev-opponent-lot-${bobLot.slotId}`)).toBeVisible();
  await filter.selectOption("");
  await expect(filter).toHaveValue("");
  expect(tacticalReads).toHaveLength(1);

  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(page.getByTestId(`dev-opponent-lot-${bobLot.slotId}`)).toBeVisible();
  await expect(filter).toHaveValue("");
  await expect(nearby).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => tacticalReads.length).toBe(2);
  const newToken = tacticalReads[1].token;
  expect(newToken).toMatch(/^[A-F0-9]{64}$/i);
  expect(newToken).not.toBe(alice);
  expect(newToken).not.toBe(bob);

  const previous = await request.get(`${url}/tactical-overview`, { headers: auth(alice) });
  expect(previous.status()).toBe(404);
  expect(previous.headers()["cache-control"]).toBe("no-store");
  const after = await request.get(url, { headers: auth(newToken!) });
  const auditAfter = await request.get(`${url}/audit`, { headers: auth(newToken!) });
  expect(after.status()).toBe(200);
  expect(auditAfter.status()).toBe(200);
  expect(await after.json()).toEqual(publicBefore);
  expect(await auditAfter.json()).toEqual(auditBefore);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
});


test("#90: two real .NET browser seats show canonical nearest rival lot and filter without mutations",
  async ({ page, browser, request }) => {
  test.setTimeout(75_000); // #93: two real browsers and repeated public posture checks
  type Lot = { slotId: string; ownerPlayerId: string; streetSteps: number;
    posture: number; streetId: string; streetPath: string[] };
  type Tactical = {
    playerId: string; verifiedRevision: number;
    otherPlayers: { others: { otherPlayerId: string; streetSteps: number; streetPath: string[] }[] };
    opponentControlledLots: { routes: Lot[] };
  };
  const readPaths: string[] = [];
  page.on("request", req => {
    if (req.method() === "GET" && new URL(req.url()).pathname.endsWith("/tactical-overview"))
      readPaths.push(req.headers()["x-edonism-dev-token"] ?? "");
  });
  const created = await startRealMatch(page);
  const id = created.matchId;
  const aliceToken = tokenFor(created, "alice");
  const bobToken = tokenFor(created, "bob");
  const url = `http://127.0.0.1:5080/api/dev/matches/${id}`;
  const getTactical = async (token: string) => {
    const response = await request.get(`${url}/tactical-overview`, { headers: auth(token) });
    expect(response.status()).toBe(200);
    return await response.json() as Tactical;
  };
  const beforeReply = await request.get(url, { headers: auth(aliceToken) });
  const auditReply = await request.get(`${url}/audit`, { headers: auth(aliceToken) });
  expect(beforeReply.status()).toBe(200);
  expect(auditReply.status()).toBe(200);
  const publicBefore = await beforeReply.json();
  const auditBefore = await auditReply.json();
  const aliceTactical = await getTactical(aliceToken);
  const bobTactical = await getTactical(bobToken);

  await expect(page.getByTestId("dev-rival-nearest-list").locator("li")).toHaveCount(1);
  expect(aliceTactical.playerId).toBe("alice");
  expect(bobTactical.playerId).toBe("bob");
  const aliceOther = aliceTactical.otherPlayers.others[0];
  expect(aliceOther.otherPlayerId).toBe("bob");
  await expect(page.getByTestId("dev-rival-public-player-bob"))
    .toHaveAttribute("data-path", aliceOther.streetPath.join(">"));
  await expect(page.getByTestId("dev-rival-public-player-bob"))
    .toHaveAttribute("data-steps", String(aliceOther.streetSteps));
  await page.getByTestId("dev-focus-rival-player-bob").click();
  await expect(page.getByTestId("city-renderer"))
    .toHaveAttribute("data-focus-path", aliceOther.streetPath.join(">"));
  await expect(page.getByTestId("city-tactical-target")).toContainText("bob");
  const nearestBob = aliceTactical.opponentControlledLots.routes
    .filter(lot => lot.ownerPlayerId === "bob")[0];
  expect(nearestBob).toBeDefined();
  await expect(page.getByTestId("dev-rival-nearest-bob"))
    .toHaveAttribute("data-slot", nearestBob.slotId);
  await expect(page.getByTestId("dev-rival-nearest-bob"))
    .toHaveAttribute("data-steps", String(nearestBob.streetSteps));
  // #93: posture is audited public data, never a combat permission or API filter.
  const postureFilter = page.getByTestId("dev-opponent-lots-posture-filter");
  await expect(postureFilter).toHaveValue("all");
  for (const [option, value] of [["standing", 0], ["fallen", 1]] as const) {
    const matching = aliceTactical.opponentControlledLots.routes.filter(lot =>
      lot.ownerPlayerId === "bob" && lot.posture === value);
    await postureFilter.selectOption(option);
    await expect(page.getByTestId("dev-opponent-lots-list").locator("li"))
      .toHaveCount(matching.length);
    if (matching.length)
      await expect(page.getByTestId("dev-rival-nearest-bob"))
        .toHaveAttribute("data-slot", matching[0].slotId);
    else
      await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
    await expect(page.getByTestId("dev-focus-rival-player-bob")).toBeVisible();
  }
  await postureFilter.selectOption("all");
  // #94: the named street is from the same server-verified lot projection.
  const streetFilter = page.getByTestId("dev-opponent-lots-street-filter");
  await expect(streetFilter).toHaveValue("");
  await streetFilter.selectOption(nearestBob.streetId);
  await expect(page.getByTestId("dev-rival-nearest-bob"))
    .toHaveAttribute("data-slot", nearestBob.slotId);
  const emptyStreet = nearestBob.streetId === "gauss" ? "einstein" : "gauss";
  await streetFilter.selectOption(emptyStreet);
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await expect(page.getByTestId("dev-focus-rival-player-bob")).toBeVisible();
  await streetFilter.selectOption("");
  await expect(page.getByTestId("dev-opponent-lot-posture-" + nearestBob.slotId))
    .toBeVisible();
  expect(readPaths).toHaveLength(1);
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("bob");
  await page.getByTestId("dev-focus-rival-nearest-bob").click();
  await expect(page.getByTestId("city-renderer"))
    .toHaveAttribute("data-focus-path", nearestBob.streetPath.join(">"));
  await page.getByTestId("dev-opponent-lots-nearby-toggle").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  if (nearestBob.streetSteps > 1)
    await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  else
    await expect(page.getByTestId("dev-rival-nearest-bob"))
      .toHaveAttribute("data-slot", nearestBob.slotId);
  await page.getByTestId("dev-opponent-lots-nearby-toggle").click();
  await expect(page.getByTestId("dev-rival-nearest-bob"))
    .toHaveAttribute("data-slot", nearestBob.slotId);
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("");
  expect(readPaths).toHaveLength(1);

  const bobContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const bobPage = await bobContext.newPage();
    const bobBrowserReads: string[] = [];
    bobPage.on("request", req => {
      if (req.method() === "GET" && new URL(req.url()).pathname.endsWith("/tactical-overview"))
        bobBrowserReads.push(req.headers()["x-edonism-dev-token"] ?? "");
    });
    await bobPage.goto("/");
    await bobPage.getByTestId("dev-join-id").fill(id);
    await bobPage.getByTestId("dev-join-token").fill(bobToken);
    await bobPage.getByTestId("dev-join").click();
    const nearestAlice = bobTactical.opponentControlledLots.routes
      .filter(lot => lot.ownerPlayerId === "alice")[0];
    expect(nearestAlice).toBeDefined();
    await expect(bobPage.getByTestId("dev-rival-nearest-alice"))
      .toHaveAttribute("data-slot", nearestAlice.slotId);
    await expect(bobPage.getByTestId("dev-rival-nearest-alice"))
      .toHaveAttribute("data-steps", String(nearestAlice.streetSteps));
    const bobPostureFilter = bobPage.getByTestId("dev-opponent-lots-posture-filter");
    for (const [option, value] of [["standing", 0], ["fallen", 1]] as const) {
      const matching = bobTactical.opponentControlledLots.routes.filter(lot =>
        lot.ownerPlayerId === "alice" && lot.posture === value);
      await bobPostureFilter.selectOption(option);
      await expect(bobPage.getByTestId("dev-opponent-lots-list").locator("li"))
        .toHaveCount(matching.length);
      if (matching.length)
        await expect(bobPage.getByTestId("dev-rival-nearest-alice"))
          .toHaveAttribute("data-slot", matching[0].slotId);
      else
        await expect(bobPage.getByTestId("dev-rival-nearest-empty-alice")).toBeVisible();
      await expect(bobPage.getByTestId("dev-focus-rival-player-alice")).toBeVisible();
    }
    await bobPostureFilter.selectOption("all");
    // #94: second bearer independently uses the same immutable public streets.
    const bobStreetFilter = bobPage.getByTestId("dev-opponent-lots-street-filter");
    await bobStreetFilter.selectOption(nearestAlice.streetId);
    await expect(bobPage.getByTestId("dev-rival-nearest-alice"))
      .toHaveAttribute("data-slot", nearestAlice.slotId);
    const otherStreet = nearestAlice.streetId === "gauss" ? "einstein" : "gauss";
    await bobStreetFilter.selectOption(otherStreet);
    await expect(bobPage.getByTestId("dev-rival-nearest-empty-alice")).toBeVisible();
    await expect(bobPage.getByTestId("dev-focus-rival-player-alice")).toBeVisible();
    await bobStreetFilter.selectOption("");

    await expect(bobPage.getByTestId("dev-rival-nearest-bob")).toHaveCount(0);
    expect(bobBrowserReads).toEqual([bobToken]);
    expect(readPaths).toEqual([aliceToken]);
    const bobOther = bobTactical.otherPlayers.others[0];
    expect(bobOther.otherPlayerId).toBe("alice");
    await expect(bobPage.getByTestId("dev-rival-public-player-alice"))
      .toHaveAttribute("data-path", bobOther.streetPath.join(">"));
    await bobPage.getByTestId("dev-focus-rival-player-alice").click();
    await expect(bobPage.getByTestId("city-renderer"))
      .toHaveAttribute("data-focus-path", bobOther.streetPath.join(">"));
    await bobPage.getByTestId("dev-focus-rival-nearest-alice").click();
    await expect(bobPage.getByTestId("city-renderer"))
      .toHaveAttribute("data-focus-path", nearestAlice.streetPath.join(">"));
    await bobPage.getByTestId("dev-opponent-lots-owner-filter").selectOption("alice");
    await expect(bobPage.getByTestId("city-tactical-focus")).toHaveCount(0);
    expect(bobBrowserReads).toEqual([bobToken]);
  } finally {
    await bobContext.close();
  }

  const afterReply = await request.get(url, { headers: auth(aliceToken) });
  const auditAfterReply = await request.get(`${url}/audit`, { headers: auth(aliceToken) });
  expect(afterReply.status()).toBe(200);
  expect(auditAfterReply.status()).toBe(200);
  expect(await afterReply.json()).toEqual(publicBefore);
  expect(await auditAfterReply.json()).toEqual(auditBefore);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
});
