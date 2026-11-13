import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleDot, Download, FlaskConical, Hand, LogOut, MoveRight, RotateCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cityBoard, shortestStreetPath, streetById, slotById } from "@/features/city/board";
import type { TacticalFocus } from "@/features/city/tacticalFocus";
import type { HistoricalStreetFocus } from "@/features/city/historicalStreetFocus";
import type { PublicMatchSceneState, PublicBoardActivity, PublicControlledActivity, PublicGrossSalaryQuote } from "@/features/city/activityMarkers";
import { visiblePublicAuditEvents, type PublicMatchEvent } from "./publicAudit";
import { buildVerifiedPublicAuditExport } from "./publicAuditExport";
import {
  MaxPublicAuditImportBytes, buildOfflinePublicAuditReview,
  type OfflinePublicAuditReview,
} from "./verifyPublicAuditFile";
import {
  compareOfflinePublicAuditReviews,
  type OfflinePublicAuditComparison,
  type PublicAuditChangedField,
} from "./comparePublicAudits";
import { verifiedPublicHistory, type PublicHistory } from "./verifiedPublicHistory";

type DemoCredential = Readonly<{ playerId: string; token: string }>;
type DemoPlayer = Readonly<{
  playerId: string;
  streetId: string;
  startingSlotId: string;
  freeMoveUsed: boolean;
  hearts: number | null;
}>;
type DemoMatch = Readonly<{
  matchId: string;
  revision: number;
  round: number;
  phase: number; // .NET MatchPhase: 0 = PlayerTurns, 1 = AwaitingRoundSettlement
  activePlayerId: string | null;
  players: readonly DemoPlayer[];
  boardActivities: readonly PublicBoardActivity[];
  controlledActivities: readonly PublicControlledActivity[];
  grossSalaryQuotes: readonly PublicGrossSalaryQuote[];
  turnOrder: readonly string[];
  proposedNextRoundOrder: readonly string[];
  events: readonly PublicMatchEvent[];
}>;
type DemoSession = Readonly<{
  matchId: string;
  state: DemoMatch;
  credentials: readonly DemoCredential[];
}>;
type PrivateHand = Readonly<{
  matchId: string;
  playerId: string;
  cardIds: readonly string[];
}>;

type ActorTurnOptions = Readonly<{
  matchId: string;
  playerId: string;
  revision: number;
  canEndTurn: boolean;
  freeMoveStreetIds: readonly string[];
}>;

type DevSeatBootstrap = Readonly<{
  matchId: string;
  playerId: string;
  state: DemoMatch;
  hand: PrivateHand;
  turnOptions: ActorTurnOptions;
}>;

// Public, audited preview, never a wage payment or next-round transition.
type PendingSettlementPreview = Readonly<{
  matchId: string;
  round: number;
  verifiedRevision: number;
  nextTurnOrder: readonly string[];
  grossSalaryQuotes: readonly PublicGrossSalaryQuote[];
}>;

// Read-only, server-verified routes to uncontrolled PUBLIC activities.
// Street steps are graph edges, never turns or purchase permissions.
type UncontrolledRoute = Readonly<{
  slotId: string;
  cardId: string;
  category: string;
  streetId: string;
  streetSteps: number;
  streetPath: readonly string[];
}>;
type UncontrolledRoutes = Readonly<{
  matchId: string;
  playerId: string;
  round: number;
  verifiedRevision: number;
  fromStreetId: string;
  routes: readonly UncontrolledRoute[];
}>;

// Public-only other-seat scouting; NEVER faction, combat or action permission.
type OtherSeatRoute = Readonly<{
  otherPlayerId: string;
  streetId: string;
  streetSteps: number;
  streetPath: readonly string[];
  controlledActivities: number;
  standingHenchmen: number;
}>;
type OtherSeatRoutes = Readonly<{
  matchId: string;
  playerId: string;
  round: number;
  verifiedRevision: number;
  fromStreetId: string;
  others: readonly OtherSeatRoute[];
}>;

type OpponentControlledLotRoute = Readonly<{
  slotId: string;
  ownerPlayerId: string;
  posture: number;
  streetId: string;
  streetSteps: number;
  streetPath: readonly string[];
}>;
type OpponentControlledLotRoutes = Readonly<{
  matchId: string;
  playerId: string;
  round: number;
  verifiedRevision: number;
  fromStreetId: string;
  routes: readonly OpponentControlledLotRoute[];
}>;

// #88: a single actor- and revision-scoped read-only result from #87.
// All three nested perspectives are validated before ANY is displayed.
type TacticalOverview = Readonly<{
  matchId: string;
  playerId: string;
  round: number;
  verifiedRevision: number;
  fromStreetId: string;
  uncontrolled: UncontrolledRoutes;
  otherPlayers: OtherSeatRoutes;
  opponentControlledLots: OpponentControlledLotRoutes;
}>;

type FirstRoundTurnProgress = Readonly<{
  matchId: string;
  round: number;
  verifiedRevision: number;
  phase: number;
  activePlayerId: string | null;
  totalTurns: number;
  completedTurns: number;
  completedPlayerIds: readonly string[];
  remainingPlayerIds: readonly string[];
}>;

// Development-only transport hint. Absence means no recent heartbeat,
// NOT proof that a person disconnected or that their turn can be skipped.
type DevPresence = Readonly<{
  matchId: string;
  seats: readonly Readonly<{ playerId: string; isActive: boolean }>[];
}>;

const quotaAndExtras = [
  ["public-financing", 5, 2],
  ["private-financing", 5, 2],
  ["black-market", 4, 2],
  ["corruption", 4, 2],
  ["culture", 4, 2],
  ["sport", 2, 1],
  ["transport", 3, 2],
  ["bishopric", 3, 3],
] as const;

const demoSeatIds = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"] as const;

/**
 * Local Development-only synthetic catalog: 46 activities, 23 characters,
 * 58 action IDs and one Election Day. These IDs are not actual Edonism cards.
 * The backend is still authoritative over draw, position, movement and turn.
 */
function demoFixture(playerCount: number) {
  const activities = quotaAndExtras.flatMap(([category, quota, extra]) =>
    Array.from({ length: quota + extra }, (_, index) => ({
      id: `demo:${category}:${String(index + 1).padStart(2, "0")}`,
      category,
    })),
  );
  // The 23 synthetic characters reference distinct activities chosen only
  // from each category's printed 30-slot quota. Any 2-8 drawn characters
  // then fit the board without inventing overflow compensation (R-03).
  const startingCards = Array.from(
    { length: Math.max(...quotaAndExtras.map(([, quota]) => quota)) },
    (_, index) => quotaAndExtras
      .filter(([, quota]) => index < quota)
      .map(([category]) => `demo:${category}:${String(index + 1).padStart(2, "0")}`),
  ).flat();
  const characters = Array.from({ length: 23 }, (_, index) => ({
    id: `demo:character:${String(index + 1).padStart(2, "0")}`,
    startingActivityCardId: startingCards[index],
    printedInitialHearts: (index % 5) + 1,
  }));
  const actionCardIds = Array.from(
    { length: 58 },
    (_, index) => `demo:action:${String(index + 1).padStart(2, "0")}`,
  );

  return {
    playerIds: demoSeatIds.slice(0, playerCount),
    characters,
    availableActivities: activities,
    actionCardIds,
    electionDayCardId: "demo:election-day",
    seed: 2026,
  };
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`http_${response.status}`);
  return (await response.json()) as T;
}

/**
 * Never write capability tokens or private hands to browser storage.
 * Switching local seats is a *Development fixture* affordance only.
 */
export function DevelopmentMatchLab({
  onStreetSelect,
  onPublicState,
  onTacticalFocus,
  onHistoricalFocus,
}: {
  onStreetSelect: (id: string) => void;
  /** A public-only server snapshot projection for the 3D scene and DOM fallback. */
  onPublicState: (state: PublicMatchSceneState | null) => void;
  /** Public-only map highlight; NEVER a move, token or action command. */
  onTacticalFocus: (focus: TacticalFocus | null) => void;
  /** A read-only public historic street, scoped to the validated replay. */
  onHistoricalFocus: (focus: HistoricalStreetFocus | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<DemoSession | null>(null);
  const [playerCount, setPlayerCount] = useState(2);
  const [actorId, setActorId] = useState("");
  const [hand, setHand] = useState<PrivateHand | null>(null);
  const [historyLease, setHistoryLease] = useState<{
    token: string; data: PublicHistory;
  } | null>(null);
  // null follows the latest server-confirmed revision, while a number means
  // the user has intentionally chosen a historical read-only frame.
  const [historyRevision, setHistoryRevision] = useState<number | null>(null);
  // Local, actor-scoped unread cursor. The baseline is the revision at
  // join/seat/token change; never persist it or use it for game commands.
  const [activityRead, setActivityRead] = useState<{
    matchId: string; seatId: string; token: string; revision: number;
  } | null>(null);
  const [tacticalLease, setTacticalLease] = useState<{
    token: string; data: TacticalOverview;
  } | null>(null);
  // #85: local display preference, never permission or a server command.
  const [nearbyOpponentLotsOnly, setNearbyOpponentLotsOnly] = useState(false);
  // #89: display-only public controller filter; never choose a faction/foe,
  // submit commands, or persist the current Development seat's preference.
  const [selectedOpponentOwnerId, setSelectedOpponentOwnerId] = useState("");
  // #94: only public canonical board streets can be selected; never gameplay authority.
  const [selectedOpponentStreetId, setSelectedOpponentStreetId] = useState("");
  // #93: public posture is a verified enum (0 standing, 1 fallen). This is
  // a browser-only display predicate, never targeting or game authority.
  const [selectedOpponentPosture, setSelectedOpponentPosture] =
    useState<"all" | "standing" | "fallen">("all");
  const [turnProgressLease, setTurnProgressLease] = useState<{
    token: string; data: FirstRoundTurnProgress;
  } | null>(null);
  const [settlementLease, setSettlementLease] = useState<{
    token: string; data: PendingSettlementPreview;
  } | null>(null);
  const [presenceLease, setPresenceLease] = useState<{
    token: string; data: DevPresence;
  } | null>(null);
  // The credential identity is held only in component memory.
  const [optionLease, setOptionLease] = useState<{
    token: string; options: ActorTurnOptions
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotationNotice, setRotationNotice] = useState<string | null>(null);
  const [joinMatchId, setJoinMatchId] = useState("");
  const [joinToken, setJoinToken] = useState("");
  // Purely local consistency check of an UNSIGNED public JSON. This state is
  // intentionally independent of session, seat, private hand and commands.
  const [offlineAudit, setOfflineAudit] = useState<
    { status: "valid"; data: OfflinePublicAuditReview; revision: number }
    | { status: "invalid" } | { status: "checking" } | null
  >(null);
  const offlineAuditRequest = useRef(0);
  const [offlineComparison, setOfflineComparison] = useState<
    { status: "checking" } | { status: "invalid" }
    | { status: "compared"; result: OfflinePublicAuditComparison } | null
  >(null);
  const offlineComparisonRequest = useRef(0);
  // Monotonic authority guards: HTTP polling/commands may resolve out of order.
  const currentMatchId = useRef<string | null>(null);
  const currentRevision = useRef(-1);
  const commandInFlight = useRef(false);
  // In-memory, actor-bound conditional HTTP tag. Never write credentials,
  // private cards or ETags to local/session storage.
  const lastPublicTag = useRef<{
    matchId: string; token: string; revision: number; value: string;
  } | null>(null);
  // A 404 is authoritative only for the exact match/seat/token that made
  // the request. Races from a prior seat or rotation must not drop a new one.
  const currentActorScope = useRef<{
    matchId: string; seatId: string; token: string;
  } | null>(null);
  // While a rotation is awaiting its ACK, the server may already have revoked
  // the old bearer. Concurrent read 404s must not erase the still-recoverable
  // seat before the rotation response updates the in-memory capability.
  const rotationPending = useRef<{
    matchId: string; seatId: string; token: string;
  } | null>(null);
  // Atomic join carries the first hand and options at the same revision.
  const bootstrappedSeat = useRef<{
    matchId: string; seatId: string; token: string; revision: number;
    handPending: boolean; optionsPending: boolean;
  } | null>(null);
  // The title is UI-only and never contains actor IDs, card IDs or tokens.
  const initialDocumentTitle = useRef<string | null>(null);

  const token = session?.credentials.find((seat) => seat.playerId === actorId)?.token;
  const player = session?.state.players.find((seat) => seat.playerId === actorId);
  const isMyTurn = Boolean(session && token && actorId
    && session.state.phase === 0 && session.state.activePlayerId === actorId);
  // Informational only: no turn permissions are derived from this label.
  const turnSignal = session?.state.phase === 0
    ? isMyTurn ? "mine" : "other" : "pending";
  const turnOptions = optionLease && token
    && optionLease.token === token
    && optionLease.options.matchId === session?.matchId
    && optionLease.options.playerId === actorId
    && optionLease.options.revision === session?.state.revision
    ? optionLease.options : null;
  const canEndTurn = Boolean(isMyTurn && turnOptions?.canEndTurn && !busy);
  // The Domain authorizes destinations; the browser board names them only.
  const adjacent = isMyTurn && turnOptions ? turnOptions.freeMoveStreetIds : [];
  const publicEvents = session
    ? visiblePublicAuditEvents(session.state.events ?? [],
        session.state.players.map((seat) => seat.playerId))
    : [];
  const history = historyLease && token
    && historyLease.token === token
    && historyLease.data.matchId === session?.matchId
    && historyLease.data.verifiedRevision === session?.state.revision
    ? historyLease.data : null;
  // A new actor/capability starts from the last known live revision.
  // Do not count preexisting match history as unseen activity.
  useEffect(() => {
    setActivityRead(session?.matchId && actorId && token
      ? { matchId: session.matchId, seatId: actorId, token,
          revision: currentRevision.current }
      : null);
  }, [session?.matchId, actorId, token]);

  const activityReady = Boolean(history && activityRead && token
    && activityRead.matchId === session?.matchId
    && activityRead.seatId === actorId && activityRead.token === token
    && activityRead.revision <= history.verifiedRevision);
  const unseenOpponentFrames = activityReady && history && activityRead
    ? history.frames.filter(frame => frame.revision > activityRead.revision
      && frame.actorId !== actorId && (frame.kind === "free-move"
        || frame.kind === "turn-ended" || frame.kind === "round-settlement-pending"))
    : [];
  const inspectedRevision = historyRevision ?? history?.verifiedRevision;
  const inspectedFrame = history?.frames.find(frame =>
    frame.revision === inspectedRevision);

  /** Navigate the authenticated, #55-verified audit, never the LIVE match.
   * Movement events may focus only the actor's server-verified arrival street.
   * All other public events select a frame but cannot invent a map move.
   */
  function jumpToAuditedEvent(entry: PublicMatchEvent) {
    if (!session || !history || !token || !actorId) return;
    const scope = currentActorScope.current;
    if (scope?.matchId !== session.matchId || scope.seatId !== actorId
      || scope.token !== token || history.matchId !== session.matchId
      || history.verifiedRevision !== session.state.revision) return;
    const original = session.state.events[entry.revision];
    const frame = history.frames[entry.revision];
    if (!original || original.revision !== entry.revision
      || original.kind !== entry.kind || original.actorId !== entry.actorId
      || !frame || frame.revision !== entry.revision
      || frame.kind !== entry.kind || frame.actorId !== entry.actorId) return;

    let moveFocus: HistoricalStreetFocus | null = null;
    if (entry.kind === "free-move") {
      const arrival = frame.players.filter(p => p.playerId === entry.actorId);
      if (original.fromStreetId !== entry.fromStreetId
        || original.toStreetId !== entry.toStreetId
        || arrival.length !== 1
        || arrival[0].streetId !== entry.toStreetId
        || !streetById(entry.toStreetId ?? "")) return;
      moveFocus = {
        matchId: session.matchId,
        sourceRevision: history.verifiedRevision,
        historyRevision: frame.revision,
        playerId: entry.actorId,
        streetId: arrival[0].streetId,
      };
    } else if (entry.kind !== "match-created"
      && entry.kind !== "turn-ended"
      && entry.kind !== "round-settlement-pending") return;

    // The revision selector and the city overlay are intentionally local.
    // Never change live player positions, actor authority or command options.
    onHistoricalFocus(moveFocus);
    setHistoryRevision(frame.revision === history.verifiedRevision
      ? null : frame.revision);
  }

  async function checkOfflinePublicAudit(file: File | null) {
    const request = ++offlineAuditRequest.current;
    // A new primary file immediately invalidates any comparison. A late
    // secondary File.text() cannot resurrect an older result.
    ++offlineComparisonRequest.current;
    setOfflineComparison(null);
    if (!file) {
      setOfflineAudit(null);
      return;
    }
    setOfflineAudit({ status: "checking" });
    // Avoid reading unbounded or empty untrusted files at all.
    if (file.size === 0 || file.size > MaxPublicAuditImportBytes) {
      setOfflineAudit({ status: "invalid" });
      return;
    }
    try {
      const raw = await file.text();
      if (request !== offlineAuditRequest.current) return;
      const checked = buildOfflinePublicAuditReview(JSON.parse(raw) as unknown);
      setOfflineAudit(checked
        ? { status: "valid", data: checked, revision: 0 }
        : { status: "invalid" });
    } catch {
      if (request === offlineAuditRequest.current)
        setOfflineAudit({ status: "invalid" });
    }
  }

  async function checkOfflineComparison(file: File | null) {
    const request = ++offlineComparisonRequest.current;
    const primaryRequest = offlineAuditRequest.current;
    const primary = offlineAudit?.status === "valid" ? offlineAudit.data : null;
    if (!file || !primary) {
      setOfflineComparison(null);
      return;
    }
    setOfflineComparison({ status: "checking" });
    if (file.size === 0 || file.size > MaxPublicAuditImportBytes) {
      setOfflineComparison({ status: "invalid" });
      return;
    }
    try {
      const raw = await file.text();
      if (request !== offlineComparisonRequest.current
        || primaryRequest !== offlineAuditRequest.current) return;
      const candidate = buildOfflinePublicAuditReview(JSON.parse(raw) as unknown);
      setOfflineComparison(candidate
        ? { status: "compared",
            result: compareOfflinePublicAuditReviews(primary, candidate) }
        : { status: "invalid" });
    } catch {
      if (request === offlineComparisonRequest.current
        && primaryRequest === offlineAuditRequest.current)
        setOfflineComparison({ status: "invalid" });
    }
  }

  // An offline review is derived only from the fully verified public file.
  // It never updates the live map, game revision, seat token or HTTP state.
  const publicDiffLabels: Record<PublicAuditChangedField["field"], string> = {
    kind: t("dev.historyCompareFieldKind"),
    actorId: t("dev.historyCompareFieldActor"),
    fromStreetId: t("dev.historyCompareFieldFrom"),
    toStreetId: t("dev.historyCompareFieldTo"),
    phase: t("dev.historyCompareFieldPhase"),
    activePlayerId: t("dev.historyCompareFieldTurn"),
    playerId: t("dev.historyCompareFieldSeatId"),
    streetId: t("dev.historyCompareFieldStreet"),
    freeMoveUsed: t("dev.historyCompareFieldFreeMove"),
  };
  const offlineFrame = offlineAudit?.status === "valid"
    ? offlineAudit.data.steps[offlineAudit.revision]
    : null;

  function navigateOfflineRevision(delta: number) {
    setOfflineAudit(current => current?.status === "valid"
      ? {
          ...current,
          revision: Math.max(0, Math.min(
            current.data.verifiedRevision, current.revision + delta)),
        }
      : current);
  }

  // Download ONLY the currently authenticated, fully verified public replay.
  // Never JSON-serialize DemoSession, a bearer, the private hand or a raw API
  // response. This is an unsigned Development-only record, not match restore.
  function exportPublicAudit() {
    if (!session || !history || !token || !actorId) return;
    const scope = currentActorScope.current;
    if (scope?.matchId !== session.matchId || scope.seatId !== actorId
      || scope.token !== token || history.matchId !== session.matchId
      || history.verifiedRevision !== session.state.revision) return;

    const proof = buildVerifiedPublicAuditExport(session.state, history);
    if (!proof) return;
    const blob = new Blob([JSON.stringify(proof, null, 2) + "\n"], {
      type: "application/json",
    });
    const href = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = href;
      // A GUID and server revision only, never a token or player ID.
      link.download = `edonism-public-audit-${proof.matchId}-r${proof.verifiedRevision}.json`;
      document.body.appendChild(link);
      try {
        link.click();
      } finally {
        link.remove();
      }
    } finally {
      // Keep the object URL alive long enough for a browser download to begin.
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    }
  }

  const tactical = tacticalLease && token && player
    && tacticalLease.token === token
    && tacticalLease.data.matchId === session?.matchId
    && tacticalLease.data.playerId === actorId
    && tacticalLease.data.round === session?.state.round
    && tacticalLease.data.verifiedRevision === session?.state.revision
    && tacticalLease.data.fromStreetId === player.streetId
    ? tacticalLease.data : null;
  const uncontrolledRoutes = tactical?.uncontrolled ?? null;
  const otherSeatRoutes = tactical?.otherPlayers ?? null;
  const opponentLots = tactical?.opponentControlledLots ?? null;
  // #89: allow a controller ONLY if listed by the same fully validated,
  // atomic actor/revision/token-scoped #88 other-seat projection. The two
  // client-side predicates compose; no new HTTP or gameplay permission.
  const knownOpponentOwners = new Set(
    otherSeatRoutes?.others.map(other => other.otherPlayerId) ?? []);
  const selectedOpponentOwner = knownOpponentOwners.has(selectedOpponentOwnerId)
    ? selectedOpponentOwnerId : "";
  // #94: a board street selector never trusts street names or frontend geometry
  // for routing. Matched routes must be from the verified #88 public projection.
  const selectedOpponentStreet = cityBoard.streets.some(street =>
    street.id === selectedOpponentStreetId) ? selectedOpponentStreetId : "";
  const visibleOpponentLots = opponentLots?.routes.filter(route =>
    (!selectedOpponentOwner || route.ownerPlayerId === selectedOpponentOwner)
    && (!selectedOpponentStreet || route.streetId === selectedOpponentStreet)
    && (!nearbyOpponentLotsOnly || route.streetSteps <= 1)
    && (selectedOpponentPosture === "all"
      || route.posture === (selectedOpponentPosture === "standing" ? 0 : 1))) ?? [];
  // #97: full, *unfiltered* public distribution across all seven canonical
  // board streets. Counts cannot survive an invalid, stale or revoked #88 view.
  const rivalLotStreetDistribution = opponentLots ? cityBoard.streets.map(street => {
    const onStreet = opponentLots.routes.filter(route => route.streetId === street.id);
    return {
      streetId: street.id,
      name: street.name,
      total: onStreet.length,
      standing: onStreet.filter(route => route.posture === 0).length,
      fallen: onStreet.filter(route => route.posture === 1).length,
      // #98: preserve the server-verified public rival roster's canonical
      // order. Only other players with actual public lots are shown.
      owners: (otherSeatRoutes?.others ?? []).map(other => {
        const held = onStreet.filter(route =>
          route.ownerPlayerId === other.otherPlayerId);
        return {
          ownerId: other.otherPlayerId,
          total: held.length,
          standing: held.filter(route => route.posture === 0).length,
          fallen: held.filter(route => route.posture === 1).length,
        };
      }).filter(owner => owner.total > 0),
    };
  }) : null;
  const activeOpponentLotFilters = [
    selectedOpponentOwner ? t("dev.opponentLotsActiveOwner", { owner: selectedOpponentOwner }) : null,
    selectedOpponentStreet ? t("dev.opponentLotsActiveStreet", {
      street: streetById(selectedOpponentStreet)?.name ?? selectedOpponentStreet,
    }) : null,
    nearbyOpponentLotsOnly ? t("dev.opponentLotsActiveNearby") : null,
    selectedOpponentPosture !== "all" ? t("dev.opponentLotsActivePosture", {
      posture: t(selectedOpponentPosture === "standing"
        ? "dev.opponentLotsPostureStanding" : "dev.opponentLotsPostureFallen"),
    }) : null,
  ].filter((label): label is string => label !== null);
  // #95: only view preferences can be reset, not audited tactical authority.
  // #90: stable server tie-break has already been verified for all routes by
  // #88. The first *visible* controlled lot per authenticated public rival
  // is therefore the canonical closest one, or null after #89/#85 filters.
  // In particular, empty rivals have NO target and never a synthetic path.
  const nearestVisibleLotByRival = otherSeatRoutes && opponentLots
    ? otherSeatRoutes.others.map(other => ({
      otherPlayerId: other.otherPlayerId,
      playerRoute: other, // #92: audited same-revision other-seat route
      route: visibleOpponentLots.find(lot =>
        lot.ownerPlayerId === other.otherPlayerId) ?? null,
    }))
    : [];
  const turnProgress = turnProgressLease && token
    && turnProgressLease.token === token
    && turnProgressLease.data.matchId === session?.matchId
    && turnProgressLease.data.verifiedRevision === session?.state.revision
    && turnProgressLease.data.phase === session?.state.phase
    && turnProgressLease.data.activePlayerId === session?.state.activePlayerId
    ? turnProgressLease.data : null;
  const settlement = settlementLease && token
    && settlementLease.token === token
    && settlementLease.data.matchId === session?.matchId
    && settlementLease.data.verifiedRevision === session?.state.revision
    && session?.state.phase === 1
    ? settlementLease.data : null;
  const presence = presenceLease && token
    && presenceLease.token === token
    && presenceLease.data.matchId === session?.matchId
    ? presenceLease.data : null;

  // Live .NET snapshots (including remote poll updates) control the tab title.
  // Never send an OS notification, persist a credential or infer commands.
  useEffect(() => {
    if (initialDocumentTitle.current === null)
      initialDocumentTitle.current = document.title;
    const normalTitle = initialDocumentTitle.current;
    document.title = session && isMyTurn
      ? `${t("dev.turnTabPrefix")} · ${normalTitle}`
      : normalTitle;
    return () => { document.title = normalTitle; };
  }, [session?.matchId, isMyTurn, actorId, token, i18n.resolvedLanguage, t]);

  function publishPublicPositions(state: DemoMatch | null) {
    // A new authoritative snapshot (or match exit) invalidates all old paths.
    onTacticalFocus(null);
    onPublicState(state
      ? {
          matchId: state.matchId,
          revision: state.revision,
          activePlayerId: state.activePlayerId,
          players: state.players.map((seat) => ({
            playerId: seat.playerId,
            streetId: seat.streetId,
          })),
          boardActivities: state.boardActivities ?? [],
          controlledActivities: state.controlledActivities ?? [],
          grossSalaryQuotes: state.grossSalaryQuotes ?? [],
        }
      : null);
  }


  /** A 404 on an authenticated Development read means this capability is gone.
   * Preserve any other creator-owned seats, but never retain the revoked hand
   * or reauthorize it from a stale HTTP response. Transient 5xx is not revocation.
   */
  function reconcileRevokedSeat(matchId: string, seatId: string, revokedToken: string) {
    const pending = rotationPending.current;
    if (pending?.matchId === matchId && pending.seatId === seatId
      && pending.token === revokedToken) return;
    const active = currentActorScope.current;
    if (active?.matchId !== matchId || active.seatId !== seatId
      || active.token !== revokedToken || session?.matchId !== matchId) return;

    const remaining = session.credentials.filter((seat) => seat.playerId !== seatId);
    onTacticalFocus(null);
    setHand(null);
    setHistoryLease(null);
    setHistoryRevision(null);
    setOptionLease(null);
    lastPublicTag.current = null;
    if (remaining.length === 0) {
      currentActorScope.current = null;
      currentMatchId.current = null;
      currentRevision.current = -1;
      setSession(null);
      setActorId("");
      publishPublicPositions(null);
    } else {
      const fallback = remaining[0];
      currentActorScope.current = { matchId, seatId: fallback.playerId, token: fallback.token };
      setSession((previous) => previous?.matchId === matchId
        ? { ...previous, credentials: previous.credentials.filter((seat) => seat.playerId !== seatId) }
        : previous);
      setActorId(fallback.playerId);
      const position = session.state.players.find((seat) => seat.playerId === fallback.playerId)?.streetId;
      if (position && streetById(position)) onStreetSelect(position);
    }
    setRotationNotice(null);
    setError(t("dev.accessRevoked"));
  }

  /** Apply only a newer snapshot for the CURRENT match, never an old HTTP result. */
  function acceptServerState(next: DemoMatch, matchId: string): boolean {
    if (currentMatchId.current !== matchId || next.matchId !== matchId
      || !Number.isInteger(next.revision) || next.revision <= currentRevision.current)
      return false;
    currentRevision.current = next.revision;
    setSession((previous) =>
      previous?.matchId === matchId ? { ...previous, state: next } : previous);
    publishPublicPositions(next);
    return true;
  }

  // Revision-bound actor options: fail closed when an HTTP result is stale,
  // unavailable or belongs to an old seat/token. No optimistic game actions.
  useEffect(() => {
    const matchId = session?.matchId;
    const revision = session?.state.revision;
    const actorToken = token;
    const seatId = actorId;
    const initial = bootstrappedSeat.current;
    if (initial?.optionsPending && initial.matchId === matchId
      && initial.token === actorToken && initial.seatId === seatId
      && initial.revision === revision) {
      initial.optionsPending = false;
      return; // Already validated with the initial /seat response.
    }
    setOptionLease(null);
    if (!matchId || revision === undefined || !actorToken || !seatId) return;
    const controller = new AbortController();
    void fetch(`/api/dev/matches/${matchId}/turn-options`, {
      headers: { "X-Edonism-Dev-Token": actorToken },
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (response.status === 404 && !controller.signal.aborted)
          reconcileRevokedSeat(matchId, seatId, actorToken);
        return responseJson<ActorTurnOptions>(response);
      })
      .then((options) => {
        if (!controller.signal.aborted && currentMatchId.current === matchId
          && currentRevision.current === revision
          && options.matchId === matchId && options.playerId === seatId
          && options.revision === revision && typeof options.canEndTurn === "boolean"
          && Array.isArray(options.freeMoveStreetIds)
          && options.freeMoveStreetIds.every((id) => typeof id === "string")) {
          setOptionLease({ token: actorToken, options });
        }
      })
      .catch(() => {
        // Offline, 404, or invalid response: leave all actions disabled.
      });
    return () => controller.abort();
  }, [session?.matchId, session?.state.revision, actorId, token]);

  // Read the current actor's private hand on seat change; credentials are NEVER
  // copied into URL or Web Storage. Joined sessions contain exactly one seat.
  useEffect(() => {
    const initial = bootstrappedSeat.current;
    if (initial?.handPending && initial.matchId === session?.matchId
      && initial.token === token && initial.seatId === actorId
      && initial.revision === session?.state.revision) {
      initial.handPending = false;
      return; // Keep the hand returned in the same locked /seat read.
    }
    if (!session?.matchId || !token) {
      setHand(null);
      return;
    }
    const controller = new AbortController();
    const matchId = session.matchId;
    const seatId = actorId;
    const actorToken = token;
    setHand(null);
    void fetch(`/api/dev/matches/${matchId}/hand`, {
      headers: { "X-Edonism-Dev-Token": actorToken },
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => {
        if (response.status === 404 && !controller.signal.aborted)
          reconcileRevokedSeat(matchId, seatId, actorToken);
        return responseJson<PrivateHand>(response);
      })
      .then((result) => {
        const active = currentActorScope.current;
        // A delayed private response must never restore a hand after
        // local exit, token rotation or a switch to another seat.
        if (!controller.signal.aborted && active?.matchId === matchId
          && active.seatId === seatId && active.token === actorToken
          && result.matchId === matchId && result.playerId === seatId
          && Array.isArray(result.cardIds)
          && result.cardIds.every(id => typeof id === "string"))
          setHand(result);
      })
      .catch(() => {
        const active = currentActorScope.current;
        if (!controller.signal.aborted && active?.matchId === matchId
          && active.seatId === seatId && active.token === actorToken)
          setHand(null);
      });
    return () => controller.abort();
  }, [session?.matchId, token]);

  // Ask the Domain verifier for a complete, public replay at this
  // confirmed match revision. A previous seat/token/revision may never
  // publish its history after a reconnect, revocation or actor switch.
  useEffect(() => {
    const matchId = session?.matchId;
    const revision = session?.state.revision;
    const seatId = actorId;
    const actorToken = token;
    setHistoryLease(null);
    if (!matchId || revision === undefined || !seatId || !actorToken) return;
    const controller = new AbortController();
    const expectedSnapshot = session.state;
    void fetch(`/api/dev/matches/${matchId}/history`, {
      headers: { "X-Edonism-Dev-Token": actorToken },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(response => {
        if (response.status === 404 && !controller.signal.aborted)
          reconcileRevokedSeat(matchId, seatId, actorToken);
        return responseJson<PublicHistory>(response);
      })
      .then(result => {
        if (controller.signal.aborted || currentMatchId.current !== matchId
          || currentRevision.current !== revision
          || currentActorScope.current?.seatId !== seatId
          || currentActorScope.current?.token !== actorToken) return;
        // Verify EVERY public first-round frame, not just the final one.
        // The current snapshot plus its public events determine the unique
        // intermediate player positions, turn, phase and free-move flags.
        // A forged/missing frame invalidates the entire optional replay.
        if (!verifiedPublicHistory(expectedSnapshot, result)) return;
        setHistoryLease({ token: actorToken, data: result });
      })
      .catch(() => {
        // History is optional UI. Never fabricate positions or authorize
        // commands, and do not clear private hands on transient errors.
      });
    return () => controller.abort();
    // Each fetch is bound to a unique match/seat/token/revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.matchId, session?.state.revision, actorId, token]);

  // Authenticated, Domain-verified first-round progress. Never use browser
  // event counts or presence as authority, and never leak a previous seat's
  // result after a token change, stale revision, revocation or local leave.
  useEffect(() => {
    const matchId = session?.matchId;
    const revision = session?.state.revision;
    const seatId = actorId;
    const actorToken = token;
    const state = session?.state;
    setTurnProgressLease(null);
    if (!matchId || !state || revision === undefined || !seatId || !actorToken) return;
    const controller = new AbortController();
    void fetch(`/api/dev/matches/${matchId}/turn-progress`, {
      headers: { "X-Edonism-Dev-Token": actorToken },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(response => {
        if (response.status === 404 && !controller.signal.aborted)
          reconcileRevokedSeat(matchId, seatId, actorToken);
        return responseJson<FirstRoundTurnProgress>(response);
      })
      .then(result => {
        const scope = currentActorScope.current;
        if (controller.signal.aborted || scope?.matchId !== matchId
          || scope.seatId !== seatId || scope.token !== actorToken
          || currentRevision.current !== revision) return;
        const ids = state.turnOrder;
        const activeIndex = state.activePlayerId === null
          ? ids.length : ids.indexOf(state.activePlayerId);
        if (!result || result.matchId !== matchId || result.round !== state.round
          || result.verifiedRevision !== revision || result.phase !== state.phase
          || result.activePlayerId !== state.activePlayerId
          || !Number.isInteger(result.totalTurns) || result.totalTurns !== ids.length
          || !Number.isInteger(result.completedTurns)
          || result.completedTurns !== activeIndex
          || (state.phase !== 0 && state.phase !== 1)
          || (state.phase === 0 && (activeIndex < 0 || activeIndex >= ids.length))
          || (state.phase === 1 && state.activePlayerId !== null)
          || !Array.isArray(result.completedPlayerIds)
          || !Array.isArray(result.remainingPlayerIds)
          || result.completedPlayerIds.length !== activeIndex
          || result.remainingPlayerIds.length !== ids.length - activeIndex
          || result.completedPlayerIds.some((id, i) => id !== ids[i])
          || result.remainingPlayerIds.some((id, i) => id !== ids[activeIndex + i]))
          return;
        setTurnProgressLease({ token: actorToken, data: result });
      })
      .catch(() => {
        // Temporary HTTP failures or invalid payloads never advance or
        // authoritatively skip a turn; the server's current state remains.
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.matchId, session?.state.revision, actorId, token]);

  // #88: ONE bearer-authenticated atomic GET for all three public tactical
  // projections. Never issue the three legacy GETs from the browser. The
  // existing #49/#51/#84 *complete* per-item guards stay in place, but are
  // evaluated as one transaction: one malformed nested view hides ALL lists.
  useEffect(() => {
    const matchId = session?.matchId;
    const state = session?.state;
    const revision = state?.revision;
    const seatId = actorId;
    const actorToken = token;
    setTacticalLease(null);
    if (!matchId || !state || revision === undefined || !seatId || !actorToken) return;
    const controller = new AbortController();
    void fetch(`/api/dev/matches/${matchId}/tactical-overview`, {
      headers: { "X-Edonism-Dev-Token": actorToken },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(response => {
        if (response.status === 404 && !controller.signal.aborted)
          reconcileRevokedSeat(matchId, seatId, actorToken);
        return responseJson<TacticalOverview>(response);
      })
      .then(overview => {
        const scope = currentActorScope.current;
        if (controller.signal.aborted || scope?.matchId !== matchId
          || scope.seatId !== seatId || scope.token !== actorToken
          || currentRevision.current !== revision) return;
        const origin = state.players.find(p => p.playerId === seatId)?.streetId;
        // No nested object may be rendered unless the top-level and ALL
        // nested scopes match the exact current public revision and seat.
        const sameScope = (view: UncontrolledRoutes | OtherSeatRoutes
          | OpponentControlledLotRoutes | null | undefined): boolean =>
          Boolean(view && view.matchId === matchId && view.playerId === seatId
            && view.round === state.round && view.verifiedRevision === revision
            && view.fromStreetId === origin);
        if (!origin || !overview || overview.matchId !== matchId
          || overview.playerId !== seatId || overview.round !== state.round
          || overview.verifiedRevision !== revision
          || overview.fromStreetId !== origin
          || !sameScope(overview.uncontrolled)
          || !sameScope(overview.otherPlayers)
          || !sameScope(overview.opponentControlledLots)) {
          onTacticalFocus(null);
          return;
        }
        const validateUncontrolled = (result: UncontrolledRoutes): boolean => {
      const position = state.players.find(p => p.playerId === seatId)?.streetId;
      const controlled = new Set(state.controlledActivities.map(c => c.slotId));
      const expected = state.boardActivities.filter(a => !controlled.has(a.slotId));
      if (!position || result.matchId !== matchId || result.playerId !== seatId
        || result.round !== state.round || result.verifiedRevision !== revision
        || result.fromStreetId !== position || !Array.isArray(result.routes)
        || result.routes.length !== expected.length) return false;
      const expectedBySlot = new Map(expected.map(card => [card.slotId, card]));
      const used = new Set<string>();
      let previousSteps = -1;
      let previousSlot = "";
      for (const route of result.routes) {
        if (!route || typeof route.slotId !== "string" || used.has(route.slotId)
          || !Number.isInteger(route.streetSteps) || route.streetSteps < 0
          || route.streetSteps > 6 || typeof route.streetId !== "string") return false;
        const card = expectedBySlot.get(route.slotId);
        const canonicalPath = shortestStreetPath(position, route.streetId);
        if (!card || route.cardId !== card.cardId || route.category !== card.category
          || slotById(route.slotId)?.streetId !== route.streetId
          || !canonicalPath || !Array.isArray(route.streetPath)
          || route.streetSteps !== canonicalPath.length - 1
          || route.streetPath.length !== canonicalPath.length
          || route.streetPath.some((id: string, index: number) => id !== canonicalPath[index])
          || route.streetSteps < previousSteps
          || (route.streetSteps === previousSteps && route.slotId <= previousSlot)) return false;
        used.add(route.slotId);
        previousSteps = route.streetSteps;
        previousSlot = route.slotId;
      }
          return true;
        };
        const validateOtherPlayers = (result: OtherSeatRoutes): boolean => {
      const origin = state.players.find(p => p.playerId === seatId)?.streetId;
      if (!origin || !result || result.matchId !== matchId
        || result.playerId !== seatId || result.round !== state.round
        || result.verifiedRevision !== revision
        || result.fromStreetId !== origin || !Array.isArray(result.others)
        || result.others.length !== state.players.length - 1) return false;
      const expected = new Map(state.players.filter(p => p.playerId !== seatId)
        .map(p => [p.playerId, p] as const));
      const encountered = new Set<string>();
      let previousSteps = -1;
      let previousId = "";
      for (const other of result.others) {
        if (!other || typeof other.otherPlayerId !== "string"
          || encountered.has(other.otherPlayerId)) return false;
        const expectedPlayer = expected.get(other.otherPlayerId);
        const canonical = shortestStreetPath(origin, other.streetId);
        const controls = state.controlledActivities.filter(c =>
          c.ownerPlayerId === other.otherPlayerId);
        const standing = controls.filter(c => c.posture === 0).length;
        if (!expectedPlayer || other.streetId !== expectedPlayer.streetId
          || !canonical || !Array.isArray(other.streetPath)
          || other.streetPath.length !== canonical.length
          || other.streetPath.some((id: string, index: number) => id !== canonical[index])
          || !Number.isInteger(other.streetSteps)
          || other.streetSteps !== canonical.length - 1
          || !Number.isInteger(other.controlledActivities)
          || other.controlledActivities !== controls.length
          || !Number.isInteger(other.standingHenchmen)
          || other.standingHenchmen !== standing
          || other.streetSteps < previousSteps
          || (other.streetSteps === previousSteps && other.otherPlayerId <= previousId))
          return false;
        encountered.add(other.otherPlayerId);
        previousSteps = other.streetSteps;
        previousId = other.otherPlayerId;
      }
          return true;
        };
        const validateOpponentLots = (result: OpponentControlledLotRoutes): boolean => {
      const origin = state.players.find(p => p.playerId === seatId)?.streetId;
      const expected = state.controlledActivities.filter(c =>
        c.ownerPlayerId !== seatId);
      if (!origin || !result || result.matchId !== matchId
        || result.playerId !== seatId || result.round !== state.round
        || result.verifiedRevision !== revision
        || result.fromStreetId !== origin || !Array.isArray(result.routes)
        || result.routes.length !== expected.length) return false;
       const otherPlayerIds = new Set(state.players.filter(p =>
        p.playerId !== seatId).map(p => p.playerId));
      if (expected.some(lot => !otherPlayerIds.has(lot.ownerPlayerId)))
        return false;
      const bySlot = new Map(expected.map(lot => [lot.slotId, lot] as const));
      const seen = new Set<string>();
      let previousSteps = -1;
      let previousOwner = "";
      let previousSlot = "";
      for (const route of result.routes) {
        if (!route || typeof route.slotId !== "string"
          || seen.has(route.slotId) || route.ownerPlayerId === seatId
          || !Number.isInteger(route.posture)
          || !Number.isInteger(route.streetSteps)) return false;
        const lot = bySlot.get(route.slotId);
        const canonical = shortestStreetPath(origin, route.streetId);
        if (!lot || route.ownerPlayerId !== lot.ownerPlayerId
          || route.posture !== lot.posture
          || slotById(route.slotId)?.streetId !== route.streetId
          || !canonical || !Array.isArray(route.streetPath)
          || route.streetPath.length !== canonical.length
          || route.streetPath.some((id: string, i: number) => id !== canonical[i])
          || route.streetSteps !== canonical.length - 1
          || route.streetSteps < previousSteps
          || (route.streetSteps === previousSteps
            && (route.ownerPlayerId < previousOwner
              || (route.ownerPlayerId === previousOwner
                && route.slotId <= previousSlot)))) return false;
        seen.add(route.slotId);
        previousSteps = route.streetSteps;
        previousOwner = route.ownerPlayerId;
        previousSlot = route.slotId;
      }
          return true;
        };
        if (!validateUncontrolled(overview.uncontrolled)
          || !validateOtherPlayers(overview.otherPlayers)
          || !validateOpponentLots(overview.opponentControlledLots)) {
          onTacticalFocus(null);
          return;
        }
        setTacticalLease({ token: actorToken, data: overview });
      })
      .catch(() => {
        // A revoked/stale/malformed tactical result can never populate any
        // public route list or enable map focus, movement, combat or purchase.
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.matchId, session?.state.revision, actorId, token]);

  // #85/#89: no browser-only tactical filter preference may follow another
  // match, player or capability (including a token rotation at same revision).
  useEffect(() => {
    setNearbyOpponentLotsOnly(false);
    setSelectedOpponentOwnerId("");
    setSelectedOpponentStreetId("");
    setSelectedOpponentPosture("all");
  }, [session?.matchId, actorId, token]);

  // Read only after the FINAL first-round event; never derive net payments
  // or apply next-round order locally. Old HTTP responses cannot resurrect
  // previews after actor switch, token revocation, exit or newer revision.
  useEffect(() => {
    const matchId = session?.matchId;
    const revision = session?.state.revision;
    const seatId = actorId;
    const actorToken = token;
    const state = session?.state;
    setSettlementLease(null);
    if (!matchId || !state || state.phase !== 1
      || revision === undefined || !seatId || !actorToken) return;
    const controller = new AbortController();
    void fetch(`/api/dev/matches/${matchId}/settlement-preview`, {
      headers: { "X-Edonism-Dev-Token": actorToken },
      cache: "no-store",
      signal: controller.signal,
    })
      .then(response => {
        if (response.status === 404 && !controller.signal.aborted)
          reconcileRevokedSeat(matchId, seatId, actorToken);
        return responseJson<PendingSettlementPreview>(response);
      })
      .then(result => {
        const scope = currentActorScope.current;
        if (controller.signal.aborted || scope?.matchId !== matchId
          || scope.seatId !== seatId || scope.token !== actorToken
          || currentRevision.current !== revision) return;
        const ids = state.players.map(p => p.playerId);
        const expectedNext = state.proposedNextRoundOrder;
        const expectedQuotes = state.grossSalaryQuotes;
        if (!result || result.matchId !== matchId
          || result.round !== state.round || result.verifiedRevision !== revision
          || !Array.isArray(result.nextTurnOrder)
          || result.nextTurnOrder.length !== ids.length
          || result.nextTurnOrder.some((id, i) => id !== expectedNext[i])
          || !Array.isArray(result.grossSalaryQuotes)
          || result.grossSalaryQuotes.length !== expectedQuotes.length
          || result.grossSalaryQuotes.some((q, i) => {
            const original = expectedQuotes[i];
            return q.playerId !== original?.playerId
              || !Number.isInteger(q.baseAtoms)
              || !Number.isInteger(q.standingActivityAtoms)
              || !Number.isInteger(q.grossAtoms)
              || q.baseAtoms < 0 || q.standingActivityAtoms < 0
              || q.grossAtoms !== q.baseAtoms + q.standingActivityAtoms
              || q.baseAtoms !== original.baseAtoms
              || q.standingActivityAtoms !== original.standingActivityAtoms
              || q.grossAtoms !== original.grossAtoms;
          })) return;
        setSettlementLease({ token: actorToken, data: result });
      })
      .catch(() => {
        // 409, transient network errors, malformed data: no preview.
        // Never invent a payout or treat an unavailable read as logout.
      });
    return () => controller.abort();
    // Match, revision, seat and bearer define the only valid projection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.matchId, session?.state.revision, session?.state.phase, actorId, token]);

  // Only a visible, authenticated Development browser sends a heartbeat.
  // It is never a game command: no local game revision or 3D projection is
  // changed and server presence cannot grant turn options.
  useEffect(() => {
    const matchId = session?.matchId;
    const actorToken = token;
    const seatId = actorId;
    setPresenceLease(null);
    if (!matchId || !actorToken || !seatId) return;
    const life = new AbortController();
    let pending: AbortController | null = null;
    let inFlight = false;
    const knownIds = new Set(session.state.players.map(p => p.playerId));

    const heartbeat = async () => {
      if (life.signal.aborted || inFlight
        || document.visibilityState === "hidden" || !navigator.onLine) return;
      const request = new AbortController();
      pending = request;
      inFlight = true;
      try {
        const response = await fetch(`/api/dev/matches/${matchId}/presence`, {
          method: "POST",
          headers: { "X-Edonism-Dev-Token": actorToken },
          signal: request.signal,
          cache: "no-store",
        });
        if (request.signal.aborted || life.signal.aborted) return;
        if (response.status === 404) {
          // Same 404 semantics as other actor-scoped reads, but a late 404
          // from the old seat must not revoke a newly joined or rotated seat.
          if (currentActorScope.current?.matchId === matchId
            && currentActorScope.current.seatId === seatId
            && currentActorScope.current.token === actorToken)
            reconcileRevokedSeat(matchId, seatId, actorToken);
          setPresenceLease(null);
          return;
        }
        const result = await responseJson<DevPresence>(response);
        if (request.signal.aborted || life.signal.aborted
          || currentActorScope.current?.matchId !== matchId
          || currentActorScope.current.seatId !== seatId
          || currentActorScope.current.token !== actorToken) return;
        if (result?.matchId !== matchId || !Array.isArray(result.seats)
          || result.seats.length !== knownIds.size
          || new Set(result.seats.map(x => x.playerId)).size !== knownIds.size
          || !result.seats.every(x => knownIds.has(x.playerId)
            && typeof x.isActive === "boolean")) {
          setPresenceLease(null);
          return;
        }
        setPresenceLease({ token: actorToken, data: result });
      } catch {
        // Network failures are NOT revocation: keep the match and private
        // hand, but fail closed on the transient presence projection.
        if (!request.signal.aborted && !life.signal.aborted)
          setPresenceLease(null);
      } finally {
        pending = null;
        inFlight = false;
      }
    };
    const visible = () => {
      if (document.visibilityState === "hidden") {
        pending?.abort();
        setPresenceLease(null);
      } else {
        void heartbeat();
      }
    };
    const online = () => void heartbeat();
    const offline = () => {
      pending?.abort();
      setPresenceLease(null);
    };
    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 5000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      life.abort();
      pending?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
    // Browser activity is bound only to the exact match, actor and token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.matchId, actorId, token]);

  // Long-poll an authenticated, revision-scoped ETag instead of issuing
  // full snapshots while idle. 304 still verifies the bearer on the server.
  // Resume polling
  // promptly when the tab becomes visible or the network comes back.
  useEffect(() => {
    const matchId = session?.matchId;
    const actorToken = token;
    const seatId = actorId;
    if (!matchId || !actorToken) return;
    const controller = new AbortController();
    let polling = false;
    let pendingRequest: AbortController | null = null;
    let retryWhenVisible = false;
    let waitCooldownUntil = 0;
    const check = async () => {
      if (polling || controller.signal.aborted || commandInFlight.current
        || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const headers: Record<string, string> = {
          "X-Edonism-Dev-Token": actorToken,
        };
        const tagged = lastPublicTag.current;
        if (tagged?.matchId === matchId && tagged.token === actorToken
          && tagged.revision === currentRevision.current) {
          headers["If-None-Match"] = tagged.value;
          // A saturated Development match can reject a long poll with 429.
          // Fall back to ordinary conditional GETs for a bounded cooldown
          // instead of repeatedly allocating new pending waiters.
          if (Date.now() >= waitCooldownUntil) headers["Prefer"] = "wait=5";
        }
        const request = new AbortController();
        pendingRequest = request;
        const response = await fetch(`/api/dev/matches/${matchId}`, {
          headers,
          signal: request.signal,
          cache: "no-store",
        });
        // A cached ETag is never an authorization grant. 404 with the
        // current bearer means the seat has been revoked or match is gone.
        if (response.status === 404) {
          if (!controller.signal.aborted && !pendingRequest?.signal.aborted)
            reconcileRevokedSeat(matchId, seatId, actorToken);
          return;
        }
        // 429 means the long-poll queue is full, NOT that the bearer
        // expired. Keep the current hand, ETag and game state, then use
        // short ordinary conditional GETs until the cooldown expires.
        if (response.status === 429) {
          waitCooldownUntil = Date.now() + 5000;
          return;
        }
        // A conditional GET never returns JSON on 304, nor advances UI state.
        if (response.status === 304) return;
        if (response.ok) {
          const next = (await response.json()) as DemoMatch;
          if (!controller.signal.aborted && !pendingRequest?.signal.aborted
            && !commandInFlight.current && currentMatchId.current === matchId
            && next.matchId === matchId && Number.isInteger(next.revision)
            && next.revision >= currentRevision.current) {
            acceptServerState(next, matchId);
            const value = response.headers.get("ETag");
            const expected = `W/"edonism-revision-${next.revision}"`;
            lastPublicTag.current = value === expected
              ? { matchId, token: actorToken, revision: next.revision, value }
              : null;
          }
        }
      } catch {
        // Network glitches do not invent state; online/focus/next poll retries.
      } finally {
        pendingRequest = null;
        polling = false;
        if (retryWhenVisible && !controller.signal.aborted
          && document.visibilityState === "visible") {
          retryWhenVisible = false;
          void check();
        }
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "hidden") {
        // Do not retain a pending long-poll while the tab is backgrounded.
        pendingRequest?.abort();
      } else if (polling) {
        retryWhenVisible = true;
        pendingRequest?.abort();
      } else {
        void check();
      }
    };
    const onOnline = () => {
      if (polling) {
        retryWhenVisible = true;
        pendingRequest?.abort();
      } else {
        void check();
      }
    };
    const handle = window.setInterval(() => void check(), 1500);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      controller.abort();
      pendingRequest?.abort();
      window.clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
    };
    // Match and token identity control subscription lifetime, not revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.matchId, token]);

  async function createDemo() {
    if (busy) return;
    commandInFlight.current = true;
    setBusy(true);
    setError(null);
    setRotationNotice(null);
    setHand(null);
    setHistoryLease(null);
    setHistoryRevision(null);
    setOptionLease(null);
    lastPublicTag.current = null;
    bootstrappedSeat.current = null;
    currentActorScope.current = null;
    currentMatchId.current = null;
    currentRevision.current = -1;
    setSession(null);
    publishPublicPositions(null);
    try {
      const response = await fetch("/api/dev/matches/from-full-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(demoFixture(playerCount)),
        cache: "no-store",
      });
      if (response.status === 429) {
        setError(t("dev.createRateLimited"));
        return;
      }
      if (response.status === 413) {
        setError(t("dev.createPayloadTooLarge"));
        return;
      }
      if (response.status === 503) {
        // A generic API outage is not proof that the Development fixture
        // budget is full. Only the precise server code gets this message.
        const failure = await response.clone().json().catch(() => null) as { code?: string } | null;
        if (failure?.code === "dev_match_capacity_reached") {
          setError(t("dev.createCapacityReached"));
          return;
        }
      }
      const created = await responseJson<DemoSession>(response);
      const playerIds = demoSeatIds.slice(0, playerCount);
      if (created.credentials.length !== playerCount || created.state.players.length !== playerCount
        || !playerIds.every((id) => created.credentials.some((seat) => seat.playerId === id)
          && created.state.players.some((seat) => seat.playerId === id))) {
        throw new Error("invalid_dev_fixture");
      }
      currentMatchId.current = created.matchId;
      currentRevision.current = created.state.revision;
      currentActorScope.current = {
        matchId: created.matchId,
        seatId: created.credentials[0].playerId,
        token: created.credentials[0].token,
      };
      setSession(created);
      publishPublicPositions(created.state);
      setActorId(created.credentials[0].playerId);
      onStreetSelect(created.state.players[0].streetId);
    } catch {
      setSession(null);
      publishPublicPositions(null);
      setActorId("");
      setError(t("dev.createError"));
    } finally {
      commandInFlight.current = false;
      setBusy(false);
    }
  }

  async function joinDemo() {
    if (busy) return;
    const id = joinMatchId.trim().toLowerCase();
    const secret = joinToken.trim();
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)
      || !/^[a-f0-9]{64}$/i.test(secret)) {
      setError(t("dev.joinInvalid"));
      return;
    }
    commandInFlight.current = true;
    setBusy(true);
    setError(null);
    setRotationNotice(null);
    setHand(null);
    setHistoryLease(null);
    setHistoryRevision(null);
    setOptionLease(null);
    lastPublicTag.current = null;
    bootstrappedSeat.current = null;
    currentActorScope.current = null;
    currentMatchId.current = null;
    currentRevision.current = -1;
    setSession(null);
    publishPublicPositions(null);
    try {
      const headers = { "X-Edonism-Dev-Token": secret };
      // One server lock authenticates the bearer and captures all three
      // projections at a single revision. Never trust a browser-supplied ID.
      const bootstrap = await responseJson<DevSeatBootstrap>(await fetch(
        `/api/dev/matches/${id}/seat`, { headers, cache: "no-store" },
      ));
      const { state, hand: privateHand, turnOptions: options } = bootstrap;
      const actor = bootstrap.playerId;
      if (bootstrap.matchId.toLowerCase() !== id || state.matchId.toLowerCase() !== id
        || privateHand.matchId.toLowerCase() !== id || options.matchId.toLowerCase() !== id
        || privateHand.playerId !== actor || options.playerId !== actor
        || !state.players.some((p) => p.playerId === actor)
        || !Number.isInteger(state.revision) || state.revision < 0
        || options.revision !== state.revision || typeof options.canEndTurn !== "boolean"
        || !Array.isArray(privateHand.cardIds)
        || !privateHand.cardIds.every((card) => typeof card === "string")
        || !Array.isArray(options.freeMoveStreetIds)
        || !options.freeMoveStreetIds.every((street) => typeof street === "string"))
        throw new Error("invalid_seat_bootstrap");
      currentMatchId.current = state.matchId;
      currentRevision.current = state.revision;
      currentActorScope.current = { matchId: state.matchId, seatId: actor, token: secret };
      bootstrappedSeat.current = {
        matchId: state.matchId, seatId: actor, token: secret, revision: state.revision,
        handPending: true, optionsPending: true,
      };
      setOptionLease({ token: secret, options });
      setSession({
        matchId: state.matchId,
        state,
        credentials: [{ playerId: actor, token: secret }],
      });
      setActorId(actor);
      setHand(privateHand);
      const street = state.players.find((p) => p.playerId === actor)?.streetId;
      if (street && streetById(street)) onStreetSelect(street);
      publishPublicPositions(state);
      setJoinMatchId("");
      setJoinToken("");
    } catch {
      setSession(null);
      publishPublicPositions(null);
      setActorId("");
      setError(t("dev.joinError"));
    } finally {
      commandInFlight.current = false;
      setBusy(false);
    }
  }


  async function rotateSeatToken() {
    if (busy || !session || !token || !actorId) return;
    const matchId = session.matchId;
    const seatId = actorId;
    const previousToken = token;
    rotationPending.current = { matchId, seatId, token: previousToken };
    commandInFlight.current = true;
    setBusy(true);
    setError(null);
    setRotationNotice(null);
    try {
      const response = await fetch(`/api/dev/matches/${matchId}/rotate-token`, {
        method: "POST",
        headers: { "X-Edonism-Dev-Token": token },
        cache: "no-store",
      });
      if (response.status === 404) {
        // Unlike concurrent read 404s, the rotation's own 404 is definitive.
        rotationPending.current = null;
        reconcileRevokedSeat(matchId, seatId, previousToken);
        return;
      }
      const result = await responseJson<DemoCredential>(response);
      if (result.playerId !== seatId || !/^[A-F0-9]{64}$/i.test(result.token)
        || result.token.toLowerCase() === token.toLowerCase()
        || currentMatchId.current !== matchId)
        throw new Error("invalid_rotated_credential");
      // No change to match, public audit or gameplay revision.
      // Update only the actor's in-memory seat secret.
      onTacticalFocus(null);
      currentActorScope.current = { matchId, seatId, token: result.token };
      // The old actor-scoped history selection must not survive a capability
      // change, even if public game revision is intentionally unchanged.
      setHistoryLease(null);
      setHistoryRevision(null);
      lastPublicTag.current = null;
      setSession((previous) => previous?.matchId === matchId
        ? {
            ...previous,
            credentials: previous.credentials.map((seat) =>
              seat.playerId === seatId ? { ...seat, token: result.token } : seat),
          }
        : previous);
      setHand(null);
      setRotationNotice(t("dev.rotateSuccess"));
    } catch {
      // A failed checkpoint write keeps the original capability valid.
      setError(t("dev.rotateError"));
    } finally {
      if (rotationPending.current?.matchId === matchId
        && rotationPending.current.seatId === seatId
        && rotationPending.current.token === previousToken)
        rotationPending.current = null;
      commandInFlight.current = false;
      setBusy(false);
    }
  }

  async function copySeatAccess(seat: DemoCredential) {
    if (!session) return;
    try {
      // Clipboard use is deliberate, LOCAL debugging only, never an URL.
      await navigator.clipboard.writeText(`${session.matchId}\n${seat.token}`);
      setError(null);
    } catch {
      setError(t("dev.copyError"));
    }
  }

  async function command(kind: "free-move" | "end-turn", destinationStreetId?: string) {
    if (busy || !session || !token || !isMyTurn || !turnOptions) return;
    if (kind === "end-turn" && !turnOptions.canEndTurn) return;
    if (kind === "free-move"
      && (!destinationStreetId || !turnOptions.freeMoveStreetIds.includes(destinationStreetId)))
      return;
    const matchId = session.matchId;
    const playerId = actorId;
    const actorToken = token;
    const expectedRevision = session.state.revision;
    // One UUID per user intention, NEVER per network attempt. ASP.NET persists
    // accepted receipts atomically with the match before acknowledging success.
    const commandId = crypto.randomUUID();
    const payload = JSON.stringify(
      kind === "free-move"
        ? { destinationStreetId, expectedRevision }
        : { expectedRevision },
    );
    const isCurrentActor = () => {
      const current = currentActorScope.current;
      return current?.matchId === matchId && current?.seatId === playerId
        && current?.token === actorToken;
    };
    const send = () => fetch(`/api/dev/matches/${matchId}/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Edonism-Dev-Token": actorToken,
        "Idempotency-Key": commandId,
      },
      body: payload,
      cache: "no-store",
    });
    commandInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      let response: Response;
      try {
        response = await send();
      } catch {
        // Only a transport failure is ambiguous: server may have committed
        // without delivering the ACK. Retry ONCE with the identical key,
        // actor, revision, command and body. Never retry a 409, 404 or 5xx.
        if (!isCurrentActor() || currentRevision.current !== expectedRevision)
          return;
        response = await send();
      }
      if (!isCurrentActor()) return;
      if (response.status === 404) {
        reconcileRevokedSeat(matchId, playerId, actorToken);
        return;
      }
      if (response.status === 409) {
        // The server wins; key re-use with altered parameters also returns
        // 409. Refresh from the server, never invent or replay a turn locally.
        const refreshed = await responseJson<DemoMatch>(
          await fetch(`/api/dev/matches/${matchId}`, {
            headers: { "X-Edonism-Dev-Token": actorToken },
            cache: "no-store",
          }),
        );
        if (!isCurrentActor()) return;
        if (acceptServerState(refreshed, matchId)) {
          const confirmedStreet = refreshed.players.find((seat) => seat.playerId === playerId)?.streetId;
          if (confirmedStreet && streetById(confirmedStreet)) onStreetSelect(confirmedStreet);
        }
        setError(t("dev.conflict"));
        return;
      }
      const next = await responseJson<DemoMatch>(response);
      if (!isCurrentActor()) return;
      const applied = acceptServerState(next, matchId);
      if (applied && kind === "free-move" && player) {
        const newStreet = next.players.find((seat) => seat.playerId === playerId)?.streetId;
        if (newStreet) onStreetSelect(newStreet);
      }
    } catch {
      setError(t("dev.networkError"));
    } finally {
      commandInFlight.current = false;
      setBusy(false);
    }
  }

  // Local-only disconnect: no server-side token revocation or match change.
  // Invalidate scopes synchronously before React effect cleanup so any
  // response already queued for the old bearer fails closed.
  function leaveDemo() {
    if (busy || !session) return;
    setActivityRead(null);
    currentActorScope.current = null;
    currentMatchId.current = null;
    currentRevision.current = -1;
    lastPublicTag.current = null;
    bootstrappedSeat.current = null;
    setSession(null);
    setActorId("");
    setHand(null);
    setOptionLease(null);
    setHistoryLease(null);
    setHistoryRevision(null);
    setPresenceLease(null);
    setJoinMatchId("");
    setJoinToken("");
    setRotationNotice(null);
    setError(null);
    publishPublicPositions(null);
  }

  function chooseActor(id: string) {
    if (busy) return;
    const credential = session?.credentials.find((seat) => seat.playerId === id);
    if (!session || !credential) return;
    // A 404 from another tab may already have selected this fallback seat.
    // Re-clicking its button must NOT erase its loaded private hand, because
    // token/actor dependencies would be unchanged and no refetch would run.
    if (actorId === id) {
      // The previous capability may have been revoked already, selecting
      // this valid fallback seat automatically. A user confirming that seat
      // acknowledges the old warning but must never erase the loaded hand.
      setError(null);
      return;
    }
    currentActorScope.current = {
      matchId: session.matchId, seatId: id, token: credential.token,
    };
    onTacticalFocus(null);
    setRotationNotice(null);
    setHistoryLease(null);
    setHistoryRevision(null);
    setActivityRead(null);
    setActorId(id);
    setHand(null);
    setError(null);
    const target = session?.state.players.find((seat) => seat.playerId === id);
    if (target) onStreetSelect(target.streetId);
  }

  return (
    <Card data-testid="dev-match-lab" className="border-primary/30">
      <CardHeader className="space-y-2">
        <Badge className="w-fit border-primary/20 bg-primary/10 text-primary">
          <FlaskConical aria-hidden="true" className="size-3.5" /> {t("dev.badge")}
        </Badge>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users aria-hidden="true" className="size-4 text-primary" />
          {t("dev.title")}
        </CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">{t("dev.description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">{t("dev.playerCount")}</span>
          <select
            aria-label={t("dev.playerCount")}
            data-testid="dev-player-count"
            className="h-10 min-w-20 rounded-md border border-input bg-background px-3"
            value={playerCount}
            disabled={busy}
            onChange={(event) => setPlayerCount(Number(event.target.value))}
          >
            {demoSeatIds.slice(1).map((id, index) => (
              <option key={id} value={index + 2}>{index + 2}</option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          className="w-full"
          onClick={() => void createDemo()}
          disabled={busy}
          data-testid="dev-create"
        >
          <RotateCw aria-hidden="true" className="size-4" />
          {busy ? t("dev.loading") : t("dev.create")}
        </Button>

        <form onSubmit={(event) => { event.preventDefault(); void joinDemo(); }}
          className="space-y-2 rounded-xl border border-border bg-muted/30 p-3"
          data-testid="dev-join-form">
          <p className="text-xs font-semibold">{t("dev.joinTitle")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span>{t("dev.joinMatch")}</span>
              <input type="text" autoComplete="off" spellCheck={false}
                data-testid="dev-join-id" value={joinMatchId}
                onChange={(event) => setJoinMatchId(event.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs" />
            </label>
            <label className="space-y-1 text-xs">
              <span>{t("dev.joinToken")}</span>
              <input type="password" autoComplete="off" spellCheck={false}
                data-testid="dev-join-token" value={joinToken}
                onChange={(event) => setJoinToken(event.target.value)}
                className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-2 font-mono text-xs" />
            </label>
          </div>
          <Button type="submit" variant="outline" className="w-full"
            disabled={busy} data-testid="dev-join">
            {t("dev.joinAction")}
          </Button>
          <p className="text-[11px] text-muted-foreground">{t("dev.joinNote")}</p>
        </form>

        <section data-testid="dev-public-audit-import"
          aria-label={t("dev.historyImportTitle")}
          className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
          <p className="text-xs font-semibold">{t("dev.historyImportTitle")}</p>
          <label className="block space-y-1 text-xs">
            <span>{t("dev.historyImportChoose")}</span>
            <input type="file" accept=".json,application/json"
              data-testid="dev-public-audit-import-file"
              className="block w-full min-w-0 rounded-md border border-input bg-background p-2 text-xs"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                event.currentTarget.value = "";
                void checkOfflinePublicAudit(file);
              }} />
          </label>
          <p className="text-[11px] leading-5 text-muted-foreground"
            data-testid="dev-public-audit-import-note">
            {t("dev.historyImportNote")}
          </p>
          {offlineAudit && (
            <p role="status" aria-live="polite"
              data-testid="dev-public-audit-import-status"
              data-check={offlineAudit.status}
              className="text-xs font-medium">
              {offlineAudit.status === "checking"
                ? t("dev.historyImportChecking")
                : offlineAudit.status === "invalid"
                  ? t("dev.historyImportInvalid")
                  : t("dev.historyImportValid", {
                      count: offlineAudit.data.playerCount,
                      revision: offlineAudit.data.verifiedRevision,
                    })}
            </p>
          )}
          {offlineAudit?.status === "valid" && (
            <section data-testid="dev-public-audit-compare"
              className="space-y-2 rounded-lg border border-border bg-background p-3"
              aria-label={t("dev.historyCompareTitle")}>
              <p className="text-xs font-semibold">{t("dev.historyCompareTitle")}</p>
              <label className="block space-y-1 text-xs">
                <span>{t("dev.historyCompareChoose")}</span>
                <input type="file" accept=".json,application/json"
                  data-testid="dev-public-audit-compare-file"
                  className="block w-full min-w-0 rounded-md border border-input bg-background p-2 text-xs"
                  onChange={event => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    event.currentTarget.value = "";
                    void checkOfflineComparison(file);
                  }} />
              </label>
              {offlineComparison && (
                <p role="status" aria-live="polite"
                  data-testid="dev-public-audit-compare-status"
                  data-compare={offlineComparison.status === "compared"
                    ? offlineComparison.result.status : offlineComparison.status}
                  className="text-xs font-medium">
                  {offlineComparison.status === "checking"
                    ? t("dev.historyCompareChecking")
                    : offlineComparison.status === "invalid"
                      ? t("dev.historyCompareInvalid")
                      : offlineComparison.result.status === "identical"
                        ? t("dev.historyCompareIdentical")
                        : offlineComparison.result.status === "left-prefix"
                          ? t("dev.historyCompareLeftPrefix")
                          : offlineComparison.result.status === "right-prefix"
                            ? t("dev.historyCompareRightPrefix")
                            : offlineComparison.result.status === "different-match"
                              ? t("dev.historyCompareDifferentMatch")
                              : t("dev.historyCompareDivergent", {
                                  revision: offlineComparison.result.firstDifferentRevision,
                                })}
                </p>
              )}
              {offlineComparison?.status === "compared"
                && offlineComparison.result.status === "divergent"
                && offlineComparison.result.firstDifference && (
                  <section data-testid="dev-public-audit-diff"
                    aria-label={t("dev.historyCompareDetailTitle")}
                    className="space-y-2 rounded-lg border border-border p-2">
                    <p data-testid="dev-public-audit-diff-revision"
                      className="text-xs font-semibold">
                      {t("dev.historyCompareAtRevision", {
                        revision: offlineComparison.result.firstDifferentRevision,
                      })}
                    </p>
                    <section aria-label={t("dev.historyCompareChangedTitle")}
                      className="space-y-1">
                      <p className="text-xs font-semibold">
                        {t("dev.historyCompareChangedTitle")}
                      </p>
                      <ul data-testid="dev-public-audit-changes"
                        className="list-disc space-y-1 pl-4 text-xs">
                        {offlineComparison.result.firstDifference.changedFields.map(change => {
                          const path = change.seatIndex === null
                            ? change.field
                            : `players[${change.seatIndex}].${change.field}`;
                          const field = publicDiffLabels[change.field];
                          return (
                            <li key={path} data-testid="dev-public-audit-changed-field"
                              data-field-path={path} className="[overflow-wrap:anywhere]">
                              {change.seatIndex === null
                                ? field
                                : t("dev.historyCompareChangedSeatField", {
                                    seat: change.seatIndex + 1, field,
                                  })}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                    <div className="grid gap-2 md:grid-cols-2">
                      {([
                        { id: "left", label: t("dev.historyCompareFirstFile"),
                          step: offlineComparison.result.firstDifference.left },
                        { id: "right", label: t("dev.historyCompareSecondFile"),
                          step: offlineComparison.result.firstDifference.right },
                      ] as const).map(entry => (
                        <section key={entry.id}
                          data-testid={`dev-public-audit-diff-${entry.id}`}
                          className="min-w-0 space-y-1 rounded-md bg-muted/30 p-2 text-xs [overflow-wrap:anywhere]">
                          <p className="font-semibold">{entry.label}</p>
                          <p data-testid={`dev-public-audit-diff-${entry.id}-event`}>
                            {t("dev.historyCompareEvent", {
                              kind: entry.step.kind, actor: entry.step.actorId,
                            })}
                          </p>
                          <p data-testid={`dev-public-audit-diff-${entry.id}-route`}>
                            {t("dev.historyCompareRoute", {
                              from: entry.step.fromStreetId ?? t("dev.historyCompareNone"),
                              to: entry.step.toStreetId ?? t("dev.historyCompareNone"),
                            })}
                          </p>
                          <p>{t("dev.historyComparePhase", {
                            phase: entry.step.phase === 0
                              ? t("dev.historyCompareTurns")
                              : t("dev.historyComparePending"),
                          })}</p>
                          <p data-testid={`dev-public-audit-diff-${entry.id}-active`}>
                            {t("dev.historyCompareActive", {
                              actor: entry.step.activePlayerId ?? t("dev.historyCompareNone"),
                            })}
                          </p>
                          <p className="font-medium">{t("dev.historyComparePlayers")}</p>
                          <ol className="space-y-1"
                            data-testid={`dev-public-audit-diff-${entry.id}-players`}>
                            {entry.step.players.map((player, index) => (
                              <li key={`${player.playerId}-${index}`}
                                data-testid="dev-public-audit-diff-player"
                                className="flex flex-wrap gap-x-2 gap-y-0.5">
                                <span className="font-medium">{index + 1}. {player.playerId}</span>
                                <span>{t("dev.historyOfflinePlayerPosition", {
                                  street: player.streetId,
                                })}</span>
                                <span>{player.freeMoveUsed
                                  ? t("dev.historyOfflineMoveUsed")
                                  : t("dev.historyOfflineMoveAvailable")}</span>
                              </li>
                            ))}
                          </ol>
                        </section>
                      ))}
                    </div>
                  </section>
                )}
              <p className="text-[11px] leading-5 text-muted-foreground">
                {t("dev.historyCompareUnsigned")}
              </p>
            </section>
          )}
          {offlineAudit?.status === "valid" && offlineFrame && (
            <section data-testid="dev-offline-timeline"
              className="space-y-2 rounded-lg border border-border bg-background p-3"
              aria-label={t("dev.historyOfflineTimelineTitle")}>
              <p className="text-xs font-semibold">
                {t("dev.historyOfflineTimelineTitle")}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2"
                role="group" aria-label={t("dev.historyOfflineTimelineNav")}>
                <Button type="button" variant="outline" size="sm"
                  data-testid="dev-offline-timeline-previous"
                  disabled={offlineAudit.revision === 0}
                  onClick={() => navigateOfflineRevision(-1)}>
                  {t("dev.historyPrevious")}
                </Button>
                <output data-testid="dev-offline-timeline-revision"
                  className="text-xs font-medium" aria-live="polite">
                  #{offlineFrame.revision} / #{offlineAudit.data.verifiedRevision}
                </output>
                <Button type="button" variant="outline" size="sm"
                  data-testid="dev-offline-timeline-next"
                  disabled={offlineAudit.revision >= offlineAudit.data.verifiedRevision}
                  onClick={() => navigateOfflineRevision(1)}>
                  {t("dev.historyNext")}
                </Button>
              </div>
              <p data-testid="dev-offline-timeline-event"
                className="text-xs leading-5">
                {offlineFrame.kind === "match-created"
                  ? t("dev.auditCreated")
                  : offlineFrame.kind === "free-move"
                    ? t("dev.auditMove", {
                        actor: offlineFrame.actorId,
                        from: offlineFrame.fromStreetId,
                        to: offlineFrame.toStreetId,
                      })
                    : offlineFrame.kind === "turn-ended"
                      ? t("dev.auditEnd", { actor: offlineFrame.actorId })
                      : t("dev.auditPending", { actor: offlineFrame.actorId })}
              </p>
              <p data-testid="dev-offline-timeline-turn"
                className="text-xs text-muted-foreground">
                {offlineFrame.phase === 1
                  ? t("dev.historySettlement")
                  : t("dev.historyActor", { actor: offlineFrame.activePlayerId })}
              </p>
              <p className="text-[11px] font-semibold">
                {t("dev.historyOfflinePositionsTitle")}
              </p>
              <ul data-testid="dev-offline-timeline-players"
                className="space-y-1 text-xs">
                {offlineFrame.players.map(player => (
                  <li key={player.playerId} data-testid="dev-offline-timeline-player"
                    className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <span className="font-medium">{player.playerId}</span>
                    <span>{t("dev.historyOfflinePlayerPosition", {
                      street: player.streetId,
                    })}</span>
                    <span>{player.freeMoveUsed
                      ? t("dev.historyOfflineMoveUsed")
                      : t("dev.historyOfflineMoveAvailable")}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] leading-5 text-muted-foreground">
                {t("dev.historyOfflineUnsigned")}
              </p>
            </section>
          )}
        </section>

        {error && (
          <p role="alert" data-testid="dev-error" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {session && (
          <div className="space-y-4" data-testid="dev-session">
            <div className="space-y-2 rounded-xl border border-border p-3 text-xs">
              <p className="font-semibold">{t("dev.shareTitle")}</p>
              <p data-testid="dev-match-id" className="break-all font-mono text-muted-foreground">
                {session.matchId}
              </p>
              <div className="flex flex-wrap gap-2">
                {session.credentials.map((seat) => (
                  <Button key={seat.playerId} type="button" size="sm" variant="outline"
                    data-testid={`dev-copy-seat-${seat.playerId}`}
                    onClick={() => void copySeatAccess(seat)}>
                    {t("dev.copySeat", { seat: seat.playerId })}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] leading-5 text-muted-foreground">
                {t("dev.shareWarning")}
              </p>
              <Button type="button" size="sm" variant="outline" className="w-full"
                data-testid="dev-leave" disabled={busy} onClick={leaveDemo}>
                <LogOut aria-hidden="true" className="size-3.5" />
                {t("dev.leave")}
              </Button>
              <p className="text-[11px] leading-5 text-muted-foreground"
                data-testid="dev-leave-note">{t("dev.leaveNote")}</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-xl bg-muted p-3">
                <p className="text-muted-foreground">{t("dev.round")}</p>
                <p data-testid="dev-round" className="mt-1 font-mono text-lg font-bold">{session.state.round}</p>
              </div>
              <div className="rounded-xl bg-muted p-3">
                <p className="text-muted-foreground">{t("dev.revision")}</p>
                <p data-testid="dev-revision" className="mt-1 font-mono text-lg font-bold">{session.state.revision}</p>
              </div>
            </div>

            <div className="rounded-xl border border-border p-3 text-sm">
              <p className="text-xs text-muted-foreground">{t("dev.currentTurn")}</p>
              <p data-testid="dev-active-player" className="mt-1 font-semibold">
                {session.state.phase === 0
                  ? session.state.activePlayerId
                  : t("dev.settlement")}
              </p>
            </div>

            <div role="status" aria-live="polite" aria-atomic="true"
              data-testid="dev-turn-signal" data-turn-state={turnSignal}
              className="space-y-1 rounded-xl border border-border bg-muted/40 p-3 text-sm">
              <p className="text-xs text-muted-foreground">{t("dev.turnSignalTitle")}</p>
              <p className="font-semibold" data-testid="dev-turn-signal-text">
                {turnSignal === "mine" ? t("dev.turnSignalMine")
                  : turnSignal === "other"
                    ? t("dev.turnSignalOther", { actor: session.state.activePlayerId })
                    : t("dev.turnSignalPending")}
              </p>
              <p className="text-[11px] text-muted-foreground">{t("dev.turnSignalNote")}</p>
            </div>

            <section aria-label={t("dev.turnProgressTitle")}
              data-testid="dev-turn-progress"
              className="space-y-2 rounded-xl border border-border p-3">
              <p className="text-xs font-semibold">{t("dev.turnProgressTitle")}</p>
              {!turnProgress ? (
                <p data-testid="dev-turn-progress-unavailable"
                  className="text-xs text-muted-foreground">
                  {t("dev.turnProgressUnavailable")}
                </p>
              ) : (
                <>
                  <p data-testid="dev-turn-progress-count" aria-live="polite"
                    className="text-sm font-semibold">
                    {t("dev.turnProgressCount", {
                      completed: turnProgress.completedTurns,
                      total: turnProgress.totalTurns,
                    })}
                  </p>
                  <ol data-testid="dev-turn-progress-seats"
                    className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    {[...turnProgress.completedPlayerIds, ...turnProgress.remainingPlayerIds]
                      .map((id, index) => {
                        const stage = index < turnProgress.completedTurns
                          ? "done"
                          : id === turnProgress.activePlayerId ? "active" : "waiting";
                        return (
                          <li key={id} data-player-id={id} data-progress-state={stage}
                            className="rounded-md bg-muted px-2 py-2">
                            <span className="block font-semibold">{index + 1}. {id}</span>
                            <span className="text-muted-foreground">
                              {stage === "done" ? t("dev.turnProgressDone")
                                : stage === "active" ? t("dev.turnProgressActive")
                                : t("dev.turnProgressWaiting")}
                            </span>
                          </li>
                        );
                      })}
                  </ol>
                </>
              )}
              <p data-testid="dev-turn-progress-note"
                className="text-[11px] leading-5 text-muted-foreground">
                {t("dev.turnProgressNote")}
              </p>
            </section>

            {session.state.phase === 1 && (
              <section aria-label={t("dev.settlementPreviewTitle")}
                data-testid="dev-settlement-panel"
                className="space-y-2 rounded-xl border border-border p-3">
                <p className="text-xs font-semibold">{t("dev.settlementPreviewTitle")}</p>
                {!settlement ? (
                  <p data-testid="dev-settlement-unavailable"
                    className="text-xs text-muted-foreground">
                    {t("dev.settlementPreviewUnavailable")}
                  </p>
                ) : (
                  <>
                    <p data-testid="dev-settlement-revision"
                      className="text-xs text-muted-foreground">
                      {t("dev.settlementPreviewRevision", { revision: settlement.verifiedRevision })}
                    </p>
                    <ul data-testid="dev-settlement-gross" className="grid gap-2 text-xs sm:grid-cols-2">
                      {settlement.grossSalaryQuotes.map(q => (
                        <li key={q.playerId} data-player-id={q.playerId}
                          data-gross-atoms={q.grossAtoms}
                          className="rounded-md bg-muted px-2 py-2">
                          <span className="font-semibold">{q.playerId}</span>
                          <span className="block">{t("dev.settlementGrossAtoms", {
                            amount: q.grossAtoms,
                          })}</span>
                          <span className="text-muted-foreground">{t("dev.settlementGrossParts", {
                            base: q.baseAtoms,
                            activities: q.standingActivityAtoms,
                          })}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs font-semibold">{t("dev.nextOrderPreview")}</p>
                    <ol data-testid="dev-settlement-order" className="flex flex-wrap gap-2 text-xs">
                      {settlement.nextTurnOrder.map((id, index) => (
                        <li key={id} className="rounded-md bg-muted px-2 py-1">
                          {index + 1}. {id}
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                <p data-testid="dev-settlement-warning"
                  className="text-[11px] leading-5 text-muted-foreground">
                  {t("dev.settlementPreviewWarning")}
                </p>
              </section>
            )}

            <section aria-label={t("dev.presenceTitle")}
              data-testid="dev-presence-panel"
              className="space-y-2 rounded-xl border border-border p-3">
              <p className="text-xs font-semibold">{t("dev.presenceTitle")}</p>
              <ul data-testid="dev-presence-seats"
                className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {session.state.players.map(seat => {
                  const recentlyActive = presence?.seats.find(p =>
                    p.playerId === seat.playerId)?.isActive;
                  return (
                    <li key={seat.playerId} data-player-id={seat.playerId}
                      data-presence={recentlyActive === undefined ? "unknown"
                        : recentlyActive ? "active" : "inactive"}
                      className="rounded-md bg-muted px-2 py-2">
                      <span className="block font-semibold">{seat.playerId}</span>
                      <span className="text-muted-foreground">
                        {recentlyActive === undefined ? t("dev.presenceUnknown")
                          : recentlyActive ? t("dev.presenceRecent")
                          : t("dev.presenceInactive")}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p data-testid="dev-presence-note"
                className="text-[11px] leading-5 text-muted-foreground">
                {t("dev.presenceNote")}
              </p>
            </section>

            <div role="group" aria-label={t("dev.seatLabel")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {session.credentials.map((seat) => (
                <Button
                  key={seat.playerId}
                  type="button"
                  size="sm"
                  variant={actorId === seat.playerId ? "default" : "outline"}
                  aria-pressed={actorId === seat.playerId}
                  disabled={busy}
                  onClick={() => chooseActor(seat.playerId)}
                  data-testid={`dev-seat-${seat.playerId}`}
                  className="min-w-0"
                >
                  {seat.playerId}
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <Button type="button" variant="outline" className="w-full"
                disabled={busy || !token}
                onClick={() => void rotateSeatToken()}
                data-testid="dev-rotate-token">
                {t("dev.rotateSeat", { seat: actorId })}
              </Button>
              {rotationNotice && (
                <p role="status" data-testid="dev-rotation-notice"
                  className="text-xs text-muted-foreground">{rotationNotice}</p>
              )}
              <p className="text-[11px] text-muted-foreground">{t("dev.rotateWarning")}</p>
            </div>

            {player && (
              <>
                <p className="text-sm">
                  <span className="text-muted-foreground">{t("dev.position")}: </span>
                  <strong data-testid="dev-position">{streetById(player.streetId)?.name ?? player.streetId}</strong>
                </p>
                <section aria-label={t("dev.otherSeatsTitle")}
                  data-testid="dev-other-seats"
                  className="space-y-2 rounded-xl border border-border p-3 text-xs">
                  <p className="font-semibold">{t("dev.otherSeatsTitle")}</p>
                  {!otherSeatRoutes ? (
                    <p data-testid="dev-other-seats-unavailable"
                      className="text-muted-foreground">{t("dev.otherSeatsUnavailable")}</p>
                  ) : (
                    <>
                      <p data-testid="dev-other-seats-count" aria-live="polite">
                        {t("dev.otherSeatsCount", { count: otherSeatRoutes.others.length })}
                      </p>
                      <ol data-testid="dev-other-seats-list" className="grid gap-2 sm:grid-cols-2">
                        {otherSeatRoutes.others.map(other => (
                          <li key={other.otherPlayerId}
                            data-testid={`dev-other-seat-${other.otherPlayerId}`}
                            data-steps={other.streetSteps}
                            data-path={other.streetPath.join(">")}
                            data-owned={other.controlledActivities}
                            data-standing={other.standingHenchmen}
                            className="min-w-0 rounded-md bg-muted p-2">
                            <span className="block font-semibold">{other.otherPlayerId}</span>
                            <span className="block text-muted-foreground">
                              {streetById(other.streetId)?.name ?? other.streetId} · {
                                t("dev.routeSteps", { count: other.streetSteps })
                              }
                            </span>
                            <span className="block break-words text-muted-foreground"
                              data-testid={`dev-other-path-${other.otherPlayerId}`}>
                              {t("dev.routePath")}: {other.streetPath.map(id =>
                                streetById(id)?.name ?? id).join(" → ")}
                            </span>
                            <span className="block text-muted-foreground">
                              {t("dev.otherSeatsControls", {
                                owned: other.controlledActivities,
                                standing: other.standingHenchmen,
                              })}
                            </span>
                            <Button type="button" size="sm" variant="outline"
                              data-testid={`dev-focus-player-${other.otherPlayerId}`}
                              aria-label={t("dev.focusPlayer", { player: other.otherPlayerId })}
                              className="mt-2 h-8 w-full"
                              onClick={() => onTacticalFocus({
                                kind: "player",
                                matchId: session.matchId,
                                revision: session.state.revision,
                                actorId,
                                targetId: other.otherPlayerId,
                                streetPath: [...other.streetPath],
                              })}>
                              {t("dev.focusOnMap")}
                            </Button>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  <p data-testid="dev-other-seats-note"
                    className="text-[11px] leading-5 text-muted-foreground">
                    {t("dev.otherSeatsNote")}
                  </p>
                </section>
                <section aria-label={t("dev.opponentLotsTitle")}
                  data-testid="dev-opponent-lots"
                  className="space-y-2 rounded-xl border border-border p-3 text-xs">
                  <p className="font-semibold">{t("dev.opponentLotsTitle")}</p>
                  {!opponentLots ? (
                    <p data-testid="dev-opponent-lots-unavailable"
                      className="text-muted-foreground">{t("dev.opponentLotsUnavailable")}</p>
                  ) : (
                    <>
                      <p data-testid="dev-opponent-lots-count" aria-live="polite">
                        {t("dev.opponentLotsCount", { count: opponentLots.routes.length })}
                      </p>
                      {rivalLotStreetDistribution && (
                        <div className="space-y-2" data-testid="dev-opponent-street-distribution">
                          <p className="font-semibold">{t("dev.opponentStreetDistributionTitle")}</p>
                          <p className="text-muted-foreground">
                            {t("dev.opponentStreetDistributionNote")}
                          </p>
                          <ol className="grid gap-2 sm:grid-cols-2"
                            data-testid="dev-opponent-street-distribution-list">
                            {rivalLotStreetDistribution.map(street => (
                              <li key={street.streetId}
                                data-testid={`dev-opponent-street-row-${street.streetId}`}
                                data-total={street.total}
                                data-standing={street.standing}
                                data-fallen={street.fallen}
                                className="min-w-0">
                                <Button type="button" size="sm" variant="outline"
                                  className="h-auto min-h-10 w-full min-w-0 justify-start whitespace-normal p-2 text-left"
                                  data-testid={`dev-opponent-street-select-${street.streetId}`}
                                  aria-pressed={selectedOpponentStreet === street.streetId}
                                  aria-label={t("dev.opponentStreetDistributionSelect", {
                                    street: street.name, count: street.total,
                                    standing: street.standing, fallen: street.fallen,
                                  })}
                                  onClick={() => {
                                    setSelectedOpponentStreetId(previous =>
                                      previous === street.streetId ? "" : street.streetId);
                                    onTacticalFocus(null);
                                  }}>
                                  <span className="min-w-0">
                                    <span className="block font-semibold">{street.name}</span>
                                    <span className="block text-muted-foreground">
                                      {t("dev.opponentStreetDistributionLots", {
                                        count: street.total,
                                      })} · {t("dev.opponentStreetDistributionPostures", {
                                        standing: street.standing, fallen: street.fallen,
                                      })}
                                    </span>
                                  </span>
                                </Button>
                                {street.owners.length > 0 ? (
                                  <ol data-testid={`dev-opponent-street-owners-${street.streetId}`}
                                    className="mt-2 space-y-1 pl-2">
                                    {street.owners.map(owner => (
                                      <li key={owner.ownerId}
                                        data-testid={`dev-opponent-street-owner-row-${street.streetId}-${owner.ownerId}`}
                                        data-total={owner.total}
                                        data-standing={owner.standing}
                                        data-fallen={owner.fallen}>
                                        <Button type="button" size="sm" variant="outline"
                                          className="h-auto min-h-10 w-full min-w-0 justify-start whitespace-normal p-2 text-left"
                                          data-testid={`dev-opponent-street-owner-select-${street.streetId}-${owner.ownerId}`}
                                          aria-pressed={selectedOpponentStreet === street.streetId
                                            && selectedOpponentOwner === owner.ownerId}
                                          aria-label={t("dev.opponentStreetOwnerSelect", {
                                            owner: owner.ownerId,
                                            street: street.name,
                                            count: owner.total,
                                            standing: owner.standing, fallen: owner.fallen,
                                          })}
                                          onClick={() => {
                                            const pairActive = selectedOpponentStreet === street.streetId
                                              && selectedOpponentOwner === owner.ownerId;
                                            setSelectedOpponentStreetId(pairActive ? "" : street.streetId);
                                            setSelectedOpponentOwnerId(pairActive ? "" : owner.ownerId);
                                            // Pair selection is only display; stale map focus is invalid.
                                            onTacticalFocus(null);
                                          }}>
                                          <span className="min-w-0">
                                            <span className="block font-semibold">{owner.ownerId}</span>
                                            <span className="block text-muted-foreground">
                                              {t("dev.opponentStreetDistributionLots", { count: owner.total })}
                                              {" · "}
                                              {t("dev.opponentStreetDistributionPostures", {
                                                standing: owner.standing, fallen: owner.fallen,
                                              })}
                                            </span>
                                          </span>
                                        </Button>
                                      </li>
                                    ))}
                                  </ol>
                                ) : (
                                  <p className="mt-1 text-muted-foreground"
                                    data-testid={`dev-opponent-street-no-owners-${street.streetId}`}>
                                    {t("dev.opponentStreetNoOwners")}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      <label className="block space-y-1">
                        <span className="block font-medium">
                          {t("dev.opponentLotsOwnerFilterLabel")}
                        </span>
                        <select
                          aria-label={t("dev.opponentLotsOwnerFilterLabel")}
                          data-testid="dev-opponent-lots-owner-filter"
                          className="h-10 w-full max-w-full rounded-md border border-input bg-background px-3 text-foreground"
                          value={selectedOpponentOwner}
                          onChange={(event) => {
                            setSelectedOpponentOwnerId(event.target.value);
                            // A previously selected map route may now be hidden.
                            // This is read-only focus, never movement authority.
                            onTacticalFocus(null);
                          }}
                        >
                          <option value="">{t("dev.opponentLotsAllOwners")}</option>
                          {otherSeatRoutes?.others.map(other => (
                            <option key={other.otherPlayerId} value={other.otherPlayerId}>
                              {other.otherPlayerId}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-1">
                        <span className="block font-medium">
                          {t("dev.opponentLotsStreetFilterLabel")}
                        </span>
                        <select
                          aria-label={t("dev.opponentLotsStreetFilterLabel")}
                          data-testid="dev-opponent-lots-street-filter"
                          className="h-10 w-full max-w-full rounded-md border border-input bg-background px-3 text-foreground"
                          value={selectedOpponentStreet}
                          onChange={(event) => {
                            const id = event.target.value;
                            setSelectedOpponentStreetId(
                              id === "" || cityBoard.streets.some(street => street.id === id)
                                ? id : "");
                            onTacticalFocus(null);
                          }}
                        >
                          <option value="">{t("dev.opponentLotsAllStreets")}</option>
                          {cityBoard.streets.map(street => (
                            <option key={street.id} value={street.id}>{street.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-1">
                        <span className="block font-medium">
                          {t("dev.opponentLotsPostureFilterLabel")}
                        </span>
                        <select
                          aria-label={t("dev.opponentLotsPostureFilterLabel")}
                          data-testid="dev-opponent-lots-posture-filter"
                          className="h-10 w-full max-w-full rounded-md border border-input bg-background px-3 text-foreground"
                          value={selectedOpponentPosture}
                          onChange={(event) => {
                            const value = event.target.value;
                            setSelectedOpponentPosture(
                              value === "standing" || value === "fallen" ? value : "all");
                            // A hidden held lot can never retain the old map focus.
                            onTacticalFocus(null);
                          }}
                        >
                          <option value="all">{t("dev.opponentLotsPostureAll")}</option>
                          <option value="standing">{t("dev.opponentLotsPostureStanding")}</option>
                          <option value="fallen">{t("dev.opponentLotsPostureFallen")}</option>
                        </select>
                      </label>
                      <Button type="button" size="sm" variant="outline"
                        data-testid="dev-opponent-lots-nearby-toggle"
                        aria-pressed={nearbyOpponentLotsOnly}
                        onClick={() => {
                          setNearbyOpponentLotsOnly(previous => !previous);
                          onTacticalFocus(null);
                        }}>
                        {t("dev.opponentLotsNearbyToggle")}
                      </Button>
                      {activeOpponentLotFilters.length > 0 && (
                        <div className="space-y-2" data-testid="dev-opponent-lots-active-filters">
                          <p className="break-words text-muted-foreground" aria-live="polite"
                            data-testid="dev-opponent-lots-active-filter-summary">
                            {t("dev.opponentLotsActiveFilterCount", {
                              count: activeOpponentLotFilters.length,
                            })}: {activeOpponentLotFilters.join(" · ")}
                          </p>
                          <Button type="button" size="sm" variant="outline"
                            data-testid="dev-opponent-lots-reset-filters"
                            aria-label={t("dev.opponentLotsResetFilters")}
                            className="h-10 w-full"
                            onClick={() => {
                              setSelectedOpponentOwnerId("");
                              setSelectedOpponentStreetId("");
                              setNearbyOpponentLotsOnly(false);
                              setSelectedOpponentPosture("all");
                              // A reset does not authorize any old public map focus.
                              onTacticalFocus(null);
                            }}>
                            {t("dev.opponentLotsResetFilters")}
                          </Button>
                        </div>
                      )}
                      {selectedOpponentStreet && (
                        <p data-testid="dev-opponent-lots-street-filtered-count" aria-live="polite">
                          {t("dev.opponentLotsStreetFilteredCount", { count: visibleOpponentLots.length })}
                        </p>
                      )}
                      {selectedOpponentPosture !== "all" && (
                        <p data-testid="dev-opponent-lots-posture-filtered-count" aria-live="polite">
                          {t("dev.opponentLotsPostureFilteredCount", { count: visibleOpponentLots.length })}
                        </p>
                      )}
                      {selectedOpponentOwner && (
                        <p data-testid="dev-opponent-lots-owner-filtered-count" aria-live="polite">
                          {t("dev.opponentLotsOwnerFilteredCount", {
                            owner: selectedOpponentOwner, count: visibleOpponentLots.length,
                          })}
                        </p>
                      )}
                      {nearbyOpponentLotsOnly && (
                        <p data-testid="dev-opponent-lots-filtered-count" aria-live="polite">
                          {t("dev.opponentLotsFilteredCount", { count: visibleOpponentLots.length })}
                        </p>
                      )}
                      {selectedOpponentOwner && visibleOpponentLots.length === 0 && (
                        <p data-testid="dev-opponent-lots-no-owner"
                          className="text-muted-foreground">
                          {t("dev.opponentLotsNoOwner", { owner: selectedOpponentOwner })}
                        </p>
                      )}
                      {nearbyOpponentLotsOnly && !selectedOpponentOwner
                        && visibleOpponentLots.length === 0 && (
                        <p data-testid="dev-opponent-lots-no-nearby"
                          className="text-muted-foreground">{t("dev.opponentLotsNoNearby")}</p>
                      )}
                      <div className="space-y-2" data-testid="dev-rival-nearest-summary">
                        <p className="font-semibold">{t("dev.rivalNearestTitle")}</p>
                        <ol data-testid="dev-rival-nearest-list"
                          className="grid gap-2 sm:grid-cols-2">
                          {nearestVisibleLotByRival.map(({ otherPlayerId, playerRoute, route }) => (
                            <li key={otherPlayerId}
                              data-testid={`dev-rival-nearest-${otherPlayerId}`}
                              data-steps={route?.streetSteps ?? ""}
                              data-slot={route?.slotId ?? ""}
                              className="min-w-0 space-y-1 rounded-md border border-border p-2">
                              <span className="block font-semibold">{otherPlayerId}</span>
                              <span className="block text-muted-foreground"
                                data-testid={`dev-rival-public-player-${otherPlayerId}`}
                                data-steps={playerRoute.streetSteps}
                                data-path={playerRoute.streetPath.join(">")}>
                                {t("dev.rivalPublicPosition", {
                                  street: streetById(playerRoute.streetId)?.name ?? playerRoute.streetId,
                                  steps: t("dev.routeSteps", { count: playerRoute.streetSteps }),
                                })}
                              </span>
                              <Button type="button" size="sm" variant="outline"
                                className="h-8 w-full"
                                data-testid={`dev-focus-rival-player-${otherPlayerId}`}
                                aria-label={t("dev.focusRivalPlayer", { player: otherPlayerId })}
                                onClick={() => onTacticalFocus({
                                  kind: "player",
                                  matchId: session.matchId,
                                  revision: session.state.revision,
                                  actorId,
                                  targetId: otherPlayerId,
                                  streetPath: [...playerRoute.streetPath],
                                })}>
                                {t("dev.viewRivalPlayer")}
                              </Button>
                              {route ? (
                                <>
                                  <span className="block text-muted-foreground">
                                    {t("dev.rivalNearestLot", {
                                      slot: route.slotId,
                                      steps: t("dev.routeSteps", { count: route.streetSteps }),
                                    })}
                                  </span>
                                  <span className="block text-muted-foreground"
                                    data-testid={`dev-rival-nearest-posture-${otherPlayerId}`}>
                                    {route.posture === 0 ? t("dev.opponentLotStanding")
                                      : t("dev.opponentLotFallen")}
                                  </span>
                                  <Button type="button" size="sm" variant="outline"
                                    className="h-8 w-full"
                                    data-testid={`dev-focus-rival-nearest-${otherPlayerId}`}
                                    aria-label={t("dev.focusRivalNearest", {
                                      player: otherPlayerId, slot: route.slotId,
                                    })}
                                    onClick={() => onTacticalFocus({
                                      kind: "opponent-lot",
                                      matchId: session.matchId,
                                      revision: session.state.revision,
                                      actorId,
                                      targetId: route.slotId,
                                      streetPath: [...route.streetPath],
                                    })}>
                                    {t("dev.viewRivalLot")}
                                  </Button>
                                </>
                              ) : (
                                <span className="block text-muted-foreground"
                                  data-testid={`dev-rival-nearest-empty-${otherPlayerId}`}>
                                  {t("dev.rivalNearestNone")}
                                </span>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                      <ol data-testid="dev-opponent-lots-list" className="grid gap-2 sm:grid-cols-2">
                        {visibleOpponentLots.map(route => (
                          <li key={route.slotId}
                            data-testid={`dev-opponent-lot-${route.slotId}`}
                            data-owner={route.ownerPlayerId}
                            data-posture={route.posture}
                            data-steps={route.streetSteps}
                            data-path={route.streetPath.join(">")}
                            className="rounded-md bg-muted p-2">
                            <span className="block font-semibold">
                              {route.slotId} · {route.ownerPlayerId}
                            </span>
                            <span className="block text-muted-foreground">
                              {streetById(route.streetId)?.name ?? route.streetId} · {
                                t("dev.routeSteps", { count: route.streetSteps })}
                            </span>
                            <span className="block text-muted-foreground"
                              data-testid={`dev-opponent-lot-posture-${route.slotId}`}>
                              {route.posture === 0 ? t("dev.opponentLotStanding")
                                : t("dev.opponentLotFallen")}
                            </span>
                            <span className="block break-words text-muted-foreground">
                              {t("dev.routePath")}: {route.streetPath.map(id =>
                                streetById(id)?.name ?? id).join(" → ")}
                            </span>
                            <Button type="button" size="sm" variant="outline"
                              data-testid={`dev-focus-opponent-lot-${route.slotId}`}
                              aria-label={t("dev.focusOpponentLot", { slot: route.slotId })}
                              className="mt-2 h-8 w-full"
                              onClick={() => onTacticalFocus({
                                kind: "opponent-lot",
                                matchId: session.matchId,
                                revision: session.state.revision,
                                actorId,
                                targetId: route.slotId,
                                streetPath: [...route.streetPath],
                              })}>
                              {t("dev.focusOnMap")}
                            </Button>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  <p data-testid="dev-opponent-lots-note"
                    className="text-[11px] leading-5 text-muted-foreground">
                    {t("dev.opponentLotsNote")}
                  </p>
                </section>
                <section aria-label={t("dev.routesTitle")}
                  data-testid="dev-route-planner"
                  className="space-y-2 rounded-xl border border-border p-3 text-xs">
                  <p className="font-semibold">{t("dev.routesTitle")}</p>
                  {!uncontrolledRoutes ? (
                    <p data-testid="dev-routes-unavailable"
                      className="text-muted-foreground">{t("dev.routesUnavailable")}</p>
                  ) : (
                    <>
                      <p data-testid="dev-routes-count" aria-live="polite">
                        {t("dev.routesCount", { count: uncontrolledRoutes.routes.length })}
                      </p>
                      <ol data-testid="dev-routes-list" className="space-y-1">
                        {uncontrolledRoutes.routes.slice(0, 5).map(route => (
                          <li key={route.slotId} data-testid={`dev-route-${route.slotId}`}
                            data-street-id={route.streetId}
                            data-steps={route.streetSteps}
                            data-card-id={route.cardId}
                            data-path={route.streetPath.join(">")}
                            className="rounded-md bg-muted p-2">
                            <span className="font-semibold">{route.slotId} · {route.category}</span>
                            <span className="block text-muted-foreground">
                              {streetById(route.streetId)?.name ?? route.streetId} · {
                                t("dev.routeSteps", { count: route.streetSteps })
                              }
                            </span>
                            <span className="block break-words text-muted-foreground"
                              data-testid={`dev-route-path-${route.slotId}`}>
                              {t("dev.routePath")}: {route.streetPath.map(id =>
                                streetById(id)?.name ?? id).join(" → ")}
                            </span>
                            <Button type="button" size="sm" variant="outline"
                              data-testid={`dev-focus-activity-${route.slotId}`}
                              aria-label={t("dev.focusActivity", { slot: route.slotId })}
                              className="mt-2 h-8 w-full"
                              onClick={() => onTacticalFocus({
                                kind: "activity",
                                matchId: session.matchId,
                                revision: session.state.revision,
                                actorId,
                                targetId: route.slotId,
                                streetPath: [...route.streetPath],
                              })}>
                              {t("dev.focusOnMap")}
                            </Button>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  <p className="text-[11px] leading-5 text-muted-foreground"
                    data-testid="dev-routes-note">{t("dev.routesNote")}</p>
                </section>
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CircleDot aria-hidden="true" className="size-3.5" />
                  {player.freeMoveUsed ? t("dev.moveUsed") : t("dev.moveAvailable")}
                </p>
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">{t("dev.moveTo")}</p>
                  <div className="flex flex-wrap gap-2">
                    {adjacent.map((id) => (
                      <Button
                        key={id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-9 whitespace-normal text-xs"
                        disabled={busy || !isMyTurn || !turnOptions?.freeMoveStreetIds.includes(id)}
                        onClick={() => void command("free-move", id)}
                        data-testid={`dev-move-${id}`}
                      >
                        <MoveRight aria-hidden="true" className="size-3.5" />
                        {streetById(id)?.name ?? id}
                      </Button>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  disabled={!canEndTurn}
                  onClick={() => void command("end-turn")}
                  data-testid="dev-end-turn"
                >
                  {t("dev.endTurn")}
                </Button>
              </>
            )}

            <section aria-label={t("dev.hand")} className="rounded-xl bg-muted p-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <Hand aria-hidden="true" className="size-4" /> {t("dev.hand")} · {actorId}
              </p>
              {hand?.playerId === actorId ? (
                <ul data-testid="dev-hand" className="space-y-1 font-mono text-xs">
                  {hand.cardIds.map((id) => <li key={id} className="break-all">{id}</li>)}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">{t("dev.handLoading")}</p>
              )}
            </section>
            <section
              aria-label={t("dev.auditTitle")}
              data-testid="dev-audit-panel"
              className="space-y-3 rounded-xl border border-border p-3"
            >
              <p className="text-xs font-semibold">{t("dev.auditTitle")}</p>
              <ol data-testid="dev-audit-list" className="max-h-44 space-y-2 overflow-y-auto">
                {publicEvents.map((entry) => (
                  <li key={entry.revision} data-testid={`dev-audit-event-${entry.revision}`}
                    data-event-kind={entry.kind}
                    className="flex items-start gap-2 text-xs">
                    <span className="min-w-9 rounded bg-muted px-1 py-0.5 text-center font-mono text-muted-foreground">
                      #{entry.revision}
                    </span>
                    <span className="min-w-0 flex-1">
                      {entry.kind === "match-created"
                        ? t("dev.auditCreated")
                        : entry.kind === "free-move"
                          ? t("dev.auditMove", {
                              actor: entry.actorId,
                              from: streetById(entry.fromStreetId!)?.name ?? entry.fromStreetId,
                              to: streetById(entry.toStreetId!)?.name ?? entry.toStreetId,
                            })
                          : entry.kind === "turn-ended"
                            ? t("dev.auditEnd", { actor: entry.actorId })
                            : t("dev.auditPending", { actor: entry.actorId })}
                    </span>
                    <Button type="button" size="sm" variant="outline"
                      data-testid={`dev-audit-jump-${entry.revision}`}
                      className="h-auto min-h-8 shrink-0 whitespace-normal text-xs"
                      aria-current={inspectedFrame?.revision === entry.revision ? "step" : undefined}
                      aria-label={t(entry.kind === "free-move"
                        ? "dev.auditJumpMove" : "dev.auditJumpEvent", {
                          revision: entry.revision, actor: entry.actorId,
                        })}
                      disabled={!history || history.frames[entry.revision]?.kind !== entry.kind
                        || history.frames[entry.revision]?.actorId !== entry.actorId}
                      onClick={() => jumpToAuditedEvent(entry)}>
                      {t("dev.auditJump")}
                    </Button>
                  </li>
                ))}
              </ol>
              <div className="border-t border-border pt-3">
                <p className="mb-2 text-xs font-semibold">{t("dev.nextOrderPreview")}</p>
                <ol data-testid="dev-next-order" className="flex flex-wrap gap-2 text-xs">
                  {(session.state.proposedNextRoundOrder ?? []).map((id, index) => (
                    <li key={id} className="rounded-md bg-muted px-2 py-1">
                      <span className="mr-1 font-mono text-muted-foreground">{index + 1}.</span>
                      {id}
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  {t("dev.nextOrderWarning")}
                </p>
              </div>
            </section>
            <section aria-label={t("dev.unreadActivityTitle")}
              data-testid="dev-unread-activity-panel"
              className="space-y-2 rounded-xl border border-border p-3">
              <p className="text-xs font-semibold">{t("dev.unreadActivityTitle")}</p>
              {!activityReady ? (
                <p data-testid="dev-unread-activity-unavailable"
                  className="text-xs text-muted-foreground">
                  {t("dev.unreadActivityUnavailable")}
                </p>
              ) : (
                <>
                  <p data-testid="dev-unread-activity-count" role="status" aria-live="polite"
                    className="text-sm font-semibold">
                    {t("dev.unreadActivityCount", { count: unseenOpponentFrames.length })}
                  </p>
                  {unseenOpponentFrames.length > 0 && (
                    <ol data-testid="dev-unread-activity-events"
                      className="max-h-44 space-y-1 overflow-y-auto text-xs">
                      {unseenOpponentFrames.slice(-5).map(frame => (
                        <li key={frame.revision} data-event-kind={frame.kind}
                          data-testid={`dev-unread-activity-event-${frame.revision}`}
                          className="rounded-md bg-muted px-2 py-1">
                          <span className="mr-2 font-mono text-muted-foreground">
                            #{frame.revision}
                          </span>
                          {frame.kind === "free-move"
                            ? t("dev.unreadActivityMove", { actor: frame.actorId })
                            : frame.kind === "turn-ended"
                              ? t("dev.unreadActivityTurnEnded", { actor: frame.actorId })
                              : t("dev.unreadActivityRoundEnded", { actor: frame.actorId })}
                        </li>
                      ))}
                    </ol>
                  )}
                  <Button type="button" size="sm" variant="outline"
                    disabled={unseenOpponentFrames.length === 0}
                    data-testid="dev-unread-activity-mark-seen"
                    onClick={() => {
                      if (!history || !session || !token || !actorId) return;
                      const scope = currentActorScope.current;
                      if (scope?.matchId !== session.matchId
                        || scope.seatId !== actorId || scope.token !== token) return;
                      setActivityRead({
                        matchId: session.matchId, seatId: actorId,
                        token, revision: history.verifiedRevision,
                      });
                    }}>
                    {t("dev.unreadActivityMarkSeen")}
                  </Button>
                </>
              )}
              <p data-testid="dev-unread-activity-note"
                className="text-[11px] leading-5 text-muted-foreground">
                {t("dev.unreadActivityNote")}
              </p>
            </section>
            <section
              aria-label={t("dev.historyTitle")}
              data-testid="dev-history-panel"
              className="space-y-3 rounded-xl border border-border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold">{t("dev.historyTitle")}</p>
                <Button type="button" size="sm" variant="outline"
                  data-testid="dev-public-audit-export"
                  disabled={!history || !actorId || !token}
                  onClick={exportPublicAudit}>
                  <Download aria-hidden="true" className="size-3.5" />
                  {t("dev.historyExport")}
                </Button>
              </div>
              <p data-testid="dev-public-audit-export-note"
                className="text-[11px] leading-5 text-muted-foreground">
                {t("dev.historyExportNote")}
              </p>
              {!inspectedFrame || !history ? (
                <p data-testid="dev-history-unavailable"
                  className="text-xs text-muted-foreground">{t("dev.historyUnavailable")}</p>
              ) : (
                <>
                  <div role="group" aria-label={t("dev.historyNavigation")}
                    className="flex flex-wrap items-center gap-2">
                    <Button type="button" size="sm" variant="outline"
                      data-testid="dev-history-previous"
                      disabled={inspectedFrame.revision <= 0}
                      onClick={() => {
                        onHistoricalFocus(null);
                        setHistoryRevision(inspectedFrame.revision - 1);
                      }}>
                      {t("dev.historyPrevious")}
                    </Button>
                    <span data-testid="dev-history-revision"
                      className="font-mono text-xs" aria-live="polite">
                      {t("dev.historyAtRevision", { revision: inspectedFrame.revision })}
                    </span>
                    <Button type="button" size="sm" variant="outline"
                      data-testid="dev-history-next"
                      disabled={inspectedFrame.revision >= history.verifiedRevision}
                      onClick={() => {
                        onHistoricalFocus(null);
                        const next = inspectedFrame.revision + 1;
                        setHistoryRevision(next === history.verifiedRevision ? null : next);
                      }}>
                      {t("dev.historyNext")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost"
                      data-testid="dev-history-latest"
                      disabled={inspectedFrame.revision === history.verifiedRevision}
                      onClick={() => {
                        onHistoricalFocus(null);
                        setHistoryRevision(null);
                      }}>
                      {t("dev.historyLatest")}
                    </Button>
                  </div>
                  <p data-testid="dev-history-active" className="text-xs text-muted-foreground">
                    {inspectedFrame.activePlayerId
                      ? t("dev.historyActor", { actor: inspectedFrame.activePlayerId })
                      : t("dev.historySettlement")}
                  </p>
                  <ul data-testid="dev-history-positions"
                    className="grid gap-1 text-xs sm:grid-cols-2">
                    {inspectedFrame.players.map(p => (
                      <li key={p.playerId} data-player-id={p.playerId}
                        data-street-id={p.streetId} data-moved={p.freeMoveUsed}
                        className="rounded-md bg-muted px-2 py-1">
                        <span className="font-semibold">{p.playerId}: </span>
                        {streetById(p.streetId)?.name ?? p.streetId}
                        <Button type="button" size="sm" variant="outline"
                          data-testid={`dev-history-focus-${p.playerId}`}
                          className="ml-2 h-auto min-h-8 whitespace-normal text-xs"
                          aria-label={t("dev.historyFocusPlayerOnMap", {
                            player: p.playerId, revision: inspectedFrame.revision,
                          })}
                          onClick={() => {
                            if (!session || !history || !token || !actorId) return;
                            const scope = currentActorScope.current;
                            if (scope?.matchId !== session.matchId
                              || scope.seatId !== actorId || scope.token !== token
                              || history.matchId !== session.matchId
                              || history.verifiedRevision !== session.state.revision) return;
                            const frame = history.frames.find(f => f.revision === inspectedFrame.revision);
                            const exact = frame?.players.filter(x => x.playerId === p.playerId);
                            if (!frame || exact?.length !== 1 || exact[0].streetId !== p.streetId
                              || !streetById(p.streetId)) return;
                            onHistoricalFocus({
                              matchId: session.matchId,
                              sourceRevision: history.verifiedRevision,
                              historyRevision: frame.revision,
                              playerId: p.playerId,
                              streetId: p.streetId,
                            });
                          }}>{t("dev.historyFocusOnMap")}</Button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] leading-5 text-muted-foreground"
                    data-testid="dev-history-warning">{t("dev.historyWarning")}</p>
                </>
              )}
            </section>
            <p className="text-[11px] leading-5 text-muted-foreground">{t("dev.warning")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
