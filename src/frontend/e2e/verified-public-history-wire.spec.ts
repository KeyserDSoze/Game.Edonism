import { expect, test } from "@playwright/test";

// #175: genuine React/Vite replay verifier (not a test-only implementation).
// These are only the existing first-round audited events; no new game rules.
const actors = ["Renée", "王小明", "System", "🙂",
  "alpha", "bravo", "charlie", "delta"];

function fixture(count: 2 | 4 | 8, completedTurns: number) {
  const ids = actors.slice(0, count);
  const players = ids.map((playerId, index) => ({
    playerId,
    streetId: index === 0 ? "gauss" : "einstein",
    freeMoveUsed: false,
  }));
  const events = [{
    revision: 0, round: 1, kind: "match-created", actorId: "system",
    fromStreetId: null as string | null, toStreetId: null as string | null,
  }];
  const frames = [{
    revision: 0, kind: "match-created", actorId: "system",
    phase: 0, activePlayerId: ids[0] as string | null,
    players: structuredClone(players),
  }];
  for (let index = 1; index <= completedTurns; index++) {
    const final = index === count;
    const kind = final ? "round-settlement-pending" : "turn-ended";
    events.push({
      revision: index, round: 1, kind, actorId: ids[index - 1],
      fromStreetId: null, toStreetId: null,
    });
    frames.push({
      revision: index, kind, actorId: ids[index - 1],
      phase: final ? 1 : 0,
      activePlayerId: final ? null : ids[index],
      players: structuredClone(players),
    });
  }
  const phase = completedTurns === count ? 1 : 0;
  const state = {
    matchId: "history-175", revision: completedTurns, round: 1, phase,
    activePlayerId: completedTurns === count ? null : ids[completedTurns],
    turnOrder: ids, players, events,
  };
  const history = {
    matchId: state.matchId, verifiedRevision: state.revision, frames,
  };
  return { state, history };
}

for (const count of [2, 4, 8] as const) {
  test(`#175: valid ${count}-seat genesis, active and pending audited history keys`,
    async ({ page }) => {
      const genesis = fixture(count, 0);
      const middle = fixture(count, 1);
      const pending = fixture(count, count);
      const reordered = {
        verifiedRevision: middle.history.verifiedRevision,
        frames: middle.history.frames.map(row => ({
          players: row.players.map(p => ({
            streetId: p.streetId, freeMoveUsed: p.freeMoveUsed,
            playerId: p.playerId,
          })),
          activePlayerId: row.activePlayerId,
          revision: row.revision, phase: row.phase,
          kind: row.kind, actorId: row.actorId,
        })),
        matchId: middle.history.matchId,
      };
      const before = JSON.stringify({ genesis, middle, pending, reordered });
      await page.goto("/");
      const checked = await page.evaluate(async ({ genesis, middle, pending, reordered }) => {
        const { verifiedPublicHistory } =
          await import("/src/features/matches/verifiedPublicHistory.ts");
        return {
          genesis: verifiedPublicHistory(genesis.state, genesis.history) !== null,
          active: verifiedPublicHistory(middle.state, middle.history) !== null,
          pending: verifiedPublicHistory(pending.state, pending.history) !== null,
          reordered: verifiedPublicHistory(middle.state, reordered) !== null,
          wrongMatch: verifiedPublicHistory(genesis.state,
            { ...genesis.history, matchId: "foreign-match" }) === null,
        };
      }, { genesis, middle, pending, reordered });
      expect(checked).toEqual({
        genesis: true, active: true, pending: true, reordered: true, wrongMatch: true,
      });
      expect(JSON.stringify({ genesis, middle, pending, reordered })).toBe(before);
    });

  test(`#175: reject over-wide root, intermediate frames and seats for ${count} owners`,
    async ({ page }) => {
      const { state, history } = fixture(count, count);
      const changed = (update: (row: typeof history) => void) => {
        const row = structuredClone(history);
        update(row);
        return row;
      };
      const bad: Record<string, unknown> = {
        rootPrivateHand: { ...history, privateHand: ["HIDDEN"] },
        rootOtherTokens: { ...history, otherPlayerTokens: ["HIDDEN"] },
        rootAdminActions: { ...history, adminActions: ["skip-turn"] },
        rootExtraNull: { ...history, metadata: null },
        rootExtraFalse: { ...history, futureActions: false },
        frameGenesisSecret: changed(row => {
          Object.assign(row.frames[0], { secret: "HIDDEN" });
        }),
        frameIntermediateToken: changed(row => {
          Object.assign(row.frames[1], { token: "HIDDEN" });
        }),
        frameFinalFalsePermission: changed(row => {
          Object.assign(row.frames[count], { canMoveAnywhere: false });
        }),
        seatIntermediatePrivateCard: changed(row => {
          Object.assign(row.frames[1].players[count - 1], { cardIds: ["HIDDEN"] });
        }),
        seatGenesisNullMetadata: changed(row => {
          Object.assign(row.frames[0].players[0], { metadata: null });
        }),
        seatFinalNewPower: changed(row => {
          Object.assign(row.frames[count].players[0], { futurePower: [] });
        }),
        missingMatch: changed(row => {
          delete (row as unknown as Record<string, unknown>).matchId;
        }),
        missingRevision: changed(row => {
          delete (row as unknown as Record<string, unknown>).verifiedRevision;
        }),
        missingFrames: changed(row => {
          delete (row as unknown as Record<string, unknown>).frames;
        }),
        missingFrameKind: changed(row => {
          delete (row.frames[1] as unknown as Record<string, unknown>).kind;
        }),
        missingFramePhase: changed(row => {
          delete (row.frames[1] as unknown as Record<string, unknown>).phase;
        }),
        missingFrameActor: changed(row => {
          delete (row.frames[1] as unknown as Record<string, unknown>).actorId;
        }),
        missingFrameActive: changed(row => {
          delete (row.frames[1] as unknown as Record<string, unknown>).activePlayerId;
        }),
        missingFramePlayers: changed(row => {
          delete (row.frames[1] as unknown as Record<string, unknown>).players;
        }),
        missingFrameRevision: changed(row => {
          delete (row.frames[1] as unknown as Record<string, unknown>).revision;
        }),
        missingSeatPlayer: changed(row => {
          delete (row.frames[1].players[0] as unknown as Record<string, unknown>).playerId;
        }),
        missingSeatStreet: changed(row => {
          delete (row.frames[1].players[0] as unknown as Record<string, unknown>).streetId;
        }),
        missingSeatMoveFlag: changed(row => {
          delete (row.frames[1].players[0] as unknown as Record<string, unknown>).freeMoveUsed;
        }),
        nullFrame: changed(row => {
          row.frames[1] = null as unknown as typeof row.frames[1];
        }),
        nullSeat: changed(row => {
          row.frames[1].players[0] = null as unknown as typeof row.frames[1].players[0];
        }),
        arraySeat: changed(row => {
          row.frames[1].players[0] = [] as unknown as typeof row.frames[1].players[0];
        }),
        frameArrayInsteadOfRecord: changed(row => {
          row.frames[1] = [] as unknown as typeof row.frames[1];
        }),
        numericSeatMoveFlag: changed(row => {
          row.frames[1].players[0].freeMoveUsed = 0 as unknown as boolean;
        }),
        nullRoot: null,
        arrayRoot: [],
      };
      const before = JSON.stringify({ state, history, bad });
      await page.goto("/");
      const verdicts = await page.evaluate(async ({ state, bad }) => {
        const { verifiedPublicHistory } =
          await import("/src/features/matches/verifiedPublicHistory.ts");
        return Object.entries(bad).map(([name, value]) => {
          const accepted = verifiedPublicHistory(state, value as never);
          return [name, accepted !== null] as const;
        });
      }, { state, bad });
      expect(verdicts).toHaveLength(Object.keys(bad).length);
      for (const [name, accepted] of verdicts) expect(accepted, name).toBe(false);
      expect(JSON.stringify({ state, history, bad })).toBe(before);
    });
}
