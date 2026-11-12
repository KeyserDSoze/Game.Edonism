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


/**
 * The review is a fresh, explicitly projected copy of ONLY already-validated
 * public fields. No raw JSON object, browser credential or command handler is
 * retained. A valid unsigned file remains unauthenticated.
 */
export type OfflinePublicAuditTimelineStep = Readonly<{
  revision: number;
  kind: "match-created" | "free-move" | "turn-ended" | "round-settlement-pending";
  actorId: string;
  fromStreetId: string | null;
  toStreetId: string | null;
  phase: 0 | 1;
  activePlayerId: string | null;
  players: readonly Readonly<{
    playerId: string;
    streetId: string;
    freeMoveUsed: boolean;
  }>[];
}>;

export type OfflinePublicAuditReview = PublicAuditFileCheck & Readonly<{
  steps: readonly OfflinePublicAuditTimelineStep[];
}>;

export function buildOfflinePublicAuditReview(
  input: unknown,
): OfflinePublicAuditReview | null {
  const verified = verifyPublicAuditFile(input);
  if (!verified) return null;

  // The strict verifier has checked the shape, enums and every transition.
  // Re-project ALL fields explicitly; never store input or spreads of it.
  const record = input as {
    events: Array<{
      revision: number;
      kind: OfflinePublicAuditTimelineStep["kind"];
      actorId: string;
      fromStreetId: string | null;
      toStreetId: string | null;
    }>;
    frames: Array<{
      revision: number;
      phase: 0 | 1;
      activePlayerId: string | null;
      players: Array<{
        playerId: string;
        streetId: string;
        freeMoveUsed: boolean;
      }>;
    }>;
  };
  return {
    matchId: verified.matchId,
    verifiedRevision: verified.verifiedRevision,
    playerCount: verified.playerCount,
    eventCount: verified.eventCount,
    steps: record.events.map((event, index) => ({
      revision: event.revision,
      kind: event.kind,
      actorId: event.actorId,
      fromStreetId: event.fromStreetId,
      toStreetId: event.toStreetId,
      phase: record.frames[index].phase,
      activePlayerId: record.frames[index].activePlayerId,
      players: record.frames[index].players.map(player => ({
        playerId: player.playerId,
        streetId: player.streetId,
        freeMoveUsed: player.freeMoveUsed,
      })),
    })),
  };
}
