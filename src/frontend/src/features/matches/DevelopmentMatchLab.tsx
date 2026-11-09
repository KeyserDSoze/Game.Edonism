import { useEffect, useState } from "react";
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

/**
 * Local Development-only synthetic catalog: 46 activities, 23 characters,
 * 58 action IDs and one Election Day. These IDs are not actual Edonism cards.
 * The backend is still authoritative over draw, position, movement and turn.
 */
function demoFixture() {
  const activities = quotaAndExtras.flatMap(([category, quota, extra]) =>
    Array.from({ length: quota + extra }, (_, index) => ({
      id: `demo:${category}:${String(index + 1).padStart(2, "0")}`,
      category,
    })),
  );
  // Match backend test fixture semantics. Each character has a distinct
  // starting card and a synthetic heart count solely for this laboratory.
  const sortedActivities = [...activities].sort((a, b) => a.id.localeCompare(b.id, "en"));
  const characters = Array.from({ length: 23 }, (_, index) => ({
    id: `demo:character:${String(index + 1).padStart(2, "0")}`,
    startingActivityCardId: sortedActivities[index].id,
    printedInitialHearts: (index % 5) + 1,
  }));
  const actionCardIds = Array.from(
    { length: 58 },
    (_, index) => `demo:action:${String(index + 1).padStart(2, "0")}`,
  );

  return {
    playerIds: ["alice", "bob"],
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
  const [actorId, setActorId] = useState("");
  const [hand, setHand] = useState<PrivateHand | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = session?.credentials.find((seat) => seat.playerId === actorId)?.token;
  const player = session?.state.players.find((seat) => seat.playerId === actorId);
  const isMyTurn = session?.state.phase === 0 && session.state.activePlayerId === actorId;
  const canMove = Boolean(player && isMyTurn && !player.freeMoveUsed && !busy);
  const adjacent = player ? (streetById(player.streetId)?.neighbors ?? []) : [];
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

  async function createDemo() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setHand(null);
    try {
      const response = await fetch("/api/dev/matches/from-full-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(demoFixture()),
        cache: "no-store",
      });
      const created = await responseJson<DemoSession>(response);
      if (created.credentials.length !== 2 || created.state.players.length !== 2) {
        throw new Error("invalid_dev_fixture");
      }
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
      setBusy(false);
    }
  }

  async function command(kind: "free-move" | "end-turn", destinationStreetId?: string) {
    if (busy || !session || !token || !isMyTurn) return;
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
        setSession((previous) => previous && { ...previous, state: refreshed });
        publishPublicPositions(refreshed);
        const confirmedStreet = refreshed.players.find((seat) => seat.playerId === actorId)?.streetId;
        if (confirmedStreet && streetById(confirmedStreet)) onStreetSelect(confirmedStreet);
        setError(t("dev.conflict"));
        return;
      }
      const next = await responseJson<DemoMatch>(response);
      setSession((previous) => previous && { ...previous, state: next });
      publishPublicPositions(next);
      if (kind === "free-move" && player) {
        const newStreet = next.players.find((seat) => seat.playerId === actorId)?.streetId;
        if (newStreet) onStreetSelect(newStreet);
      }
    } catch {
      setError(t("dev.networkError"));
    } finally {
      setBusy(false);
    }
  }

  function chooseActor(id: string) {
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

        {error && (
          <p role="alert" data-testid="dev-error" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {session && (
          <div className="space-y-4" data-testid="dev-session">
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

            <div role="group" aria-label={t("dev.seatLabel")} className="grid grid-cols-2 gap-2">
              {session.credentials.map((seat) => (
                <Button
                  key={seat.playerId}
                  type="button"
                  size="sm"
                  variant={actorId === seat.playerId ? "default" : "outline"}
                  aria-pressed={actorId === seat.playerId}
                  onClick={() => chooseActor(seat.playerId)}
                  data-testid={`dev-seat-${seat.playerId}`}
                  className="min-w-0"
                >
                  {seat.playerId}
                </Button>
              ))}
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
                        disabled={!canMove}
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
                  disabled={!isMyTurn || busy}
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
