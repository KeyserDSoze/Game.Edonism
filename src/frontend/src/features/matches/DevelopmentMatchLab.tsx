import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleDot, FlaskConical, Hand, MoveRight, RotateCw, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { streetById } from "@/features/city/board";
import type { PublicMatchSceneState, PublicBoardActivity, PublicControlledActivity, PublicGrossSalaryQuote } from "@/features/city/activityMarkers";
import { visiblePublicAuditEvents, type PublicMatchEvent } from "./publicAudit";

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
}: {
  onStreetSelect: (id: string) => void;
  /** A public-only server snapshot projection for the 3D scene and DOM fallback. */
  onPublicState: (state: PublicMatchSceneState | null) => void;
}) {
  const { t } = useTranslation();
  const [session, setSession] = useState<DemoSession | null>(null);
  const [playerCount, setPlayerCount] = useState(2);
  const [actorId, setActorId] = useState("");
  const [hand, setHand] = useState<PrivateHand | null>(null);
  // The credential identity is held only in component memory.
  const [optionLease, setOptionLease] = useState<{
    token: string; options: ActorTurnOptions
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotationNotice, setRotationNotice] = useState<string | null>(null);
  const [joinMatchId, setJoinMatchId] = useState("");
  const [joinToken, setJoinToken] = useState("");
  // Monotonic authority guards: HTTP polling/commands may resolve out of order.
  const currentMatchId = useRef<string | null>(null);
  const currentRevision = useRef(-1);
  const commandInFlight = useRef(false);
  // In-memory, actor-bound conditional HTTP tag. Never write credentials,
  // private cards or ETags to local/session storage.
  const lastPublicTag = useRef<{
    matchId: string; token: string; revision: number; value: string;
  } | null>(null);

  const token = session?.credentials.find((seat) => seat.playerId === actorId)?.token;
  const player = session?.state.players.find((seat) => seat.playerId === actorId);
  const isMyTurn = session?.state.phase === 0 && session.state.activePlayerId === actorId;
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

  function publishPublicPositions(state: DemoMatch | null) {
    onPublicState(state
      ? {
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
    setOptionLease(null);
    const matchId = session?.matchId;
    const revision = session?.state.revision;
    const actorToken = token;
    const seatId = actorId;
    if (!matchId || revision === undefined || !actorToken || !seatId) return;
    const controller = new AbortController();
    void fetch(`/api/dev/matches/${matchId}/turn-options`, {
      headers: { "X-Edonism-Dev-Token": actorToken },
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => responseJson<ActorTurnOptions>(response))
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
    if (!session?.matchId || !token) {
      setHand(null);
      return;
    }
    const controller = new AbortController();
    setHand(null);
    void fetch(`/api/dev/matches/${session.matchId}/hand`, {
      headers: { "X-Edonism-Dev-Token": token },
      signal: controller.signal,
      cache: "no-store",
    })
      .then((response) => responseJson<PrivateHand>(response))
      .then((result) => {
        if (!controller.signal.aborted) setHand(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHand(null);
      });
    return () => controller.abort();
  }, [session?.matchId, token]);

  // No periodic full snapshots if the public revision is unchanged.
  // A 304 still follows a bearer-authenticated server read. Resume polling
  // promptly when the tab becomes visible or the network comes back.
  useEffect(() => {
    const matchId = session?.matchId;
    const actorToken = token;
    if (!matchId || !actorToken) return;
    const controller = new AbortController();
    let polling = false;
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
        }
        const response = await fetch(`/api/dev/matches/${matchId}`, {
          headers,
          signal: controller.signal,
          cache: "no-store",
        });
        // A conditional GET never returns JSON on 304, nor advances UI state.
        if (response.status === 304) return;
        if (response.ok) {
          const next = (await response.json()) as DemoMatch;
          if (!controller.signal.aborted && !commandInFlight.current
            && currentMatchId.current === matchId
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
        polling = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onOnline = () => void check();
    const handle = window.setInterval(() => void check(), 1500);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      controller.abort();
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
    setOptionLease(null);
    lastPublicTag.current = null;
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
      const created = await responseJson<DemoSession>(response);
      const playerIds = demoSeatIds.slice(0, playerCount);
      if (created.credentials.length !== playerCount || created.state.players.length !== playerCount
        || !playerIds.every((id) => created.credentials.some((seat) => seat.playerId === id)
          && created.state.players.some((seat) => seat.playerId === id))) {
        throw new Error("invalid_dev_fixture");
      }
      currentMatchId.current = created.matchId;
      currentRevision.current = created.state.revision;
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
    setOptionLease(null);
    lastPublicTag.current = null;
    currentMatchId.current = null;
    currentRevision.current = -1;
    setSession(null);
    publishPublicPositions(null);
    try {
      const headers = { "X-Edonism-Dev-Token": secret };
      // The identity MUST be resolved from the token-bound private-hand endpoint,
      // not from a playerId typed or guessed in the browser.
      const [publicResponse, handResponse] = await Promise.all([
        fetch(`/api/dev/matches/${id}`, { headers, cache: "no-store" }),
        fetch(`/api/dev/matches/${id}/hand`, { headers, cache: "no-store" }),
      ]);
      const [state, privateHand] = await Promise.all([
        responseJson<DemoMatch>(publicResponse),
        responseJson<PrivateHand>(handResponse),
      ]);
      if (state.matchId.toLowerCase() !== id || privateHand.matchId.toLowerCase() !== id
        || !state.players.some((p) => p.playerId === privateHand.playerId))
        throw new Error("invalid_seat");
      const actor = privateHand.playerId;
      currentMatchId.current = state.matchId;
      currentRevision.current = state.revision;
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
    commandInFlight.current = true;
    setBusy(true);
    setError(null);
    setRotationNotice(null);
    try {
      const result = await responseJson<DemoCredential>(await fetch(
        `/api/dev/matches/${matchId}/rotate-token`, {
          method: "POST",
          headers: { "X-Edonism-Dev-Token": token },
          cache: "no-store",
        },
      ));
      if (result.playerId !== seatId || !/^[A-F0-9]{64}$/i.test(result.token)
        || result.token.toLowerCase() === token.toLowerCase()
        || currentMatchId.current !== matchId)
        throw new Error("invalid_rotated_credential");
      // No change to match, public audit or gameplay revision.
      // Update only the actor's in-memory seat secret.
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
    commandInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/dev/matches/${session.matchId}/${kind}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Edonism-Dev-Token": token,
        },
        body: JSON.stringify(
          kind === "free-move"
            ? { destinationStreetId, expectedRevision: session.state.revision }
            : { expectedRevision: session.state.revision },
        ),
        cache: "no-store",
      });
      if (response.status === 409) {
        // Server wins on optimistic concurrency. Never guess the next state.
        const refreshed = await responseJson<DemoMatch>(
          await fetch(`/api/dev/matches/${session.matchId}`, {
            headers: { "X-Edonism-Dev-Token": token },
            cache: "no-store",
          }),
        );
        if (acceptServerState(refreshed, session.matchId)) {
          const confirmedStreet = refreshed.players.find((seat) => seat.playerId === actorId)?.streetId;
          if (confirmedStreet && streetById(confirmedStreet)) onStreetSelect(confirmedStreet);
        }
        setError(t("dev.conflict"));
        return;
      }
      const next = await responseJson<DemoMatch>(response);
      const applied = acceptServerState(next, session.matchId);
      if (applied && kind === "free-move" && player) {
        const newStreet = next.players.find((seat) => seat.playerId === actorId)?.streetId;
        if (newStreet) onStreetSelect(newStreet);
      }
    } catch {
      setError(t("dev.networkError"));
    } finally {
      commandInFlight.current = false;
      setBusy(false);
    }
  }

  function chooseActor(id: string) {
    if (busy) return;
    setRotationNotice(null);
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
                    <span>
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
            <p className="text-[11px] leading-5 text-muted-foreground">{t("dev.warning")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
