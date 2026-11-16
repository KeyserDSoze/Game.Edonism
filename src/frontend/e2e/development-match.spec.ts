import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// #103: All mutable mock match/seat state and HTTP interception live inside
// mockMatchApi(page), and every test has its own Playwright page/context.
// Parallelize ONLY independent mocked browser tests in this file. The live
// .NET two-browser suite stays strictly serial (workers: 1).
test.describe.configure({ mode: "parallel" });
// E2E mocks stay Node-compatible: do not import Vite's JSON-backed board
// module here, because Node 24 requires a JSON import attribute at runtime.
const mockStreetGraph: Record<string, readonly string[]> = {
  gauss: ["main-square", "newton", "planck"],
  einstein: ["main-square", "newton", "planck"],
  newton: ["boson", "einstein", "gauss"],
  planck: ["einstein", "gauss", "meson"],
  boson: ["main-square", "newton"],
  meson: ["main-square", "planck"],
  "main-square": ["boson", "einstein", "gauss", "meson"],
};
function shortestStreetPath(from: string, to: string): string[] | null {
  if (!mockStreetGraph[from] || !mockStreetGraph[to]) return null;
  const parents = new Map<string, string | null>([[from, null]]);
  const pending = [from];
  for (let i = 0; i < pending.length; i++) {
    const current = pending[i];
    if (current === to) {
      const reversed: string[] = [];
      for (let street: string | null = current; street !== null;
        street = parents.get(street) ?? null) reversed.push(street);
      return reversed.reverse();
    }
    for (const next of mockStreetGraph[current]) {
      if (parents.has(next)) continue;
      parents.set(next, current);
      pending.push(next);
    }
  }
  return null;
}

type Seat = string;
const demoSeats = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"] as const;
// #143: test-only complete printed-card fixture. Its category distribution
// mirrors .NET ActivityPlacement's p.4 quotas. Alice's N-01 is culture
// and Bob's S-01 is transport; the remaining 28 are public/uncontrolled.
const mockPrintedSlotIds143 = [
  ...Array.from({ length: 8 }, (_, i) => `N-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, i) => `S-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, i) => `W-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 3 }, (_, i) => `E-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, i) => `B-${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 4 }, (_, i) => `M-${String(i + 1).padStart(2, "0")}`),
];
const mockRemainingPrintedCategories143: string[] = [
  ...Array(5).fill("public-financing"),
  ...Array(5).fill("private-financing"),
  ...Array(4).fill("black-market"),
  ...Array(4).fill("corruption"),
  ...Array(3).fill("culture"),
  ...Array(2).fill("sport"),
  ...Array(2).fill("transport"),
  ...Array(3).fill("bishopric"),
];
const mockFullBoardExtras143 = mockPrintedSlotIds143
  .filter(id => id !== "N-01" && id !== "S-01")
  .map((slotId, i) => ({
    slotId, cardId: `synthetic:printed:${slotId}`,
    category: mockRemainingPrintedCategories143[i],
  }));
// #114: All synthetic 2–8 seat bearers must obey the same 64-hex format
// as the real server and the Development join/rotation controls.
const mockSeatToken = (index: number) => "abcdef01".charAt(index).repeat(64);
type MockOptions = {
  conflictOnFirstMove?: boolean;
  creationFails?: boolean;
  creatorCredentialFaultOnce?: "duplicate-token" | "short-token" | "null-token" | "wrong-seat";
  forgedCreatorAuditChronologyOnce?: boolean; // #119: valid credentials, false public timeline.
  forgedCreatorTurnOrderOnce?: boolean; // #120: correct credentials, false next-round order.
  forgedCreatorBoardVersionOnce?: boolean; // #122: false board version on creator 201.
  rotationCredentialFaultOnce?: "other-seat" | "other-seat-uppercase"; // #115 fake 200, no backend rotation.
  sameStreet?: boolean;
  unknownStreet?: boolean;
  fallenHenchman?: boolean;
  invalidGrossQuote?: boolean; // #105: forged public total, never server wallet state.
  missingGrossQuote?: boolean; // #107: a forged incomplete public quote set.
  malformedReserve?: boolean; // #139: public henchmen reserve contradicts owned lots.
  forgedAssignedCharacter?: "wrong-hearts" | "forged-seat-hearts" | "duplicate-character"
    | "duplicate-starting-activity" | "missing-seat" | "foreign-actor" | "bad-heart"; // #141.
  unownedBoardCard?: "valid" | "duplicate" | "foreign" | "bad-category" | "bad-id"; // #140: untouched controlled cards.
  duplicatePublicCardIds?: "unowned-vs-unowned" | "unowned-vs-controlled" | "controlled-vs-controlled"; // #142: distinct canonical slots, cloned physical card.
  publicCardCategory?: "partial-valid" | "partial-foreign" | "partial-casing"
    | "full-valid" | "full-bad-quota"; // #143: category/quota on unowned lots.
  forgedFullBoardOrigin?: "foreign-card" | "missing-card"; // #145: public starting-card provenance.
  forgedHigherRevisionSnapshot?: boolean; // #112: corrupt first public poll, never a real command.
  forgedNullAuditEventSnapshot?: boolean; // #113: corrupt first poll with events:[null].
  forgedForeignAuditStreetOnce?: boolean; // #125: plausible public 200 with foreign audit road.
  forgedForeignAuditActorOnce?: boolean; // #126: plausible public 200 with foreign actor.
  forgedNonGenesisOnce?: "reserved-actor" | "duplicate-genesis"; // #134: valid transport, impossible origin.
  forgedKnownEndpointsOnce?: "move-missing-destination" | "end-with-origin" | "pending-with-destination"; // #135.
  forgedUnicodePlayerIdOnce?: boolean; // #127: invisible bidi roster actor in otherwise coherent snapshot.
  forgedSystemSeatOnce?: boolean; // #128: reserved genesis ID impersonates an ordinary seat.
  forgedStartingSlotOnce?: "duplicate" | "unknown"; // #129: forged origin lot.
  forgedPhaseActorMismatchSnapshot?: boolean; // #116: phase1 with active Alice in forged poll.
  forgedAuditChronologySnapshot?: boolean; // #119: high revision with genesis only.
  forgedPublicTurnOrderOnce?: boolean; // #120: coherent next revision but false order.
  forgedPublicBoardVersionOnce?: boolean; // #122: false board version on public poll 200.
  forgedSameRevisionOnce?: "street" | "quote"; // #121: valid 200, same revision but different public JSON.
  badControlSlot?: boolean;
  unknownOwner?: boolean;
  missingBoardCard?: boolean;
  malformedPublicCardId?: boolean; // #108: wire-format cardId is JSON number.
  unknownSecretEvent?: boolean;
  playerCount?: number;
  brokenSeatBootstrap?: "wrong-player" | "wrong-revision";
  forgedJoinedAuditChronologyOnce?: boolean; // #119: false revision in atomic /seat.
  forgedJoinedTurnOrderOnce?: boolean; // #120: coherent bootstrap except false preview.
  forgedJoinedBoardVersionOnce?: boolean; // #122: false board version on atomic seat read.
  forgedJoinedHandOnce?: boolean; // #118: duplicate private cards in atomic /seat.
  forgedBobHandOnce?: boolean; // #118: malformed 200 /hand before later valid recovery.
  bootstrapUnavailable?: boolean;
  noTurnOptions?: boolean;
  invalidTurnOptions?: boolean;
  forgedSecondMoveOptionsOnce?: boolean; // #117: 200 offers another move after use.
  forgedUnknownStreetOptionsOnce?: boolean; // #124: forged canonical/foreign destination mix.
  delayFirstAliceOptions?: boolean;
  dropFirstEndTurnResponse?: boolean;
  http503FirstEndTurn?: boolean;
  overloadFirstConditionalWait?: boolean;
  historyUnavailable?: boolean;
  corruptHistory?: boolean;
  tamperHistoryFrame?: "street" | "move-flag" | "active" | "phase" | "actor";
  presenceUnavailable?: boolean;
  invalidPresence?: boolean;
  delayFirstAlicePresence?: boolean;
  invalidTurnProgress?: boolean;
  delayFirstAliceTurnProgress?: boolean;
  invalidSettlementPreview?: boolean;
  delayFirstSettlementPreview?: boolean;
  routePlannerWithFreeCards?: boolean;
  invalidRoutePlanner?: boolean;
  delayFirstAliceRoutes?: boolean;
  invalidRoutePath?: boolean;
  invalidRouteSteps?: boolean;
  invalidOtherSeatRoutes?: "revision" | "path" | "steps" | "count" | "identity";
  delayFirstAliceOtherSeatRoutes?: boolean;
  invalidOpponentLots?: "revision" | "owner" | "path" | "street" | "posture" | "count" | "steps";
  delayFirstAliceOpponentLots?: boolean;
  invalidTacticalOverview?: "outer-revision" | "outer-player" | "nested-origin"
    | "nested-lots-player" | "missing-uncontrolled" | "missing-other" | "missing-lots";
  delayRotationAcknowledgement?: boolean;
  bobLotOnSecondSlot?: boolean; // #104: a legitimate rival-held non-first space on Einstein Avenue.
};

async function mockMatchApi(page: Page, options: MockOptions = {}) {
  const seats = demoSeats.slice(0, options.playerCount ?? 2);
  const bobLotSlot = options.bobLotOnSecondSlot ? "S-02" : "S-01";
  const tokenToSeat = new Map(seats.map((seat, index) =>
    [mockSeatToken(index), seat]));
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
  let rotationCredentialFaultIssued = false;
  let snapshotFailure = false;
  let delayRevokedResponse = false;
  let delayedRevokedResponse = false;
  let delayedAliceOptions = false;
  let forgedSecondMoveIssued = false;
  let forgedForeignAuditIssued = false;
  let forgedForeignActorIssued = false;
  let forgedNonGenesisIssued = false;
  let forgedKnownEndpointsIssued = false;
  let forgedUnicodePlayerIdIssued = false;
  let forgedSystemSeatIssued = false;
  let forgedStartingSlotIssued = false;
  let forgedUnknownStreetIssued = false;
  let forgedJoinedHandIssued = false;
  let forgedBobHandIssued = false;
  const observedInvalidHandReplies: Array<"seat" | "hand"> = [];
  let firstResponseDropped = false;
  let firstHttp503 = false;
  let firstOverloadedPoll = false;
  let forgedHigherRevisionSent = false;
  let forgedSameRevisionSent = false;
  let forgedJoinedAuditChronologySent = false;
  let forgedJoinedTurnOrderSent = false;
  let forgedJoinedBoardVersionSent = false;
  let creatorCredentialFaultIssued = false;
  let forgedCreatorAuditIssued = false;
  let forgedCreatorTurnOrderSent = false;
  let forgedCreatorBoardVersionSent = false;
  let forgedPublicBoardVersionSent = false;
  let delayedAlicePresence = false;
  let delayedSettlement = false;
  let delayedAliceTurnProgress = false;
  let delayedAliceRoutes = false;
  let delayedAliceOtherSeats = false;
  let delayedAliceOpponentLots = false;
  const presentSeats = new Set<Seat>();
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
  const observedForgedOptions: Array<{ seat: string; revision: number }> = [];

  const snapshot = () => ({
    matchId: "00000000-0000-0000-0000-000000000020",
    boardVersion: "edonism-streets-v1",
    round: 1,
    // The synthetic unknown-kind privacy regression must keep a coherent
    // public event count, even though .NET won't emit that kind yet.
    revision: options.unknownSecretEvent ? revision + 1 : revision,
    phase,
    activePlayerId: active,
    turnOrder: [...seats],
    proposedNextRoundOrder: [...seats.slice(-1), ...seats.slice(0, -1)],
    events: options.unknownSecretEvent
      ? [...auditEvents, { revision: revision + 1, round: 1, kind: "private-action",
          actorId: "alice", fromStreetId: null, toStreetId: null }]
      : [...auditEvents],
    players: seats.map((playerId, index) => ({
      playerId,
      streetId: streets[playerId],
      startingSlotId: playerId === "alice" ? "N-01" : playerId === "bob" ? bobLotSlot
        : `N-${String(index + 1).padStart(2, "0")}`,
      hearts: playerId === "alice" && options.forgedAssignedCharacter === "forged-seat-hearts"
        ? 4 : 3,
      // #139: real .NET public fixture: 4 atoms, 2 diplomacy, 16
      // henchmen, one deployed on each of the first two starting lots.
      atoms: 4,
      diplomacyTokens: 2,
      henchmenTotal: 16,
      henchmenAvailable: playerId === "alice" && options.malformedReserve
        ? 14 : playerId === "alice" || playerId === "bob" ? 15 : 16,
      freeMoveUsed: moved[playerId],
    })),
    boardActivities: [
      { slotId: "N-01", cardId: "demo:activity:gauss", category: "culture" },
      ...(options.routePlannerWithFreeCards ? [
        { slotId: "N-02", cardId: "demo:activity:free-gauss", category: "culture" },
        ...(options.bobLotOnSecondSlot ? [] : [
          { slotId: "S-02", cardId: "demo:activity:free-einstein", category: "sport" },
        ]),
      ] : []),
      ...(options.missingBoardCard
        ? []
        : [{ slotId: bobLotSlot, cardId: options.malformedPublicCardId
          ? (42 as unknown as string)
          : options.duplicatePublicCardIds === "controlled-vs-controlled"
            ? "demo:activity:gauss" : "demo:activity:einstein", category: "transport" }]),
      // #140: all these extras occupy only an UNCONTROLLED lot, so every
      // previous controlledLotMarkers() still succeeds. Two N-08 cards,
      // a foreign slot or bad metadata must invalidate board totals AND
      // all finance/resource views without disabling valid game commands.
      ...(options.unownedBoardCard === "duplicate" ? [
        { slotId: "N-08", cardId: "demo:unowned:a", category: "culture" },
        { slotId: "N-08", cardId: "demo:unowned:b", category: "culture" },
      ] : options.unownedBoardCard ? [
        { slotId: options.unownedBoardCard === "foreign"
            ? "not-printed" : "N-08",
          cardId: options.unownedBoardCard === "bad-id"
            ? 42 as unknown as string : "demo:unowned:valid",
          category: options.unownedBoardCard === "bad-category"
            ? 42 as unknown as string : "culture" },
      ] : []),
      // #142: separate, canonical FREE slots with one cloned physical
      // activity ID; independent controlled-lot and pawn projections remain.
      ...(options.duplicatePublicCardIds === "unowned-vs-controlled" ? [
        { slotId: "N-07", cardId: "demo:activity:gauss", category: "culture" },
      ] : options.duplicatePublicCardIds === "unowned-vs-unowned" ? [
        { slotId: "N-07", cardId: "demo:free:duplicated-id", category: "culture" },
        { slotId: "N-08", cardId: "demo:free:duplicated-id", category: "culture" },
      ] : []),
      // #143: all extra slots remain unowned; only their printed category
      // changes. For a full 30-card list the quota table must be exact.
      ...(options.publicCardCategory === "full-valid"
        || options.publicCardCategory === "full-bad-quota"
        ? mockFullBoardExtras143.map((card, i) => ({
          ...card,
          category: options.publicCardCategory === "full-bad-quota" && i === 0
            ? "culture" : card.category,
        }))
        : options.publicCardCategory ? [{
          slotId: "N-08", cardId: "synthetic:category:unowned",
          category: options.publicCardCategory === "partial-foreign"
            ? "outer-space"
            : options.publicCardCategory === "partial-casing"
              ? "Culture" : "culture",
        }] : []),
    ],
    // #141: these are PUBLIC server-assigned card facts, not private hands.
    // The roster's printed hearts must agree with exactly one distinct
    // public character and initial activity per seat. All other Development
    // view validators intentionally remain independent from this field.
    assignedCharacters: seats.filter(playerId =>
      !(options.forgedAssignedCharacter === "missing-seat" && playerId === "bob"))
      .map((playerId, index) => ({
        playerId: playerId === "bob"
          && options.forgedAssignedCharacter === "foreign-actor" ? "intruder" : playerId,
        characterId: playerId === "bob"
          && options.forgedAssignedCharacter === "duplicate-character"
            ? "synthetic:character:alice" : `synthetic:character:${playerId}`,
        startingActivityCardId: playerId === "bob"
          && options.forgedAssignedCharacter === "duplicate-starting-activity"
            ? "synthetic:starting:alice"
            : playerId === "alice" && options.forgedFullBoardOrigin
              ? options.forgedFullBoardOrigin === "foreign-card"
                ? "synthetic:printed:W-01" : "synthetic:nonexistent"
            : (options.publicCardCategory === "full-valid"
              || options.publicCardCategory === "full-bad-quota")
              ? playerId === "alice" ? "demo:activity:gauss"
                : playerId === "bob" ? "demo:activity:einstein"
                  : `synthetic:printed:N-${String(index + 1).padStart(2, "0")}`
              : `synthetic:starting:${playerId}`,
        printedInitialHearts: playerId === "alice"
          && options.forgedAssignedCharacter === "wrong-hearts" ? 4
          : playerId === "alice"
            && options.forgedAssignedCharacter === "bad-heart" ? 0 : 3,
      })),
    controlledActivities: [
      { slotId: "N-01", ownerPlayerId: "alice", posture: 0 },
      {
        slotId: options.badControlSlot ? "does-not-exist" : bobLotSlot,
        ownerPlayerId: options.unknownOwner ? "intruder" : "bob",
        posture: options.fallenHenchman ? 1 : 0,
      },
    ],
    // #107: one public read-only quote per synthetic seat, including
    // additional seats without controlled activities (2 base / 0 standing).
    // These values are *not* server-authored wallet credits.
    grossSalaryQuotes: seats.map(playerId => {
      const standingActivityAtoms = playerId === "alice"
        || (playerId === "bob" && !options.fallenHenchman) ? 1 : 0;
      return {
        playerId, baseAtoms: 2, standingActivityAtoms,
        grossAtoms: playerId === "alice" && options.invalidGrossQuote
          ? 999 : 2 + standingActivityAtoms,
      };
    }).filter(quote => !options.missingGrossQuote || quote.playerId !== "bob"),
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
    const responseFrames = frames.map((frame, index) => {
      // A forged INTERMEDIATE frame: genesis and the latest authoritative
      // revision remain genuine, so matching only the final frame is unsafe.
      if (index !== 1 || frames.length < 3 || !options.tamperHistoryFrame)
        return frame;
      switch (options.tamperHistoryFrame) {
        case "street":
          return { ...frame, players: frame.players.map(player =>
            player.playerId === "alice" ? { ...player, streetId: "main-square" } : player) };
        case "move-flag":
          return { ...frame, players: frame.players.map(player =>
            player.playerId === "alice" ? { ...player, freeMoveUsed: false } : player) };
        case "active":
          return { ...frame, activePlayerId: "bob" };
        case "phase":
          return { ...frame, phase: 1 };
        case "actor":
          return { ...frame, actorId: "bob" };
      }
    });
    return {
      matchId: snapshot().matchId,
      verifiedRevision: revision,
      frames: options.corruptHistory
        ? responseFrames.map((frame, index) => index === 0
          ? { ...frame, kind: "secret-action" } : frame)
        : responseFrames,
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
      const credentials = seats.map((playerId, index) => ({
        playerId, token: mockSeatToken(index),
      }));
      if (options.creatorCredentialFaultOnce && !creatorCredentialFaultIssued) {
        creatorCredentialFaultIssued = true;
        switch (options.creatorCredentialFaultOnce) {
          case "duplicate-token": credentials[1].token = credentials[0].token; break;
          case "short-token": credentials[0].token = "abc"; break;
          case "null-token":
            credentials[0].token = null as unknown as string; break;
          case "wrong-seat": credentials[1].playerId = "intruder"; break;
        }
      }
      const forgedCreatorAudit = Boolean(options.forgedCreatorAuditChronologyOnce
        && !forgedCreatorAuditIssued);
      if (forgedCreatorAudit) forgedCreatorAuditIssued = true;
      const forgedCreatorOrder = Boolean(options.forgedCreatorTurnOrderOnce
        && !forgedCreatorTurnOrderSent);
      if (forgedCreatorOrder) forgedCreatorTurnOrderSent = true;
      const forgedCreatorBoard = Boolean(options.forgedCreatorBoardVersionOnce
        && !forgedCreatorBoardVersionSent);
      if (forgedCreatorBoard) forgedCreatorBoardVersionSent = true;
      const createdState = forgedCreatorAudit
        ? { ...snapshot(), revision: 43 }
        : forgedCreatorOrder
          ? { ...snapshot(), proposedNextRoundOrder: [...seats] }
          : forgedCreatorBoard
            ? { ...snapshot(), boardVersion: "foreign-board-v2" }
            : snapshot();
      return reply({
        status: 201,
        json: { matchId: snapshot().matchId, state: createdState, credentials },
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
      const forgedJoinAudit = Boolean(options.forgedJoinedAuditChronologyOnce
        && !forgedJoinedAuditChronologySent && seat === "bob");
      if (forgedJoinAudit) forgedJoinedAuditChronologySent = true;
      const forgedJoinOrder = Boolean(options.forgedJoinedTurnOrderOnce
        && !forgedJoinedTurnOrderSent && seat === "bob");
      if (forgedJoinOrder) forgedJoinedTurnOrderSent = true;
      const forgedJoinBoard = Boolean(options.forgedJoinedBoardVersionOnce
        && !forgedJoinedBoardVersionSent && seat === "bob");
      if (forgedJoinBoard) forgedJoinedBoardVersionSent = true;
      // Actor, options, hand, revision and public audit remain coherent.
      // Only the displayed proposed round rotation is false in #120.
      const seatState = forgedJoinAudit
        ? { ...snapshot(), revision: 42 }
        : forgedJoinOrder
          ? { ...snapshot(), proposedNextRoundOrder: [...seats] }
          : forgedJoinBoard
            ? { ...snapshot(), boardVersion: "foreign-board-v2" }
            : snapshot();
      const adjacent: Record<string, string[]> = {
        gauss: ["planck", "newton", "main-square"],
        planck: ["gauss", "einstein", "meson"],
        einstein: ["newton", "planck", "main-square"],
        newton: ["gauss", "einstein", "boson"],
        meson: ["planck", "boson"],
        boson: ["newton", "meson"],
        "main-square": ["gauss", "einstein"],
      };
      const joinedCards = Array.from({ length: 4 }, (_, index) =>
        `demo:action:${String((seat === "alice" ? 1
          : 21 + (seats.indexOf(seat) - 1) * 4) + index).padStart(2, "0")}`);
      if (options.forgedJoinedHandOnce && !forgedJoinedHandIssued && seat === "bob") {
        forgedJoinedHandIssued = true;
        observedInvalidHandReplies.push("seat");
        joinedCards[1] = joinedCards[0]; // keep HTTP 200, actor and options valid.
      }
      return reply({
        status: 200, headers: { "Cache-Control": "no-store" },
        json: {
          matchId: snapshot().matchId,
          playerId: options.brokenSeatBootstrap === "wrong-player" ? "alice" : seat,
          state: seatState,
          hand: {
            matchId: snapshot().matchId,
            playerId: seat,
            cardIds: joinedCards,
          },
          turnOptions: {
            matchId: snapshot().matchId,
            playerId: seat,
            revision: options.brokenSeatBootstrap === "wrong-revision"
              ? revision + 1 : seatState.revision,
            canEndTurn: seatHasTurn,
            freeMoveStreetIds: seatHasTurn && !moved[seat]
              ? adjacent[streets[seat]] ?? [] : [],
          },
        },
      });
    }

    if (path.endsWith("/presence")) {
      if (options.presenceUnavailable)
        return reply({ status: 503, json: { code: "temporarily_unavailable" } });
      if (options.delayFirstAlicePresence && seat === "alice" && !delayedAlicePresence) {
        delayedAlicePresence = true;
        await new Promise(resolve => setTimeout(resolve, 900));
      }
      if (request.method() === "POST") presentSeats.add(seat);
      return reply({ status: 200, json: {
        matchId: snapshot().matchId,
        seats: seats.map(id => ({
          playerId: options.invalidPresence && id === "bob" ? "intruder" : id,
          isActive: presentSeats.has(id),
        })),
      } });
    }

    // #88: one atomic, bearer-bound tactical snapshot replaces three client
    // GETs. Retain legacy mocked paths below for explicit API compatibility.
    if (path.endsWith("/tactical-overview")) {
      const state = snapshot();
      const origin = streets[seat];
      const fields = {
        matchId: state.matchId, playerId: seat, round: state.round,
        verifiedRevision: revision, fromStreetId: origin,
      };
      const opponentRoutes = state.controlledActivities
        .filter(lot => lot.ownerPlayerId !== seat)
        .map(lot => {
          const streetId = lot.slotId.startsWith("N-") ? "gauss" : "einstein";
          const streetPath = shortestStreetPath(origin, streetId) ?? [];
          return {
            slotId: lot.slotId, ownerPlayerId: lot.ownerPlayerId,
            posture: lot.posture, streetId, streetSteps: streetPath.length - 1,
            streetPath,
          };
        }).sort((a, b) => a.streetSteps - b.streetSteps
          || a.ownerPlayerId.localeCompare(b.ownerPlayerId)
          || a.slotId.localeCompare(b.slotId));
      if (opponentRoutes.length && options.invalidOpponentLots) {
        const first = opponentRoutes[0];
        if (options.invalidOpponentLots === "owner") first.ownerPlayerId = seat;
        if (options.invalidOpponentLots === "path") first.streetPath = [origin, "main-square"];
        if (options.invalidOpponentLots === "street") first.streetId = "unmapped-road";
        if (options.invalidOpponentLots === "posture") first.posture = 99;
        if (options.invalidOpponentLots === "steps") first.streetSteps++;
        if (options.invalidOpponentLots === "count") opponentRoutes.pop();
      }

      const otherPlayers = seats.filter(id => id !== seat).map(id => {
        const streetId = streets[id];
        const streetPath = shortestStreetPath(origin, streetId) ?? [];
        const controls = state.controlledActivities.filter(c => c.ownerPlayerId === id);
        return {
          otherPlayerId: id, streetId, streetSteps: streetPath.length - 1,
          streetPath, controlledActivities: controls.length,
          standingHenchmen: controls.filter(c => c.posture === 0).length,
        };
      }).sort((a, b) => a.streetSteps - b.streetSteps
        || a.otherPlayerId.localeCompare(b.otherPlayerId));
      if (otherPlayers.length && options.invalidOtherSeatRoutes) {
        const first = otherPlayers[0];
        if (options.invalidOtherSeatRoutes === "path") first.streetPath = [origin, "main-square"];
        if (options.invalidOtherSeatRoutes === "steps") first.streetSteps++;
        if (options.invalidOtherSeatRoutes === "count") first.controlledActivities++;
        if (options.invalidOtherSeatRoutes === "identity") first.otherPlayerId = "intruder";
      }

      const unowned = state.boardActivities.filter(card =>
        !state.controlledActivities.some(c => c.slotId === card.slotId));
      const uncontrolledRoutes = unowned.map(card => {
        const streetId = card.slotId.startsWith("N-") ? "gauss" : "einstein";
        const streetPath = shortestStreetPath(origin, streetId) ?? [];
        const streetSteps = streetPath.length - 1
          + (options.invalidRouteSteps && card.slotId === "S-02" ? 1 : 0);
        return {
          ...card, streetId, streetSteps,
          streetPath: options.invalidRoutePath && card.slotId === "S-02"
            ? [origin, streetId] : streetPath,
        };
      }).sort((a, b) => a.streetSteps - b.streetSteps
        || a.slotId.localeCompare(b.slotId));

      // Snapshot is captured BEFORE any delayed response: the old actor's
      // result can never be relabeled with a newer seat/revision.
      if (seat === "alice" && (
        (options.delayFirstAliceRoutes && !delayedAliceRoutes)
        || (options.delayFirstAliceOtherSeatRoutes && !delayedAliceOtherSeats)
        || (options.delayFirstAliceOpponentLots && !delayedAliceOpponentLots)
      )) {
        delayedAliceRoutes = true;
        delayedAliceOtherSeats = true;
        delayedAliceOpponentLots = true;
        await new Promise(resolve => setTimeout(resolve, 900));
      }
      const defect = options.invalidTacticalOverview;
      return reply({ status: 200, json: {
        ...fields,
        playerId: defect === "outer-player" ? "intruder" : seat,
        verifiedRevision: defect === "outer-revision" ? revision + 1 : revision,
        uncontrolled: defect === "missing-uncontrolled" ? null : {
          ...fields,
          verifiedRevision: options.invalidRoutePlanner ? revision + 5 : revision,
          routes: uncontrolledRoutes,
        },
        otherPlayers: defect === "missing-other" ? null : {
          ...fields,
          verifiedRevision: options.invalidOtherSeatRoutes === "revision"
            ? revision + 99 : revision,
          fromStreetId: defect === "nested-origin" ? "invalid-street" : origin,
          others: otherPlayers,
        },
        opponentControlledLots: defect === "missing-lots" ? null : {
          ...fields,
          playerId: defect === "nested-lots-player" ? "intruder" : seat,
          verifiedRevision: options.invalidOpponentLots === "revision"
            ? revision + 99 : revision,
          routes: opponentRoutes,
        },
      } });
    }

    if (path.endsWith("/opponent-controlled-routes")) {
      const state = snapshot();
      const origin = streets[seat];
      const routes = state.controlledActivities
        .filter(lot => lot.ownerPlayerId !== seat)
        .map(lot => {
          const streetId = lot.slotId.startsWith("N-") ? "gauss" : "einstein";
          const streetPath = shortestStreetPath(origin, streetId) ?? [];
          return {
            slotId: lot.slotId,
            ownerPlayerId: lot.ownerPlayerId,
            posture: lot.posture,
            streetId,
            streetSteps: streetPath.length - 1,
            streetPath,
          };
        }).sort((a, b) => a.streetSteps - b.streetSteps
          || a.ownerPlayerId.localeCompare(b.ownerPlayerId)
          || a.slotId.localeCompare(b.slotId));
      if (routes.length && options.invalidOpponentLots) {
        const first = routes[0];
        if (options.invalidOpponentLots === "owner") first.ownerPlayerId = seat;
        if (options.invalidOpponentLots === "path") first.streetPath = [origin, "main-square"];
        if (options.invalidOpponentLots === "posture") first.posture = 99;
        if (options.invalidOpponentLots === "steps") first.streetSteps++;
        if (options.invalidOpponentLots === "count") routes.pop();
      }
      if (options.delayFirstAliceOpponentLots && seat === "alice"
        && !delayedAliceOpponentLots) {
        delayedAliceOpponentLots = true;
        await new Promise(resolve => setTimeout(resolve, 900));
      }
      return reply({ status: 200, json: {
        matchId: state.matchId, playerId: seat, round: state.round,
        verifiedRevision: options.invalidOpponentLots === "revision"
          ? revision + 99 : revision,
        fromStreetId: origin, routes,
      } });
    }

    if (path.endsWith("/other-player-routes")) {
      const state = snapshot();
      const origin = streets[seat];
      const others = seats.filter(id => id !== seat).map(id => {
        const streetId = streets[id];
        const canonical = shortestStreetPath(origin, streetId) ?? [];
        const controls = state.controlledActivities.filter(c => c.ownerPlayerId === id);
        return {
          otherPlayerId: id,
          streetId,
          streetSteps: canonical.length - 1,
          streetPath: canonical,
          controlledActivities: controls.length,
          standingHenchmen: controls.filter(c => c.posture === 0).length,
        };
      }).sort((a, b) => a.streetSteps - b.streetSteps
        || (a.otherPlayerId < b.otherPlayerId ? -1 : a.otherPlayerId > b.otherPlayerId ? 1 : 0));
      if (others.length && options.invalidOtherSeatRoutes) {
        const target = others[0];
        if (options.invalidOtherSeatRoutes === "path") target.streetPath = [origin, "main-square"];
        if (options.invalidOtherSeatRoutes === "steps") target.streetSteps++;
        if (options.invalidOtherSeatRoutes === "count") target.controlledActivities++;
        if (options.invalidOtherSeatRoutes === "identity") target.otherPlayerId = "intruder";
      }
      if (options.delayFirstAliceOtherSeatRoutes && seat === "alice"
        && !delayedAliceOtherSeats) {
        delayedAliceOtherSeats = true;
        await new Promise(resolve => setTimeout(resolve, 900));
      }
      return reply({ status: 200, json: {
        matchId: state.matchId, playerId: seat, round: state.round,
        verifiedRevision: options.invalidOtherSeatRoutes === "revision" ? revision + 99 : revision,
        fromStreetId: origin, others,
      } });
    }

    if (path.endsWith("/uncontrolled-routes")) {
      const position = streets[seat];
      const cards = snapshot().boardActivities.filter(card =>
        !snapshot().controlledActivities.some(owned => owned.slotId === card.slotId));
      const routes = cards.map(card => {
        const streetId = card.slotId.startsWith("N-") ? "gauss" : "einstein";
        const streetPath = shortestStreetPath(position, streetId) ?? [];
        const streetSteps = streetPath.length - 1
          + (options.invalidRouteSteps && card.slotId === "S-02" ? 1 : 0);
        return { ...card, streetId, streetSteps, streetPath:
          options.invalidRoutePath && card.slotId === "S-02"
            ? [position, streetId] : streetPath };
      }).sort((a, b) => a.streetSteps - b.streetSteps
        || a.slotId.localeCompare(b.slotId));
      if (options.delayFirstAliceRoutes && seat === "alice" && !delayedAliceRoutes) {
        delayedAliceRoutes = true;
        await new Promise(resolve => setTimeout(resolve, 900));
      }
      return reply({ status: 200, json: {
        matchId: snapshot().matchId, playerId: seat, round: 1,
        verifiedRevision: options.invalidRoutePlanner ? revision + 5 : revision,
        fromStreetId: position, routes,
      } });
    }

    if (path.endsWith("/turn-progress")) {
      const completed = phase === 1 ? seats.length : seats.indexOf(active!);
      if (options.delayFirstAliceTurnProgress && seat === "alice"
        && !delayedAliceTurnProgress) {
        delayedAliceTurnProgress = true;
        await new Promise(resolve => setTimeout(resolve, 900));
      }
      return reply({ status: 200, json: {
        matchId: snapshot().matchId, round: 1,
        verifiedRevision: options.invalidTurnProgress ? revision + 99 : revision,
        phase, activePlayerId: active, totalTurns: seats.length,
        completedTurns: completed,
        completedPlayerIds: seats.slice(0, completed),
        remainingPlayerIds: seats.slice(completed),
      } });
    }

    if (path.endsWith("/settlement-preview")) {
      if (phase !== 1) return reply({ status: 409, json: { code: "round_not_pending" } });
      const data = {
        matchId: snapshot().matchId,
        round: 1,
        verifiedRevision: options.invalidSettlementPreview ? revision + 4 : revision,
        nextTurnOrder: [...seats].reverse(),
        grossSalaryQuotes: seats.map(playerId => ({
          playerId, baseAtoms: 2, standingActivityAtoms: 1, grossAtoms: 3,
        })),
      };
      if (options.delayFirstSettlementPreview && !delayedSettlement) {
        delayedSettlement = true;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return reply({ status: 200, json: data });
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
      // #117: one malicious 200 after a *real* consumed free move must not
      // advertise a second one. The next request returns genuine .NET-shaped
      // options so the actor can recover without changing public revision.
      const forgedSecondMove = options.forgedSecondMoveOptionsOnce
        && !forgedSecondMoveIssued && seat === "alice" && isTurn
        && moved[seat] && revision === 1;
      if (forgedSecondMove) {
        forgedSecondMoveIssued = true;
        observedForgedOptions.push({ seat, revision });
      }
      // #124: a typed, revision-correct HTTP 200 may contain an invented
      // destination alongside a real printed street. Reject the entire lease.
      const forgedForeignStreet = options.forgedUnknownStreetOptionsOnce
        && !forgedUnknownStreetIssued && seat === "alice" && isTurn
        && !moved[seat] && revision === 0;
      if (forgedForeignStreet) {
        forgedUnknownStreetIssued = true;
        observedForgedOptions.push({ seat, revision });
      }
      return reply({
        status: 200, headers: { "Cache-Control": "no-store" },
        json: {
          matchId: snapshot().matchId,
          playerId: seat,
          revision: options.invalidTurnOptions ? revision + 999 : revision,
          canEndTurn: isTurn,
          freeMoveStreetIds: forgedForeignStreet ? ["planck", "unmapped-road"]
            : forgedSecondMove ? ["meson"]
            : isTurn && !moved[seat] ? neighbors[streets[seat]] ?? [] : [],
        },
      });
    }

    if (path.endsWith("/hand")) {
      const cards = Array.from({ length: 4 }, (_, index) =>
        `demo:action:${String((seat === "alice" ? 1 : 21 + (seats.indexOf(seat) - 1) * 4) + index).padStart(2, "0")}`);
      if (options.forgedBobHandOnce && !forgedBobHandIssued && seat === "bob") {
        forgedBobHandIssued = true;
        observedInvalidHandReplies.push("hand");
        cards[1] = cards[0]; // corrupt private read only, not the server deck.
      }
      return reply({
        status: 200, headers: { "Cache-Control": "no-store" },
        json: { matchId: snapshot().matchId, playerId: seat, cardIds: cards },
      });
    }


    if (path.endsWith("/rotate-token") && request.method() === "POST") {
      // #115: A forged HTTP 200 with a different local seat's bearer must NOT
      // be treated as a successful server rotation. The mock does not revoke
      // the old bearer for this malformed reply, allowing a real retry.
      if (options.rotationCredentialFaultOnce && !rotationCredentialFaultIssued) {
        rotationCredentialFaultIssued = true;
        return reply({
          status: 200,
          json: {
            playerId: seat,
            token: options.rotationCredentialFaultOnce === "other-seat-uppercase"
              ? mockSeatToken(0).toUpperCase() : mockSeatToken(0),
          },
        });
      }
      rotationSequence++;
      const fresh = "F".repeat(62)
        + (seats.indexOf(seat) + 1).toString(16).toUpperCase()
        + (rotationSequence % 16).toString(16).toUpperCase();
      tokenToSeat.delete(token!);
      presentSeats.delete(seat);
      tokenToSeat.set(fresh, seat);
      // The server revokes old access BEFORE the browser receives the ACK.
      // A separate concurrent GET may legitimately return 404 meanwhile.
      if (options.delayRotationAcknowledgement)
        await new Promise(resolve => setTimeout(resolve, 1400));
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
      // #125: a well-typed forged event can claim a foreign street while
      // advertising a plausible next revision and ETag. Ignore the entire
      // response before changing session state or the conditional cache.
      // #126: A well-shaped newer event from an outsider cannot be
      // accepted as an authentic public match revision or cached ETag.
      // #127: coherent roster/turn order/active actor and a public audit
      // revision, but with an invalid invisible Unicode control in the ID.
      // #128: A forged participant reuses the technical "system" genesis ID.
      // Even a coherent 200 must not advance revision, ETag or browser seat.
      // #129: A fake 200 revision with valid audit, order and player street
      // but a duplicate/foreign starting lot cannot bind the new ETag.
      if (options.forgedStartingSlotOnce && !forgedStartingSlotIssued) {
        forgedStartingSlotIssued = true;
        const nextRevision = revision + 1;
        const bogusTag = `W/"edonism-revision-${nextRevision}"`;
        const honest = snapshot();
        const forgedSlot = options.forgedStartingSlotOnce === "duplicate"
          ? "N-01" : "no-such-lot";
        observedPolls.push({ status: 200, supplied, etag: bogusTag,
          prefer: request.headers()["prefer"] ?? null });
        return reply({ status: 200,
          headers: { ETag: bogusTag, "Cache-Control": "no-store" },
          json: {
            ...honest, revision: nextRevision,
            players: honest.players.map(p => p.playerId === "bob"
              ? { ...p, startingSlotId: forgedSlot } : p),
            events: [...auditEvents, {
              revision: nextRevision, round: 1, kind: "future-public-kind",
              actorId: "alice", fromStreetId: null, toStreetId: null,
            }],
          },
        });
      }
      if (options.forgedSystemSeatOnce && !forgedSystemSeatIssued) {
        forgedSystemSeatIssued = true;
        const nextRevision = revision + 1;
        const bogusTag = `W/"edonism-revision-${nextRevision}"`;
        const honest = snapshot();
        observedPolls.push({ status: 200, supplied, etag: bogusTag,
          prefer: request.headers()["prefer"] ?? null });
        return reply({ status: 200,
          headers: { ETag: bogusTag, "Cache-Control": "no-store" },
          json: {
            ...honest, revision: nextRevision, activePlayerId: "system",
            players: honest.players.map(p => p.playerId === "alice"
              ? { ...p, playerId: "system" } : p),
            turnOrder: ["system", ...seats.slice(1)],
            proposedNextRoundOrder: [...seats.slice(-1), "system", ...seats.slice(1, -1)],
            events: [...auditEvents, {
              revision: nextRevision, round: 1, kind: "future-public-kind",
              actorId: "system", fromStreetId: null, toStreetId: null,
            }],
          },
        });
      }
      if (options.forgedUnicodePlayerIdOnce && !forgedUnicodePlayerIdIssued) {
        forgedUnicodePlayerIdIssued = true;
        const badId = "al\u202Eice";
        const nextRevision = revision + 1;
        const badEtag = `W/"edonism-revision-${nextRevision}"`;
        const honest = snapshot();
        observedPolls.push({ status: 200, supplied, etag: badEtag,
          prefer: request.headers()["prefer"] ?? null });
        return reply({ status: 200,
          headers: { ETag: badEtag, "Cache-Control": "no-store" },
          json: {
            ...honest, revision: nextRevision, activePlayerId: badId,
            players: honest.players.map(p => p.playerId === "alice"
              ? { ...p, playerId: badId } : p),
            turnOrder: [badId, ...seats.slice(1)],
            proposedNextRoundOrder: [...seats.slice(-1), badId, ...seats.slice(1, -1)],
            events: [...auditEvents, {
              revision: nextRevision, round: 1, kind: "future-public-kind",
              actorId: badId, fromStreetId: null, toStreetId: null,
            }],
          },
        });
      }
      if (options.forgedForeignAuditActorOnce && !forgedForeignActorIssued) {
        forgedForeignActorIssued = true;
        const nextRevision = revision + 1;
        const bogusTag = `W/"edonism-revision-${nextRevision}"`;
        observedPolls.push({ status: 200, supplied, etag: bogusTag,
          prefer: request.headers()["prefer"] ?? null });
        return reply({ status: 200,
          headers: { ETag: bogusTag, "Cache-Control": "no-store" },
          json: {
            ...snapshot(), revision: nextRevision,
            events: [...auditEvents, {
              revision: nextRevision, round: 1, kind: "future-public-kind",
              actorId: "outsider", fromStreetId: null, toStreetId: null,
            }],
          },
        });
      }
      // #134: Both forged events have a valid roster, known streets, event
      // count and proposed revision; only the unique-genesis constraint fails.
      if (options.forgedNonGenesisOnce && !forgedNonGenesisIssued) {
        forgedNonGenesisIssued = true;
        const nextRevision = revision + 1;
        const fakeTag = `W/"edonism-revision-${nextRevision}"`;
        observedPolls.push({ status: 200, supplied, etag: fakeTag,
          prefer: request.headers()["prefer"] ?? null });
        return reply({ status: 200,
          headers: { ETag: fakeTag, "Cache-Control": "no-store" },
          json: {
            ...snapshot(), revision: nextRevision,
            events: [...auditEvents, {
              revision: nextRevision, round: 1,
              kind: options.forgedNonGenesisOnce === "reserved-actor"
                ? "future-public-kind" : "match-created",
              actorId: options.forgedNonGenesisOnce === "reserved-actor"
                ? "system" : "alice",
              fromStreetId: null, toStreetId: null,
            }],
          },
        });
      }
      // #135: Canonical, validly typed roads and active seat but a known
      // event kind with impossible endpoint shape must not bind a new ETag.
      if (options.forgedKnownEndpointsOnce && !forgedKnownEndpointsIssued) {
        forgedKnownEndpointsIssued = true;
        const nextRevision = revision + 1;
        const bogusTag = `W/"edonism-revision-${nextRevision}"`;
        const kind = options.forgedKnownEndpointsOnce;
        observedPolls.push({ status: 200, supplied, etag: bogusTag,
          prefer: request.headers()["prefer"] ?? null });
        return reply({ status: 200,
          headers: { ETag: bogusTag, "Cache-Control": "no-store" },
          json: {
            ...snapshot(), revision: nextRevision,
            events: [...auditEvents, {
              revision: nextRevision, round: 1, actorId: "alice",
              kind: kind === "move-missing-destination" ? "free-move"
                : kind === "end-with-origin" ? "turn-ended" : "round-settlement-pending",
              fromStreetId: kind === "end-with-origin" ? "gauss"
                : kind === "move-missing-destination" ? "gauss" : null,
              toStreetId: kind === "pending-with-destination" ? "planck" : null,
            }],
          },
        });
      }
      if (options.forgedForeignAuditStreetOnce && !forgedForeignAuditIssued) {
        forgedForeignAuditIssued = true;
        const foreignRevision = revision + 1;
        const foreignEtag = `W/"edonism-revision-${foreignRevision}"`;
        observedPolls.push({ status: 200, supplied, etag: foreignEtag,
          prefer: request.headers()["prefer"] ?? null });
        return reply({ status: 200,
          headers: { ETag: foreignEtag, "Cache-Control": "no-store" },
          json: {
            ...snapshot(), revision: foreignRevision,
            events: [...auditEvents, {
              revision: foreignRevision, round: 1, kind: "free-move",
              actorId: "alice", fromStreetId: "unmapped-road", toStreetId: "planck",
            }],
          },
        });
      }
      if (options.forgedPublicBoardVersionOnce && !forgedPublicBoardVersionSent) {
        forgedPublicBoardVersionSent = true;
        // #122: The malformed 200 claims the same revision and ETag, with
        // canonical event/turn/actor JSON except for its foreign board ID.
        // No gameplay action occurred and the local city must not bind it.
        observedPolls.push({
          status: 200, supplied, etag, prefer: request.headers()["prefer"] ?? null,
        });
        return reply({
          status: 200, headers: { ETag: etag, "Cache-Control": "no-store" },
          json: { ...snapshot(), boardVersion: "foreign-board-v2" },
        });
      }
      if (options.forgedSameRevisionOnce && !forgedSameRevisionSent) {
        forgedSameRevisionSent = true;
        const base = snapshot();
        // #121: HTTP 200 and ETag claim the CORRECT revision with an
        // otherwise valid public envelope, chronology and turn order.
        // The player street or gross quote silently disagrees with the
        // already accepted creator snapshot: no command was committed.
        const forged = options.forgedSameRevisionOnce === "street"
          ? { ...base, players: base.players.map(player =>
              player.playerId === "bob" ? { ...player, streetId: "boson" } : player) }
          : { ...base, grossSalaryQuotes: base.grossSalaryQuotes.map(quote =>
              quote.playerId === "alice" ? { ...quote, grossAtoms: 999 } : quote) };
        observedPolls.push({
          status: 200, supplied, etag, prefer: request.headers()["prefer"] ?? null,
        });
        return reply({ status: 200,
          headers: { ETag: etag, "Cache-Control": "no-store" }, json: forged });
      }
      if ((options.forgedHigherRevisionSnapshot || options.forgedNullAuditEventSnapshot
        || options.forgedPhaseActorMismatchSnapshot
        || options.forgedAuditChronologySnapshot
        || options.forgedPublicTurnOrderOnce)
        && !forgedHigherRevisionSent) {
        forgedHigherRevisionSent = true;
        const forgedRevision = options.forgedPublicTurnOrderOnce ? revision + 1
          : options.forgedAuditChronologySnapshot ? 96
          : options.forgedPhaseActorMismatchSnapshot ? 97
          : options.forgedNullAuditEventSnapshot ? 98 : 99;
        const invalidEtag = `W/"edonism-revision-${forgedRevision}"`;
        observedPolls.push({
          status: 200, supplied, etag: invalidEtag,
          prefer: request.headers()["prefer"] ?? null,
        });
        return reply({
          status: 200, headers: { ETag: invalidEtag, "Cache-Control": "no-store" },
          json: options.forgedPublicTurnOrderOnce
            ? {
                ...snapshot(),
                revision: forgedRevision,
                activePlayerId: seats[1],
                proposedNextRoundOrder: [...seats],
                events: [...auditEvents, {
                  revision: forgedRevision, round: 1, kind: "turn-ended",
                  actorId: seats[0], fromStreetId: null, toStreetId: null,
                }],
              }
            : options.forgedAuditChronologySnapshot
              ? { ...snapshot(), revision: forgedRevision, events: [...auditEvents] }
              : options.forgedPhaseActorMismatchSnapshot
              ? { ...snapshot(), revision: forgedRevision, phase: 1, activePlayerId: "alice" }
              : options.forgedNullAuditEventSnapshot
                ? { ...snapshot(), revision: forgedRevision, events: [null] }
                : { ...snapshot(), revision: forgedRevision, players: null },
        });
      }
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
      // A separate tab legitimately ended Alice's turn before her old 0
      // revision move could commit. Keep the mock's public timeline identical
      // to what the .NET Domain would emit, rather than inventing revision 3.
      revision = 1;
      active = seats[1];
      auditEvents.push({ revision, round: 1, kind: "turn-ended",
        actorId: "alice", fromStreetId: null, toStreetId: null });
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
    observedForgedOptions,
    observedInvalidHandReplies,
    setSnapshotFailure: (value: boolean) => { snapshotFailure = value; },
    delayNextRevokedSnapshot: () => { delayRevokedResponse = true; },
    didDelayRevokedSnapshot: () => delayedRevokedResponse,
    // Invalidate a seat as if another browser had rotated its bearer.
    // The old token never receives the replacement by polling.
    revokeSeat: (seat: Seat) => {
      const previous = [...tokenToSeat.entries()].find(([, id]) => id === seat)?.[0];
      expect(previous).toBeTruthy();
      tokenToSeat.delete(previous!);
      presentSeats.delete(seat);
      rotationSequence++;
      const fresh = "F".repeat(62)
        + (seats.indexOf(seat) + 1).toString(16).toUpperCase()
        + (rotationSequence % 16).toString(16).toUpperCase();
      tokenToSeat.set(fresh, seat);
      return fresh;
    },
    // A separate server actor: real audit and positions, not a local UI guess.
    moveBobRemotely: () => {
      expect(active).toBe("bob");
      expect(moved.bob).toBe(false);
      const fromStreetId = streets.bob;
      streets.bob = "newton";
      moved.bob = true;
      revision++;
      auditEvents.push({ revision, round: 1, kind: "free-move",
        actorId: "bob", fromStreetId, toStreetId: "newton" });
    },
    endBobRemotely: () => {
      expect(active).toBe("bob");
      revision++;
      active = null;
      phase = 1;
      auditEvents.push({ revision, round: 1, kind: "round-settlement-pending",
        actorId: "bob", fromStreetId: null, toStreetId: null });
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
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
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


test("#114: creator duplicate seat bearer is rejected before session, then valid eight-seat create works",
  async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  const { observedHeaders } = await mockMatchApi(page,
    { playerCount: 8, creatorCredentialFaultOnce: "duplicate-token" });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toContainText("Impossibile avviare");
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveCount(0);
  await expect(page.getByTestId("match-player-legend")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("dev-create")).toBeEnabled();
  expect(observedHeaders.filter(e => e.path.endsWith("/hand")
    || e.path.endsWith("/turn-options")
    || e.path.endsWith("/end-turn"))).toHaveLength(0);

  // Same server mock now returns eight correctly typed, unique hex tokens.
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(8);
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await page.getByTestId("dev-seat-heidi").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:45");
  expect(observedHeaders.some(e =>
    e.path.endsWith("/hand") && e.token === mockSeatToken(7))).toBe(true);
  const visible = await page.locator("body").innerText();
  for (let i = 0; i < 8; i++) expect(visible).not.toContain(mockSeatToken(i));
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

for (const count of [2, 8] as const) {
  test("#130: public origin labels survive move and actor switch for "
    + count + " PvP seats", async ({ page }) => {
    const { observedHeaders } = await mockMatchApi(page, { playerCount: count });
    await page.goto("/");
    await page.getByTestId("dev-player-count").selectOption(String(count));
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("match-player-legend").locator("li"))
      .toHaveCount(count);
    const alice = page.getByTestId("match-player-alice");
    const bob = page.getByTestId("match-player-bob");
    await expect(alice).toHaveAttribute("data-street-id", "gauss");
    await expect(alice).toHaveAttribute("data-starting-slot-id", "N-01");
    await expect(page.getByTestId("match-origin-alice"))
      .toHaveText("Lotto iniziale: N-01");
    await expect(bob).toHaveAttribute("data-starting-slot-id", "S-01");
    await expect(page.getByTestId("match-origin-bob"))
      .toHaveText("Lotto iniziale: S-01");
    if (count === 8) {
      await expect(page.getByTestId("match-player-heidi"))
        .toHaveAttribute("data-starting-slot-id", "N-08");
      const starting = await page.getByTestId("match-player-legend")
        .locator("li").evaluateAll(items =>
          items.map(item => item.getAttribute("data-starting-slot-id")));
      expect(new Set(starting).size).toBe(8);
    }
    // Inspecting a different seat must never shift initial activities.
    await page.getByTestId("dev-seat-bob").click();
    await expect(alice).toHaveAttribute("data-starting-slot-id", "N-01");
    await expect(bob).toHaveAttribute("data-starting-slot-id", "S-01");
    await page.getByTestId("dev-seat-alice").click();

    await page.getByTestId("dev-move-planck").click();
    await expect(alice).toHaveAttribute("data-street-id", "planck");
    await expect(alice).toHaveAttribute("data-starting-slot-id", "N-01");
    await expect(page.getByTestId("match-origin-alice"))
      .toHaveText("Lotto iniziale: N-01");
    await page.getByTestId("dev-end-turn").click();
    await expect(bob).toHaveAttribute("data-active", "true");
    await expect(alice).toHaveAttribute("data-starting-slot-id", "N-01");

    // The new roster is strictly public; neither tokens nor hand IDs
    // become available in the city legend through this projection.
    const visible = await page.getByTestId("match-player-legend").innerText();
    expect(visible).not.toContain("demo:action:");
    expect(observedHeaders.filter(x => x.path.endsWith("/end-turn")))
      .toHaveLength(1);
    await page.getByTestId("dev-leave").click();
    await expect(page.getByTestId("match-player-legend")).toHaveCount(0);
  });
}


for (const count of [2, 8] as const) {
  test("#131: inspect rival initial lot without moving live pawn or changing private actor ("
    + count + " seats)", async ({ page }) => {
    const { observedHeaders } = await mockMatchApi(page, { playerCount: count });
    await page.goto("/");
    await page.getByTestId("dev-player-count").selectOption(String(count));
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    await expect(page.getByTestId("match-player-legend").locator("li"))
      .toHaveCount(count);
    await expect(page.getByTestId("match-inspect-origin-bob"))
      .toHaveAttribute("aria-label", "Esplora il lotto iniziale S-01 di bob");

    // Bob begins on Einstein; Alice is the authorized seat on Gauss.
    await page.getByTestId("match-inspect-origin-bob").click();
    await expect(page.getByTestId("selected-slot")).toHaveText("S-01");
    await expect(page.getByTestId("street-picker-einstein"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("match-inspect-origin-bob"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("dev-active-player")).toHaveText("alice");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", "gauss");
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
    // Inspect must never issue a command, even while changing city streets.
    expect(observedHeaders.filter(x =>
      x.path.endsWith("/free-move") || x.path.endsWith("/end-turn")))
      .toHaveLength(0);

    // Legitimate movement changes Alice's street, not her starting lot.
    await page.getByTestId("dev-move-planck").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", "planck");
    await page.getByTestId("street-picker-meson").click();
    await page.getByTestId("match-inspect-origin-alice").click();
    await expect(page.getByTestId("selected-slot")).toHaveText("N-01");
    await expect(page.getByTestId("street-picker-gauss"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", "planck");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-starting-slot-id", "N-01");
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    expect(observedHeaders.filter(x => x.path.endsWith("/free-move")))
      .toHaveLength(1);

    await page.getByTestId("dev-seat-bob").click();
    await page.getByTestId("match-inspect-origin-bob").click();
    await expect(page.getByTestId("selected-slot")).toHaveText("S-01");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", "planck");
    expect(observedHeaders.filter(x =>
      x.path.endsWith("/free-move") || x.path.endsWith("/end-turn")))
      .toHaveLength(1);

    await page.getByTestId("dev-leave").click();
    await expect(page.getByTestId("match-inspect-origin-alice")).toHaveCount(0);
    await expect(page.getByTestId("match-inspect-origin-bob")).toHaveCount(0);
  });
}


for (const count of [2, 8] as const) {
  test("#132: inspect a rival-controlled public lot without issuing a game command ("
    + count + " seats)", async ({ page }) => {
    const { observedHeaders } = await mockMatchApi(page, { playerCount: count });
    await page.goto("/");
    await page.getByTestId("dev-player-count").selectOption(String(count));
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    const bobLot = page.getByTestId("controlled-lot-S-01");
    await expect(bobLot).toHaveAttribute("data-owner-id", "bob");
    const bobCard = await bobLot.getAttribute("data-card-id");
    const inspect = page.getByTestId("match-inspect-controlled-S-01");
    await expect(inspect).toHaveAttribute("aria-label",
      "Esplora l’attività controllata S-01 da bob");
    await inspect.click();
    await expect(page.getByTestId("selected-slot")).toHaveText("S-01");
    await expect(page.getByTestId("street-picker-einstein"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(inspect).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("dev-active-player")).toHaveText("alice");
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
    expect(observedHeaders.filter(x =>
      x.path.endsWith("/free-move") || x.path.endsWith("/end-turn")))
      .toHaveLength(0);

    await page.getByTestId("dev-move-planck").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", "planck");
    await page.getByTestId("street-picker-meson").click();
    await page.getByTestId("match-inspect-controlled-N-01").click();
    await expect(page.getByTestId("selected-slot")).toHaveText("N-01");
    await expect(page.getByTestId("street-picker-gauss"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(bobLot).toHaveAttribute("data-card-id", bobCard!);
    await expect(bobLot).toHaveAttribute("data-owner-id", "bob");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", "planck");
    expect(observedHeaders.filter(x => x.path.endsWith("/free-move")))
      .toHaveLength(1);
    expect(observedHeaders.filter(x => x.path.endsWith("/end-turn")))
      .toHaveLength(0);

    await page.getByTestId("dev-seat-bob").click();
    await page.getByTestId("match-inspect-controlled-S-01").click();
    await expect(page.getByTestId("selected-slot")).toHaveText("S-01");
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    expect(observedHeaders.filter(x =>
      x.path.endsWith("/free-move") || x.path.endsWith("/end-turn")))
      .toHaveLength(1);

    await page.getByTestId("dev-leave").click();
    await expect(page.getByTestId("match-inspect-controlled-S-01")).toHaveCount(0);
    await expect(page.getByTestId("match-inspect-controlled-N-01")).toHaveCount(0);
  });
}


for(const count of [2, 8] as const) {
  test("#133: inspect the current verified opponent street without moving or switching "
    + count + " seats", async ({ page }) => {
    const { observedHeaders } = await mockMatchApi(page, { playerCount: count });
    await page.goto("/");
    await page.getByTestId("dev-player-count").selectOption(String(count));
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("match-player-legend").locator("li"))
      .toHaveCount(count);
    const bobStreet = page.getByTestId("match-inspect-street-bob");
    await expect(bobStreet).toHaveAttribute("aria-label",
      "Esplora la strada attuale Einstein Avenue di bob");
    await bobStreet.click();
    await expect(page.getByTestId("street-picker-einstein"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("selected-slot")).toHaveText("S-01");
    await expect(bobStreet).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("dev-active-player")).toHaveText("alice");
    await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    expect(observedHeaders.filter(x =>
      x.path.endsWith("/free-move") || x.path.endsWith("/end-turn")))
      .toHaveLength(0);

    // A real server-shaped command moves Alice, not her originating lot.
    await page.getByTestId("dev-move-planck").click();
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", "planck");
    const aliceStreet = page.getByTestId("match-inspect-street-alice");
    await expect(aliceStreet).toHaveAttribute("aria-label",
      "Esplora la strada attuale Planck Avenue di alice");
    await page.getByTestId("street-picker-meson").click();
    await aliceStreet.click();
    await expect(page.getByTestId("street-picker-planck"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("selected-slot")).toHaveText("E-01");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-starting-slot-id", "N-01");

    // The original lot and current street must remain independent.
    await page.getByTestId("match-inspect-origin-alice").click();
    await expect(page.getByTestId("selected-slot")).toHaveText("N-01");
    await expect(page.getByTestId("street-picker-gauss"))
      .toHaveAttribute("aria-pressed", "true");
    await aliceStreet.click();
    await expect(page.getByTestId("street-picker-planck"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    expect(observedHeaders.filter(x => x.path.endsWith("/free-move")))
      .toHaveLength(1);
    expect(observedHeaders.filter(x => x.path.endsWith("/end-turn")))
      .toHaveLength(0);

    await page.getByTestId("dev-seat-bob").click();
    await bobStreet.click();
    await expect(page.getByTestId("selected-slot")).toHaveText("S-01");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", "planck");
    expect(observedHeaders.filter(x =>
      x.path.endsWith("/free-move") || x.path.endsWith("/end-turn")))
      .toHaveLength(1);

    await page.getByTestId("dev-leave").click();
    await expect(page.getByTestId("match-inspect-street-bob")).toHaveCount(0);
    await expect(page.getByTestId("match-inspect-street-alice")).toHaveCount(0);
  });
}

test("#133: live street inspector is keyboard accessible on English mobile without WebGL",
  async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      if (kind === "webgl" || kind === "webgl2"
        || kind === "experimental-webgl") return null;
      return Reflect.apply(original, this, [kind, ...args]);
    };
  });
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  const inspect = page.getByTestId("match-inspect-street-bob");
  await expect(inspect).toHaveAttribute("aria-label",
    "Inspect bob’s current street Einstein Avenue");
  await inspect.focus();
  await expect(inspect).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("street-picker-einstein"))
    .toHaveAttribute("aria-pressed", "true");
  await expect(inspect).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflow).toBe(false);
  await page.getByTestId("dev-leave").click();
  await expect(inspect).toHaveCount(0);
});

test("#132: controlled lot inspection is keyboard accessible in English and WebGL fallback",
  async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      if (kind === "webgl" || kind === "webgl2"
        || kind === "experimental-webgl") return null;
      return Reflect.apply(original, this, [kind, ...args]);
    };
  });
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  const inspect = page.getByTestId("match-inspect-controlled-S-01");
  await expect(inspect).toHaveAttribute("aria-label",
    "Inspect activity S-01 controlled by bob");
  await inspect.focus();
  await expect(inspect).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selected-slot")).toHaveText("S-01");
  await expect(inspect).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflow).toBe(false);
  await page.getByTestId("dev-leave").click();
  await expect(inspect).toHaveCount(0);
});

test("#132: invalid public rival control never gets an inspector action",
  async ({ page }) => {
  await mockMatchApi(page, { badControlSlot: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("match-inspect-controlled-N-01")).toBeVisible();
  await expect(page.getByTestId("match-inspect-controlled-S-01")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
});

test("#131: origin inspection is keyboard reachable in English and WebGL fallback",
  async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      if (kind === "webgl" || kind === "webgl2"
        || kind === "experimental-webgl") return null;
      return Reflect.apply(original, this, [kind, ...args]);
    };
  });
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  const target = page.getByTestId("match-inspect-origin-bob");
  await expect(target).toHaveAttribute("aria-label",
    "Inspect bob’s starting lot S-01");
  await target.focus();
  await expect(target).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selected-slot")).toHaveText("S-01");
  await expect(page.getByTestId("street-picker-einstein"))
    .toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflow).toBe(false);
  await page.getByTestId("dev-leave").click();
  await expect(target).toHaveCount(0);
});

test("#130: starting lot roster stays accessible in English/mobile/WebGL fallback",
  async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
      if (kind === "webgl" || kind === "webgl2"
        || kind === "experimental-webgl") return null;
      return Reflect.apply(original, this, [kind, ...args]);
    };
  });
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("match-origin-alice"))
    .toHaveText("Starting lot: N-01");
  await expect(page.getByTestId("match-origin-bob"))
    .toHaveText("Starting lot: S-01");
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(2);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflow).toBe(false);
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("match-origin-alice")).toHaveCount(0);
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

test("#123: shared streets render both players; foreign street creator fails closed and recovers", async ({ page }) => {
  await mockMatchApi(page, { sameStreet: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(2);

  // #123: Unlike the old marker-only policy, the shared public ingress now
  // rejects the ENTIRE untrusted creator snapshot with an unknown street.
  // It must not retain a misleading half-valid match, hand or revision.
  await mockMatchApi(page, { unknownStreet: true });
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toBeVisible();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("match-player-alice")).toHaveCount(0);
  await expect(page.getByTestId("match-player-bob")).toHaveCount(0);
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);

  // Recovery with a genuine canonical response must remain possible.
  await mockMatchApi(page, { sameStreet: true });
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(2);
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
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  // Rejected move: roster and inspector remain on the server-confirmed street.
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("selected-street")).toHaveText("Gauss Avenue");
});


test("#112: malformed higher-revision poll cannot poison actor state or block later valid commit",
  async ({ page }) => {
  // The test concerns public JSON acceptance, not the 3D city scene.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  const { observedPolls, observedHeaders } = await mockMatchApi(page,
    { forgedHigherRevisionSnapshot: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.etag === 'W/"edonism-revision-99"')).toBe(true);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedHeaders.filter(e => e.path.endsWith("/end-turn")
    || e.path.endsWith("/free-move"))).toHaveLength(0);

  // A legitimate server command remains possible at revision zero and
  // its confirmed revision one is accepted rather than shadowed by 99.
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  // The forged high revision must never enter conditional polling cache.
  expect(observedPolls.some(p => p.supplied === 'W/"edonism-revision-99"')).toBe(false);
  expect(observedHeaders.filter(e => e.path.endsWith("/end-turn"))).toHaveLength(1);
});


test("#113: forged higher revision with null audit event cannot poison actor or polling ETag",
  async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  const { observedPolls, observedHeaders } = await mockMatchApi(page,
    { forgedNullAuditEventSnapshot: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.etag === 'W/"edonism-revision-98"')).toBe(true);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedHeaders.filter(e => e.path.endsWith("/end-turn")
    || e.path.endsWith("/free-move"))).toHaveLength(0);
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  expect(observedPolls.some(p => p.supplied === 'W/"edonism-revision-98"')).toBe(false);
  expect(observedHeaders.filter(e => e.path.endsWith("/end-turn"))).toHaveLength(1);
});

test("#116: forged phase1 with active player cannot poison revision, token or turn controls",
  async ({ page }) => {
  // The test targets the public JSON ingress, not WebGL availability.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  const { observedPolls, observedHeaders } = await mockMatchApi(page,
    { forgedPhaseActorMismatchSnapshot: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.etag === 'W/"edonism-revision-97"')).toBe(true);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedHeaders.filter(e =>
    e.path.endsWith("/end-turn") || e.path.endsWith("/free-move"))).toHaveLength(0);

  // Real mock server still has phase=0 and revision=0. Rejecting fabricated
  // phase=1/active Alice must not block a genuine revision-one command.
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  expect(observedPolls.some(p => p.supplied === 'W/"edonism-revision-97"')).toBe(false);
  expect(observedHeaders.filter(e => e.path.endsWith("/end-turn"))).toHaveLength(1);
});

test("#119: forged high-revision HTTP 200 with gapped audit cannot poison the actor, ETag or next turn",
  async ({ page }) => {
  // Public snapshot validation must work even when WebGL is unavailable.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  const { observedPolls, observedHeaders } = await mockMatchApi(page,
    { forgedAuditChronologySnapshot: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.etag === 'W/"edonism-revision-96"')).toBe(true);
  // All other JSON fields are well-typed; ONLY audit length vs revision
  // is contradictory. Reject before public revision, cache or private UI.
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedPolls.some(p => p.supplied === 'W/"edonism-revision-96"')).toBe(false);

  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-audit-event-1")).toHaveAttribute("data-event-kind", "turn-ended");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  expect(observedHeaders.filter(e => e.path.endsWith("/end-turn"))).toHaveLength(1);
  expect(observedPolls.some(p => p.supplied === 'W/"edonism-revision-96"')).toBe(false);
});

for (const forgedStartingSlotOnce of ["duplicate", "unknown"] as const) {
  test("#129: forged " + forgedStartingSlotOnce
    + " initial lot cannot poison public match revision or ETag", async ({ page }) => {
    const { observedHeaders, observedPolls } = await mockMatchApi(page,
      { forgedStartingSlotOnce });
    await page.goto("/");
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    const bogusTag = 'W/"edonism-revision-1"';
    await expect.poll(() => observedPolls.some(p =>
      p.status === 200 && p.etag === bogusTag)).toBe(true);

    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("match-player-bob"))
      .toHaveAttribute("data-street-id", "einstein");
    await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
    await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
    expect(observedPolls.some(p => p.supplied === bogusTag)).toBe(false);
    expect(observedHeaders.filter(h => h.path.endsWith("/end-turn"))).toHaveLength(0);

    // Genuine end-turn succeeds using the server's actual revision 0.
    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("match-player-bob"))
      .toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("dev-audit-event-1"))
      .toHaveAttribute("data-event-kind", "turn-ended");
    expect(observedHeaders.filter(h => h.path.endsWith("/end-turn"))).toHaveLength(1);
  });
}

test("#128: reserved system seat cannot poison the PvP roster, ETag or private hand",
  async ({ page }) => {
  const { observedPolls, observedHeaders } = await mockMatchApi(page,
    { forgedSystemSeatOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  const forgedTag = 'W/"edonism-revision-1"';
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.etag === forgedTag)).toBe(true);

  // The bogus ID is echoed in active seat, player list, order and audit.
  // Reserved system genesis is valid; reserved system PLAYER never is.
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice"))
    .toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedPolls.some(p => p.supplied === forgedTag)).toBe(false);
  expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(0);

  // Still authorized as Alice, one true .NET-shaped revision, no leaked hand.
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-bob"))
    .toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-audit-event-1"))
    .toHaveAttribute("data-event-kind", "turn-ended");
  expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(1);
});

test("#127: invalid bidi roster ID cannot poison revision, ETag or private actor", async ({ page }) => {
  const { observedHeaders, observedPolls } = await mockMatchApi(page,
    { forgedUnicodePlayerIdOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  const badTag = 'W/"edonism-revision-1"';
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.etag === badTag)).toBe(true);

  // The forged next public revision is otherwise internally coherent:
  // the same bogus ID occurs in the roster, order, active turn and audit.
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedPolls.some(p => p.supplied === badTag)).toBe(false);
  expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(0);

  // Genuine command still runs with an unmodified server-issued bearer.
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-audit-event-1")).toHaveAttribute("data-event-kind", "turn-ended");
  expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(1);
});

for (const kind of ["move-missing-destination", "end-with-origin",
  "pending-with-destination"] as const) {
  test(`#135: forged ${kind} event cannot poison revision/ETag/hand or later command`,
    async ({ page }) => {
      const { observedHeaders, observedPolls } = await mockMatchApi(page,
        { forgedKnownEndpointsOnce: kind });
      await page.goto("/");
      await page.getByTestId("dev-create").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("0");
      const forgedTag = 'W/"edonism-revision-1"';
      await expect.poll(() => observedPolls.some(p =>
        p.status === 200 && p.etag === forgedTag)).toBe(true);
      await expect(page.getByTestId("dev-revision")).toHaveText("0");
      await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "true");
      await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "gauss");
      await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
      await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
      await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
      expect(observedPolls.some(p => p.supplied === forgedTag)).toBe(false);
      expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(0);
      await page.getByTestId("dev-end-turn").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
      await expect(page.getByTestId("dev-audit-event-1")).toHaveAttribute("data-event-kind", "turn-ended");
      expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(1);
    });
}

for (const kind of ["reserved-actor", "duplicate-genesis"] as const) {
  test(`#134: forged ${kind} event cannot poison revision, ETag or genuine commands`,
    async ({ page }) => {
      const { observedHeaders, observedPolls } = await mockMatchApi(page,
        { forgedNonGenesisOnce: kind });
      await page.goto("/");
      await page.getByTestId("dev-create").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("0");
      const forgedTag = 'W/"edonism-revision-1"';
      await expect.poll(() => observedPolls.some(p =>
        p.status === 200 && p.etag === forgedTag)).toBe(true);
      await expect(page.getByTestId("dev-revision")).toHaveText("0");
      await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "true");
      await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(2);
      await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
      await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
      await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
      expect(observedPolls.some(p => p.supplied === forgedTag)).toBe(false);
      expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(0);
      await page.getByTestId("dev-end-turn").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
      await expect(page.getByTestId("dev-audit-event-1")).toHaveAttribute("data-event-kind", "turn-ended");
      expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(1);
    });
}

test("#126: outsider audit actor cannot poison revision, ETag or genuine commands", async ({ page }) => {
  const { observedHeaders, observedPolls } = await mockMatchApi(page,
    { forgedForeignAuditActorOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  const forgedTag = 'W/"edonism-revision-1"';
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.etag === forgedTag)).toBe(true);

  // Only the public event actorId is invalid: matching revision, roster,
  // board version and future public kind are otherwise transport-shaped.
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedPolls.some(p => p.supplied === forgedTag)).toBe(false);
  expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(0);

  // The genuine next command uses the actual revision, never the forged one.
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-audit-event-1")).toHaveAttribute("data-event-kind", "turn-ended");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(1);
});

test("#125: forged public audit road cannot advance match revision or poison ETag", async ({ page }) => {
  const { observedPolls, observedHeaders } = await mockMatchApi(page,
    { forgedForeignAuditStreetOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  const foreignTag = 'W/"edonism-revision-1"';
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.etag === foreignTag)).toBe(true);

  // This false next-revision public event has a well-typed body, but the
  // fromStreetId is not on the board. Fail the whole response closed, not
  // just its timeline marker. The private actor controls stay usable.
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(0);
  expect(observedPolls.some(p => p.supplied === foreignTag)).toBe(false);

  // The true server still has genesis revision 0, so a legitimate command
  // must succeed once and the forged ETag must never become a poll cursor.
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-audit-event-1")).toHaveAttribute("data-event-kind", "turn-ended");
  expect(observedHeaders.filter(x => x.path.endsWith("/end-turn"))).toHaveLength(1);
});

test("#119: malformed creator public chronology cannot bind all-seat capabilities; good retry works",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page,
    { forgedCreatorAuditChronologyOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toBeVisible();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("match-player-alice")).toHaveCount(0);
  // A genuine response carries genesis revision 0 and two distinct bearers.
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-seat-alice")).toBeVisible();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  expect(observedHeaders.filter(e => e.path.endsWith("/from-full-deck"))).toHaveLength(2);
  const privacy = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  for (const secret of [mockSeatToken(0), mockSeatToken(1)])
    expect(JSON.stringify(privacy)).not.toContain(secret);
});

test("#119: forged atomic /seat audit cannot mount Bob or hand; genuine retry joins only Bob",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page,
    { forgedJoinedAuditChronologyOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-join-id").fill("00000000-0000-0000-0000-000000000020");
  await page.getByTestId("dev-join-token").fill(mockSeatToken(1));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-error")).toBeVisible();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("match-player-bob")).toHaveCount(0);
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-seat-alice")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
  expect(observedHeaders.filter(e => e.path.endsWith("/seat"))).toHaveLength(2);
  const privacy = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(privacy)).not.toContain(mockSeatToken(1));
});

test("#120: forged future turn order on public poll cannot poison revision or next seat",
  async ({ page }) => {
  const { observedPolls, observedHeaders } = await mockMatchApi(page,
    { forgedPublicTurnOrderOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  // The synthetic HTTP 200 has a perfectly consecutive 0..1 audit and
  // plausible active Bob; ONLY the last-to-first rotation is false.
  await expect.poll(() => observedPolls.some(p =>
    p.status === 200 && p.etag === 'W/"edonism-revision-1"')).toBe(true);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-next-order").locator("li"))
    .toHaveText(["1.bob", "2.alice"]);
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedPolls.some(p => p.supplied === 'W/"edonism-revision-1"')).toBe(false);
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-next-order").locator("li"))
    .toHaveText(["1.bob", "2.alice"]);
  await expect(page.getByTestId("dev-audit-event-1"))
    .toHaveAttribute("data-event-kind", "turn-ended");
  expect(observedHeaders.filter(h => h.path.endsWith("/end-turn"))).toHaveLength(1);
});

test("#120: forged creator rotation does not bind credentials; valid retry creates match",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page,
    { forgedCreatorTurnOrderOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toBeVisible();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("match-player-alice")).toHaveCount(0);
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-seat-alice")).toBeVisible();
  await expect(page.getByTestId("dev-next-order").locator("li"))
    .toHaveText(["1.bob", "2.alice"]);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  expect(observedHeaders.filter(h => h.path.endsWith("/from-full-deck"))).toHaveLength(2);
  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain(mockSeatToken(0));
  expect(JSON.stringify(storage)).not.toContain(mockSeatToken(1));
});

test("#120: joined seat rejects forged next-round rotation without mounting private hand",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page,
    { forgedJoinedTurnOrderOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-join-id").fill("00000000-0000-0000-0000-000000000020");
  await page.getByTestId("dev-join-token").fill(mockSeatToken(1));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-error")).toBeVisible();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("match-player-bob")).toHaveCount(0);
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-seat-alice")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-next-order").locator("li"))
    .toHaveText(["1.bob", "2.alice"]);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
  expect(observedHeaders.filter(h => h.path.endsWith("/seat"))).toHaveLength(2);
  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain(mockSeatToken(1));
});

for (const corrupted of ["street", "quote"] as const) {
  test(`#121: forged same-revision ${corrupted} HTTP 200 never primes ETag; valid poll recovers`,
    async ({ page }) => {
    const { observedPolls, observedHeaders } = await mockMatchApi(page,
      { forgedSameRevisionOnce: corrupted });
    await page.goto("/");
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
    await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);

    // #121: Only the first 200 is a forged public projection. A refused
    // same-revision response MUST NOT seed If-None-Match. A subsequent
    // genuine 200 (still revision 0) safely enables conditional 304.
    await expect.poll(() => observedPolls.filter(p =>
      p.status === 200 && p.supplied === null).length,
    { timeout: 10000 }).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    await expect(page.getByTestId("match-player-bob")).toHaveAttribute(
      "data-street-id", "einstein");
    await expect(page.getByTestId("dev-next-order").locator("li"))
      .toHaveText(["1.bob", "2.alice"]);
    await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
    await expect.poll(() => observedPolls.some(p =>
      p.status === 304 && p.supplied === 'W/"edonism-revision-0"'),
    { timeout: 10000 }).toBe(true);

    // The next accepted turn, not a forged 200, advances public revision.
    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("dev-audit-event-1"))
      .toHaveAttribute("data-event-kind", "turn-ended");
    expect(observedHeaders.filter(item => item.path.endsWith("/end-turn")))
      .toHaveLength(1);

    const privacy = await page.evaluate(() => ({
      url: location.href, local: Object.values(localStorage),
      session: Object.values(sessionStorage),
    }));
    for (const secret of [mockSeatToken(0), mockSeatToken(1)])
      expect(JSON.stringify(privacy)).not.toContain(secret);
  });
}

test("#122: foreign board version on poll cannot seed public ETag or advance turn", async ({ page }) => {
  const { observedPolls, observedHeaders } = await mockMatchApi(page,
    { forgedPublicBoardVersionOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect.poll(() => observedPolls.filter(p =>
    p.status === 200 && p.supplied === null).length, { timeout: 10000 })
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  // The first forged 200 may not establish the conditional ETag; only the
  // following legitimate server response is eligible for 304 caching.
  await expect.poll(() => observedPolls.some(p =>
    p.status === 304 && p.supplied === 'W/"edonism-revision-0"'),
  { timeout: 10000 }).toBe(true);
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  await expect(page.getByTestId("dev-audit-event-1"))
    .toHaveAttribute("data-event-kind", "turn-ended");
  expect(observedHeaders.filter(h => h.path.endsWith("/end-turn"))).toHaveLength(1);
});

test("#122: creator cannot bind credentials to foreign public board version", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page,
    { forgedCreatorBoardVersionOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toBeVisible();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("match-player-alice")).toHaveCount(0);
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-seat-alice")).toBeVisible();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  expect(observedHeaders.filter(h => h.path.endsWith("/from-full-deck"))).toHaveLength(2);
  const exposure = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  for (const secret of [mockSeatToken(0), mockSeatToken(1)])
    expect(JSON.stringify(exposure)).not.toContain(secret);
});

test("#122: atomic joined seat rejects foreign board before binding private hand", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page,
    { forgedJoinedBoardVersionOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-join-id").fill("00000000-0000-0000-0000-000000000020");
  await page.getByTestId("dev-join-token").fill(mockSeatToken(1));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-error")).toBeVisible();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("match-player-bob")).toHaveCount(0);
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-seat-alice")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
  expect(observedHeaders.filter(h => h.path.endsWith("/seat"))).toHaveLength(2);
  const exposure = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(exposure)).not.toContain(mockSeatToken(1));
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


test("#105: forged gross salary quote hides all public wage rows, not gameplay controls",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { invalidGrossQuote: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("match-activity-roster")).toBeVisible();
  await expect(page.getByTestId("controlled-lot-N-01")).toBeVisible();
  await expect(page.getByTestId("controlled-lot-S-01")).toBeVisible();
  await expect(page.getByTestId("gross-salary-alice")).toHaveCount(0);
  await expect(page.getByTestId("gross-salary-bob")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedHeaders.filter(event =>
    event.path.endsWith("/free-move") || event.path.endsWith("/end-turn"))).toHaveLength(0);
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("gross-salary-alice")).toHaveCount(0);
});


/** #107: DOM-only gross quote tests don't require expensive 3D graphics. */
async function disableWebGLForGrossSalaryTests(page: Page) {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
}

test("#107: eight-seat mocked public sidebar shows exactly one server-style gross quote per seat",
  async ({ page }) => {
  await disableWebGLForGrossSalaryTests(page);
  await mockMatchApi(page, { playerCount: 8 });
  await page.goto("/");
  await expect(page.getByTestId("city-renderer").getByRole("status"))
    .toContainText("3D non è disponibile");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  for (const player of demoSeats) {
    const expected = player === "alice" || player === "bob" ? "3" : "2";
    await expect(page.getByTestId(`gross-salary-${player}`))
      .toHaveAttribute("data-gross-atoms", expected);
  }
  await expect(page.getByTestId("match-activity-roster")).toBeVisible();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
});

test("#107: an omitted eight-seat gross quote hides all wage rows without removing public lots",
  async ({ page }) => {
  await disableWebGLForGrossSalaryTests(page);
  await mockMatchApi(page, { playerCount: 8, missingGrossQuote: true });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("match-activity-roster")).toBeVisible();
  await expect(page.getByTestId("controlled-lot-N-01")).toBeVisible();
  await expect(page.getByTestId("controlled-lot-S-01")).toBeVisible();
  for (const player of demoSeats)
    await expect(page.getByTestId(`gross-salary-${player}`)).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
});



test("#111: malformed public card ID hides unverified board count but leaves city and controls intact",
  async ({ page }) => {
  // This is a JSON/read-only roster test, not a 3D rendering test.
  await page.addInitScript(() => {
    const native = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
          return null;
        return Reflect.apply(native, this, [kind, ...args]);
      },
    });
  });
  const { observedHeaders } = await mockMatchApi(page, { malformedPublicCardId: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("city-renderer")).toBeVisible();
  await expect(page.getByTestId("match-activity-roster")).toBeVisible();
  await expect(page.getByTestId("match-board-card-count")).toHaveCount(0);
  await expect(page.getByTestId("controlled-lot-N-01")).toHaveAttribute("data-owner-id", "alice");
  await expect(page.getByTestId("controlled-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("gross-salary-alice")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedHeaders.filter(event => event.path.endsWith("/free-move")
    || event.path.endsWith("/end-turn"))).toHaveLength(0);
});

test("#108: malformed public card ID never crashes the city or invents a controlled lot",
  async ({ page }) => {
  // DOM fallback prevents unnecessary 3D work in this snapshot integrity test.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  const { observedHeaders } = await mockMatchApi(page, { malformedPublicCardId: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("city-renderer")).toBeVisible();
  await expect(page.getByTestId("city-renderer").getByRole("status"))
    .toContainText("3D non è disponibile");
  await expect(page.getByTestId("match-activity-roster")).toBeVisible();
  await expect(page.getByTestId("controlled-lot-N-01")).toBeVisible();
  await expect(page.getByTestId("controlled-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("gross-salary-alice")).toHaveCount(0);
  await expect(page.getByTestId("gross-salary-bob")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  expect(observedHeaders.filter(event => event.path.endsWith("/end-turn")
    || event.path.endsWith("/free-move"))).toHaveLength(0);
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
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
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
  await expect(page.getByTestId("dev-audit-event-1")).toHaveCount(0);
  await expect(page.getByTestId("dev-audit-list")).not.toContainText("private-action");
  const text = await page.getByTestId("dev-audit-panel").innerText();
  expect(text).not.toContain("demo:action:");
  expect(text).not.toContain("a".repeat(64));
  expect(text).not.toContain("b".repeat(64));
});

test("409 reconciliation shows only the concurrent server event without WebGL", async ({ page }) => {
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
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-error")).toContainText("state refreshed");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("dev-audit-event-1")).toHaveAttribute("data-event-kind", "turn-ended");
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
    path.endsWith("/hand") && token === mockSeatToken(7))).toBe(true);

  const storage = await page.evaluate(() => ({
    local: Object.values(localStorage), session: Object.values(sessionStorage), url: location.href,
  }));
  for (let i = 0; i < 8; i++) {
    const token = mockSeatToken(i);
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

test("#115: colliding 200 rotation cannot impersonate Alice; Bob retries safely", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page,
    { rotationCredentialFaultOnce: "other-seat-uppercase" });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-session")).toBeVisible();
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  const rotateResponse = () => page.waitForResponse(r =>
    new URL(r.url()).pathname.endsWith("/rotate-token")
      && r.request().method() === "POST");

  const forged = rotateResponse();
  await page.getByTestId("dev-rotate-token").click();
  const forgedReply = await forged;
  expect(forgedReply.status()).toBe(200);
  expect(await forgedReply.json()).toEqual({
    playerId: "bob", token: mockSeatToken(0).toUpperCase(),
  });
  await expect(page.getByTestId("dev-error")).toBeVisible();
  await expect(page.getByTestId("dev-rotation-notice")).toHaveCount(0);
  await expect(page.getByTestId("dev-session")).toBeVisible();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");

  // Both locally held bearers remain independently bound after rejecting
  // the malformed reply; neither secret becomes the other actor's credential.
  await page.getByTestId("dev-seat-alice").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  expect(observedHeaders.some(e =>
    e.path.endsWith("/hand") && e.token === mockSeatToken(1))).toBe(true);

  const legitimate = rotateResponse();
  await page.getByTestId("dev-rotate-token").click();
  const success = await legitimate;
  expect(success.status()).toBe(200);
  const rotated = await success.json() as { playerId: string; token: string };
  expect(rotated.playerId).toBe("bob");
  expect(rotated.token).toMatch(/^[a-f0-9]{64}$/i);
  expect(rotated.token.toLowerCase()).not.toBe(mockSeatToken(0));
  expect(rotated.token.toLowerCase()).not.toBe(mockSeatToken(1));
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(observedHeaders.some(e =>
    e.path.endsWith("/hand") && e.token === rotated.token)).toBe(true);

  const privacy = await page.evaluate(() => ({
    url: location.href,
    local: Object.values(localStorage), session: Object.values(sessionStorage),
    text: document.body.innerText,
  }));
  for (const secret of [mockSeatToken(0), mockSeatToken(1), rotated.token])
    expect(JSON.stringify(privacy)).not.toContain(secret);
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


test("#124: foreign destination in otherwise valid turn options hides all controls and recovers", async ({ page }) => {
  // Keep DOM checks independent of WebGL, while retaining the real React runtime.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  const { observedHeaders, observedForgedOptions } = await mockMatchApi(page,
    { forgedUnknownStreetOptionsOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect.poll(() => observedForgedOptions.length).toBe(1);
  expect(observedForgedOptions).toEqual([{ seat: "alice", revision: 0 }]);
  await expect(page.getByTestId("dev-position")).toHaveText("Gauss Avenue");
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "gauss");
  await expect(page.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();

  // Seat changes re-fetch genuine actor-bound options; no forged move is sent.
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await page.getByTestId("dev-seat-alice").click();
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await expect(page.getByTestId("dev-move-planck")).toBeEnabled();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(observedHeaders.filter(event => event.path.endsWith("/free-move"))).toHaveLength(0);
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  expect(observedHeaders.filter(event => event.path.endsWith("/free-move"))).toHaveLength(0);
  expect(observedHeaders.filter(event => event.path.endsWith("/end-turn"))).toHaveLength(1);

  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain(mockSeatToken(0));
  expect(JSON.stringify(storage)).not.toContain(mockSeatToken(1));
});

test("#117: forged second free move is hidden; later verified options recover same actor", async ({ page }) => {
  // Use DOM fallback to isolate this options/command test from WebGL timing.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, kind: string, ...args: unknown[]) {
        if (kind === "webgl" || kind === "webgl2" || kind === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [kind, ...args]);
      },
    });
  });
  const { observedHeaders, observedForgedOptions } = await mockMatchApi(page,
    { forgedSecondMoveOptionsOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-move-planck")).toBeEnabled();
  const forgedResponse = page.waitForResponse(r =>
    new URL(r.url()).pathname.endsWith("/turn-options")
    && r.request().headers()["x-edonism-dev-token"] === mockSeatToken(0));
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  const poisoned = await forgedResponse;
  expect(poisoned.status()).toBe(200);
  expect(await poisoned.json()).toMatchObject({
    playerId: "alice", revision: 1, canEndTurn: true,
    freeMoveStreetIds: ["meson"],
  });
  expect(observedForgedOptions).toEqual([{ seat: "alice", revision: 1 }]);
  await expect(page.getByTestId("dev-position")).toHaveText("Planck Avenue");
  await expect(page.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
  // No partial untrusted lease: ignore the entire forged options response.
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");

  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await page.getByTestId("dev-seat-alice").click();
  // Real mock source now responds with no second move but canEndTurn=true.
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await expect(page.locator('[data-testid^="dev-move-"]')).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  await expect(page.getByTestId("match-player-bob")).toHaveAttribute("data-active", "true");
  expect(observedHeaders.filter(e => e.path.endsWith("/free-move"))).toHaveLength(1);
  expect(observedHeaders.filter(e => e.path.endsWith("/end-turn"))).toHaveLength(1);

  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain(mockSeatToken(0));
  expect(JSON.stringify(storage)).not.toContain(mockSeatToken(1));
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

test("#118: forged Bob private /hand never renders duplicates; legitimate retry restores privacy", async ({ page }) => {
  const { observedInvalidHandReplies, observedHeaders } =
    await mockMatchApi(page, { forgedBobHandOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await page.getByTestId("dev-seat-bob").click();
  await expect.poll(() => observedInvalidHandReplies).toEqual(["hand"]);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await page.getByTestId("dev-seat-alice").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-hand")).not.toContainText("demo:action:01");
  expect(observedInvalidHandReplies).toEqual(["hand"]);
  expect(observedHeaders.filter(x => x.path.endsWith("/hand") && x.token === mockSeatToken(1)))
    .toHaveLength(2);
  const exposure = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage), session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(exposure)).not.toContain(mockSeatToken(0));
  expect(JSON.stringify(exposure)).not.toContain(mockSeatToken(1));
});

test("#118: forged atomic /seat private hand never binds; genuine retry joins Bob only", async ({ page }) => {
  const { observedInvalidHandReplies, observedHeaders } =
    await mockMatchApi(page, { forgedJoinedHandOnce: true });
  await page.goto("/");
  await page.getByTestId("dev-join-id").fill("00000000-0000-0000-0000-000000000020");
  await page.getByTestId("dev-join-token").fill(mockSeatToken(1));
  await page.getByTestId("dev-join").click();
  await expect.poll(() => observedInvalidHandReplies).toEqual(["seat"]);
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("dev-error")).toBeVisible();

  // Same authorized credential, genuine atomic server reply; no private
  // state/turn actor was leaked or installed during the failed first join.
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-seat-alice")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-hand")).not.toContainText("demo:action:01");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
  expect(observedInvalidHandReplies).toEqual(["seat"]);
  expect(observedHeaders.filter(x => x.path.endsWith("/seat"))).toHaveLength(2);
  const exposure = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage), session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(exposure)).not.toContain(mockSeatToken(1));
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

// #71: compare independently verified unsigned exports in a new browser,
// with NO bearer or API access. A coherent forgery can still be detected as a
// fork against another history, but neither version is authenticated.
for (const playerCount of [2, 8] as const) {
  test(`two public replay exports compare as same/prefix/fork for ${playerCount} seats`,
    async ({ page, browser }) => {
      test.setTimeout(playerCount === 8 ? 90_000 : 60_000);
      await mockMatchApi(page, { playerCount });
      await page.goto("/");
      if (playerCount === 8)
        await page.getByTestId("dev-player-count").selectOption("8");
      await page.getByTestId("dev-create").click();
      const exportButton = page.getByTestId("dev-public-audit-export");
      await expect(exportButton).toBeEnabled();

      const firstDownload = page.waitForEvent("download");
      await exportButton.click();
      const revisionZero = await firstDownload;
      const r0 = await readFile(await revisionZero.path());
      await page.getByTestId("dev-move-planck").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
      await expect(exportButton).toBeEnabled();
      const secondDownload = page.waitForEvent("download");
      await exportButton.click();
      const revisionOne = await secondDownload;
      const r1 = await readFile(await revisionOne.path());
      await page.close(); // Free the 3D renderer before offline comparison.

      const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
      try {
        const offline = await context.newPage();
        let apiCalls = 0;
        await offline.route("**/api/**", async route => {
          apiCalls++;
          await route.abort();
        });
        await offline.goto("/");
        if (playerCount === 8)
          await offline.getByRole("combobox", { name: "Lingua" }).selectOption("en");
        const firstInput = offline.getByTestId("dev-public-audit-import-file");
        const secondInput = offline.getByTestId("dev-public-audit-compare-file");
        const compare = offline.getByTestId("dev-public-audit-compare-status");
        const upload = async (input: typeof firstInput, bytes: Buffer) =>
          input.setInputFiles({
            name: "received-public-audit.json", mimeType: "application/json",
            buffer: bytes,
          });
        await upload(firstInput, r0);
        await expect(offline.getByTestId("dev-public-audit-import-status"))
          .toHaveAttribute("data-check", "valid");
        await expect(offline.getByTestId("dev-offline-timeline-revision"))
          .toHaveText("#0 / #0");
        await upload(secondInput, r0);
        await expect(compare).toHaveAttribute("data-compare", "identical");
        await upload(secondInput, r1);
        await expect(compare).toHaveAttribute("data-compare", "left-prefix");

        // Replacing the base file discards the previous comparison.
        await upload(firstInput, r1);
        await expect(compare).toHaveCount(0);
        await expect(offline.getByTestId("dev-public-audit-import-status"))
          .toHaveAttribute("data-check", "valid");
        await expect(offline.getByTestId("dev-offline-timeline-revision"))
          .toHaveText("#0 / #1");
        await upload(secondInput, r0);
        await expect(compare).toHaveAttribute("data-compare", "right-prefix");
        await upload(secondInput, r1);
        await expect(compare).toHaveAttribute("data-compare", "identical");

        const divergent = JSON.parse(r1.toString("utf8")) as {
          matchId: string;
          events: Array<{ kind: string; fromStreetId: string | null; toStreetId: string | null }>;
          frames: Array<{
            kind: string; activePlayerId: string | null;
            players: Array<{ playerId: string; streetId: string; freeMoveUsed: boolean }>
          }>;
        };
        divergent.events[1].kind = "turn-ended";
        divergent.events[1].fromStreetId = null;
        divergent.events[1].toStreetId = null;
        divergent.frames[1].kind = "turn-ended";
        divergent.frames[1].activePlayerId = divergent.frames[0].players[1].playerId;
        divergent.frames[1].players = divergent.frames[0].players;
        await upload(secondInput, Buffer.from(JSON.stringify(divergent)));
        await expect(compare).toHaveAttribute("data-compare", "divergent");
        await expect(compare).toContainText("#1");

        // The same GUID with different hex casing still identifies ONE match.
        const uppercase = JSON.parse(r1.toString("utf8")) as { matchId: string };
        uppercase.matchId = uppercase.matchId.toUpperCase();
        await upload(secondInput, Buffer.from(JSON.stringify(uppercase)));
        await expect(compare).toHaveAttribute("data-compare", "identical");

        const differentMatch = JSON.parse(r1.toString("utf8")) as { matchId: string };
        differentMatch.matchId = "00000000-0000-0000-0000-000000000099";
        await upload(secondInput, Buffer.from(JSON.stringify(differentMatch)));
        await expect(compare).toHaveAttribute("data-compare", "different-match");

        const unsafe = JSON.parse(r1.toString("utf8")) as { token?: string };
        unsafe.token = "private-token-must-never-be-displayed";
        await upload(secondInput, Buffer.from(JSON.stringify(unsafe)));
        await expect(compare).toHaveAttribute("data-compare", "invalid");
        await expect(compare).not.toContainText(unsafe.token);
        if (playerCount === 2) {
          await upload(secondInput, Buffer.alloc(64 * 1024 + 1, "x"));
          await expect(compare).toHaveAttribute("data-compare", "invalid");
        }
        await upload(firstInput, Buffer.from("{not json"));
        await expect(compare).toHaveCount(0);
        await expect(offline.getByTestId("dev-offline-timeline")).toHaveCount(0);
        await expect(offline.getByTestId("dev-public-audit-import-status"))
          .toHaveAttribute("data-check", "invalid");
        await expect(offline.getByTestId("dev-session")).toHaveCount(0);
        expect(apiCalls).toBe(0);
        expect(await offline.evaluate(() =>
          document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
      } finally {
        await context.close();
      }
    });
}

test("offline public replay validates completed two-seat round but rejects premature settlement",
  async ({ page, browser }) => {
    // #91: two fully rendered browser pages, export/import and tampering are
    // more expensive than ordinary single-page UI checks on shared CI runners.
    // Keep all checks and retries; only this test gets the two-browser budget.
    test.setTimeout(75_000);
    // #106: this is a DOM-only offline audit integrity test, not a 3D test.
    // Two full WebGL cities competing with another CI worker can starve the
    // import/tamper checks. Keep 2D canvas and ALL replay assertions intact.
    const disableOnlyWebGL = () => {
      const original = HTMLCanvasElement.prototype.getContext;
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
          if (type === "webgl" || type === "webgl2" || type === "experimental-webgl")
            return null;
          return Reflect.apply(original, this, [type, ...args]);
        },
      });
    };
    await page.addInitScript(disableOnlyWebGL);
    await mockMatchApi(page);
    await page.goto("/");
    await expect(page.getByTestId("city-renderer").getByRole("status"))
      .toContainText("3D non è disponibile");
    await page.getByTestId("dev-create").click();
    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await page.getByTestId("dev-seat-bob").click();
    await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("2");
    await expect(page.getByTestId("dev-history-revision")).toContainText("#2");
    const pending = page.waitForEvent("download");
    await page.getByTestId("dev-public-audit-export").click();
    const download = await pending;
    const bytes = await readFile(await download.path());
    const data = JSON.parse(bytes.toString("utf8")) as {
      events: Array<{ kind: string }>;
      frames: Array<{ phase: number }>;
      verifiedRevision: number;
    };
    expect(data.verifiedRevision).toBe(2);
    expect(data.events.map(e => e.kind)).toEqual([
      "match-created", "turn-ended", "round-settlement-pending"]);
    expect(data.frames[2].phase).toBe(1);

    const context = await browser.newContext();
    await context.addInitScript(disableOnlyWebGL);
    try {
      const offline = await context.newPage();
      await offline.goto("/");
      await expect(offline.getByTestId("city-renderer").getByRole("status"))
        .toContainText("3D non è disponibile");
      const fileInput = offline.getByTestId("dev-public-audit-import-file");
      const status = offline.getByTestId("dev-public-audit-import-status");
      await fileInput.setInputFiles({
        name: "completed-round.json", mimeType: "application/json", buffer: bytes,
      });
      await expect(status).toHaveAttribute("data-check", "valid");
      const timeline = offline.getByTestId("dev-offline-timeline");
      const revision = offline.getByTestId("dev-offline-timeline-revision");
      const previous = offline.getByTestId("dev-offline-timeline-previous");
      const next = offline.getByTestId("dev-offline-timeline-next");
      await expect(timeline).toBeVisible();
      await expect(revision).toHaveText("#0 / #2");
      await expect(previous).toBeDisabled();
      await expect(offline.getByTestId("dev-offline-timeline-players")
        .getByTestId("dev-offline-timeline-player")).toHaveCount(2);
      await next.click();
      await expect(revision).toHaveText("#1 / #2");
      await expect(offline.getByTestId("dev-offline-timeline-event"))
        .toContainText("alice");
      await next.click();
      await expect(revision).toHaveText("#2 / #2");
      await expect(next).toBeDisabled();
      await expect(offline.getByTestId("dev-offline-timeline-turn"))
        .toContainText("saldo in attesa");
      await previous.click();
      await expect(revision).toHaveText("#1 / #2");

      const forged = JSON.parse(bytes.toString("utf8")) as typeof data;
      forged.events[1].kind = "round-settlement-pending";
      await fileInput.setInputFiles({
        name: "early-settlement.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(forged)),
      });
      await expect(status).toHaveAttribute("data-check", "invalid");
      await expect(timeline).toHaveCount(0);
      await expect(offline.getByTestId("dev-session")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

// #69: an unsigned public export must be checkable offline by a SECOND
// browser that has no match, actor capability or access to the .NET server.
for (const seatCount of [2, 8] as const) {
  test(`offline public replay checker validates ${seatCount}-seat exports and rejects tampering`,
    async ({ page, browser }) => {
      // The eight-seat fixture renders a full 3D city and second browser.
      // Keep the complete tamper matrix on two seats, and the eight-seat
      // download/import plus one tamper guard within a bounded 60s budget.
      test.setTimeout(seatCount === 8 ? 75_000 : 45_000);
      await mockMatchApi(page, { playerCount: seatCount });
      await page.goto("/");
      if (seatCount === 8)
        await page.getByTestId("dev-player-count").selectOption("8");
      await page.getByTestId("dev-create").click();
      await page.getByTestId("dev-move-planck").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      await expect(page.getByTestId("dev-public-audit-export")).toBeEnabled();

      const pending = page.waitForEvent("download");
      await page.getByTestId("dev-public-audit-export").click();
      const downloaded = await pending;
      const jsonBytes = await readFile(await downloaded.path());
      // Release the live 3D renderer before validating the public file in an
      // independent browser; the offline verifier must work with zero seats.
      await page.close();
      const original = JSON.parse(jsonBytes.toString("utf8")) as {
        format: string; verifiedRevision: number;
        events: Array<{ kind: string; toStreetId: string | null }>;
        frames: Array<{ players: Array<{ streetId: string }> }>;
      };

      const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
      try {
        const offline = await context.newPage();
        let apiCalls = 0;
        await offline.route("**/api/**", async route => {
          apiCalls++;
          await route.abort();
        });
        await offline.goto("/");
        if (seatCount === 8)
          await offline.getByRole("combobox", { name: "Lingua" }).selectOption("en");
        await expect(offline.getByTestId("dev-session")).toHaveCount(0);
        const fileInput = offline.getByTestId("dev-public-audit-import-file");
        const status = offline.getByTestId("dev-public-audit-import-status");
        const upload = async (buffer: Buffer) => {
          await fileInput.setInputFiles({
            name: "received-public-replay.json",
            mimeType: "application/json",
            buffer,
          });
        };
        await upload(jsonBytes);
        await expect(status).toHaveAttribute("data-check", "valid");
        await expect(status).toContainText(seatCount === 8
          ? "Internally consistent history: 8 players"
          : "Cronologia internamente coerente: 2 giocatori");
        const timeline = offline.getByTestId("dev-offline-timeline");
        const revision = offline.getByTestId("dev-offline-timeline-revision");
        const previous = offline.getByTestId("dev-offline-timeline-previous");
        const next = offline.getByTestId("dev-offline-timeline-next");
        await expect(timeline).toBeVisible();
        await expect(revision).toHaveText("#0 / #1");
        await expect(previous).toBeDisabled();
        await expect(timeline.getByTestId("dev-offline-timeline-player")).toHaveCount(seatCount);
        await expect(timeline.getByTestId("dev-offline-timeline-player").first())
          .toContainText("Movimento gratuito disponibile".replace(
            "Movimento gratuito disponibile",
            seatCount === 8 ? "Free move available" : "Movimento gratuito disponibile"));
        await next.click();
        await expect(revision).toHaveText("#1 / #1");
        await expect(next).toBeDisabled();
        await expect(timeline.getByTestId("dev-offline-timeline-event"))
          .toContainText("planck");
        await expect(timeline.getByTestId("dev-offline-timeline-player").first())
          .toContainText("planck");
        await previous.click();
        await expect(revision).toHaveText("#0 / #1");
        await expect(offline.getByTestId("dev-session")).toHaveCount(0);

        const invalid = [
          (value: typeof original) => { value.events[1].toStreetId = "unknown-street"; },
          (value: typeof original) => { value.frames[1].players[0].streetId = "newton"; },
          (value: typeof original) => { value.events[1].kind = "private-action"; },
          (value: typeof original) => { value.format = "edonism-public-audit-v2"; },
          (value: typeof original) => { (value as typeof original & { token: string }).token = "must-not-be-rendered"; },
        ];
        for (const mutate of seatCount === 8 ? invalid.slice(0, 1) : invalid) {
          const forged = JSON.parse(jsonBytes.toString("utf8")) as typeof original;
          mutate(forged);
          await upload(Buffer.from(JSON.stringify(forged)));
          await expect(status).toHaveAttribute("data-check", "invalid");
          await expect(timeline).toHaveCount(0);
        }

        if (seatCount === 2) {
          await upload(Buffer.alloc(64 * 1024 + 1, "x"));
          await expect(status).toHaveAttribute("data-check", "invalid");
          await upload(Buffer.from("{invalid json"));
          await expect(status).toHaveAttribute("data-check", "invalid");
        }
        await upload(jsonBytes);
        await expect(status).toHaveAttribute("data-check", "valid");
        await expect(revision).toHaveText("#0 / #1");
        await expect(timeline).toBeVisible();
        await expect(offline.getByTestId("dev-session")).toHaveCount(0);
        expect(apiCalls).toBe(0);
        const browserState = await offline.evaluate(() => ({
          url: location.href, local: Object.values(localStorage),
          session: Object.values(sessionStorage),
        }));
        expect(JSON.stringify(browserState)).not.toContain("a".repeat(64));
        expect(JSON.stringify(browserState)).not.toContain("b".repeat(64));
        expect(await offline.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
          .toBe(false);
      } finally {
        await context.close();
      }
    });
}

// #68: the actual browser download must contain only explicit public fields,
// never serialized session, private hand, bearer, idempotency key or future data.
for (const seatCount of [2, 8] as const) {
  test(`public replay export downloads a private-data-free verified JSON for ${seatCount} seats`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockMatchApi(page, { playerCount: seatCount });
    await page.goto("/");
    if (seatCount === 8) {
      await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
      await page.getByTestId("dev-player-count").selectOption("8");
    }
    await page.getByTestId("dev-create").click();
    const exportButton = page.getByTestId("dev-public-audit-export");
    await expect(exportButton).toBeEnabled();
    await expect(exportButton).toHaveText(
      seatCount === 8 ? "Export public JSON" : "Esporta JSON pubblico");
    await page.getByTestId("dev-move-planck").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
    await expect(exportButton).toBeEnabled();

    const pendingDownload = page.waitForEvent("download");
    await exportButton.click();
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toBe(
      "edonism-public-audit-00000000-0000-0000-0000-000000000020-r1.json");
    const text = await readFile(await download.path(), "utf8");
    const proof = JSON.parse(text) as {
      format: string; matchId: string; round: number; verifiedRevision: number;
      events: Array<{ revision: number; kind: string; actorId: string; toStreetId: string | null }>;
      frames: Array<{
        revision: number; kind: string; phase: number; players: Array<{
          playerId: string; streetId: string; freeMoveUsed: boolean
        }>
      }>;
    };
    expect(Object.keys(proof).sort()).toEqual(
      ["events", "format", "frames", "matchId", "round", "verifiedRevision"]);
    expect(proof.format).toBe("edonism-public-audit-v1");
    expect(proof.matchId).toBe("00000000-0000-0000-0000-000000000020");
    expect(proof.round).toBe(1);
    expect(proof.verifiedRevision).toBe(1);
    expect(proof.events.map(e => e.kind)).toEqual(["match-created", "free-move"]);
    expect(proof.events[1].toStreetId).toBe("planck");
    expect(proof.frames.map(f => f.revision)).toEqual([0, 1]);
    expect(proof.frames[1].players).toHaveLength(seatCount);
    for (const event of proof.events)
      expect(Object.keys(event).sort()).toEqual(
        ["actorId", "fromStreetId", "kind", "revision", "round", "toStreetId"]);
    for (const frame of proof.frames) {
      expect(Object.keys(frame).sort()).toEqual(
        ["activePlayerId", "actorId", "kind", "phase", "players", "revision"]);
      for (const player of frame.players)
        expect(Object.keys(player).sort()).toEqual(
          ["freeMoveUsed", "playerId", "streetId"]);
    }
    for (let index = 0; index < seatCount; index++)
      expect(text).not.toContain(String.fromCharCode(97 + index).repeat(64));
    expect(text).not.toMatch(/cardIds|demo:action:|credentials|token|drawPile|digest|idempotency|faction/i);
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
    const storage = await page.evaluate(() => JSON.stringify({
      url: location.href, local: Object.values(localStorage),
      session: Object.values(sessionStorage),
    }));
    expect(storage).not.toContain("a".repeat(64));
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
      .toBe(false);
  });
}

for (const invalid of ["unavailable", "unknown-event", "forged-frame"] as const) {
  test(`public replay export fails closed for ${invalid} history`, async ({ page }) => {
    await mockMatchApi(page, invalid === "unavailable"
      ? { historyUnavailable: true }
      : invalid === "unknown-event"
        ? { unknownSecretEvent: true }
        : { tamperHistoryFrame: "street" });
    await page.goto("/");
    await page.getByTestId("dev-create").click();
    if (invalid === "forged-frame") {
      await expect(page.getByTestId("dev-public-audit-export")).toBeEnabled();
      await page.getByTestId("dev-move-planck").click();
      await page.getByTestId("dev-end-turn").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("2");
    }
    await expect(page.getByTestId("dev-history-unavailable")).toBeVisible();
    await expect(page.getByTestId("dev-public-audit-export")).toBeDisabled();
    await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  });
}

test("public audit buttons jump to verified replay and map without moving LIVE players", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-audit-jump-0")).toBeEnabled();
  await expect(page.getByTestId("dev-audit-jump-0"))
    .toHaveAttribute("aria-label", "Inspect public event at revision #0 in the replay");
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-audit-jump-1")).toBeEnabled();
  await expect(page.getByTestId("dev-audit-jump-1"))
    .toHaveAttribute("aria-label", "Show alice's movement at revision #1 on the city");

  await page.getByTestId("dev-audit-jump-0").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#0");
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
  await page.getByTestId("dev-audit-jump-1").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
  await expect(page.getByTestId("dev-audit-jump-1")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-history-street", "planck");
  await expect(page.getByTestId("city-historical-target"))
    .toContainText("Revision #1 · alice was on Planck Avenue");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "planck");
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();

  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  await expect(page.getByTestId("dev-audit-jump-2")).toBeEnabled();
  await page.getByTestId("dev-audit-jump-2").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#2");
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-history-active")).toContainText("bob's turn");
  await page.getByTestId("dev-audit-jump-1").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
  await expect(page.getByTestId("city-historical-target")).toContainText("alice was on Planck Avenue");
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "planck");
  expect(observedHeaders.filter(v => v.path.endsWith("/history")).length).toBeGreaterThanOrEqual(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
});

test("settlement and turn-ended audit jumps never fabricate a historical movement", async ({ page }) => {
  await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  await expect(page.getByTestId("dev-audit-jump-2")).toBeEnabled();
  await page.getByTestId("dev-audit-jump-1").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
  await expect(page.getByTestId("dev-history-active")).toContainText("bob");
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
  await page.getByTestId("dev-audit-jump-2").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#2");
  await expect(page.getByTestId("dev-history-active")).toContainText("fine round");
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
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
    .toContainText("live markers and legal moves stay unchanged");
  await expect(page.getByTestId("dev-history-focus-alice"))
    .toHaveAttribute("aria-label", "Show alice at revision #0 on the city");
  await page.getByTestId("dev-history-focus-alice").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("city-historical-focus")).toBeVisible();
  await expect(page.getByTestId("city-historical-target"))
    .toContainText("Revision #0 · alice was on Gauss Avenue");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-history-street", "gauss");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-history-revision", "0");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "planck");
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await page.getByTestId("city-clear-historical-focus").click();
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
  await page.getByTestId("dev-history-focus-bob").click();
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-history-player", "bob");
  await page.getByTestId("dev-history-next").click();
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
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

test("Italian historical city overlay is accessible without WebGL and clears on manual inspection", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [type, ...args]);
      },
    });
  });
  await mockMatchApi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByText("Il 3D non è disponibile", { exact: false })).toBeVisible();
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#0");
  await expect(page.getByTestId("dev-audit-jump-0")).toBeEnabled();
  await expect(page.getByTestId("dev-audit-jump-0"))
    .toHaveAttribute("aria-label", "Esplora l'evento pubblico alla revisione #0 nel replay");
  await page.getByTestId("dev-audit-jump-0").click();
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-history-focus-alice"))
    .toHaveAttribute("aria-label", "Mostra alice alla revisione #0 sulla città");
  await page.getByTestId("dev-history-focus-alice").click();
  await expect(page.getByTestId("city-historical-target"))
    .toContainText("Revisione #0 · alice era su Gauss Avenue");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-history-player", "alice");
  await page.getByTestId("street-picker-newton").click();
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-history-street", "");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-audit-jump-1")).toBeEnabled();
  await page.getByTestId("dev-audit-jump-1").click();
  await expect(page.getByTestId("city-historical-target"))
    .toContainText("Revisione #1 · alice era su Planck Avenue");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "planck");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)).toBe(false);
});

test("invalid public history fails closed without disabling server-confirmed commands", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { corruptHistory: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-history-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-history-positions")).toHaveCount(0);
  await expect(page.getByTestId("dev-audit-jump-0")).toBeDisabled();
  await expect(page.getByTestId("dev-history-focus-alice")).toHaveCount(0);
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-history-unavailable")).toBeVisible();
  expect(observedHeaders.some(v => v.path.endsWith("/history"))).toBe(true);
});

// #55: a forged middle frame must never drive the historical city, unread
// opponent timeline or any other public replay view; latest is still correct.
for (const tamper of ["street", "move-flag", "active", "phase", "actor"] as const) {
  test(`forged intermediate public history (${tamper}) fails closed`, async ({ page }) => {
    const { observedHeaders } = await mockMatchApi(page, { tamperHistoryFrame: tamper });
    await page.goto("/");
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("dev-history-revision")).toContainText("#0");
    await page.getByTestId("dev-move-planck").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("2");
    await expect(page.getByTestId("dev-history-unavailable")).toBeVisible();
    await expect(page.getByTestId("dev-history-positions")).toHaveCount(0);
    await expect(page.getByTestId("dev-history-focus-alice")).toHaveCount(0);
    await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
    await expect(page.getByTestId("dev-unread-activity-events")).toHaveCount(0);
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", "planck");
    await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
    expect(observedHeaders.some(x => x.path.endsWith("/history"))).toBe(true);
  });
}

// Check the same replay contract beyond the two-seat default. Only known,
// first-round public events may become an accessible history.
for (const playerCount of [4, 8] as const) {
  test(`verified public replay preserves all ${playerCount} players after a legal move`, async ({ page }) => {
    await mockMatchApi(page, { playerCount });
    await page.goto("/");
    await page.getByTestId("dev-player-count").selectOption(String(playerCount));
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("dev-history-positions").locator("li")).toHaveCount(playerCount);
    await page.getByTestId("dev-move-planck").click();
    await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-history-revision")).toContainText("#2");
    await expect(page.getByTestId("dev-history-positions").locator("li")).toHaveCount(playerCount);
    await page.getByTestId("dev-history-previous").click();
    await page.getByTestId("dev-history-previous").click();
    await expect(page.getByTestId("dev-history-revision")).toContainText("#0");
    await expect(page.getByTestId("dev-history-positions")
      .locator('[data-player-id="alice"]')).toHaveAttribute("data-street-id", "gauss");
    await expect(page.getByTestId("match-player-alice"))
      .toHaveAttribute("data-street-id", "planck");
    await expect(page.getByTestId("dev-revision")).toHaveText("2");
  });
}

test("history is token-bound and creator seat switch discards the prior inspected frame", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
  await page.getByTestId("dev-history-previous").click();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#0");
  await page.getByTestId("dev-history-focus-alice").click();
  await expect(page.getByTestId("city-historical-focus")).toBeVisible();
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
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
  await page.getByTestId("dev-history-focus-alice").click();
  await expect(page.getByTestId("city-historical-focus")).toBeVisible();
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("city-historical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(page.getByTestId("dev-history-revision")).toContainText("#1");
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("match-player-alice")).toHaveAttribute("data-street-id", "planck");
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  const historyCalls = observedHeaders.filter(v => v.path.endsWith("/history"));
  expect(historyCalls.some(v => v.token === "a".repeat(64))).toBe(true);
  expect(historyCalls.some(v => v.token?.startsWith("F".repeat(62)))).toBe(true);
});

test("Development seat presence shows only bearer-checked active seats on mobile in English", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-presence", "active");
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="bob"]')).toHaveAttribute("data-presence", "inactive");
  await expect(page.getByTestId("dev-presence-panel")).toContainText("Recent seat activity");
  await expect(page.getByTestId("dev-presence-note")).toContainText("15 seconds");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="bob"]')).toHaveAttribute("data-presence", "active");
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-presence", "active");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-active-player")).toHaveText("alice");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(1);
  const calls = observedHeaders.filter(x => x.path.endsWith("/presence"));
  expect(calls.some(x => x.token === "a".repeat(64))).toBe(true);
  expect(calls.some(x => x.token === "b".repeat(64))).toBe(true);
  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain("a".repeat(64));
  expect(JSON.stringify(storage)).not.toContain("b".repeat(64));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("HTTP 503 or unknown seat presence fails closed but never revokes or grants commands", async ({ page }) => {
  await mockMatchApi(page, { presenceUnavailable: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-presence", "unknown");
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-audit-list").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
});

test("malformed presence never makes an invented opponent appear", async ({ page }) => {
  await mockMatchApi(page, { invalidPresence: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-presence", "unknown");
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="bob"]')).toHaveAttribute("data-presence", "unknown");
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="intruder"]')).toHaveCount(0);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
});

test("delayed presence for a previous seat cannot overwrite the new seat scope", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { delayFirstAlicePresence: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect.poll(() => observedHeaders.filter(x => x.path.endsWith("/presence")).length)
    .toBeGreaterThan(0);
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="bob"]')).toHaveAttribute("data-presence", "active");
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="bob"]')).toHaveAttribute("data-presence", "active");
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
});

test("reselecting an already active fallback seat cannot erase its private hand", async ({ page }) => {
  const { revokeSeat } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  revokeSeat("alice");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  // Presence or ordinary polling may detect revocation first. The creator
  // keeps Bob's valid seat and its hand under either arrival order.
  await expect(page.getByTestId("dev-seat-bob")).toHaveAttribute("aria-pressed", "true", {
    timeout: 12000,
  });
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await page.getByTestId("dev-seat-bob").click();
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="bob"]')).toHaveAttribute("data-presence", "active");
  await expect(page.getByTestId("dev-session")).toBeVisible();
});

test("backgrounded Development browser stops presence heartbeats and refreshes on return", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const calls = () => observedHeaders.filter(x => x.path.endsWith("/presence"));
  await expect.poll(() => calls().length).toBeGreaterThan(0);
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-presence", "active");

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true, get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-presence", "unknown");
  const hiddenCount = calls().length;
  // Give the 5-second heartbeat interval time to fire while the tab is
  // hidden. No request should be sent and no private/game state should move.
  await page.waitForTimeout(5600);
  expect(calls()).toHaveLength(hiddenCount);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true, get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => calls().length).toBeGreaterThan(hiddenCount);
  await expect(page.getByTestId("dev-presence-seats")
    .locator('[data-player-id="alice"]')).toHaveAttribute("data-presence", "active");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
});

test("local exit clears creator credentials, private state, 3D markers and stops browser polling", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByTestId("dev-leave")).toHaveCount(0);
  await page.getByTestId("dev-create").click();
  const id = await page.getByTestId("dev-match-id").innerText();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:01");
  await expect(page.getByTestId("match-player-alice")).toBeVisible();
  await page.getByTestId("dev-join-id").fill(id);
  await page.getByTestId("dev-join-token").fill("b".repeat(64));
  await expect(page.getByTestId("dev-leave-note"))
    .toContainText("the server token remains valid");

  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-leave")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("dev-history-panel")).toHaveCount(0);
  await expect(page.getByTestId("dev-presence-panel")).toHaveCount(0);
  await expect(page.getByTestId("match-player-alice")).toHaveCount(0);
  await expect(page.getByTestId("dev-join-id")).toHaveValue("");
  await expect(page.getByTestId("dev-join-token")).toHaveValue("");
  const afterLeave = observedHeaders.length;
  await page.waitForTimeout(5600);
  expect(observedHeaders).toHaveLength(afterLeave);
  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
  }));
  expect(JSON.stringify(storage)).not.toContain("a".repeat(64));
  expect(JSON.stringify(storage)).not.toContain("b".repeat(64));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);

  // Leaving never revokes the server capability: rejoin is explicit and
  // obtains a new authenticated, atomic seat bootstrap.
  await page.getByTestId("dev-join-id").fill(id);
  await page.getByTestId("dev-join-token").fill("b".repeat(64));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(observedHeaders.some(x => x.path.endsWith("/seat")
    && x.token === "b".repeat(64))).toBe(true);
});

test("local exit rejects a delayed old-seat heartbeat and keeps the lab empty", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { delayFirstAlicePresence: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect.poll(() => observedHeaders.filter(x => x.path.endsWith("/presence")).length)
    .toBeGreaterThan(0);
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("dev-hand")).toHaveCount(0);
  await expect(page.getByTestId("dev-presence-panel")).toHaveCount(0);
  await expect(page.getByTestId("match-player-alice")).toHaveCount(0);
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
});

test("server-backed turn status follows live turns and clears the tab badge on exit", async ({ page }) => {
  await mockMatchApi(page);
  await page.goto("/");
  const normalTitle = await page.title();
  await expect(page.getByTestId("dev-turn-signal")).toHaveCount(0);
  await page.getByTestId("dev-create").click();
  const status = page.getByTestId("dev-turn-signal");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveAttribute("data-turn-state", "mine");
  await expect(page.getByTestId("dev-turn-signal-text")).toHaveText("È il tuo turno");
  await expect.poll(() => page.title()).toBe(`È il tuo turno · ${normalTitle}`);

  // Creator test fixture can switch seats: selection affects the status
  // and tab title, but never advances the server's revision.
  await page.getByTestId("dev-seat-bob").click();
  await expect(status).toHaveAttribute("data-turn-state", "other");
  await expect(page.getByTestId("dev-turn-signal-text")).toContainText("alice");
  await expect.poll(() => page.title()).toBe(normalTitle);
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await page.getByTestId("dev-seat-alice").click();
  await expect(status).toHaveAttribute("data-turn-state", "mine");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(status).toHaveAttribute("data-turn-state", "other");
  await expect.poll(() => page.title()).toBe(normalTitle);
  await page.getByTestId("dev-seat-bob").click();
  await expect(status).toHaveAttribute("data-turn-state", "mine");
  await expect.poll(() => page.title()).toBe(`È il tuo turno · ${normalTitle}`);
  await page.getByTestId("dev-end-turn").click();
  await expect(status).toHaveAttribute("data-turn-state", "pending");
  await expect(page.getByTestId("dev-turn-signal-text")).toContainText("saldo del round");
  await expect.poll(() => page.title()).toBe(normalTitle);
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  await page.getByTestId("dev-leave").click();
  await expect(status).toHaveCount(0);
  await expect.poll(() => page.title()).toBe(normalTitle);
});

test("turn announcement is bilingual on mobile and revocation clears stale title", async ({ page }) => {
  const { revokeSeat } = await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const normalTitle = await page.title();
  await page.getByTestId("dev-create").click();
  const status = page.getByTestId("dev-turn-signal");
  await expect(status).toHaveAttribute("data-turn-state", "mine");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByTestId("dev-turn-signal-text")).toHaveText("It's your turn");
  await expect.poll(() => page.title()).toBe(`Your turn · ${normalTitle}`);
  await expect(status).toContainText("Informational only");
  revokeSeat("alice");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-seat-bob")).toHaveAttribute("aria-pressed", "true", {
    timeout: 12000,
  });
  await expect(status).toHaveAttribute("data-turn-state", "other");
  await expect(page.getByTestId("dev-turn-signal-text")).toContainText("alice");
  await expect.poll(() => page.title()).toBe(normalTitle);
  await expect(page.getByTestId("dev-hand")).toContainText("demo:action:21");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
  const storage = await page.evaluate(() => ({
    url: location.href, local: Object.values(localStorage),
    session: Object.values(sessionStorage),
    title: document.title,
  }));
  expect(JSON.stringify(storage)).not.toContain("a".repeat(64));
  expect(JSON.stringify(storage)).not.toContain("b".repeat(64));
});

test("settlement is a server-verified read-only gross projection, not a payout", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-settlement-panel")).toHaveCount(0);
  const matchId = await page.getByTestId("dev-match-id").innerText();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-settlement-panel")).toHaveCount(0);
  await page.getByTestId("dev-seat-bob").click();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  const panel = page.getByTestId("dev-settlement-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("dev-settlement-revision")).toContainText("#2");
  await expect(page.getByTestId("dev-settlement-gross").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("dev-settlement-gross").locator('[data-player-id="alice"]'))
    .toHaveAttribute("data-gross-atoms", "3");
  await expect(page.getByTestId("dev-settlement-order").locator("li"))
    .toHaveText(["1. bob", "2. alice"]);
  await expect(page.getByTestId("dev-settlement-warning"))
    .toContainText("nessun salario pagato");
  await expect(page.getByTestId("dev-end-turn")).toBeDisabled();
  expect(observedHeaders.filter(x => x.path.endsWith("/settlement-preview")).length)
    .toBeGreaterThanOrEqual(1);
  expect(matchId).toMatch(/^[a-f0-9-]{36}$/);
  await page.getByTestId("dev-leave").click();
  await expect(panel).toHaveCount(0);
});

test("settlement preview rejects stale, malformed and switched bearer results on mobile EN", async ({ page }) => {
  await mockMatchApi(page, { delayFirstSettlementPreview: true, invalidSettlementPreview: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-end-turn").click();
  await page.getByTestId("dev-seat-bob").click();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-settlement-panel")).toBeVisible();
  await page.getByTestId("dev-seat-alice").click();
  await expect(page.getByTestId("dev-settlement-unavailable")).toBeVisible();
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("dev-settlement-gross")).toHaveCount(0);
  await expect(page.getByTestId("dev-settlement-warning"))
    .toContainText("no salary paid");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-settlement-panel")).toHaveCount(0);
});

test("first-round progress is verified by server after moves and completed turns", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const panel = page.getByTestId("dev-turn-progress");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("dev-turn-progress-count")).toContainText("0 di 2");
  await expect(page.getByTestId("dev-turn-progress-seats").locator('[data-player-id="alice"]'))
    .toHaveAttribute("data-progress-state", "active");
  await expect(page.getByTestId("dev-turn-progress-seats").locator('[data-player-id="bob"]'))
    .toHaveAttribute("data-progress-state", "waiting");
  await page.getByTestId("dev-move-planck").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-turn-progress-count")).toContainText("0 di 2");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("2");
  await expect(page.getByTestId("dev-turn-progress-count")).toContainText("1 di 2");
  await expect(page.getByTestId("dev-turn-progress-seats").locator('[data-player-id="alice"]'))
    .toHaveAttribute("data-progress-state", "done");
  await expect(page.getByTestId("dev-turn-progress-seats").locator('[data-player-id="bob"]'))
    .toHaveAttribute("data-progress-state", "active");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-turn-progress-count")).toContainText("1 di 2");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("3");
  await expect(page.getByTestId("dev-turn-progress-count")).toContainText("2 di 2");
  await expect(page.getByTestId("dev-turn-progress-seats").locator('[data-progress-state="done"]'))
    .toHaveCount(2);
  await expect(page.getByTestId("dev-turn-progress-note")).toContainText("non salta turni");
  expect(observedHeaders.filter(x => x.path.endsWith("/turn-progress")).length).toBeGreaterThan(0);
  await page.getByTestId("dev-leave").click();
  await expect(panel).toHaveCount(0);
});

test("turn progress rejects a delayed old-seat response after switch on mobile EN", async ({ page }) => {
  await mockMatchApi(page, { delayFirstAliceTurnProgress: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-turn-progress-count")).toContainText("0 of 2");
  await expect(page.getByTestId("dev-turn-progress-seats").locator('[data-player-id="alice"]'))
    .toHaveAttribute("data-progress-state", "active");
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("dev-turn-progress-count")).toContainText("0 of 2");
  await expect(page.getByTestId("dev-turn-progress-note")).toContainText("turns are never skipped");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-turn-progress")).toHaveCount(0);
});

test("turn progress never renders malformed revision even with a valid seat", async ({ page }) => {
  await mockMatchApi(page, { invalidTurnProgress: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-turn-progress")).toBeVisible();
  await expect(page.getByTestId("dev-turn-progress-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-turn-progress-seats")).toHaveCount(0);
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-turn-progress-seats")).toHaveCount(0);
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-turn-progress")).toHaveCount(0);
});

test("unread opponent history counts remote moves and turn endings, not own actions", async ({ page }) => {
  const server = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const count = page.getByTestId("dev-unread-activity-count");
  await expect(count).toContainText("0");
  await expect(page.getByTestId("dev-unread-activity-mark-seen")).toBeDisabled();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(count).toContainText("0", { timeout: 12000 });
  server.moveBobRemotely();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-revision")).toHaveText("2", { timeout: 12000 });
  await expect(count).toContainText("1", { timeout: 12000 });
  await expect(page.getByTestId("dev-unread-activity-event-2")).toContainText("bob si è mosso");
  server.endBobRemotely();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-revision")).toHaveText("3", { timeout: 12000 });
  await expect(count).toContainText("2", { timeout: 12000 });
  await expect(page.getByTestId("dev-unread-activity-event-3"))
    .toContainText("bob ha completato il round");
  await expect(page.getByTestId("dev-unread-activity-events").locator("li")).toHaveCount(2);
  await page.getByTestId("dev-unread-activity-mark-seen").click();
  await expect(count).toContainText("0");
  await expect(page.getByTestId("dev-revision")).toHaveText("3");
  await page.getByTestId("dev-seat-bob").click();
  await expect(count).toContainText("0");
  await page.getByTestId("dev-seat-alice").click();
  await expect(count).toContainText("0");
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-unread-activity-panel")).toHaveCount(0);
});

test("unread opponent activity fails closed on malformed public replay, mobile EN and actor switch", async ({ page }) => {
  const server = await mockMatchApi(page, { corruptHistory: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-unread-activity-unavailable")).toBeVisible();
  await page.getByTestId("dev-end-turn").click();
  server.moveBobRemotely();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-revision")).toHaveText("2", { timeout: 12000 });
  await expect(page.getByTestId("dev-unread-activity-events")).toHaveCount(0);
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-unread-activity-events")).toHaveCount(0);
  await expect(page.getByTestId("dev-unread-activity-note"))
    .toContainText("No system notification");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-unread-activity-panel")).toHaveCount(0);
});

test("fresh manual join starts at current revision without replaying old events as unread", async ({ page }) => {
  await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const matchId = (await page.getByTestId("dev-match-id").innerText()).trim();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await page.getByTestId("dev-leave").click();
  await page.getByTestId("dev-join-id").fill(matchId);
  await page.getByTestId("dev-join-token").fill("b".repeat(64));
  await page.getByTestId("dev-join").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-unread-activity-count")).toContainText("0");
  await expect(page.getByTestId("dev-unread-activity-events")).toHaveCount(0);
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await page.getByTestId("dev-leave").click();
});

test("Development creator quota and oversize rejections are localized and do not create phantom matches", async ({ page }) => {
  await mockMatchApi(page);
  let attempts = 0;
  await page.route("**/api/dev/matches/from-full-deck", async route => {
    attempts++;
    if (attempts === 1)
      return route.fulfill({ status: 429,
        headers: { "Retry-After": "12", "Cache-Control": "no-store" },
        json: { code: "dev_create_rate_limited" } });
    if (attempts === 2)
      return route.fulfill({ status: 413,
        headers: { "Cache-Control": "no-store" },
        json: { code: "dev_create_payload_too_large" } });
    return route.fallback();
  });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toContainText("Troppe richieste di creazione");
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-create")).toBeEnabled();

  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toContainText("exceeds the 128 KiB limit");
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-session")).toBeVisible();
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(attempts).toBe(3);
  await page.getByTestId("dev-leave").click();
});


test("Development fixture capacity 503 is localized, private and leaves no phantom match", async ({ page }) => {
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  let creates = 0;
  await page.route("**/api/dev/matches/from-full-deck", async route => {
    creates++;
    if (creates <= 3) {
      return route.fulfill({
        status: 503,
        headers: { "Cache-Control": "no-store" },
        json: { code: creates === 3 ? "api_unavailable" : "dev_match_capacity_reached" },
      });
    }
    return route.fallback();
  });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toContainText("limite di partite in memoria");
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  await expect(page.getByTestId("dev-create")).toBeEnabled();

  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toContainText("in-memory match limit");
  await expect(page.getByTestId("dev-session")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);

  // A different 503 is an API error, not proof that creation slots ran out.
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-error")).toContainText("Cannot start the demo match");
  await expect(page.getByTestId("dev-session")).toHaveCount(0);

  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-session")).toBeVisible();
  await expect(page.getByTestId("dev-error")).toHaveCount(0);
});

test("read-only uncontrolled activity routes follow the current seat on mobile IT/EN", async ({ page }) => {
  await mockMatchApi(page, { routePlannerWithFreeCards: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-routes-count")).toContainText("2 attività non controllate");
  await expect(page.getByTestId("dev-routes-list").locator("li")).toHaveCount(2);
  await expect(page.getByTestId("dev-route-N-02")).toHaveAttribute("data-steps", "0");
  await expect(page.getByTestId("dev-route-S-02")).toHaveAttribute("data-steps", "2");
  await expect(page.getByTestId("dev-route-path-N-02")).toContainText("Percorso: Gauss Avenue");
  await expect(page.getByTestId("dev-route-path-S-02"))
    .toContainText("Gauss Avenue → Main Square → Einstein Avenue");
  await expect(page.getByTestId("dev-routes-note")).toContainText("Non sono turni stimati");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");

  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByTestId("dev-routes-note")).toContainText("not turn estimates");
  await expect(page.getByTestId("dev-route-path-N-02")).toContainText("Route:");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-route-S-02")).toHaveAttribute("data-steps", "0");
  await expect(page.getByTestId("dev-route-N-02")).toHaveAttribute("data-steps", "2");
  await expect(page.getByTestId("dev-route-path-N-02"))
    .toContainText("Einstein Avenue → Main Square → Gauss Avenue");
  await expect(page.getByTestId("dev-routes-count")).toContainText("2 uncontrolled");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-route-planner")).toHaveCount(0);
});

test("corrupt or late route plans fail closed across revision and actor changes", async ({ page }) => {
  await mockMatchApi(page, { routePlannerWithFreeCards: true, invalidRoutePlanner: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-routes-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-routes-list")).toHaveCount(0);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-routes-list")).toHaveCount(0);
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-route-planner")).toHaveCount(0);
});

test("late previous-seat route response cannot overwrite current actor", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, {
    routePlannerWithFreeCards: true, delayFirstAliceRoutes: true,
  });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect.poll(() => observedHeaders.some(({ path, token }) =>
    path.endsWith("/tactical-overview") && token === "a".repeat(64))).toBe(true);
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-route-S-02")).toHaveAttribute("data-steps", "0");
  await page.waitForTimeout(1100);
  await expect(page.getByTestId("dev-route-S-02")).toHaveAttribute("data-steps", "0");
  await expect(page.getByTestId("dev-route-N-02")).toHaveAttribute("data-steps", "2");
  await page.getByTestId("dev-leave").click();
});

test("forged street hops fail closed without affecting PvP commands", async ({ page }) => {
  await mockMatchApi(page, { routePlannerWithFreeCards: true, invalidRoutePath: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-routes-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-routes-list")).toHaveCount(0);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-routes-list")).toHaveCount(0);
});

test("nonminimal route distance is never presented as a valid plan", async ({ page }) => {
  await mockMatchApi(page, { routePlannerWithFreeCards: true, invalidRouteSteps: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-routes-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-routes-list")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});


// #51: public rival reconnaissance is informational, not permission to attack.
test("other-player public street routes switch seats on IT/EN mobile without leaking credentials", async ({ page }) => {
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-other-seats-count")).toContainText("1 altri giocatori");
  await expect(page.getByTestId("dev-other-seats-list").locator("li")).toHaveCount(1);
  const bob = page.getByTestId("dev-other-seat-bob");
  await expect(bob).toHaveAttribute("data-steps", "2");
  await expect(bob).toHaveAttribute("data-path", "gauss>main-square>einstein");
  await expect(bob).toHaveAttribute("data-owned", "1");
  await expect(bob).toHaveAttribute("data-standing", "1");
  await expect(page.getByTestId("dev-other-path-bob")).toContainText(
    "Gauss Avenue → Main Square → Einstein Avenue");
  await expect(page.getByTestId("dev-other-seats-note")).toContainText("non indica fazioni");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");

  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByTestId("dev-other-seats-note")).toContainText("no faction");
  await page.getByTestId("dev-seat-bob").click();
  const alice = page.getByTestId("dev-other-seat-alice");
  await expect(alice).toHaveAttribute("data-path", "einstein>main-square>gauss");
  await expect(alice).toHaveAttribute("data-owned", "1");
  await expect(alice).toHaveAttribute("data-standing", "1");
  await expect(page.getByTestId("dev-other-seats-count")).toContainText("1 other players");
  await expect(page.getByTestId("dev-other-seat-bob")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-other-seats")).toHaveCount(0);
});

for (const defect of ["revision", "path", "steps", "count", "identity"] as const) {
  test(`forged opponent projection ${defect} is hidden without blocking legal commands`, async ({ page }) => {
    await mockMatchApi(page, { invalidOtherSeatRoutes: defect });
    await page.goto("/");
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("dev-other-seats-unavailable")).toBeVisible();
    await expect(page.getByTestId("dev-other-seats-list")).toHaveCount(0);
    await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
    await page.getByTestId("dev-end-turn").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("1");
    await expect(page.getByTestId("dev-other-seats-list")).toHaveCount(0);
  });
}

test("late old-seat public opponent routes cannot replace the newly selected seat", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { delayFirstAliceOtherSeatRoutes: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect.poll(() => observedHeaders.some(({ path, token }) =>
    path.endsWith("/tactical-overview") && token === "a".repeat(64))).toBe(true);
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-other-seat-alice"))
    .toHaveAttribute("data-path", "einstein>main-square>gauss");
  await page.waitForTimeout(1150);
  await expect(page.getByTestId("dev-other-seat-alice"))
    .toHaveAttribute("data-path", "einstein>main-square>gauss");
  await expect(page.getByTestId("dev-other-seat-bob")).toHaveCount(0);
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-other-seats")).toHaveCount(0);
});

test("same-street public seats show a zero-edge path and no implied combat", async ({ page }) => {
  await mockMatchApi(page, { sameStreet: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-other-seat-bob")).toHaveAttribute("data-steps", "0");
  await expect(page.getByTestId("dev-other-seat-bob")).toHaveAttribute("data-path", "gauss");
  await expect(page.getByTestId("dev-other-seats-note")).toContainText("non indica fazioni");
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
});

test("eight-player public proximity orders all seven other seats without exposing current actor", async ({ page }) => {
  await mockMatchApi(page, { playerCount: 8 });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-other-seats-list").locator("li")).toHaveCount(7);
  await expect(page.getByTestId("dev-other-seats-count")).toContainText("7 altri giocatori");
  await expect(page.getByTestId("dev-other-seat-heidi")).toHaveAttribute("data-steps", "0");
  await expect(page.getByTestId("dev-other-seat-alice")).toHaveCount(0);
  await page.getByTestId("dev-seat-heidi").click();
  await expect(page.getByTestId("dev-other-seats-list").locator("li")).toHaveCount(7);
  await expect(page.getByTestId("dev-other-seat-alice")).toHaveAttribute("data-steps", "0");
  await expect(page.getByTestId("dev-other-seat-heidi")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("fallen opponent henchmen remain publicly controlled but are not standing", async ({ page }) => {
  await mockMatchApi(page, { fallenHenchman: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-other-seat-bob")).toHaveAttribute("data-owned", "1");
  await expect(page.getByTestId("dev-other-seat-bob")).toHaveAttribute("data-standing", "0");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-other-seat-alice")).toHaveAttribute("data-owned", "1");
  await expect(page.getByTestId("dev-other-seat-alice")).toHaveAttribute("data-standing", "1");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
});

test("concurrent old-token read 404 cannot log out a seat during successful token rotation", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { delayRotationAcknowledgement: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  const matchPath = "/api/dev/matches/00000000-0000-0000-0000-000000000020";
  // Presence heartbeat is not blocked by the command-in-flight guard, unlike
  // match revision polling. It reliably reproduces a concurrent old-token 404.
  const oldReadPath = `${matchPath}/presence`;
  const oldToken = "a".repeat(64);
  const baseline = observedHeaders.filter(e => e.path === oldReadPath && e.token === oldToken).length;
  const rotation = page.waitForResponse(response =>
    new URL(response.url()).pathname.endsWith("/rotate-token")
      && response.request().method() === "POST");
  await page.getByTestId("dev-rotate-token").click();
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => observedHeaders
    .filter(e => e.path === oldReadPath && e.token === oldToken).length,
  { timeout: 10000 }).toBeGreaterThan(baseline);
  const response = await rotation;
  expect(response.status()).toBe(200);
  await expect(page.getByTestId("dev-session")).toBeVisible();
  await expect(page.getByTestId("dev-rotation-notice")).toContainText("Token aggiornato");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
});

// #52: the optional public tactical focus must never submit gameplay commands.
test("public player and free-card focus select canonical streets, and manual inspection clears it", async ({ page }) => {
  await mockMatchApi(page, { routePlannerWithFreeCards: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-focus-player-bob")).toBeVisible();
  await page.getByTestId("dev-focus-player-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await expect(page.getByTestId("city-tactical-target")).toContainText("Giocatore osservato: bob");
  await expect(page.getByTestId("city-tactical-route"))
    .toContainText("Gauss Avenue → Main Square → Einstein Avenue");
  await expect(page.getByTestId("selected-street")).toHaveText("Einstein Avenue");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute(
    "data-focus-path", "gauss>main-square>einstein");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-focus-kind", "player");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("city-tactical-waypoints")).toBeVisible();
  await expect(page.getByTestId("city-tactical-waypoint-0"))
    .toHaveAttribute("aria-label", "Tappa 1 di 3: Gauss Avenue");
  await expect(page.getByTestId("city-tactical-waypoint-2")).toHaveAttribute("aria-current", "step");
  await page.getByTestId("city-tactical-waypoint-1").click();
  await expect(page.getByTestId("selected-street")).toHaveText("Main Square");
  await expect(page.getByTestId("city-tactical-waypoint-1")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute(
    "data-focus-path", "gauss>main-square>einstein");
  await page.getByTestId("city-tactical-waypoint-0").click();
  await expect(page.getByTestId("selected-street")).toHaveText("Gauss Avenue");
  await page.getByTestId("city-tactical-waypoint-2").click();
  await expect(page.getByTestId("selected-street")).toHaveText("Einstein Avenue");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await page.getByTestId("city-clear-tactical-focus").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-focus-path", "");

  await page.getByTestId("dev-focus-activity-S-02").click();
  await expect(page.getByTestId("city-tactical-target")).toContainText("Attività osservata: S-02");
  await expect(page.getByTestId("selected-slot")).toHaveText("S-02");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute(
    "data-focus-path", "gauss>main-square>einstein");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-focus-kind", "activity");
  await page.getByTestId("city-tactical-waypoint-0").click();
  await expect(page.getByTestId("selected-street")).toHaveText("Gauss Avenue");
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await page.getByTestId("city-tactical-waypoint-2").click();
  await expect(page.getByTestId("selected-slot")).toHaveText("S-02");
  await page.getByTestId("street-picker-newton").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("selected-street")).toHaveText("Newton Avenue");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
});

test("tactical focus resets on actor switch, confirmed server movement and local exit", async ({ page }) => {
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-focus-player-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-focus-target", "");
  await page.getByTestId("dev-focus-player-alice").click();
  await expect(page.getByTestId("city-tactical-route"))
    .toContainText("Einstein Avenue → Main Square → Gauss Avenue");
  await page.getByTestId("dev-seat-alice").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await page.getByTestId("dev-focus-player-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await page.locator('[data-testid^="dev-move-"]:not([disabled])').first().click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-focus-path", "");
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("English mobile tactical focus remains accessible when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // Disable ONLY WebGL. Breaking 2D contexts prevents app initialization
    // in Chromium and would test a broken browser, not the supported fallback.
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
        if (type === "webgl" || type === "webgl2" || type === "experimental-webgl")
          return null;
        return Reflect.apply(original, this, [type, ...args]);
      },
    });
  });
  await mockMatchApi(page, { routePlannerWithFreeCards: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByText("3D is not available on this device.", { exact: false }))
    .toBeVisible();
  await page.getByTestId("dev-create").click();
  // #98: the verified owner+street pair is also a DOM-only keyboard control.
  const fallbackOwner = page.getByTestId("dev-opponent-street-owner-select-einstein-bob");
  await fallbackOwner.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dev-opponent-lots-owner-filter")).toHaveValue("bob");
  await expect(page.getByTestId("dev-opponent-lots-street-filter")).toHaveValue("einstein");
  await fallbackOwner.click();
  await expect(page.getByTestId("dev-opponent-lots-owner-filter")).toHaveValue("");
  await expect(page.getByTestId("dev-opponent-lots-street-filter")).toHaveValue("");
  // #97: public per-street counts and quick selection remain DOM-only.
  await expect(page.getByTestId("dev-opponent-street-distribution-list").locator(":scope > li"))
    .toHaveCount(7);
  const fallbackStreet = page.getByTestId("dev-opponent-street-select-einstein");
  await fallbackStreet.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dev-opponent-lots-street-filter")).toHaveValue("einstein");
  await fallbackStreet.click();
  await expect(page.getByTestId("dev-opponent-lots-street-filter")).toHaveValue("");
  // #94: real street IDs from the canonical board remain selectable without WebGL.
  const streetFallback = page.getByTestId("dev-opponent-lots-street-filter");
  await expect(streetFallback).toHaveValue("");
  await streetFallback.selectOption("gauss");
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await expect(page.getByTestId("dev-focus-rival-player-bob")).toBeVisible();
  await streetFallback.selectOption("einstein");
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveAttribute("data-slot", "S-01");
  await streetFallback.selectOption("");
  // #93: filtered public rival lots remain a keyboard-accessible DOM-only
  // view when 3D is unavailable; a hidden lot cannot retain a map focus.
  const postureFallback = page.getByTestId("dev-opponent-lots-posture-filter");
  await expect(postureFallback).toHaveValue("all");
  await postureFallback.selectOption("fallen");
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await expect(page.getByTestId("dev-focus-rival-player-bob")).toBeVisible();
  await postureFallback.selectOption("standing");
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveAttribute("data-slot", "S-01");
  await postureFallback.selectOption("all");
  // #95: all active predicates can be cleared with Enter without a 3D renderer.
  await streetFallback.selectOption("gauss");
  await postureFallback.selectOption("fallen");
  await expect(page.getByTestId("dev-opponent-lots-active-filter-summary"))
    .toContainText("2 active filters");
  const resetFallback = page.getByTestId("dev-opponent-lots-reset-filters");
  await resetFallback.focus();
  await page.keyboard.press("Enter");
  await expect(streetFallback).toHaveValue("");
  await expect(postureFallback).toHaveValue("all");
  await expect(page.getByTestId("dev-opponent-lots-active-filters")).toHaveCount(0);
  // #92: the paired player focus must also be a DOM-only control when
  // WebGL is disabled, without authorizing a command or new API read.
  const publicRival = page.getByTestId("dev-focus-rival-player-bob");
  await expect(publicRival).toHaveAttribute("aria-label",
    "View bob's verified public position on map");
  await publicRival.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("city-tactical-target"))
    .toContainText("Observed player: bob");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute(
    "data-focus-path", "gauss>main-square>einstein");
  await page.getByTestId("city-clear-tactical-focus").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  const button = page.getByTestId("dev-focus-player-bob");
  await expect(button).toHaveAttribute("aria-label", "View bob on map");
  await button.click();
  await expect(page.getByTestId("city-tactical-target")).toContainText("Observed player: bob");
  await expect(page.getByTestId("city-tactical-route"))
    .toContainText("Gauss Avenue → Main Square → Einstein Avenue");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute(
    "data-focus-path", "gauss>main-square>einstein");
  await expect(page.getByTestId("city-tactical-waypoint-0"))
    .toHaveAttribute("aria-label", "Step 1 of 3: Gauss Avenue");
  await page.getByTestId("city-tactical-waypoint-0").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selected-street")).toHaveText("Gauss Avenue");
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await expect(page.getByTestId("city-renderer")).toHaveAttribute(
    "data-focus-path", "gauss>main-square>einstein");
  await page.getByTestId("city-tactical-waypoint-2").click();
  await expect(page.getByTestId("selected-street")).toHaveText("Einstein Avenue");
  await page.getByTestId("city-clear-tactical-focus").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await page.getByTestId("dev-focus-activity-N-02").click();
  await expect(page.getByTestId("city-tactical-target")).toContainText("Observed activity: N-02");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-focus-path", "gauss");
  await expect(page.getByTestId("city-tactical-waypoint-0"))
    .toHaveAttribute("aria-label", "Step 1 of 1: Gauss Avenue");
  await expect(page.getByTestId("city-tactical-waypoint-1")).toHaveCount(0);
  await page.getByTestId("city-tactical-waypoint-0").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("forged and stale player/lot projections never enable tactical focus", async ({ page }) => {
  await mockMatchApi(page, { invalidOtherSeatRoutes: "path", invalidRoutePath: true,
    routePlannerWithFreeCards: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-other-seats-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-routes-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-focus-player-bob")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-rival-player-bob")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-activity-S-02")).toHaveCount(0);
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-focus-path", "");
});

test("tactical focus is cleared on seat token rotation and remote revocation", async ({ page }) => {
  const { revokeSeat } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-focus-player-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();

  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-focus-path", "");
  await expect(page.getByTestId("dev-hand").locator("li")).toHaveCount(4);

  await page.getByTestId("dev-focus-player-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  revokeSeat("alice");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-seat-alice")).toHaveCount(0, { timeout: 12000 });
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("city-renderer")).toHaveAttribute("data-focus-target", "");
});


// #84: public opponent-controlled lots are not permissions or game commands.
test("verified opponent-controlled lots focus on the public map and switch seats", async ({ page }) => {
  await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-opponent-lots-count"))
    .toContainText("1 attività pubbliche");
  const bobLot = page.getByTestId("dev-opponent-lot-S-01");
  await expect(bobLot).toHaveAttribute("data-owner", "bob");
  await expect(bobLot).toHaveAttribute("data-posture", "0");
  await expect(bobLot).toHaveAttribute("data-steps", "2");
  await expect(bobLot).toHaveAttribute("data-path", "gauss>main-square>einstein");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toHaveCount(0);
  await page.getByTestId("dev-focus-opponent-lot-S-01").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await expect(page.getByTestId("city-tactical-target")).toContainText("S-01");
  await expect(page.getByTestId("city-renderer"))
    .toHaveAttribute("data-focus-path", "gauss>main-square>einstein");
  await page.getByTestId("city-tactical-waypoint-2").click();
  await expect(page.getByTestId("selected-street")).toHaveText("Einstein Avenue");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");

  await page.getByTestId("dev-seat-bob").click();
  const aliceLot = page.getByTestId("dev-opponent-lot-N-01");
  await expect(aliceLot).toHaveAttribute("data-owner", "alice");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await page.getByTestId("dev-focus-opponent-lot-N-01").click();
  await expect(page.getByTestId("city-tactical-target")).toContainText("N-01");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
});


// #104: The rival-held activity may live after the first slot on the street.
// The read-only map must inspect the exact verified lot, not just its street.
test("verified non-first opponent lot focus selects its exact public slot without a command",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { bobLotOnSecondSlot: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const rivalLot = page.getByTestId("dev-opponent-lot-S-02");
  await expect(rivalLot).toBeVisible();
  await expect(rivalLot).toHaveAttribute("data-owner", "bob");
  await expect(rivalLot).toHaveAttribute("data-path", "gauss>main-square>einstein");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toHaveCount(0);

  await page.getByTestId("dev-focus-opponent-lot-S-02").click();
  await expect(page.getByTestId("city-tactical-target")).toContainText("S-02");
  await expect(page.getByTestId("city-renderer"))
    .toHaveAttribute("data-focus-path", "gauss>main-square>einstein");
  await expect(page.getByTestId("selected-street")).toHaveText("Einstein Avenue");
  await expect(page.getByTestId("selected-slot")).toHaveText("S-02");
  await expect(page.getByTestId("slot-picker-S-02")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("slot-picker-S-01")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("city-tactical-waypoint-1").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await page.getByTestId("city-tactical-waypoint-2").click();
  await expect(page.getByTestId("selected-slot")).toHaveText("S-02");

  await page.getByTestId("slot-picker-S-01").click();
  await expect(page.getByTestId("selected-slot")).toHaveText("S-01");
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toHaveAttribute("data-owner", "alice");
  await page.getByTestId("dev-focus-opponent-lot-N-01").click();
  await expect(page.getByTestId("selected-slot")).toHaveText("N-01");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(observedHeaders.filter(e => /\/(free-move|end-turn)$/.test(e.path))).toHaveLength(0);
});

test("tampered opponent-controlled lot routes are hidden, never focusable", async ({ page }) => {
  await mockMatchApi(page, { invalidOpponentLots: "path" });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-opponent-lots-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lots-list")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-opponent-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  await page.getByTestId("dev-end-turn").click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
});


test("unknown public owner never becomes an opponent-lot map target", async ({ page }) => {
  await mockMatchApi(page, { unknownOwner: true });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-opponent-lots-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lots-list")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-opponent-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
});


test("nearby opponent-lot filter is public-only and resets when switching seats", async ({ page }) => {
  await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const toggle = page.getByTestId("dev-opponent-lots-nearby-toggle");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("dev-opponent-lots-filtered-count")).toContainText("0");
  await expect(page.getByTestId("dev-opponent-lots-no-nearby")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await page.getByTestId("dev-seat-bob").click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
});

test("all three tactical panels preserve public actor scope after atomic overview migration", async ({ page }) => {
  await mockMatchApi(page, { routePlannerWithFreeCards: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-other-seat-bob")).toHaveAttribute("data-steps", "2");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toHaveAttribute("data-owner", "bob");
  await expect(page.getByTestId("dev-route-N-02")).toHaveAttribute("data-steps", "0");
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-other-seat-alice")).toHaveAttribute("data-steps", "2");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toHaveAttribute("data-owner", "alice");
  await expect(page.getByTestId("dev-route-S-02")).toHaveAttribute("data-steps", "0");
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-other-seats")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lots")).toHaveCount(0);
  await expect(page.getByTestId("dev-route-planner")).toHaveCount(0);
});

test("#88: one tactical GET per seat/revision, no legacy route GETs", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { routePlannerWithFreeCards: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-other-seat-bob")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await expect(page.getByTestId("dev-route-N-02")).toBeVisible();
  const tactical = () => observedHeaders.filter(x => x.path.endsWith("/tactical-overview"));
  const legacy = () => observedHeaders.filter(x =>
    /\/(uncontrolled-routes|other-player-routes|opponent-controlled-routes)$/.test(x.path));
  expect(tactical()).toHaveLength(1);
  expect(tactical()[0].token).toBe("a".repeat(64));
  expect(legacy()).toHaveLength(0);
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("dev-other-seat-alice")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  await expect(page.getByTestId("dev-route-S-02")).toBeVisible();
  expect(tactical()).toHaveLength(2);
  expect(tactical()[1].token).toBe("b".repeat(64));
  await page.getByTestId("dev-seat-alice").click();
  await expect(page.getByTestId("dev-other-seat-bob")).toBeVisible();
  expect(tactical()).toHaveLength(3);
  await page.locator('[data-testid^="dev-move-"]:not([disabled])').first().click();
  await expect(page.getByTestId("dev-revision")).toHaveText("1");
  await expect(page.getByTestId("dev-other-seat-bob")).toBeVisible();
  expect(tactical()).toHaveLength(4);
  expect(legacy()).toHaveLength(0);
});

for (const defect of ["outer-revision", "outer-player", "nested-origin",
  "missing-uncontrolled", "missing-other", "missing-lots"] as const) {
  test(`#88: corrupt atomic envelope ${defect} hides ALL tactical panels`, async ({ page }) => {
    await mockMatchApi(page, { routePlannerWithFreeCards: true, invalidTacticalOverview: defect });
    await page.goto("/");
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("dev-other-seats-unavailable")).toBeVisible();
    await expect(page.getByTestId("dev-routes-unavailable")).toBeVisible();
    await expect(page.getByTestId("dev-opponent-lots-unavailable")).toBeVisible();
    await expect(page.getByTestId("dev-focus-player-bob")).toHaveCount(0);
    await expect(page.getByTestId("dev-focus-opponent-lot-S-01")).toHaveCount(0);
    await expect(page.getByTestId("dev-focus-activity-N-02")).toHaveCount(0);
    await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
    await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
  });
}

test("#88: forged nested other-player path blocks ALL three tactical views", async ({ page }) => {
  await mockMatchApi(page, { routePlannerWithFreeCards: true, invalidOtherSeatRoutes: "path" });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  for (const id of ["dev-other-seats-unavailable", "dev-routes-unavailable",
    "dev-opponent-lots-unavailable"]) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("dev-focus-activity-N-02")).toHaveCount(0);
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
});

test("#88: eight-seat preview uses one actor-scoped atomic request", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { playerCount: 8 });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-other-seats-list").locator("li")).toHaveCount(7);
  expect(observedHeaders.filter(e => e.path.endsWith("/tactical-overview"))).toHaveLength(1);
  await page.getByTestId("dev-seat-heidi").click();
  await expect(page.getByTestId("dev-other-seat-alice")).toHaveAttribute("data-steps", "0");
  const tactical = observedHeaders.filter(e => e.path.endsWith("/tactical-overview"));
  expect(tactical).toHaveLength(2);
  expect(tactical[1].token).toBe(mockSeatToken(7));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#89: public controller filter composes with nearby and never fetches or commands", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const owner = page.getByTestId("dev-opponent-lots-owner-filter");
  await expect(owner).toHaveValue("");
  await expect(owner.locator("option")).toHaveCount(2);
  await expect(owner.locator('option[value="alice"]')).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  const tactical = () => observedHeaders.filter(e => e.path.endsWith("/tactical-overview"));
  const commands = () => observedHeaders.filter(e =>
    /\/(free-move|end-turn)$/.test(e.path));
  expect(tactical()).toHaveLength(1);
  expect(commands()).toHaveLength(0);
  await owner.focus();
  await expect(owner).toBeFocused();
  await owner.selectOption("bob");
  await expect(page.getByTestId("dev-opponent-lots-owner-filtered-count"))
    .toContainText("1 lotti visibili di bob");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toHaveAttribute("data-owner", "bob");
  await page.getByTestId("dev-focus-opponent-lot-S-01").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  const nearby = page.getByTestId("dev-opponent-lots-nearby-toggle");
  await nearby.click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lots-no-owner"))
    .toContainText("Nessun lotto di bob");
  await nearby.click();
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await page.getByTestId("dev-focus-opponent-lot-S-01").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await owner.selectOption("");
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lots-owner-filtered-count")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  expect(tactical()).toHaveLength(1);
  expect(commands()).toHaveLength(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#89: eight seats offer only verified other players, including public empty owners", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { playerCount: 8 });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  const filter = page.getByTestId("dev-opponent-lots-owner-filter");
  await expect(filter.locator("option")).toHaveCount(8);
  await expect(filter.locator('option[value="alice"]')).toHaveCount(0);
  await filter.selectOption("heidi");
  await expect(page.getByTestId("dev-opponent-lots-no-owner"))
    .toContainText("Nessun lotto di heidi");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await filter.selectOption("bob");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByRole("combobox", {
    name: "Filter by player controlling the lot",
  })).toHaveValue("bob");
  await expect(page.getByTestId("dev-opponent-lots-owner-filtered-count"))
    .toContainText("1 visible lots controlled by bob");
  await page.getByTestId("dev-seat-heidi").click();
  await expect(filter).toHaveValue("");
  await expect(filter.locator('option[value="heidi"]')).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toHaveAttribute("data-owner", "alice");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toHaveAttribute("data-owner", "bob");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(2);
  const tactical = observedHeaders.filter(e => e.path.endsWith("/tactical-overview"));
  expect(tactical).toHaveLength(2);
  expect(tactical[0].token).toBe("a".repeat(64));
  expect(tactical[1].token).toBe(mockSeatToken(7));
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#89: owner preference resets on token rotation and cannot retain revoked owners", async ({ page }) => {
  const { observedHeaders, revokeSeat } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const owner = page.getByTestId("dev-opponent-lots-owner-filter");
  await owner.selectOption("bob");
  await page.getByTestId("dev-opponent-lots-nearby-toggle").click();
  await expect(page.getByTestId("dev-opponent-lots-no-owner")).toBeVisible();
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await expect(owner).toHaveValue("");
  await expect(page.getByTestId("dev-opponent-lots-nearby-toggle"))
    .toHaveAttribute("aria-pressed", "false");
  const firstReads = observedHeaders.filter(x => x.path.endsWith("/tactical-overview"));
  expect(firstReads).toHaveLength(2);
  expect(firstReads[0].token).not.toBe(firstReads[1].token);
  await owner.selectOption("bob");
  revokeSeat("alice");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByTestId("dev-seat-alice")).toHaveCount(0, { timeout: 12000 });
  await expect(page.getByTestId("dev-seat-bob")).toBeVisible();
  await expect(owner).toHaveValue("");
  await expect(owner.locator('option[value="bob"]')).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-opponent-lots")).toHaveCount(0);
});

test("#89: forged atomic projection never offers a rival owner filter", async ({ page }) => {
  await mockMatchApi(page, { invalidTacticalOverview: "nested-origin" });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-opponent-lots-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lots-owner-filter")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-opponent-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
});

test("#90: nearest rival-controlled lot is public, focusable and filter-aware on mobile", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const rival = page.getByTestId("dev-rival-nearest-bob");
  await expect(page.getByTestId("dev-rival-nearest-list").locator("li")).toHaveCount(1);
  await expect(rival).toHaveAttribute("data-slot", "S-01");
  await expect(rival).toHaveAttribute("data-steps", "2");
  await expect(page.getByTestId("dev-rival-nearest-alice")).toHaveCount(0);
  const focus = page.getByTestId("dev-focus-rival-nearest-bob");
  await expect(focus).toBeVisible();
  await focus.focus();
  await expect(focus).toBeFocused();
  await focus.press("Enter");
  await expect(page.getByTestId("city-tactical-target")).toContainText("S-01");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute(
    "data-focus-path", "gauss>main-square>einstein");
  await page.getByTestId("dev-opponent-lots-nearby-toggle").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(rival).toHaveAttribute("data-slot", "");
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await expect(focus).toHaveCount(0);
  await page.getByTestId("dev-opponent-lots-nearby-toggle").click();
  await expect(rival).toHaveAttribute("data-slot", "S-01");
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("bob");
  await expect(rival).toHaveAttribute("data-steps", "2");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(page.getByTestId("dev-rival-nearest-summary"))
    .toContainText("Nearest controlled lot per player");
  await expect(focus).toHaveAttribute("aria-label",
    "View bob's nearest public controlled lot: S-01");
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("");
  await expect(rival).toHaveAttribute("data-slot", "S-01");
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview")))
    .toHaveLength(1);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#90: nearest rival summary includes empty owners across eight authenticated seats", async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { playerCount: 8 });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  const list = page.getByTestId("dev-rival-nearest-list");
  await expect(list.locator("li")).toHaveCount(7);
  await expect(page.getByTestId("dev-rival-nearest-alice")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-bob"))
    .toHaveAttribute("data-slot", "S-01");
  await expect(page.getByTestId("dev-rival-nearest-heidi"))
    .toHaveAttribute("data-slot", "");
  await expect(page.getByTestId("dev-rival-nearest-empty-heidi")).toBeVisible();
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("heidi");
  await expect(list.locator("li")).toHaveCount(7);
  await expect(page.getByTestId("dev-focus-rival-nearest-bob")).toHaveCount(0);
  await expect(list.locator('[data-testid^="dev-focus-rival-nearest-"]')).toHaveCount(0);
  await expect(list.locator('[data-testid^="dev-focus-rival-player-"]')).toHaveCount(7);
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("bob");
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveAttribute("data-slot", "S-01");
  await page.getByTestId("dev-seat-heidi").click();
  await expect(list.locator("li")).toHaveCount(7);
  await expect(page.getByTestId("dev-rival-nearest-heidi")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-alice"))
    .toHaveAttribute("data-slot", "N-01");
  await expect(page.getByTestId("dev-rival-nearest-alice"))
    .toHaveAttribute("data-steps", "0");
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveAttribute("data-slot", "S-01");
  await page.getByTestId("dev-focus-rival-nearest-alice").click();
  await expect(page.getByTestId("city-renderer"))
    .toHaveAttribute("data-focus-path", "gauss");
  const reads = observedHeaders.filter(x => x.path.endsWith("/tactical-overview"));
  expect(reads).toHaveLength(2);
  expect(reads[0].token).toBe("a".repeat(64));
  expect(reads[1].token).toBe(mockSeatToken(7));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#90: forged atomic tactical data never produces nearest rival map focus", async ({ page }) => {
  await mockMatchApi(page, { invalidTacticalOverview: "nested-origin" });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-opponent-lots-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-rival-nearest-summary")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-rival-nearest-bob")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-rival-player-bob")).toHaveCount(0);
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
});

test("#90: nearest-rival focus never survives seat switch, token rotation or local exit",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await page.getByTestId("dev-focus-rival-nearest-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveAttribute("data-slot", "S-01");
  await page.getByTestId("dev-focus-rival-nearest-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await page.getByTestId("dev-seat-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-alice")).toHaveAttribute("data-slot", "N-01");
  await page.getByTestId("dev-leave").click();
  await expect(page.getByTestId("dev-rival-nearest-summary")).toHaveCount(0);
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview")))
    .toHaveLength(3);
});


test("#92: public rival and nearest held lot have distinct mobile IT/EN keyboard focus",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const other = page.getByTestId("dev-rival-public-player-bob");
  const playerButton = page.getByTestId("dev-focus-rival-player-bob");
  const lotButton = page.getByTestId("dev-focus-rival-nearest-bob");
  const verifiedPath = await page.getByTestId("dev-other-seat-bob").getAttribute("data-path");
  expect(verifiedPath).toBeTruthy();
  await expect(other).toHaveAttribute("data-path", verifiedPath!);
  await expect(other).toContainText("Posizione pubblica:");
  await playerButton.focus();
  await expect(playerButton).toBeFocused();
  await playerButton.press("Enter");
  await expect(page.getByTestId("city-tactical-target")).toContainText("bob");
  await expect(page.getByTestId("city-renderer")).toHaveAttribute(
    "data-focus-path", verifiedPath!);
  await lotButton.click();
  await expect(page.getByTestId("city-tactical-target")).toContainText("S-01");
  await page.getByTestId("dev-opponent-lots-nearby-toggle").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(lotButton).toHaveCount(0);
  await expect(playerButton).toBeVisible();
  await playerButton.click();
  await expect(page.getByTestId("city-tactical-target")).toContainText("bob");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(other).toContainText("Public player position:");
  await expect(playerButton).toHaveAttribute("aria-label",
    "View bob's verified public position on map");
  await expect(playerButton).toContainText("View player");
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("bob");
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(playerButton).toBeVisible();
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview")))
    .toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#92: eight-seat owner focus survives empty-lot filters, not token/seat switch",
  async ({ page }) => {
  test.setTimeout(60_000);
  const { observedHeaders } = await mockMatchApi(page, { playerCount: 8 });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  const list = page.getByTestId("dev-rival-nearest-list");
  await expect(list.locator('[data-testid^="dev-focus-rival-player-"]')).toHaveCount(7);
  await expect(page.getByTestId("dev-focus-rival-player-alice")).toHaveCount(0);
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("heidi");
  await expect(page.getByTestId("dev-rival-nearest-empty-heidi")).toBeVisible();
  await expect(list.locator('[data-testid^="dev-focus-rival-nearest-"]')).toHaveCount(0);
  const verifiedPath = await page.getByTestId("dev-other-seat-heidi").getAttribute("data-path");
  expect(verifiedPath).toBeTruthy();
  await page.getByTestId("dev-focus-rival-player-heidi").click();
  await expect(page.getByTestId("city-renderer")).toHaveAttribute(
    "data-focus-path", verifiedPath!);
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await page.getByTestId("dev-seat-heidi").click();
  await expect(page.getByTestId("dev-focus-rival-player-heidi")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-rival-player-alice")).toBeVisible();
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview")))
    .toHaveLength(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});


test("#93: fallen rival posture filter intersects public owner and nearby without mutations",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { fallenHenchman: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const posture = page.getByTestId("dev-opponent-lots-posture-filter");
  await expect(posture).toHaveValue("all");
  await expect(page.getByTestId("dev-opponent-lot-posture-S-01"))
    .toHaveText("Scagnozzo atterrato");
  await expect(page.getByTestId("dev-rival-nearest-posture-bob"))
    .toHaveText("Scagnozzo atterrato");
  await page.getByTestId("dev-focus-rival-nearest-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await posture.selectOption("standing");
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await expect(page.getByTestId("dev-focus-rival-player-bob")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lots-posture-filtered-count"))
    .toContainText("0 lotti");
  await posture.selectOption("fallen");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toHaveAttribute("data-posture", "1");
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveAttribute("data-slot", "S-01");
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("bob");
  await page.getByTestId("dev-opponent-lots-nearby-toggle").click();
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await page.getByTestId("dev-opponent-lots-nearby-toggle").click();
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(posture).toHaveAttribute("aria-label", "Filter by henchman posture on lot");
  await expect(posture.locator("option[value=fallen]")).toHaveText("Fallen only");
  await expect(page.getByTestId("dev-opponent-lot-posture-S-01"))
    .toHaveText("Fallen henchman");
  await posture.focus();
  await expect(posture).toBeFocused();
  await posture.selectOption("all");
  await expect(page.getByTestId("dev-opponent-lots-posture-filtered-count")).toHaveCount(0);
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview")))
    .toHaveLength(1);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#93: eight-seat posture filter resets on seat/token changes and refuses forged posture",
  async ({ page }) => {
  test.setTimeout(60_000);
  const { observedHeaders } = await mockMatchApi(page,
    { playerCount: 8, fallenHenchman: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  const posture = page.getByTestId("dev-opponent-lots-posture-filter");
  const roster = page.getByTestId("dev-rival-nearest-list");
  await expect(roster.locator("li")).toHaveCount(7);
  await posture.selectOption("standing");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await expect(page.getByTestId("dev-focus-rival-player-heidi")).toBeVisible();
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("heidi");
  await posture.selectOption("fallen");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-rival-player-heidi")).toBeVisible();
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("bob");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toHaveAttribute("data-posture", "1");
  await page.getByTestId("dev-seat-bob").click();
  await expect(posture).toHaveValue("all");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toHaveAttribute("data-posture", "0");
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveCount(0);
  await posture.selectOption("fallen");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(posture).toHaveValue("all");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview")))
    .toHaveLength(3);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#93: invalid public posture never exposes a selector or any lot focus",
  async ({ page }) => {
  await mockMatchApi(page, { invalidOpponentLots: "posture" });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-opponent-lots-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lots-posture-filter")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-opponent-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-summary")).toHaveCount(0);
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
});


test("#94: canonical street filter intersects owner, posture and nearby on mobile IT/EN",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { fallenHenchman: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const street = page.getByTestId("dev-opponent-lots-street-filter");
  const owner = page.getByTestId("dev-opponent-lots-owner-filter");
  const posture = page.getByTestId("dev-opponent-lots-posture-filter");
  await expect(street).toHaveValue("");
  await expect(street.locator("option")).toHaveCount(8);
  await expect(street.locator('option[value="einstein"]')).toHaveText("Einstein Avenue");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await page.getByTestId("dev-focus-rival-nearest-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await street.selectOption("gauss");
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await expect(page.getByTestId("dev-focus-rival-player-bob")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lots-street-filtered-count")).toContainText("0 lotti");
  // The Municipio is a canonical public street but contains no activity lots.
  await street.selectOption("main-square");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-rival-player-bob")).toBeVisible();
  await street.selectOption("einstein");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toHaveAttribute("data-owner", "bob");
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveAttribute("data-slot", "S-01");
  await owner.selectOption("bob");
  await posture.selectOption("standing");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await posture.selectOption("fallen");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await page.getByTestId("dev-opponent-lots-nearby-toggle").click();
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await page.getByTestId("dev-opponent-lots-nearby-toggle").click();
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(street).toHaveAttribute("aria-label", "Filter rival lots by public street");
  await expect(street.locator("option").first()).toHaveText("All streets");
  await street.focus();
  await expect(street).toBeFocused();
  await street.selectOption("");
  await expect(page.getByTestId("dev-opponent-lots-street-filtered-count")).toHaveCount(0);
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview"))).toHaveLength(1);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#94: eight-seat street selection keeps rival roster and resets on actor/token changes",
  async ({ page }) => {
  test.setTimeout(60_000);
  const { observedHeaders } = await mockMatchApi(page, { playerCount: 8 });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  const street = page.getByTestId("dev-opponent-lots-street-filter");
  const owners = page.getByTestId("dev-rival-nearest-list");
  await expect(owners.locator("li")).toHaveCount(7);
  await street.selectOption("gauss");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await expect(page.getByTestId("dev-focus-rival-player-heidi")).toBeVisible();
  await street.selectOption("einstein");
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveAttribute("data-slot", "S-01");
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("heidi");
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-rival-player-heidi")).toBeVisible();
  await page.getByTestId("dev-seat-bob").click();
  await expect(street).toHaveValue("");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveCount(0);
  await street.selectOption("gauss");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  await page.getByTestId("dev-focus-rival-nearest-alice").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(street).toHaveValue("");
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview"))).toHaveLength(3);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#94: forged public lot street ID makes all rival filters unavailable", async ({ page }) => {
  await mockMatchApi(page, { invalidOpponentLots: "street" });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  await expect(page.getByTestId("dev-opponent-lots-unavailable")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-lots-street-filter")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-street-distribution")).toHaveCount(0);
  await expect(page.locator("[data-testid^=dev-opponent-street-owner-select-]")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lots-reset-filters")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lots-active-filter-summary")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-summary")).toHaveCount(0);
  await expect(page.getByTestId("dev-focus-opponent-lot-S-01")).toHaveCount(0);
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
});


test("#95: four filters are summarized and cleared atomically via keyboard on mobile IT/EN",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { fallenHenchman: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const owner = page.getByTestId("dev-opponent-lots-owner-filter");
  const street = page.getByTestId("dev-opponent-lots-street-filter");
  const posture = page.getByTestId("dev-opponent-lots-posture-filter");
  const nearby = page.getByTestId("dev-opponent-lots-nearby-toggle");
  const summary = page.getByTestId("dev-opponent-lots-active-filter-summary");
  const reset = page.getByTestId("dev-opponent-lots-reset-filters");
  await expect(reset).toHaveCount(0);
  await owner.selectOption("bob");
  await street.selectOption("einstein");
  await posture.selectOption("fallen");
  await nearby.click();
  await expect(summary).toContainText("4 filtri attivi");
  await expect(summary).toContainText("Giocatore: bob");
  await expect(summary).toContainText("Strada: Einstein Avenue");
  await expect(summary).toContainText("Solo vicini");
  await expect(summary).toContainText("Postura: Solo atterrati");
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await page.getByTestId("dev-focus-rival-player-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();

  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(summary).toContainText("4 active filters");
  await expect(summary).toContainText("Player: bob");
  await expect(summary).toContainText("Street: Einstein Avenue");
  await expect(reset).toHaveAttribute("aria-label", "Clear all filters");
  await reset.focus();
  await expect(reset).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(owner).toHaveValue("");
  await expect(street).toHaveValue("");
  await expect(posture).toHaveValue("all");
  await expect(nearby).toHaveAttribute("aria-pressed", "false");
  await expect(summary).toHaveCount(0);
  await expect(reset).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toHaveAttribute("data-posture", "1");
  await expect(page.getByTestId("dev-rival-nearest-bob")).toHaveAttribute("data-slot", "S-01");
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview"))).toHaveLength(1);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#95: eight-seat reset preserves verified roster and actor/token capability isolation",
  async ({ page }) => {
  test.setTimeout(60_000);
  const { observedHeaders } = await mockMatchApi(page, { playerCount: 8 });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  const owner = page.getByTestId("dev-opponent-lots-owner-filter");
  const street = page.getByTestId("dev-opponent-lots-street-filter");
  const posture = page.getByTestId("dev-opponent-lots-posture-filter");
  const nearby = page.getByTestId("dev-opponent-lots-nearby-toggle");
  const reset = page.getByTestId("dev-opponent-lots-reset-filters");
  const summary = page.getByTestId("dev-opponent-lots-active-filter-summary");
  await expect(page.getByTestId("dev-rival-nearest-list").locator("li")).toHaveCount(7);
  await owner.selectOption("heidi");
  await street.selectOption("gauss");
  await posture.selectOption("fallen");
  await nearby.click();
  await expect(summary).toContainText("4 filtri attivi");
  await expect(page.getByTestId("dev-rival-nearest-empty-heidi")).toBeVisible();
  await expect(page.getByTestId("dev-focus-rival-player-heidi")).toBeVisible();
  await reset.click();
  await expect(reset).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-list").locator("li")).toHaveCount(7);
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await expect(owner).toHaveValue("");
  await expect(street).toHaveValue("");
  await expect(posture).toHaveValue("all");
  await expect(nearby).toHaveAttribute("aria-pressed", "false");
  await street.selectOption("einstein");
  await posture.selectOption("standing");
  await page.getByTestId("dev-seat-bob").click();
  await expect(summary).toHaveCount(0);
  await expect(owner).toHaveValue("");
  await expect(street).toHaveValue("");
  await expect(posture).toHaveValue("all");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  await owner.selectOption("alice");
  await street.selectOption("gauss");
  await expect(summary).toContainText("2 filtri attivi");
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(reset).toHaveCount(0);
  await expect(owner).toHaveValue("");
  await expect(street).toHaveValue("");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview"))).toHaveLength(3);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});


test("#97: two-seat canonical street counts and keyboard quick selection on mobile IT/EN",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { fallenHenchman: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const summary = page.getByTestId("dev-opponent-street-distribution");
  const rows = page.getByTestId("dev-opponent-street-distribution-list").locator(":scope > li");
  const street = page.getByTestId("dev-opponent-lots-street-filter");
  await expect(summary).toContainText("Distribuzione dei lotti rivali");
  await expect(rows).toHaveCount(7);
  const einstein = page.getByTestId("dev-opponent-street-row-einstein");
  await expect(einstein).toHaveAttribute("data-total", "1");
  await expect(einstein).toHaveAttribute("data-standing", "0");
  await expect(einstein).toHaveAttribute("data-fallen", "1");
  await expect(page.getByTestId("dev-opponent-street-row-main-square"))
    .toHaveAttribute("data-total", "0");
  const totals = await rows.evaluateAll(nodes =>
    nodes.map(node => Number(node.getAttribute("data-total"))));
  expect(totals.reduce((sum, count) => sum + count, 0)).toBe(1);
  const chooseEinstein = page.getByTestId("dev-opponent-street-select-einstein");
  await chooseEinstein.focus();
  await expect(chooseEinstein).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(chooseEinstein).toHaveAttribute("aria-pressed", "true");
  await expect(street).toHaveValue("einstein");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await page.getByTestId("dev-focus-rival-nearest-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await page.getByTestId("dev-opponent-street-select-gauss").click();
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(street).toHaveValue("gauss");
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await expect(page.getByTestId("dev-focus-rival-player-bob")).toBeVisible();
  // The seven counters describe the complete audited public list, not a
  // filtered subset of routes. Toggling a selected row clears the street.
  await expect(einstein).toHaveAttribute("data-total", "1");
  await page.getByTestId("dev-opponent-street-select-gauss").click();
  await expect(street).toHaveValue("");
  await page.getByTestId("dev-opponent-lots-owner-filter").selectOption("bob");
  await page.getByTestId("dev-opponent-lots-posture-filter").selectOption("standing");
  await page.getByTestId("dev-opponent-street-select-einstein").click();
  await expect(page.getByTestId("dev-opponent-lots-list").locator("li")).toHaveCount(0);
  await expect(einstein).toHaveAttribute("data-fallen", "1");
  await page.getByTestId("dev-opponent-lots-reset-filters").click();
  await expect(street).toHaveValue("");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(summary).toContainText("Rival-held lots by public street");
  await expect(chooseEinstein).toHaveAttribute("aria-label",
    "Filter Einstein Avenue: 1 rival lot, 0 standing and 1 fallen");
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview")))
    .toHaveLength(1);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#97: eight-seat public street totals follow verified actor and token isolation",
  async ({ page }) => {
  test.setTimeout(60_000);
  const { observedHeaders } = await mockMatchApi(page, { playerCount: 8 });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  const roster = page.getByTestId("dev-rival-nearest-list");
  const street = page.getByTestId("dev-opponent-lots-street-filter");
  const gauss = page.getByTestId("dev-opponent-street-row-gauss");
  const einstein = page.getByTestId("dev-opponent-street-row-einstein");
  await expect(roster.locator("li")).toHaveCount(7);
  await expect(page.getByTestId("dev-opponent-street-distribution-list").locator(":scope > li"))
    .toHaveCount(7);
  await expect(einstein).toHaveAttribute("data-total", "1");
  await expect(gauss).toHaveAttribute("data-total", "0");
  await page.getByTestId("dev-opponent-street-select-main-square").click();
  await expect(street).toHaveValue("main-square");
  await expect(page.getByTestId("dev-rival-nearest-empty-bob")).toBeVisible();
  await expect(page.getByTestId("dev-focus-rival-player-heidi")).toBeVisible();
  await page.getByTestId("dev-seat-bob").click();
  await expect(street).toHaveValue("");
  await expect(gauss).toHaveAttribute("data-total", "1");
  await expect(einstein).toHaveAttribute("data-total", "0");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  await page.getByTestId("dev-opponent-street-select-gauss").click();
  await expect(street).toHaveValue("gauss");
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(street).toHaveValue("");
  await expect(gauss).toHaveAttribute("data-total", "1");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview")))
    .toHaveLength(3);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});


test("#98: paired public owner+street holdings select and clear without changing posture/nearby",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, { fallenHenchman: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("dev-create").click();
  const owner = page.getByTestId("dev-opponent-lots-owner-filter");
  const street = page.getByTestId("dev-opponent-lots-street-filter");
  const posture = page.getByTestId("dev-opponent-lots-posture-filter");
  const nearby = page.getByTestId("dev-opponent-lots-nearby-toggle");
  const row = page.getByTestId("dev-opponent-street-owner-row-einstein-bob");
  const choice = page.getByTestId("dev-opponent-street-owner-select-einstein-bob");
  await expect(row).toHaveAttribute("data-total", "1");
  await expect(row).toHaveAttribute("data-standing", "0");
  await expect(row).toHaveAttribute("data-fallen", "1");
  await expect(page.getByTestId("dev-opponent-street-owners-einstein").locator("li"))
    .toHaveCount(1);
  await expect(page.getByTestId("dev-opponent-street-no-owners-main-square")).toBeVisible();
  await expect(page.getByTestId("dev-opponent-street-owners-gauss")).toHaveCount(0);
  await expect(choice).toHaveAttribute("aria-pressed", "false");
  await posture.selectOption("fallen");
  await nearby.click();
  await page.getByTestId("dev-focus-rival-player-bob").click();
  await expect(page.getByTestId("city-tactical-focus")).toBeVisible();
  await choice.focus();
  await expect(choice).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(choice).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  await expect(owner).toHaveValue("bob");
  await expect(street).toHaveValue("einstein");
  await expect(posture).toHaveValue("fallen");
  await expect(nearby).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("dev-opponent-lots-active-filter-summary"))
    .toContainText("4 filtri attivi");
  // Counts are complete public observations, even with active filters.
  await expect(row).toHaveAttribute("data-total", "1");
  await choice.click();
  await expect(choice).toHaveAttribute("aria-pressed", "false");
  await expect(owner).toHaveValue("");
  await expect(street).toHaveValue("");
  await expect(posture).toHaveValue("fallen");
  await expect(nearby).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
  await expect(choice).toHaveAttribute("aria-label",
    "Filter bob on Einstein Avenue: 1 public lot, 0 standing and 1 fallen");
  await expect(page.getByTestId("dev-opponent-street-no-owners-main-square"))
    .toContainText("No public rival-held lots");
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview"))).toHaveLength(1);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

test("#98: eight-seat holdings only list public other owners and clear on seat/token change",
  async ({ page }) => {
  test.setTimeout(60_000);
  const { observedHeaders } = await mockMatchApi(page, { playerCount: 8 });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  const owner = page.getByTestId("dev-opponent-lots-owner-filter");
  const street = page.getByTestId("dev-opponent-lots-street-filter");
  await expect(page.getByTestId("dev-rival-nearest-list").locator("li")).toHaveCount(7);
  await expect(page.locator("[data-testid^=dev-opponent-street-owner-row-]"))
    .toHaveCount(1);
  await expect(page.getByTestId("dev-opponent-street-owner-row-einstein-bob"))
    .toHaveAttribute("data-total", "1");
  await expect(page.getByTestId("dev-opponent-street-owner-row-gauss-alice"))
    .toHaveCount(0);
  await page.getByTestId("dev-opponent-street-owner-select-einstein-bob").click();
  await expect(owner).toHaveValue("bob");
  await expect(street).toHaveValue("einstein");
  await expect(page.getByTestId("dev-opponent-lot-S-01")).toBeVisible();
  await page.getByTestId("dev-seat-bob").click();
  await expect(owner).toHaveValue("");
  await expect(street).toHaveValue("");
  await expect(page.getByTestId("dev-opponent-street-owner-row-einstein-bob")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-street-owner-row-gauss-alice"))
    .toHaveAttribute("data-total", "1");
  const aliceChoice = page.getByTestId("dev-opponent-street-owner-select-gauss-alice");
  await aliceChoice.click();
  await expect(owner).toHaveValue("alice");
  await expect(street).toHaveValue("gauss");
  await expect(page.getByTestId("dev-opponent-lot-N-01")).toBeVisible();
  await page.getByTestId("dev-rotate-token").click();
  await expect(page.getByTestId("dev-rotation-notice")).toBeVisible();
  await expect(owner).toHaveValue("");
  await expect(street).toHaveValue("");
  await expect(aliceChoice).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("dev-rival-nearest-list").locator("li")).toHaveCount(7);
  expect(observedHeaders.filter(x => x.path.endsWith("/tactical-overview"))).toHaveLength(3);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});


test("#100: forged nested rival lot actor scope hides all atomic tactical views (eight seats)",
  async ({ page }) => {
  const { observedHeaders } = await mockMatchApi(page, {
    playerCount: 8, invalidTacticalOverview: "nested-lots-player",
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByTestId("dev-player-count").selectOption("8");
  await page.getByTestId("dev-create").click();
  for (const id of ["dev-other-seats-unavailable",
    "dev-routes-unavailable", "dev-opponent-lots-unavailable"])
    await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByTestId("dev-other-seats-list")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-street-distribution")).toHaveCount(0);
  await expect(page.getByTestId("dev-opponent-lots-owner-filter")).toHaveCount(0);
  await expect(page.getByTestId("dev-rival-nearest-summary")).toHaveCount(0);
  await expect(page.getByTestId("city-tactical-focus")).toHaveCount(0);
  const readPaths = observedHeaders.filter(event => event.path.endsWith("/tactical-overview"));
  expect(readPaths).toHaveLength(1);
  expect(readPaths[0].token).toBe("a".repeat(64));
  expect(observedHeaders.filter(event =>
    /\/(uncontrolled-routes|other-player-routes|opponent-controlled-routes)$/
      .test(event.path))).toHaveLength(0);
  await expect(page.getByTestId("dev-revision")).toHaveText("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2))
    .toBe(false);
});

// #136: These are server-public history flags, never move permissions.
// Read-only city inspection and locale changes do not issue game commands.
for (const count of [2, 8] as const) {
  test(`#136: ${count}-seat public free-move flags follow honest moves without extra commands`,
    async ({ page }) => {
      if (count === 2) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addInitScript(() => {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
            if (kind === "webgl" || kind === "webgl2"
              || kind === "experimental-webgl") return null;
            return Reflect.apply(original, this, [kind, ...args]);
          };
        });
      }
      const { observedHeaders } = await mockMatchApi(page, { playerCount: count });
      await page.goto("/");
      await page.getByTestId("dev-player-count").selectOption(String(count));
      await page.getByTestId("dev-create").click();
      await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(count);
      for (const playerId of demoSeats.slice(0, count)) {
        await expect(page.getByTestId(`match-free-move-${playerId}`))
          .toHaveAttribute("data-free-move-used", "false");
        await expect(page.getByTestId(`match-free-move-${playerId}`))
          .toHaveText("Movimento libero non usato");
      }
      expect(observedHeaders.filter(h => h.path.endsWith("/free-move")
        || h.path.endsWith("/end-turn"))).toHaveLength(0);

      await page.getByTestId("dev-move-planck").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      await expect(page.getByTestId("match-free-move-alice"))
        .toHaveAttribute("data-free-move-used", "true");
      await expect(page.getByTestId("match-free-move-alice"))
        .toHaveText("Movimento libero usato");
      for (const playerId of demoSeats.slice(1, count)) {
        await expect(page.getByTestId(`match-free-move-${playerId}`))
          .toHaveAttribute("data-free-move-used", "false");
      }
      await page.getByTestId("match-inspect-street-bob").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      expect(observedHeaders.filter(h => h.path.endsWith("/free-move")
        || h.path.endsWith("/end-turn"))).toHaveLength(1);
      await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
      await expect(page.getByTestId("match-free-move-alice")).toHaveText("Free move used");
      await expect(page.getByTestId("match-free-move-bob")).toHaveText("Free move not used");
      await page.getByTestId("dev-seat-bob").click();
      await expect(page.getByTestId("match-free-move-alice"))
        .toHaveAttribute("data-free-move-used", "true");
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      expect(observedHeaders.filter(h => h.path.endsWith("/free-move")
        || h.path.endsWith("/end-turn"))).toHaveLength(1);
      await page.getByTestId("dev-leave").click();
      await expect(page.getByTestId("match-free-move-alice")).toHaveCount(0);
    });
}

// #137: Already-public character card hearts stay on the city legend.
// They are not damage, attack permissions or new API capabilities.
for (const count of [2, 8] as const) {
  test(`#137: ${count}-seat public hearts survive real-shaped movement, seat/locale changes and leave`,
    async ({ page }) => {
      if (count === 2) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addInitScript(() => {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
            if (kind === "webgl" || kind === "webgl2"
              || kind === "experimental-webgl") return null;
            return Reflect.apply(original, this, [kind, ...args]);
          };
        });
      }
      const { observedHeaders } = await mockMatchApi(page, { playerCount: count });
      await page.goto("/");
      await page.getByTestId("dev-player-count").selectOption(String(count));
      await page.getByTestId("dev-create").click();
      await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(count);
      for (const playerId of demoSeats.slice(0, count)) {
        await expect(page.getByTestId(`match-character-hearts-${playerId}`))
          .toHaveAttribute("data-character-hearts", "3");
        await expect(page.getByTestId(`match-character-hearts-${playerId}`))
          .toHaveText("Cuori personaggio: 3");
      }
      expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
        .toHaveLength(0);

      await page.getByTestId("dev-move-planck").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      for (const playerId of demoSeats.slice(0, count)) {
        await expect(page.getByTestId(`match-character-hearts-${playerId}`))
          .toHaveAttribute("data-character-hearts", "3");
      }
      await page.getByTestId("match-inspect-street-bob").click();
      await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
      await expect(page.getByTestId("match-character-hearts-alice"))
        .toHaveText("Character hearts: 3");
      await expect(page.getByTestId("match-character-hearts-bob"))
        .toHaveText("Character hearts: 3");
      await page.getByTestId("dev-seat-bob").click();
      await expect(page.getByTestId("match-character-hearts-alice"))
        .toHaveAttribute("data-character-hearts", "3");
      expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
        .toHaveLength(1);
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      await page.getByTestId("dev-leave").click();
      await expect(page.getByTestId("match-character-hearts-alice")).toHaveCount(0);
    });
}

// #138: city scouting copies the existing validated PUBLIC quote only.
for (const count of [2, 8] as const) {
  for (const fallen of [false, true] as const) {
    test(`#138: ${count}-seat public city economy with fallen=${fallen} is read-only in IT/EN`,
      async ({ page }) => {
        if (count === 2) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.addInitScript(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
              if (kind === "webgl" || kind === "webgl2"
                || kind === "experimental-webgl") return null;
              return Reflect.apply(original, this, [kind, ...args]);
            };
          });
        }
        const { observedHeaders } = await mockMatchApi(page,
          { playerCount: count, fallenHenchman: fallen });
        await page.goto("/");
        await page.getByTestId("dev-player-count").selectOption(String(count));
        await page.getByTestId("dev-create").click();
        await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(count);
        for (const playerId of demoSeats.slice(0, count)) {
          const economy = page.getByTestId(`match-player-economy-${playerId}`);
          const alice = playerId === "alice";
          const bob = playerId === "bob";
          const gross = alice || (bob && !fallen) ? 3 : 2;
          await expect(economy).toHaveAttribute("data-controlled-lots", alice || bob ? "1" : "0");
          await expect(economy).toHaveAttribute("data-standing", alice || (bob && !fallen) ? "1" : "0");
          await expect(economy).toHaveAttribute("data-fallen", bob && fallen ? "1" : "0");
          await expect(economy).toHaveAttribute("data-gross-atoms", String(gross));
          await expect(economy).toContainText(`preventivo lordo: ${gross} atomi`);
        }
        expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
          .toHaveLength(0);
        await page.getByTestId("dev-move-planck").click();
        await expect(page.getByTestId("dev-revision")).toHaveText("1");
        await expect(page.getByTestId("match-player-economy-alice"))
          .toHaveAttribute("data-gross-atoms", "3");
        await page.getByTestId("match-inspect-street-bob").click();
        await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
        await expect(page.getByTestId("match-player-economy-bob"))
          .toContainText(`gross quote: ${fallen ? 2 : 3} atoms`);
        await page.getByTestId("dev-seat-bob").click();
        await expect(page.getByTestId("match-player-economy-bob"))
          .toHaveAttribute("data-gross-atoms", fallen ? "2" : "3");
        expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
          .toHaveLength(1);
        await page.getByTestId("dev-leave").click();
        await expect(page.getByTestId("match-player-economy-alice")).toHaveCount(0);
      });
  }
}

for (const kind of ["missingGrossQuote", "invalidGrossQuote", "missingBoardCard",
  "badControlSlot", "unknownOwner"] as const) {
  test(`#138: forged ${kind} hides every public economic city label without affecting turn`,
    async ({ page }) => {
      await mockMatchApi(page, { [kind]: true, playerCount: 8 });
      await page.goto("/");
      await page.getByTestId("dev-player-count").selectOption("8");
      await page.getByTestId("dev-create").click();
      await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(8);
      for (const playerId of demoSeats) {
        await expect(page.getByTestId(`match-player-economy-${playerId}`)).toHaveCount(0);
        await expect(page.getByTestId(`gross-salary-${playerId}`)).toHaveCount(0);
      }
      await expect(page.getByTestId("dev-revision")).toHaveText("0");
      await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
    });
}

// #139: all values come from server-authored public player resources; a
// quoted GROSS salary is never credited to the current atom count.
for (const count of [2, 8] as const) {
  test(`#139: ${count}-seat current public atoms/diplomacy/reserve remain stable through view and turn`,
    async ({ page }) => {
      if (count === 2) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addInitScript(() => {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
            if (kind === "webgl" || kind === "webgl2"
              || kind === "experimental-webgl") return null;
            return Reflect.apply(original, this, [kind, ...args]);
          };
        });
      }
      const { observedHeaders } = await mockMatchApi(page, { playerCount: count });
      await page.goto("/");
      await page.getByTestId("dev-player-count").selectOption(String(count));
      await page.getByTestId("dev-create").click();
      await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(count);
      for (const playerId of demoSeats.slice(0, count)) {
        const resources = page.getByTestId(`match-player-resources-${playerId}`);
        await expect(resources).toHaveAttribute("data-atoms", "4");
        await expect(resources).toHaveAttribute("data-diplomacy-tokens", "2");
        await expect(resources).toHaveAttribute("data-henchmen-total", "16");
        await expect(resources).toHaveAttribute("data-henchmen-available",
          playerId === "alice" || playerId === "bob" ? "15" : "16");
        await expect(resources).toContainText("Atomi attuali: 4");
      }
      await expect(page.getByTestId("match-player-economy-alice"))
        .toHaveAttribute("data-gross-atoms", "3");
      expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
        .toHaveLength(0);
      await page.getByTestId("dev-move-planck").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      await expect(page.getByTestId("match-player-resources-alice"))
        .toHaveAttribute("data-atoms", "4");
      await page.getByTestId("match-inspect-street-bob").click();
      await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
      await expect(page.getByTestId("match-player-resources-bob"))
        .toContainText("Current atoms: 4");
      await expect(page.getByTestId("match-player-resources-bob"))
        .toContainText("available henchmen:");
      await page.getByTestId("dev-seat-bob").click();
      await expect(page.getByTestId("match-player-resources-alice"))
        .toHaveAttribute("data-diplomacy-tokens", "2");
      expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
        .toHaveLength(1);
      await page.getByTestId("dev-leave").click();
      await expect(page.getByTestId("match-player-resources-alice")).toHaveCount(0);
    });
}

for (const malformed of [false, true] as const) {
  test(`#139: 8-seat forged reserve=${malformed} hides or preserves entire scouting projection`,
    async ({ page }) => {
      await mockMatchApi(page, { playerCount: 8, malformedReserve: malformed });
      await page.goto("/");
      await page.getByTestId("dev-player-count").selectOption("8");
      await page.getByTestId("dev-create").click();
      await expect(page.getByTestId("match-player-legend").locator("li")).toHaveCount(8);
      for (const id of demoSeats) {
        await expect(page.getByTestId(`match-player-resources-${id}`))
          .toHaveCount(malformed ? 0 : 1);
        // Independent verified public economic quote stays visible: only
        // the invalid resource projection fails, not the whole match.
        await expect(page.getByTestId(`match-player-economy-${id}`))
          .toHaveCount(1);
      }
      await expect(page.getByTestId("dev-revision")).toHaveText("0");
      await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
    });
}

// #140: an invalid card on an UNCONTROLLED lot hides the complete economic
// readouts, but must NOT suppress a genuine game turn or public pawn/lot.
// In the valid case the extra unowned card is harmless to finance views.
for (const count of [2, 8] as const) {
  for (const extra of ["valid", "duplicate", "foreign", "bad-category", "bad-id"] as const) {
    test(`#140: ${count}-seat unowned-card=${extra} keeps only verified economic data`,
      async ({ page }) => {
        if (count === 2) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.addInitScript(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
              if (kind === "webgl" || kind === "webgl2"
                || kind === "experimental-webgl") return null;
              return Reflect.apply(original, this, [kind, ...args]);
            };
          });
        }
        const { observedHeaders } = await mockMatchApi(page,
          { playerCount: count, unownedBoardCard: extra });
        await page.goto("/");
        await page.getByTestId("dev-player-count").selectOption(String(count));
        await page.getByTestId("dev-create").click();
        await expect(page.getByTestId("match-player-legend").locator("li"))
          .toHaveCount(count);
        await expect(page.getByTestId("controlled-lot-N-01")).toBeVisible();
        await expect(page.getByTestId("controlled-lot-S-01")).toBeVisible();
        await expect(page.getByTestId("dev-revision")).toHaveText("0");
        await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
        const trustworthy = extra === "valid";
        await expect(page.getByTestId("match-board-card-count"))
          .toHaveCount(trustworthy ? 1 : 0);
        if (trustworthy) {
          await expect(page.getByTestId("match-board-card-count"))
            .toContainText("3");
        }
        for (const actor of demoSeats.slice(0, count)) {
          await expect(page.getByTestId(`gross-salary-${actor}`))
            .toHaveCount(trustworthy ? 1 : 0);
          await expect(page.getByTestId(`match-player-economy-${actor}`))
            .toHaveCount(trustworthy ? 1 : 0);
          await expect(page.getByTestId(`match-player-resources-${actor}`))
            .toHaveCount(trustworthy ? 1 : 0);
          await expect(page.getByTestId(`match-inspect-street-${actor}`))
            .toHaveCount(1);
        }
        expect(observedHeaders.filter(h =>
          /\/(free-move|end-turn)$/.test(h.path))).toHaveLength(0);
        if (count === 2 && extra === "valid") {
          await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
          await expect(page.getByTestId("match-player-economy-alice"))
            .toContainText("gross quote:");
          await expect(page.getByTestId("match-player-resources-alice"))
            .toContainText("Current atoms:");
        }
      });
  }
}

// #141: retain all valid independently verified positions, economic rows,
// resources, active turn and private actor scope on a malformed PUBLIC
// character assignment. The browser displays no fabricated rival hearts.
for (const count of [2, 8] as const) {
  for (const defect of ["wrong-hearts", "forged-seat-hearts", "duplicate-character",
    "duplicate-starting-activity", "missing-seat", "foreign-actor", "bad-heart"] as const) {
    test(`#141: ${count}-seat ${defect} hides all hearts but keeps legitimate PvP views`,
      async ({ page }) => {
        if (count === 2) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.addInitScript(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
              if (kind === "webgl" || kind === "webgl2"
                || kind === "experimental-webgl") return null;
              return Reflect.apply(original, this, [kind, ...args]);
            };
          });
        }
        const { observedHeaders } = await mockMatchApi(page, {
          playerCount: count, forgedAssignedCharacter: defect,
        });
        await page.goto("/");
        await page.getByTestId("dev-player-count").selectOption(String(count));
        await page.getByTestId("dev-create").click();
        await expect(page.getByTestId("match-player-legend").locator("li"))
          .toHaveCount(count);
        for (const id of demoSeats.slice(0, count)) {
          await expect(page.getByTestId(`match-character-hearts-${id}`))
            .toHaveCount(0);
          await expect(page.getByTestId(`match-inspect-street-${id}`))
            .toHaveCount(1);
          await expect(page.getByTestId(`match-player-economy-${id}`))
            .toHaveCount(1);
          await expect(page.getByTestId(`match-player-resources-${id}`))
            .toHaveCount(1);
        }
        await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
        await expect(page.getByTestId("dev-revision")).toHaveText("0");
        expect(observedHeaders.filter(h => /\/(free-move|end-turn)$/.test(h.path)))
          .toHaveLength(0);
        if (count === 2 && defect === "wrong-hearts") {
          await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
          await expect(page.getByTestId("match-player-resources-alice"))
            .toContainText("Current atoms:");
        }
      });
  }
}

// #142: a cloned physical public card across *distinct printed slots*
// must NOT make the city economic/finance data look verified. Valid
// independent pawns, controlled lot markers and server turn remain usable.
for (const count of [2, 8] as const) {
  for (const duplicate of ["unowned-vs-unowned",
    "unowned-vs-controlled", "controlled-vs-controlled"] as const) {
    test(`#142: ${count}-seat cloned public ${duplicate} hides board/finance, not live actors`,
      async ({ page }) => {
        if (count === 2) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.addInitScript(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
              if (kind === "webgl" || kind === "webgl2"
                || kind === "experimental-webgl") return null;
              return Reflect.apply(original, this, [kind, ...args]);
            };
          });
        }
        const { observedHeaders } = await mockMatchApi(page,
          { playerCount: count, duplicatePublicCardIds: duplicate });
        await page.goto("/");
        await page.getByTestId("dev-player-count").selectOption(String(count));
        await page.getByTestId("dev-create").click();
        await expect(page.getByTestId("match-player-legend").locator("li"))
          .toHaveCount(count);
        await expect(page.getByTestId("match-board-card-count")).toHaveCount(0);
        await expect(page.getByTestId("controlled-lot-N-01")).toBeVisible();
        await expect(page.getByTestId("controlled-lot-S-01")).toBeVisible();
        await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
        await expect(page.getByTestId("dev-revision")).toHaveText("0");
        for (const seat of demoSeats.slice(0, count)) {
          await expect(page.getByTestId(`gross-salary-${seat}`)).toHaveCount(0);
          await expect(page.getByTestId(`match-player-economy-${seat}`)).toHaveCount(0);
          await expect(page.getByTestId(`match-player-resources-${seat}`)).toHaveCount(0);
          await expect(page.getByTestId(`match-inspect-street-${seat}`)).toHaveCount(1);
        }
        expect(observedHeaders.filter(r =>
          /\/(free-move|end-turn)$/.test(r.path))).toHaveLength(0);
        if (count === 2 && duplicate === "unowned-vs-unowned") {
          await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
          await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
          await expect(page.getByTestId("match-player-legend").locator("li"))
            .toHaveCount(2);
        }
      });
  }
}

// #143: valid full 30-card Domain quotas must keep the economic UI visible;
// a forged printed category or a wrong full-deck quota hides every derived
// finance/resource row without disabling a genuine turn or public pawn.
for (const count of [2, 8] as const) {
  for (const scenario of [
    "partial-valid", "partial-foreign", "partial-casing",
    "full-valid", "full-bad-quota",
  ] as const) {
    test(`#143: ${count} seats board category=${scenario} respects complete public quotas`,
      async ({ page }) => {
        if (count === 2) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.addInitScript(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
              if (kind === "webgl" || kind === "webgl2"
                || kind === "experimental-webgl") return null;
              return Reflect.apply(original, this, [kind, ...args]);
            };
          });
        }
        const { observedHeaders } = await mockMatchApi(page,
          { playerCount: count, publicCardCategory: scenario });
        await page.goto("/");
        await page.getByTestId("dev-player-count").selectOption(String(count));
        await page.getByTestId("dev-create").click();
        await expect(page.getByTestId("match-player-legend").locator("li"))
          .toHaveCount(count);
        await expect(page.getByTestId("controlled-lot-N-01")).toBeVisible();
        await expect(page.getByTestId("controlled-lot-S-01")).toBeVisible();
        await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
        await expect(page.getByTestId("dev-revision")).toHaveText("0");
        const valid = scenario === "partial-valid" || scenario === "full-valid";
        await expect(page.getByTestId("match-board-card-count"))
          .toHaveCount(valid ? 1 : 0);
        if (valid) {
          await expect(page.getByTestId("match-board-card-count"))
            .toContainText(scenario === "full-valid" ? "30" : "3");
        }
        for (const id of demoSeats.slice(0, count)) {
          await expect(page.getByTestId(`gross-salary-${id}`))
            .toHaveCount(valid ? 1 : 0);
          await expect(page.getByTestId(`match-player-economy-${id}`))
            .toHaveCount(valid ? 1 : 0);
          await expect(page.getByTestId(`match-player-resources-${id}`))
            .toHaveCount(valid ? 1 : 0);
          await expect(page.getByTestId(`match-inspect-street-${id}`))
            .toHaveCount(1);
        }
        expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
          .toHaveLength(0);
        if (count === 2 && scenario === "full-valid") {
          await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
          await expect(page.getByTestId("match-player-economy-alice"))
            .toContainText("gross quote:");
          await expect(page.getByTestId("match-player-resources-alice"))
            .toContainText("Current atoms:");
        }
      });
  }
}


// #145: with 30 publicly placed cards the browser must prove that each
// character's assigned starting activity is the card in its OWN origin lot.
// A wrong-but-existing unowned card must not create a genuine hearts badge.
for (const count of [2, 8] as const) {
  for (const forged of [undefined, "foreign-card", "missing-card"] as const) {
    test("#145: " + count + "-seat full board character origin=" + (forged ?? "valid")
      + " keeps independent PvP views", async ({ page }) => {
      if (count === 2) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addInitScript(() => {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
            if (kind === "webgl" || kind === "webgl2"
              || kind === "experimental-webgl") return null;
            return Reflect.apply(original, this, [kind, ...args]);
          };
        });
      }
      const { observedHeaders } = await mockMatchApi(page, {
        playerCount: count, publicCardCategory: "full-valid",
        forgedFullBoardOrigin: forged,
      });
      await page.goto("/");
      await page.getByTestId("dev-player-count").selectOption(String(count));
      await page.getByTestId("dev-create").click();
      await expect(page.getByTestId("match-player-legend").locator("li"))
        .toHaveCount(count);
      await expect(page.getByTestId("match-board-card-count"))
        .toContainText("30");
      for (const id of demoSeats.slice(0, count)) {
        await expect(page.getByTestId(`match-character-hearts-${id}`))
          .toHaveCount(forged ? 0 : 1);
        // #146: the same verified character gate guards BOTH publicly
        // assigned technical card IDs, not only the printed hearts.
        const publicCharacter = page.getByTestId(`match-character-card-${id}`);
        const publicStartingCard = page.getByTestId(`match-character-starting-card-${id}`);
        await expect(publicCharacter).toHaveCount(forged ? 0 : 1);
        await expect(publicStartingCard).toHaveCount(forged ? 0 : 1);
        if (!forged) {
          await expect(publicCharacter).toHaveAttribute(
            "data-character-card-id", `synthetic:character:${id}`);
          const startingId = id === "alice" ? "demo:activity:gauss"
            : id === "bob" ? "demo:activity:einstein"
              : `synthetic:printed:N-${String(demoSeats.indexOf(id) + 1).padStart(2, "0")}`;
          await expect(publicStartingCard).toHaveAttribute(
            "data-starting-activity-card-id", startingId);
        }
        await expect(page.getByTestId(`match-player-economy-${id}`))
          .toHaveCount(1);
        await expect(page.getByTestId(`match-player-resources-${id}`))
          .toHaveCount(1);
        await expect(page.getByTestId(`match-inspect-street-${id}`))
          .toHaveCount(1);
      }
      await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
      await expect(page.getByTestId("dev-revision")).toHaveText("0");
      expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
        .toHaveLength(0);
      if (count === 2 && !forged) {
        await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
        await expect(page.getByTestId("match-character-hearts-alice"))
          .toHaveText("Character hearts: 3");
        await expect(page.getByTestId("match-character-card-alice"))
          .toHaveText("Character card (public ID): synthetic:character:alice");
        await expect(page.getByTestId("match-character-starting-card-alice"))
          .toHaveText("Starting activity (public ID): demo:activity:gauss");
      }
    });
  }
}


// #147: lightweight, PUBLIC PvP distance from the actual current turn owner;
// never a move option or server command. Canonical street hops must update on
// turn rotation and disappear when the last first-round player ends the turn.
for (const count of [2, 8] as const) {
  test(`#147: ${count} seats display active-turn rival hops with IT/EN/mobile/no-WebGL`,
    async ({ page }) => {
      if (count === 2) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.addInitScript(() => {
          const original = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
            if (kind === "webgl" || kind === "webgl2"
              || kind === "experimental-webgl") return null;
            return Reflect.apply(original, this, [kind, ...args]);
          };
        });
      }
      const { observedHeaders } = await mockMatchApi(page, { playerCount: count });
      await page.goto("/");
      await page.getByTestId("dev-player-count").selectOption(String(count));
      await page.getByTestId("dev-create").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("0");
      await expect(page.getByTestId("match-player-legend").locator("li"))
        .toHaveCount(count);
      await expect(page.getByTestId("match-active-rival-steps-alice"))
        .toHaveCount(0);
      const expectedHops = {
        bob: 2, charlie: 1, diana: 1, eve: 2,
        frank: 2, grace: 1, heidi: 0,
      } as const;
      for (const id of demoSeats.slice(1, count)) {
        const badge = page.getByTestId(`match-active-rival-steps-${id}`);
        await expect(badge).toHaveAttribute("data-from-player-id", "alice");
        await expect(badge).toHaveAttribute("data-from-street-id", "gauss");
        await expect(badge).toHaveAttribute(
          "data-street-steps", String(expectedHops[id as keyof typeof expectedHops]));
        await expect(badge).toContainText("Distanza in strade da alice (di turno):");
        await expect(page.getByTestId(`match-character-hearts-${id}`))
          .toHaveCount(1);
        await expect(page.getByTestId(`match-player-economy-${id}`))
          .toHaveCount(1);
      }
      await expect(page.getByTestId("match-active-rival-steps-bob"))
        .toHaveAttribute("data-street-path", "gauss,main-square,einstein");
      expect(observedHeaders.filter(e => /\/(free-move|end-turn)$/.test(e.path)))
        .toHaveLength(0);

      if (count === 2) {
        await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
        await expect(page.getByTestId("match-active-rival-steps-bob"))
          .toHaveText("Street hops from turn owner alice: 2");
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth > window.innerWidth + 2);
        expect(overflow).toBe(false);
      }
      await page.getByTestId("dev-end-turn").click();
      await expect(page.getByTestId("dev-revision")).toHaveText("1");
      await expect(page.getByTestId("dev-active-player")).toHaveText("bob");
      await expect(page.getByTestId("match-active-rival-steps-bob"))
        .toHaveCount(0);
      await expect(page.getByTestId("match-active-rival-steps-alice"))
        .toHaveAttribute("data-from-player-id", "bob");
      await expect(page.getByTestId("match-active-rival-steps-alice"))
        .toHaveAttribute("data-street-steps", "2");

      if (count === 2) {
        await page.getByTestId("dev-seat-bob").click();
        await page.getByTestId("dev-end-turn").click();
        await expect(page.getByTestId("dev-revision")).toHaveText("2");
        await expect(page.getByTestId("dev-active-player"))
          .toHaveText("Waiting for round-settlement rules");
        for (const id of demoSeats.slice(0, count))
          await expect(page.getByTestId(`match-active-rival-steps-${id}`))
            .toHaveCount(0);
      }
      expect(observedHeaders.filter(e => e.path.endsWith("/free-move")))
        .toHaveLength(0);
      expect(observedHeaders.filter(e => e.path.endsWith("/end-turn")))
        .toHaveLength(count === 2 ? 2 : 1);
    });
}


// #148: an actually useful PvP quick-scout: ALL nearest rival seats, not
// one arbitrary winner. Clicking only INSPECTS that public street. This
// section uses buttons, NOT extra <li> elements in the canonical seat list.
for (const count of [2, 8] as const) {
  for (const sameStreet of [false, true] as const) {
    test(`#148: ${count} seats nearest opponent ties, sameStreet=${sameStreet}, inspect only`,
      async ({ page }) => {
        if (count === 2) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.addInitScript(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
              if (kind === "webgl" || kind === "webgl2"
                || kind === "experimental-webgl") return null;
              return Reflect.apply(original, this, [kind, ...args]);
            };
          });
        }
        const { observedHeaders } = await mockMatchApi(page, {
          playerCount: count, sameStreet,
        });
        await page.goto("/");
        await page.getByTestId("dev-player-count").selectOption(String(count));
        await page.getByTestId("dev-create").click();
        await expect(page.getByTestId("match-player-legend").locator("li"))
          .toHaveCount(count);
        await expect(page.getByTestId("dev-revision")).toHaveText("0");

        const expected = count === 2 ? ["bob"]
          : sameStreet ? ["bob", "heidi"] : ["heidi"];
        const buttons = page.getByTestId("city-nearest-rivals")
          .locator('button[data-testid^="city-nearest-rival-"]');
        await expect(buttons).toHaveCount(expected.length);
        for (let i = 0; i < expected.length; i++) {
          const button = buttons.nth(i);
          const id = expected[i];
          await expect(button).toHaveAttribute(
            "data-from-player-id", "alice");
          await expect(button).toHaveAttribute(
            "data-street-steps",
            String(count === 2 && !sameStreet ? 2 : 0));
          await expect(button).toHaveAttribute("data-target-street-id",
            id === "bob" && !sameStreet ? "einstein" : "gauss");
          await expect(button).toContainText(id);
        }
        expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
          .toHaveLength(0);

        const targetStreet = expected[0] === "bob" && !sameStreet
          ? "Einstein Avenue" : "Gauss Avenue";
        await buttons.first().click();
        await expect(page.getByTestId("selected-street")).toHaveText(targetStreet);
        await expect(page.getByTestId("dev-revision")).toHaveText("0");
        await expect(page.getByTestId("match-player-legend").locator("li"))
          .toHaveCount(count);
        expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
          .toHaveLength(0);
        await expect(page.getByTestId("match-player-economy-bob"))
          .toHaveCount(1);
        await expect(page.getByTestId("match-character-hearts-bob"))
          .toHaveCount(1);

        if (count === 2) {
          await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
          await expect(page.getByTestId("city-nearest-rivals"))
            .toContainText("Nearest rivals to the turn owner");
          await expect(buttons.first()).toHaveText(
            `bob · ${sameStreet ? 0 : 2} hops`);
          const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth > window.innerWidth + 2);
          expect(overflow).toBe(false);
        }
        await page.getByTestId("dev-end-turn").click();
        await expect(page.getByTestId("dev-revision")).toHaveText("1");
        await expect(page.getByTestId("dev-active-player")).toHaveText("bob");
        const expectedAfter = count === 2 ? ["alice"]
          : sameStreet ? ["alice", "heidi"] : ["charlie", "diana", "grace"];
        await expect(buttons).toHaveCount(expectedAfter.length);
        for (let i = 0; i < expectedAfter.length; i++) {
          const button = buttons.nth(i);
          await expect(button).toHaveAttribute(
            "data-from-player-id", "bob");
          await expect(button).toContainText(expectedAfter[i]);
        }
        if (count === 2) {
          await page.getByTestId("dev-seat-bob").click();
          await page.getByTestId("dev-end-turn").click();
          await expect(page.getByTestId("dev-revision")).toHaveText("2");
          await expect(page.getByTestId("city-nearest-rivals"))
            .toHaveCount(0);
          await expect(page.getByTestId("match-player-legend").locator("li"))
            .toHaveCount(2);
        }
        expect(observedHeaders.filter(x => x.path.endsWith("/free-move")))
          .toHaveLength(0);
        expect(observedHeaders.filter(x => x.path.endsWith("/end-turn")))
          .toHaveLength(count === 2 ? 2 : 1);
      });
  }
}


// #149: full 30-card printed Development boards have 28 visibly public but
// UNCONTROLLED cards in this synthetic fixture (two controlled starts).
// The city lists ALL of them only after validating the entire public board;
// clicking merely selects the printed lot, without a .NET game command.
for (const count of [2, 8] as const) {
  for (const invalidQuota of [false, true] as const) {
    test(`#149: ${count} seats free public activity atlas, forged quota=${invalidQuota}`,
      async ({ page }) => {
        // #156: eight-seat, full-board PvP test includes the seven-road
        // owner matrix, eight-player public footprint and every atlas
        // filter. It is a legitimate slower UI stress scenario under
        // software WebGL; only THIS case receives 90s (default remains 30s).
        if (count === 8 && !invalidQuota) test.setTimeout(90_000);
        if (count === 2) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.addInitScript(() => {
            const original = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
              if (kind === "webgl" || kind === "webgl2"
                || kind === "experimental-webgl") return null;
              return Reflect.apply(original, this, [kind, ...args]);
            };
          });
        }
        const { observedHeaders } = await mockMatchApi(page, {
          playerCount: count,
          publicCardCategory: invalidQuota ? "full-bad-quota" : "full-valid",
        });
        await page.goto("/");
        await page.getByTestId("dev-player-count").selectOption(String(count));
        await page.getByTestId("dev-create").click();
        await expect(page.getByTestId("dev-revision")).toHaveText("0");
        await expect(page.getByTestId("match-player-legend").locator("li"))
          .toHaveCount(count);
        await expect(page.getByTestId("match-activity-roster")
          .locator("li[data-owner-id]")).toHaveCount(2);

        const atlas = page.getByTestId("match-public-free-activities");
        const list = page.getByTestId("match-public-free-activities-list");
        if (invalidQuota) {
          await expect(atlas).toHaveCount(0);
          // #152: a forged full-board quota cannot produce an apparently
          // valid rival-control matrix with free/owned counts.
          await expect(page.getByTestId("public-street-control-section")).toHaveCount(0);
          await expect(page.getByTestId("public-territory-standings-section")).toHaveCount(0);
          await expect(page.getByTestId("match-board-card-count")).toHaveCount(0);
          // A rejected printed category NEVER suppresses player positions
          // or revokes a valid actor's separate .NET turn command.
          await expect(page.getByTestId("dev-end-turn")).toBeEnabled();
          await expect(page.getByTestId("match-player-alice")).toHaveCount(1);
          await expect(page.getByTestId("match-player-bob")).toHaveCount(1);
          return;
        }

        await expect(page.getByTestId("match-board-card-count"))
          .toContainText("30");
        await expect(atlas).toBeVisible();
        await expect(atlas).not.toHaveAttribute("open", "");
        await expect(atlas.locator("summary"))
          .toContainText("Esplora 28 attività non controllate sulla plancia");
        await atlas.locator("summary").click();
        await expect(atlas).toHaveAttribute("open", "");
        await expect(list.locator("li")).toHaveCount(28);
        await expect(list.locator("li").first())
          .toHaveAttribute("data-card-id", "synthetic:printed:N-02");
        await expect(list.locator("li").first())
          .toHaveAttribute("data-street-id", "gauss");
        await expect(list.locator("li").last())
          .toHaveAttribute("data-card-id", "synthetic:printed:M-04");
        await expect(page.getByTestId("public-free-activity-N-01")).toHaveCount(0);
        await expect(page.getByTestId("public-free-activity-S-01")).toHaveCount(0);
        await expect(page.getByTestId("match-inspect-free-activity-N-02"))
          .toHaveAttribute("aria-label",
            "Esplora attività non controllata nel lotto N-02 su Gauss Avenue");
        await page.getByTestId("match-inspect-free-activity-N-02").click();
        await expect(page.getByTestId("selected-slot")).toHaveText("N-02");
        await expect(page.getByTestId("selected-street")).toHaveText("Gauss Avenue");
        await expect(page.getByTestId("dev-revision")).toHaveText("0");
        expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
          .toHaveLength(0);
        await expect(page.getByTestId("gross-salary-alice")).toHaveCount(1);
        await expect(page.getByTestId("match-character-hearts-bob")).toHaveCount(1);
        // #152: territory is public, 30 printed slots in exactly 7 roads,
        // with owner zero-counts retained in 2- AND 8-player fixtures.
        const territory = page.getByTestId("public-street-control-details");
        await expect(territory).toBeVisible();
        await expect(territory).not.toHaveAttribute("open", "");
        await territory.locator("summary").click();
        await expect(territory).toHaveAttribute("open", "");
        const territoryRows = page.getByTestId("public-street-control-list").locator("li");
        await expect(territoryRows).toHaveCount(7);
        const gaussControl = page.getByTestId("public-street-control-gauss");
        const einsteinControl = page.getByTestId("public-street-control-einstein");
        const hallControl = page.getByTestId("public-street-control-main-square");
        await expect(gaussControl).toHaveAttribute("data-total-slots", "8");
        await expect(gaussControl).toHaveAttribute("data-free-count", "7");
        await expect(gaussControl).toHaveAttribute("data-controlled-count", "1");
        await expect(gaussControl).toHaveAttribute("data-standing-count", "1");
        await expect(gaussControl).toHaveAttribute("data-fallen-count", "0");
        await expect(einsteinControl).toHaveAttribute("data-free-count", "7");
        await expect(einsteinControl).toHaveAttribute("data-controlled-count", "1");
        await expect(hallControl).toHaveAttribute("data-total-slots", "0");
        await expect(hallControl).toHaveAttribute("data-free-count", "0");
        await expect(hallControl).toHaveAttribute("data-controlled-count", "0");
        for (const roadId of ["gauss", "einstein", "newton", "planck", "boson", "meson", "main-square"])
          await expect(page.getByTestId(`public-street-control-${roadId}`)
            .locator('[data-testid*="-owner-"]')).toHaveCount(count);
        await expect(page.getByTestId("public-street-control-gauss-owner-alice"))
          .toHaveAttribute("data-owned-count", "1");
        await expect(page.getByTestId("public-street-control-gauss-owner-bob"))
          .toHaveAttribute("data-owned-count", "0");
        await expect(page.getByTestId("public-street-control-einstein-owner-bob"))
          .toHaveAttribute("data-owned-count", "1");
        // #153: only TWO owners have a lot in this synthetic 8-seat
        // fixture; all zero-lot rivals remain visible, with competition
        // positions 1,1,3 (not gameplay victory points).
        const footprint = page.getByTestId("public-territory-standings");
        await expect(footprint).toBeVisible();
        await expect(footprint).not.toHaveAttribute("open", "");
        await footprint.locator("summary").click();
        await expect(footprint).toHaveAttribute("open", "");
        const seatStandings = page.getByTestId("public-territory-standings-list").locator("li");
        await expect(seatStandings).toHaveCount(count);
        for (const playerId of ["alice", "bob"]) {
          const row = page.getByTestId(`public-territory-footprint-${playerId}`);
          await expect(row).toHaveAttribute("data-place", "1");
          await expect(row).toHaveAttribute("data-controlled-lots", "1");
          await expect(row).toHaveAttribute("data-occupied-streets", "1");
        }
        for (const playerId of demoSeats.slice(2, count)) {
          const row = page.getByTestId(`public-territory-footprint-${playerId}`);
          await expect(row).toHaveAttribute("data-place", "3");
          await expect(row).toHaveAttribute("data-controlled-lots", "0");
          await expect(row).toHaveAttribute("data-occupied-streets", "0");
        }
        const bobFootprint = page.getByTestId("public-territory-footprint-bob");
        await expect(bobFootprint).toHaveAttribute("data-standing", "1");
        await expect(bobFootprint).toHaveAttribute("data-fallen", "0");
        await expect(seatStandings.first()).toHaveAttribute("data-testid",
          "public-territory-footprint-alice");
        await expect(seatStandings.nth(1)).toHaveAttribute("data-testid",
          "public-territory-footprint-bob");
        await page.getByTestId("public-street-control-inspect-einstein").click();
        await expect(page.getByTestId("selected-street")).toHaveText("Einstein Avenue");
        await expect(page.getByTestId("dev-revision")).toHaveText("0");
        expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
          .toHaveLength(0);

        // #150: combining a canonical street with a printed category filters
        // ONLY this verified atlas; public totals, PvP state and choices stay.
        const streetFilter = page.getByTestId("public-free-filter-street");
        const categoryFilter = page.getByTestId("public-free-filter-category");
        const countText = page.getByTestId("public-free-filter-count");
        await expect(streetFilter.locator("option")).toHaveCount(8);
        await expect(categoryFilter.locator("option")).toHaveCount(9);
        await expect(countText).toHaveAttribute("data-total-count", "28");
        await streetFilter.selectOption("gauss");
        await expect(list.locator("li")).toHaveCount(7);
        await expect(countText).toHaveAttribute("data-visible-count", "7");
        await categoryFilter.selectOption("sport");
        await expect(list.locator("li")).toHaveCount(0);
        await expect(page.getByTestId("public-free-filter-empty")).toBeVisible();
        await expect(countText).toHaveAttribute("data-total-count", "28");
        await streetFilter.selectOption("");
        await expect(list.locator("li")).toHaveCount(2);
        await expect(page.getByTestId("public-free-filter-empty")).toHaveCount(0);
        await expect(page.getByTestId("public-free-activity-B-02")).toBeVisible();
        await expect(page.getByTestId("public-free-activity-B-03")).toBeVisible();
        // #151: street count quick-scout must clear the other facet rather
        // than accidentally showing an unrelated category subset.
        const streetCounts = page.getByTestId("public-free-street-distribution");
        const streetButtons = streetCounts.locator('button[data-testid^="public-free-street-count-"]');
        await expect(streetButtons).toHaveCount(7);
        const expectedStreetCounts = [
          ["gauss", 7], ["einstein", 7], ["newton", 3], ["planck", 3],
          ["boson", 4], ["meson", 4], ["main-square", 0],
        ] as const;
        for (let index = 0; index < expectedStreetCounts.length; index++) {
          const [street, total] = expectedStreetCounts[index];
          await expect(streetButtons.nth(index)).toHaveAttribute(
            "data-street-id", street);
          await expect(streetButtons.nth(index)).toHaveAttribute(
            "data-free-count", String(total));
        }
        await page.getByTestId("public-free-street-count-gauss").click();
        await expect(streetFilter).toHaveValue("gauss");
        await expect(categoryFilter).toHaveValue("");
        await expect(list.locator("li")).toHaveCount(7);
        await expect(countText).toHaveAttribute("data-total-count", "28");
        await page.getByTestId("public-free-street-count-main-square").click();
        await expect(streetFilter).toHaveValue("main-square");
        await expect(list.locator("li")).toHaveCount(0);
        await expect(page.getByTestId("public-free-filter-empty")).toBeVisible();
        await expect(page.getByTestId("public-free-street-count-main-square"))
          .toHaveAttribute("aria-label",
            "Mostra 0 attività pubbliche non controllate sulla strada Main Square");
        await page.getByTestId("public-free-street-count-boson").click();
        await expect(streetFilter).toHaveValue("boson");
        await expect(list.locator("li")).toHaveCount(4);
        await streetFilter.selectOption("");
        await expect(list.locator("li")).toHaveCount(28);
        // The road shortcut already cleared the category facet; do not
        // repeat a no-op selectOption under heavy eight-seat rendering.
        await expect(categoryFilter).toHaveValue("");
        expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
          .toHaveLength(0);

        if (count === 2) {
          await page.getByRole("combobox", { name: "Lingua" }).selectOption("en");
          await expect(atlas.locator("summary"))
            .toContainText("Inspect 28 uncontrolled activities on the board");
          await expect(page.getByText("Filter by street", { exact: true })).toBeVisible();
          await expect(page.getByText("Filter by category", { exact: true })).toBeVisible();
          await expect(page.getByTestId("public-free-filter-count"))
            .toHaveText("28 of 28 free public activities visible");
          await expect(page.getByTestId("public-free-street-distribution"))
            .toContainText("Free public activities by street");
          await expect(territory.locator("summary"))
            .toContainText("Public territory: free and controlled lots by street");
          await expect(footprint.locator("summary"))
            .toContainText("Public territory comparison · not a victory score");
          await expect(page.getByTestId("public-territory-footprint-bob"))
            .toContainText("Place 1 · 1 lots · 1 standing · 0 fallen · 1 streets");
          await expect(page.getByTestId("public-street-control-gauss"))
            .toContainText("7 free · 1 controlled");
          await expect(page.getByTestId("public-street-control-inspect-einstein"))
            .toHaveAttribute("aria-label",
              "Inspect street Einstein Avenue without executing game actions");
          await expect(page.getByTestId("public-free-street-count-gauss"))
            .toHaveAttribute("aria-label",
              "Show 7 uncontrolled public activities on Gauss Avenue");
          await expect(page.getByTestId("match-inspect-free-activity-N-02"))
            .toHaveAttribute("aria-label",
              "Inspect uncontrolled activity at lot N-02 on Gauss Avenue");
          const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth > window.innerWidth + 2);
          expect(overflow).toBe(false);
          await page.getByTestId("dev-end-turn").click();
          await expect(page.getByTestId("dev-active-player")).toHaveText("bob");
          await page.getByTestId("dev-seat-bob").click();
          await page.getByTestId("dev-end-turn").click();
          await expect(page.getByTestId("dev-revision")).toHaveText("2");
          // No active player is necessary: printed public cards remain.
          await expect(atlas).toBeVisible();
          await expect(list.locator("li")).toHaveCount(28);
          await expect(territory).toBeVisible();
          await expect(gaussControl).toHaveAttribute("data-controlled-count", "1");
          await expect(page.getByTestId("public-territory-footprint-alice"))
            .toHaveAttribute("data-place", "1");
        }
      });
  }
}


test("#152: fallen public rival henchman is not counted as standing or an attack option",
  async ({ page }) => {
    const { observedHeaders } = await mockMatchApi(page, {
      playerCount: 2,
      publicCardCategory: "full-valid",
      fallenHenchman: true,
    });
    await page.goto("/");
    await page.getByTestId("dev-create").click();
    await expect(page.getByTestId("dev-revision")).toHaveText("0");
    const territory = page.getByTestId("public-street-control-details");
    await territory.locator("summary").click();
    const einstein = page.getByTestId("public-street-control-einstein");
    await expect(einstein).toHaveAttribute("data-total-slots", "8");
    await expect(einstein).toHaveAttribute("data-controlled-count", "1");
    await expect(einstein).toHaveAttribute("data-standing-count", "0");
    await expect(einstein).toHaveAttribute("data-fallen-count", "1");
    await expect(page.getByTestId("public-street-control-einstein-owner-bob"))
      .toHaveAttribute("data-fallen-count", "1");
    await expect(page.getByTestId("public-street-control-einstein-owner-alice"))
      .toHaveAttribute("data-owned-count", "0");
    const standings = page.getByTestId("public-territory-standings");
    await standings.locator("summary").click();
    await expect(page.getByTestId("public-territory-footprint-alice"))
      .toHaveAttribute("data-place", "1");
    await expect(page.getByTestId("public-territory-footprint-bob"))
      .toHaveAttribute("data-place", "1");
    await expect(page.getByTestId("public-territory-footprint-bob"))
      .toHaveAttribute("data-standing", "0");
    await expect(page.getByTestId("public-territory-footprint-bob"))
      .toHaveAttribute("data-fallen", "1");
    await expect(page.getByTestId("match-public-free-activities-list")).toHaveCount(1);
    await page.getByTestId("public-street-control-inspect-einstein").click();
    await expect(page.getByTestId("selected-street")).toHaveText("Einstein Avenue");
    expect(observedHeaders.filter(x => /\/(free-move|end-turn)$/.test(x.path)))
      .toHaveLength(0);
  });
