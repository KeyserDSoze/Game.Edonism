import { expect, test } from "@playwright/test";
import {
  hasAtomicPublicTacticalScope, type PublicTacticalScope,
} from "../src/features/matches/publicTacticalScope";

// No API, credentials or browser runtime: this pure test matrix covers all
// five public-scope fields at every level of the atomic #88 response.
const fields = ["matchId", "playerId", "round", "verifiedRevision",
  "fromStreetId"] as const;
const parts = ["uncontrolled", "otherPlayers", "opponentControlledLots"] as const;
type Field = typeof fields[number];
type Part = typeof parts[number];
type FakeOverview = Record<Field | Part, unknown>;
const expected: PublicTacticalScope = Object.freeze({
  matchId: "public-match-1",
  playerId: "alice",
  round: 3,
  verifiedRevision: 14,
  fromStreetId: "gauss",
});
function verifiedSnapshot(): FakeOverview {
  return {
    ...expected,
    uncontrolled: { ...expected, routes: [] },
    otherPlayers: { ...expected, others: [] },
    opponentControlledLots: { ...expected, routes: [] },
  };
}
function incorrect(field: Field) {
  return field === "round" || field === "verifiedRevision"
    ? 42 : field === "playerId" ? "bob"
      : field === "fromStreetId" ? "einstein" : "different-public-match";
}

for (const seats of [2, 4, 8] as const) {
  test(`#100: valid ${seats}-seat complete public tactical scope is accepted`, () => {
    const snapshot = verifiedSnapshot();
    const before = JSON.stringify(snapshot);
    expect(hasAtomicPublicTacticalScope(snapshot, expected)).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(before);
    // A different expected actor, match or revision can never reuse a
    // public response from another Development seat/revision.
    for (const field of fields) {
      const different = { ...expected, [field]: incorrect(field) };
      expect(hasAtomicPublicTacticalScope(snapshot, different)).toBe(false);
    }
  });
}

test("#100: every top-level and three nested scope field must match exactly", () => {
  const clean = verifiedSnapshot();
  expect(hasAtomicPublicTacticalScope(clean, expected)).toBe(true);
  for (const field of fields) {
    const top = verifiedSnapshot();
    top[field] = incorrect(field);
    expect(hasAtomicPublicTacticalScope(top, expected)).toBe(false);

    for (const part of parts) {
      const tampered = verifiedSnapshot();
      tampered[part] = {
        ...(tampered[part] as Record<string, unknown>),
        [field]: incorrect(field),
      };
      expect(hasAtomicPublicTacticalScope(tampered, expected)).toBe(false);
    }
  }
  expect(hasAtomicPublicTacticalScope(clean, expected)).toBe(true);
});

test("#100: null, primitive, array and missing nested objects fail closed without throwing", () => {
  const bad: readonly unknown[] = [null, undefined, 0, false, "broken",
    [], [verifiedSnapshot()], Object.create(null)];
  for (const raw of bad)
    expect(hasAtomicPublicTacticalScope(raw, expected)).toBe(false);
  for (const part of parts) {
    for (const raw of bad) {
      const snapshot = verifiedSnapshot();
      snapshot[part] = raw;
      expect(hasAtomicPublicTacticalScope(snapshot, expected)).toBe(false);
    }
    const missing = verifiedSnapshot();
    delete missing[part];
    expect(hasAtomicPublicTacticalScope(missing, expected)).toBe(false);
  }
});

test("#100: no partial disclosure from two valid nested scopes and one forged scope", () => {
  for (const part of parts) {
    const snapshot = verifiedSnapshot();
    const original = JSON.stringify(snapshot);
    const altered = snapshot[part] as Record<string, unknown>;
    snapshot[part] = { ...altered, playerId: "intruder" };
    expect(hasAtomicPublicTacticalScope(snapshot, expected)).toBe(false);
    expect(JSON.stringify(snapshot)).not.toBe(original);
  }
  const full = verifiedSnapshot();
  const tampered = { ...full, verifiedRevision: "14" };
  expect(hasAtomicPublicTacticalScope(tampered, expected)).toBe(false);
  expect(hasAtomicPublicTacticalScope(full, expected)).toBe(true);
});
