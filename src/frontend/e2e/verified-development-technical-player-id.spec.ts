import { expect, test } from "@playwright/test";

// #127: Actual Vite-imported helper + shared public ingress, NOT test copy.
const seatIds = ["alice", "bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];
type Count = 2 | 4 | 8;
function fixture(count: Count) {
  const ids = seatIds.slice(0, count);
  return {
    matchId: "public-seat-id-policy", boardVersion: "edonism-streets-v1",
    revision: 0, round: 1, phase: 0, activePlayerId: "alice",
    players: ids.map((playerId, index) => ({
      playerId, startingSlotId: "N-" + String(index + 1).padStart(2, "0"), streetId: index % 2 ? "einstein" : "gauss", freeMoveUsed: false,
    })),
    turnOrder: ids,
    proposedNextRoundOrder: [...ids.slice(-1), ...ids.slice(0, -1)],
    events: [{ revision: 0, round: 1, kind: "match-created",
      actorId: "system", fromStreetId: null, toStreetId: null }],
    boardActivities: [], controlledActivities: [], grossSalaryQuotes: [],
  };
}
function replaceLastActor(s: ReturnType<typeof fixture>, id: unknown) {
  const copy = structuredClone(s);
  const last = copy.players.length - 1;
  copy.players[last].playerId = id as string;
  copy.turnOrder[last] = id as string;
  copy.proposedNextRoundOrder[0] = id as string;
  return copy;
}
const validValues = [
  "Renée", "王小明", "Alpha Player", "Player🙂", "System", "SYSTEM",
  "A".repeat(64), "界".repeat(64), "🙂".repeat(32),
];
const invalidValues: unknown[] = [
  null, 5, false, "", " ", "  ", " alice", "alice ", "system",
  "A".repeat(65), "界".repeat(65), "🙂".repeat(33),
  "alice\nbob", "alice\tbob", "alice\u007fbob",
  "alice\u0085bob", "alice\u200B", "alice\u202Eevil",
  "alice\u2066", "alice\u2028", "alice\u2029",
  "alice\u00a0bob", "alice\u202fbob", "alice\u{E0001}other",
  "\uD800", "\uDC00", "alice\uD800bob", "alice\uDC00bob",
];

for (const count of [2, 4, 8] as const) {
  test("#127: server-compatible printable Unicode technical IDs accept for "
    + count + " seats", async ({ page }) => {
    const original = fixture(count);
    const variants = validValues.map(id => replaceLastActor(original, id));
    const before = JSON.stringify({ original, variants });
    await page.goto("/");
    const result = await page.evaluate(async ({ original, variants, validValues }) => {
      const { isValidDevelopmentTechnicalPlayerId: validId } =
        await import("/src/features/matches/verifiedDevelopmentTechnicalPlayerId.ts");
      const { hasValidDevelopmentPublicEnvelope: ingress } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      return {
        standalone: validValues.map(validId),
        ingress: variants.map(v => ingress(v, original.matchId)),
        baseline: ingress(original, original.matchId),
      };
    }, { original, variants, validValues });
    expect(result.standalone).toEqual(validValues.map(() => true));
    expect(result.ingress).toEqual(validValues.map(() => true));
    expect(result.baseline).toBe(true);
    expect(JSON.stringify({ original, variants })).toBe(before);
  });

  test("#127: controls/bidi/surrogates/overlong IDs fail entire match for "
    + count + " seats", async ({ page }) => {
    const original = fixture(count);
    const variants = invalidValues.map(value => replaceLastActor(original, value));
    const before = JSON.stringify({ original, variants });
    await page.goto("/");
    const result = await page.evaluate(async ({ original, variants, invalidValues }) => {
      const { isValidDevelopmentTechnicalPlayerId: validId } =
        await import("/src/features/matches/verifiedDevelopmentTechnicalPlayerId.ts");
      const { hasValidDevelopmentPublicEnvelope: ingress } =
        await import("/src/features/matches/verifiedDevelopmentPublicEnvelope.ts");
      return {
        standalone: invalidValues.map(validId),
        ingress: variants.map(v => ingress(v, original.matchId)),
        original: ingress(original, original.matchId),
      };
    }, { original, variants, invalidValues });
    expect(result.standalone).toEqual(invalidValues.map(() => false));
    expect(result.ingress).toEqual(invalidValues.map(() => false));
    expect(result.original).toBe(true);
    expect(JSON.stringify({ original, variants })).toBe(before);
  });
}
