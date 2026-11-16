import { expect, test } from "@playwright/test";

// #132: Direct Vite import of the already fail-closed controlled-lot
// projection. It uses public known owners/face-up cards on the shared board;
// no browser movement or ownership/gameplay authority is introduced.
const ids = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type SeatCount = 2 | 4 | 8;
function fixture(count: SeatCount) {
  const players = ids.slice(0, count).map((playerId, i) => ({
    playerId, streetId: i % 2 ? "einstein" : "gauss",
    startingSlotId: "N-" + String(i + 1).padStart(2, "0"),
  }));
  const controls = players.map((p, i) => ({
    slotId: p.startingSlotId, ownerPlayerId: p.playerId, posture: i % 2,
  }));
  return {
    matchId: "controlled-lot-inspection", revision: 0,
    players, activePlayerId: "alice",
    boardActivities: controls.map((c,i) => ({
      slotId: c.slotId, cardId: "demo:activity:" + i, category: "culture",
    })),
    controlledActivities: controls, grossSalaryQuotes: [],
  };
}

for (const count of [2, 4, 8] as const) {
  test("#132: public controlled activity markers use 30 real printed lot locations "
    + "for " + count + " player seats", async ({ page }) => {
    const original = fixture(count);
    const before = JSON.stringify(original);
    await page.goto("/");
    const response = await page.evaluate(async data => {
      const { controlledLotMarkers: markers } =
        await import("/src/features/city/activityMarkers.ts");
      const { cityBoard, slotById } =
        await import("/src/features/city/board.ts");
      const all = cityBoard.slots.map(x => x.id);
      const canonical = all.map(last => {
        const ids = [...all.filter(x => x !== last).slice(0, data.players.length - 1), last];
        const states = structuredClone(data);
        states.boardActivities = ids.map((slotId, i) => ({
          slotId, cardId: "demo:activity:" + i, category: "culture",
        }));
        states.controlledActivities = ids.map((slotId, i) => ({
          slotId, ownerPlayerId: states.players[i].playerId, posture: i % 2,
        }));
        const list = markers(states);
        return list.length === data.players.length
          && list.every(m => slotById(m.slotId)?.streetId === m.streetId);
      });
      const current = markers(data);
      return {
        count: all.length, distinct: new Set(all).size,
        allCanonical: canonical,
        origins: current.map(m => [m.slotId, m.ownerPlayerId, m.posture]),
        street: current.map(m => [m.slotId, m.streetId]),
      };
    }, original);
    expect(response.count).toBe(30);
    expect(response.distinct).toBe(30);
    expect(response.allCanonical).toEqual(Array.from({ length: 30 }, () => true));
    expect(response.origins).toEqual(original.controlledActivities.map(c =>
      [c.slotId, c.ownerPlayerId, c.posture === 0 ? "standing" : "fallen"]));
    expect(response.street).toEqual(original.controlledActivities.map(c =>
      [c.slotId, "gauss"]));
    expect(JSON.stringify(original)).toBe(before);
  });

  test("#132: invalid, duplicate or ownerless public lot never gets a marker "
    + "or an inspect action for " + count + " players", async ({ page }) => {
    const original = fixture(count);
    const bad = (mutate: (s: ReturnType<typeof fixture>) => void) => {
      const s = structuredClone(original); mutate(s); return s;
    };
    const cases = [
      bad(s => { s.controlledActivities[0].ownerPlayerId = "intruder"; }),
      bad(s => { s.controlledActivities[0].posture = 99; }),
      bad(s => { s.controlledActivities[0].slotId = "foreign-lot"; }),
      bad(s => { s.boardActivities[0].slotId = "foreign-lot"; }),
      bad(s => { s.controlledActivities.push(structuredClone(s.controlledActivities[0])); }),
      bad(s => { s.boardActivities.push(structuredClone(s.boardActivities[0])); }),
    ];
    const before = JSON.stringify({ original, cases });
    await page.goto("/");
    const result = await page.evaluate(async ({ original, cases }) => {
      const { controlledLotMarkers: markers } =
        await import("/src/features/city/activityMarkers.ts");
      const good = markers(original);
      return {
        good: good.length,
        rejectedFirst: cases.map(s => !markers(s).some(m =>
          m.slotId === original.controlledActivities[0].slotId)),
        preservedOthers: cases.map(s => markers(s).length === original.players.length - 1),
      };
    }, { original, cases });
    expect(result.good).toBe(count);
    expect(result.rejectedFirst).toEqual(cases.map(() => true));
    expect(result.preservedOthers).toEqual(cases.map(() => true));
    expect(JSON.stringify({ original, cases })).toBe(before);
  });
}
