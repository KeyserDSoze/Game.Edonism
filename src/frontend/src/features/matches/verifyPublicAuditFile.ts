import { isAdjacentStreet, streetById } from "@/features/city/board";

/**
 * A bounded, UNTRUSTED consistency check for a public Development replay file.
 * It proves neither provenance nor authenticity: a forger could create a
 * self-consistent unsigned file. Never use it for commands or matchmaking.
 */
export const MaxPublicAuditImportBytes = 64 * 1024;

export type PublicAuditFileCheck = Readonly<{
  matchId: string;
  verifiedRevision: number;
  playerCount: number;
  eventCount: number;
}>;

const ROOT = ["format", "matchId", "round", "verifiedRevision", "events", "frames"];
const EVENT = ["revision", "round", "kind", "actorId", "fromStreetId", "toStreetId"];
const FRAME = ["revision", "kind", "actorId", "phase", "activePlayerId", "players"];
const PLAYER = ["playerId", "streetId", "freeMoveUsed"];

function exactFields(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === allowed.length && allowed.every(key =>
    Object.prototype.hasOwnProperty.call(value, key));
}

function validPlayerId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 64
    && id.trim() === id
    && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(id);
}

export function verifyPublicAuditFile(input: unknown): PublicAuditFileCheck | null {
  if (!exactFields(input, ROOT) || input.format !== "edonism-public-audit-v1"
    || typeof input.matchId !== "string"
    || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.matchId)
    || input.round !== 1 || !Number.isSafeInteger(input.verifiedRevision)
    || typeof input.verifiedRevision !== "number"
    || input.verifiedRevision < 0 || input.verifiedRevision > 16
    || !Array.isArray(input.events) || !Array.isArray(input.frames)
    || input.events.length !== input.verifiedRevision + 1
    || input.frames.length !== input.events.length) return null;

  const genesis = input.frames[0];
  if (!exactFields(genesis, FRAME) || !Array.isArray(genesis.players)
    || genesis.players.length < 2 || genesis.players.length > 8) return null;

  const order: string[] = [];
  const positions = new Map<string, string>();
  const moved = new Map<string, boolean>();
  for (const player of genesis.players) {
    if (!exactFields(player, PLAYER) || !validPlayerId(player.playerId)
      || typeof player.streetId !== "string" || !streetById(player.streetId)
      || player.freeMoveUsed !== false || positions.has(player.playerId))
      return null;
    order.push(player.playerId);
    positions.set(player.playerId, player.streetId);
    moved.set(player.playerId, false);
  }

  let turn = 0;
  let phase = 0;
  for (let index = 0; index < input.events.length; index++) {
    const event: unknown = input.events[index];
    const frame: unknown = input.frames[index];
    if (!exactFields(event, EVENT) || !exactFields(frame, FRAME)
      || event.revision !== index || event.round !== 1
      || frame.revision !== index || frame.kind !== event.kind
      || frame.actorId !== event.actorId) return null;

    if (index === 0) {
      if (event.kind !== "match-created" || event.actorId !== "system"
        || event.fromStreetId !== null || event.toStreetId !== null)
        return null;
    } else {
      if (phase !== 0 || event.actorId !== order[turn]) return null;
      switch (event.kind) {
        case "free-move":
          if (moved.get(order[turn])
            || event.fromStreetId !== positions.get(order[turn])
            || typeof event.toStreetId !== "string"
            || !isAdjacentStreet(event.fromStreetId as string, event.toStreetId))
            return null;
          moved.set(order[turn], true);
          positions.set(order[turn], event.toStreetId);
          break;
        case "turn-ended":
          if (turn === order.length - 1
            || event.fromStreetId !== null || event.toStreetId !== null)
            return null;
          turn++;
          break;
        case "round-settlement-pending":
          if (turn !== order.length - 1
            || event.fromStreetId !== null || event.toStreetId !== null)
            return null;
          phase = 1;
          break;
        default:
          // Unknown future events may include hidden data. Fail closed until
          // a reviewed new export format and replay verifier exist.
          return null;
      }
    }

    if (frame.phase !== phase
      || frame.activePlayerId !== (phase === 0 ? order[turn] : null)
      || !Array.isArray(frame.players)
      || frame.players.length !== order.length) return null;

    for (let i = 0; i < order.length; i++) {
      const player: unknown = frame.players[i];
      if (!exactFields(player, PLAYER) || player.playerId !== order[i]
        || player.streetId !== positions.get(order[i])
        || player.freeMoveUsed !== moved.get(order[i])) return null;
    }
  }

  return {
    matchId: input.matchId,
    verifiedRevision: input.verifiedRevision,
    playerCount: order.length,
    eventCount: input.events.length,
  };
}
