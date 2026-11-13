import { expect, test } from "@playwright/test";
import {
  validateUncontrolledPublicRoutes, validateOtherPublicPlayerRoutes,
  validateOpponentPublicLotRoutes, validatePublicTacticalRoutes,
  type TacticalRouteContext,
} from "../src/features/matches/publicTacticalRouteValidators";

// Public seven-street fixture mirrors the printed graph; no Vite JSON import,
// browser, bearer, private data, or real API for these pure tests.
const graph: Record<string, readonly string[]> = {
  gauss: ["newton", "planck", "main-square"],
  einstein: ["newton", "planck", "main-square"],
  newton: ["gauss", "einstein", "boson"],
  planck: ["gauss", "einstein", "meson"],
  boson: ["newton", "main-square"],
  meson: ["planck", "main-square"],
  "main-square": ["gauss", "einstein", "boson", "meson"],
};
const seats = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
const streets = ["gauss", "einstein", "newton", "planck",
  "boson", "meson", "gauss", "einstein"];
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function path(from: string, to: string): string[] | null {
  if (!graph[from] || !graph[to]) return null;
  const previous = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    if (at === to) {
      const result: string[] = [];
      for (let id: string | null = at; id !== null; id = previous.get(id) ?? null)
        result.push(id);
      return result.reverse();
    }
    for (const next of [...graph[at]].sort()) {
      if (!previous.has(next)) {
        previous.set(next, at);
        queue.push(next);
      }
    }
  }
  return null;
}
function fixture(count: 2 | 4 | 8) {
  const players = seats.slice(0, count).map((playerId, i) =>
    ({ playerId, streetId: streets[i] }));
  const boardActivities = [
    ...players.map((_, i) => ({
      slotId: `seat-${i}`, cardId: `card-${i}`, category: "culture",
    })),
    { slotId: "free-gauss", cardId: "free-card-1", category: "culture" },
    { slotId: "free-planck", cardId: "free-card-2", category: "transport" },
  ];
  const controlledActivities = players.map((player, i) =>
    ({ slotId: `seat-${i}`, ownerPlayerId: player.playerId, posture: i % 2 }));
  const slotStreets: Record<string, string> = Object.fromEntries([
    ...players.map((player, i) => [`seat-${i}`, player.streetId]),
    ["free-gauss", "gauss"], ["free-planck", "planck"],
  ]);
  const scope = { matchId: "match-public-only", playerId: "alice",
    round: 1, verifiedRevision: 4, fromStreetId: "gauss" };
  const ctx: TacticalRouteContext = {
    scope, state: { players, boardActivities, controlledActivities },
    shortestPath: path, slotStreetId: id => slotStreets[id],
  };
  const pathTo = (street: string) => path("gauss", street)!;
  const uncontrolledRoutes = boardActivities.slice(-2).map(card => ({
    slotId: card.slotId, cardId: card.cardId, category: card.category,
    streetId: slotStreets[card.slotId],
    streetSteps: pathTo(slotStreets[card.slotId]).length - 1,
    streetPath: pathTo(slotStreets[card.slotId]),
  })).sort((a, b) => a.streetSteps - b.streetSteps || cmp(a.slotId, b.slotId));
  const others = players.slice(1).map(player => {
    const holdings = controlledActivities.filter(c =>
      c.ownerPlayerId === player.playerId);
    return { otherPlayerId: player.playerId, streetId: player.streetId,
      streetSteps: pathTo(player.streetId).length - 1,
      streetPath: pathTo(player.streetId),
      controlledActivities: holdings.length,
      standingHenchmen: holdings.filter(c => c.posture === 0).length };
  }).sort((a, b) => a.streetSteps - b.streetSteps
    || cmp(a.otherPlayerId, b.otherPlayerId));
  const rivalRoutes = controlledActivities.slice(1).map(lot => ({
    ...lot, streetId: slotStreets[lot.slotId],
    streetSteps: pathTo(slotStreets[lot.slotId]).length - 1,
    streetPath: pathTo(slotStreets[lot.slotId]),
  })).sort((a, b) => a.streetSteps - b.streetSteps
    || cmp(a.ownerPlayerId, b.ownerPlayerId) || cmp(a.slotId, b.slotId));
  const overview = { ...scope,
    uncontrolled: { ...scope, routes: uncontrolledRoutes },
    otherPlayers: { ...scope, others },
    opponentControlledLots: { ...scope, routes: rivalRoutes } };
  return { ctx, overview };
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

for (const count of [2, 4, 8] as const) {
  test(`#101: ${count} public seats accept exact valid routes without mutation`, () => {
    const { ctx, overview } = fixture(count);
    const before = JSON.stringify(overview);
    expect(validatePublicTacticalRoutes(overview, ctx)).toBe(true);
    expect(validateUncontrolledPublicRoutes(overview.uncontrolled, ctx)).toBe(true);
    expect(validateOtherPublicPlayerRoutes(overview.otherPlayers, ctx)).toBe(true);
    expect(validateOpponentPublicLotRoutes(overview.opponentControlledLots, ctx)).toBe(true);
    expect(JSON.stringify(overview)).toBe(before);
  });
  test(`#101: ${count} seats reject forged uncontrolled cards, paths and order`, () => {
    const { ctx, overview } = fixture(count);
    const mutations: Array<(x: typeof overview) => void> = [
      x => { x.uncontrolled.routes[0].cardId = "forged"; },
      x => { x.uncontrolled.routes[0].category = "forged"; },
      x => { x.uncontrolled.routes[0].slotId = "seat-0"; },
      x => { x.uncontrolled.routes[0].streetId = "unmapped"; },
      x => { x.uncontrolled.routes[0].streetPath = ["gauss", "gauss"]; },
      x => { x.uncontrolled.routes[0].streetSteps = 6; },
      x => { x.uncontrolled.routes.pop(); },
      x => { x.uncontrolled.routes.push(clone(x.uncontrolled.routes[0])); },
      x => { x.uncontrolled.routes.reverse(); },
    ];
    for (const mutate of mutations) {
      const bad = clone(overview); mutate(bad);
      expect(validateUncontrolledPublicRoutes(bad.uncontrolled, ctx)).toBe(false);
      expect(validatePublicTacticalRoutes(bad, ctx)).toBe(false);
    }
  });
  test(`#101: ${count} seats reject forged player identity, path and holding counts`, () => {
    const { ctx, overview } = fixture(count);
    const mutations: Array<(x: typeof overview) => void> = [
      x => { x.otherPlayers.others[0].otherPlayerId = "alice"; },
      x => { x.otherPlayers.others[0].streetId = "unmapped"; },
      x => { x.otherPlayers.others[0].streetPath = ["gauss", "gauss"]; },
      x => { x.otherPlayers.others[0].streetSteps = 9; },
      x => { x.otherPlayers.others[0].controlledActivities = 88; },
      x => { x.otherPlayers.others[0].standingHenchmen = 88; },
      x => { x.otherPlayers.others.pop(); },
      x => { x.otherPlayers.others.push(clone(x.otherPlayers.others[0])); },
    ];
    if (count > 2) mutations.push(x => { x.otherPlayers.others.reverse(); });
    for (const mutate of mutations) {
      const bad = clone(overview); mutate(bad);
      expect(validateOtherPublicPlayerRoutes(bad.otherPlayers, ctx)).toBe(false);
      expect(validatePublicTacticalRoutes(bad, ctx)).toBe(false);
    }
  });
  test(`#101: ${count} seats reject forged rival owner, posture, slot and path`, () => {
    const { ctx, overview } = fixture(count);
    const mutations: Array<(x: typeof overview) => void> = [
      x => { x.opponentControlledLots.routes[0].ownerPlayerId = "alice"; },
      x => { x.opponentControlledLots.routes[0].posture = 55; },
      x => { x.opponentControlledLots.routes[0].slotId = "seat-0"; },
      x => { x.opponentControlledLots.routes[0].streetId = "unmapped"; },
      x => { x.opponentControlledLots.routes[0].streetPath = ["gauss"]; },
      x => { x.opponentControlledLots.routes[0].streetSteps = 55; },
      x => { x.opponentControlledLots.routes.pop(); },
      x => { x.opponentControlledLots.routes.push(clone(x.opponentControlledLots.routes[0])); },
    ];
    if (count > 2) mutations.push(x => { x.opponentControlledLots.routes.reverse(); });
    for (const mutate of mutations) {
      const bad = clone(overview); mutate(bad);
      expect(validateOpponentPublicLotRoutes(bad.opponentControlledLots, ctx)).toBe(false);
      expect(validatePublicTacticalRoutes(bad, ctx)).toBe(false);
    }
  });
}
test("#101: malformed/null/missing nested routes, actor/revision/round/origin fail closed", () => {
  const { ctx, overview } = fixture(8);
  for (const malformed of [null, undefined, false, [], {}, 17, "invalid"]) {
    expect(validateUncontrolledPublicRoutes(malformed, ctx)).toBe(false);
    expect(validateOtherPublicPlayerRoutes(malformed, ctx)).toBe(false);
    expect(validateOpponentPublicLotRoutes(malformed, ctx)).toBe(false);
    expect(validatePublicTacticalRoutes(malformed, ctx)).toBe(false);
  }
  for (const part of ["uncontrolled", "otherPlayers", "opponentControlledLots"] as const) {
    for (const field of ["matchId", "playerId", "round",
      "verifiedRevision", "fromStreetId"] as const) {
      const bad = clone(overview);
      (bad[part] as Record<string, unknown>)[field] = null;
      expect(validatePublicTacticalRoutes(bad, ctx)).toBe(false);
    }
    const bad = clone(overview) as Record<string, unknown>;
    bad[part] = [overview[part]];
    expect(validatePublicTacticalRoutes(bad, ctx)).toBe(false);
    delete bad[part];
    expect(validatePublicTacticalRoutes(bad, ctx)).toBe(false);
  }
  const changedContext = { ...ctx, scope: { ...ctx.scope, fromStreetId: "newton" } };
  expect(validatePublicTacticalRoutes(overview, changedContext)).toBe(false);
  expect(validatePublicTacticalRoutes(overview, ctx)).toBe(true);
});
