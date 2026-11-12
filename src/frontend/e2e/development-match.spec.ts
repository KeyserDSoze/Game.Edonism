import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
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
  delayRotationAcknowledgement?: boolean;
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
  let delayedAlicePresence = false;
  let delayedSettlement = false;
  let delayedAliceTurnProgress = false;
  let delayedAliceRoutes = false;
  let delayedAliceOtherSeats = false;
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
      ...(options.routePlannerWithFreeCards ? [
        { slotId: "N-02", cardId: "demo:activity:free-gauss", category: "culture" },
        { slotId: "S-02", cardId: "demo:activity:free-einstein", category: "sport" },
      ] : []),
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

test("offline public replay validates completed two-seat round but rejects premature settlement",
  async ({ page, browser }) => {
    await mockMatchApi(page);
    await page.goto("/");
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
    try {
      const offline = await context.newPage();
      await offline.goto("/");
      const fileInput = offline.getByTestId("dev-public-audit-import-file");
      const status = offline.getByTestId("dev-public-audit-import-status");
      await fileInput.setInputFiles({
        name: "completed-round.json", mimeType: "application/json", buffer: bytes,
      });
      await expect(status).toHaveAttribute("data-check", "valid");
      const forged = JSON.parse(bytes.toString("utf8")) as typeof data;
      forged.events[1].kind = "round-settlement-pending";
      await fileInput.setInputFiles({
        name: "early-settlement.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(forged)),
      });
      await expect(status).toHaveAttribute("data-check", "invalid");
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
      test.setTimeout(seatCount === 8 ? 60_000 : 30_000);
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
        }

        if (seatCount === 2) {
          await upload(Buffer.alloc(64 * 1024 + 1, "x"));
          await expect(status).toHaveAttribute("data-check", "invalid");
          await upload(Buffer.from("{invalid json"));
          await expect(status).toHaveAttribute("data-check", "invalid");
        }
        await upload(jsonBytes);
        await expect(status).toHaveAttribute("data-check", "valid");
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
    path.endsWith("/uncontrolled-routes") && token === "a".repeat(64))).toBe(true);
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
    path.endsWith("/other-player-routes") && token === "a".repeat(64))).toBe(true);
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
