/**
 * #101 — Pure, fail-closed semantic validation of the three public #88
 * tactical projections. No React, fetch, bearer, storage or preview geometry.
 * The caller must check the current actor/token/abort/revision and #100 scope.
 */
import type { PublicTacticalScope } from "./publicTacticalScope";

export type TacticalRouteState = Readonly<{
  players: readonly Readonly<{ playerId: string; streetId: string }>[];
  boardActivities: readonly Readonly<{ slotId: string; cardId: string; category: string }>[];
  controlledActivities: readonly Readonly<{
    slotId: string; ownerPlayerId: string; posture: number;
  }>[];
}>;
export type TacticalRouteContext = Readonly<{
  scope: PublicTacticalScope;
  state: TacticalRouteState;
  shortestPath: (from: string, to: string) => readonly string[] | null;
  slotStreetId: (slotId: string) => string | undefined;
}>;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function scoped(value: unknown, expected: PublicTacticalScope):
  value is Record<string, unknown> {
  return record(value) && value.matchId === expected.matchId
    && value.playerId === expected.playerId && value.round === expected.round
    && value.verifiedRevision === expected.verifiedRevision
    && value.fromStreetId === expected.fromStreetId;
}
function originIsCurrent(ctx: TacticalRouteContext): boolean {
  const actor = ctx.state.players.find(p => p.playerId === ctx.scope.playerId);
  return !!actor && actor.streetId === ctx.scope.fromStreetId;
}
function exactPath(raw: unknown, path: readonly string[]): boolean {
  return Array.isArray(raw) && raw.length === path.length
    && raw.every((street: unknown, i: number) => street === path[i]);
}

/** #49: exact uncontrolled public card set, canonical slot/path/order. */
export function validateUncontrolledPublicRoutes(
  response: unknown, ctx: TacticalRouteContext,
): boolean {
  try {
    if (!originIsCurrent(ctx) || !scoped(response, ctx.scope)
      || !Array.isArray(response.routes)) return false;
    const controlled = new Set(ctx.state.controlledActivities.map(c => c.slotId));
    const expected = ctx.state.boardActivities.filter(a => !controlled.has(a.slotId));
    if (response.routes.length !== expected.length) return false;
    const bySlot = new Map(expected.map(a => [a.slotId, a] as const));
    const seen = new Set<string>();
    let lastSteps = -1, lastSlot = "";
    for (const route of response.routes) {
      if (!record(route) || typeof route.slotId !== "string"
        || typeof route.streetId !== "string" || seen.has(route.slotId)
        || !Number.isInteger(route.streetSteps)
        || (route.streetSteps as number) < 0 || (route.streetSteps as number) > 6) return false;
      const card = bySlot.get(route.slotId);
      const path = ctx.shortestPath(ctx.scope.fromStreetId, route.streetId);
      const steps = route.streetSteps as number;
      if (!card || route.cardId !== card.cardId || route.category !== card.category
        || ctx.slotStreetId(route.slotId) !== route.streetId || !path
        || !exactPath(route.streetPath, path) || steps !== path.length - 1
        || steps < lastSteps || (steps === lastSteps && route.slotId <= lastSlot))
        return false;
      seen.add(route.slotId);
      lastSteps = steps;
      lastSlot = route.slotId;
    }
    return true;
  } catch { return false; }
}

/** #51: exactly every other seat, public holdings and standing posture count. */
export function validateOtherPublicPlayerRoutes(
  response: unknown, ctx: TacticalRouteContext,
): boolean {
  try {
    if (!originIsCurrent(ctx) || !scoped(response, ctx.scope)
      || !Array.isArray(response.others)
      || response.others.length !== ctx.state.players.length - 1) return false;
    const expected = new Map(ctx.state.players.filter(p =>
      p.playerId !== ctx.scope.playerId).map(p => [p.playerId, p] as const));
    const seen = new Set<string>();
    let lastSteps = -1, lastId = "";
    for (const other of response.others) {
      if (!record(other) || typeof other.otherPlayerId !== "string"
        || typeof other.streetId !== "string" || seen.has(other.otherPlayerId))
        return false;
      const player = expected.get(other.otherPlayerId);
      const path = ctx.shortestPath(ctx.scope.fromStreetId, other.streetId);
      const owned = ctx.state.controlledActivities.filter(c =>
        c.ownerPlayerId === other.otherPlayerId);
      const standing = owned.filter(c => c.posture === 0).length;
      if (!player || other.streetId !== player.streetId || !path
        || !exactPath(other.streetPath, path)
        || !Number.isInteger(other.streetSteps)
        || other.streetSteps !== path.length - 1
        || !Number.isInteger(other.controlledActivities)
        || other.controlledActivities !== owned.length
        || !Number.isInteger(other.standingHenchmen)
        || other.standingHenchmen !== standing
        || (other.streetSteps as number) < lastSteps
        || (other.streetSteps === lastSteps && other.otherPlayerId <= lastId))
        return false;
      seen.add(other.otherPlayerId);
      lastSteps = other.streetSteps as number;
      lastId = other.otherPlayerId;
    }
    return true;
  } catch { return false; }
}

/** #84: exactly every rival-controlled public lot, no actor lot leaked. */
export function validateOpponentPublicLotRoutes(
  response: unknown, ctx: TacticalRouteContext,
): boolean {
  try {
    if (!originIsCurrent(ctx) || !scoped(response, ctx.scope)
      || !Array.isArray(response.routes)) return false;
    const expected = ctx.state.controlledActivities.filter(c =>
      c.ownerPlayerId !== ctx.scope.playerId);
    if (response.routes.length !== expected.length) return false;
    const otherIds = new Set(ctx.state.players.filter(p =>
      p.playerId !== ctx.scope.playerId).map(p => p.playerId));
    if (expected.some(lot => !otherIds.has(lot.ownerPlayerId))) return false;
    const bySlot = new Map(expected.map(lot => [lot.slotId, lot] as const));
    const seen = new Set<string>();
    let lastSteps = -1, lastOwner = "", lastSlot = "";
    for (const route of response.routes) {
      if (!record(route) || typeof route.slotId !== "string"
        || typeof route.streetId !== "string"
        || typeof route.ownerPlayerId !== "string"
        || seen.has(route.slotId) || route.ownerPlayerId === ctx.scope.playerId
        || !Number.isInteger(route.posture) || !Number.isInteger(route.streetSteps))
        return false;
      const lot = bySlot.get(route.slotId);
      const path = ctx.shortestPath(ctx.scope.fromStreetId, route.streetId);
      const steps = route.streetSteps as number;
      if (!lot || route.ownerPlayerId !== lot.ownerPlayerId
        || route.posture !== lot.posture
        || ctx.slotStreetId(route.slotId) !== route.streetId || !path
        || !exactPath(route.streetPath, path)
        || steps !== path.length - 1 || steps < lastSteps
        || (steps === lastSteps && (route.ownerPlayerId < lastOwner
          || (route.ownerPlayerId === lastOwner && route.slotId <= lastSlot))))
        return false;
      seen.add(route.slotId);
      lastSteps = steps;
      lastOwner = route.ownerPlayerId;
      lastSlot = route.slotId;
    }
    return true;
  } catch { return false; }
}

/** All-or-nothing semantic gate; #100 scope gate must run in React first. */
export function validatePublicTacticalRoutes(
  overview: unknown, ctx: TacticalRouteContext,
): boolean {
  return record(overview)
    && validateUncontrolledPublicRoutes(overview.uncontrolled, ctx)
    && validateOtherPublicPlayerRoutes(overview.otherPlayers, ctx)
    && validateOpponentPublicLotRoutes(overview.opponentControlledLots, ctx);
}
