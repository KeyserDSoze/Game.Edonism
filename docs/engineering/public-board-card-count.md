# Verified public board card count in city roster (#111)

The Development city sidebar originally displayed raw `publicPlayers.boardActivities.length`
even though serialized public .NET snapshots arrive as **runtime JSON**.
Malformed `null`, non-array, duplicate or unknown cards could crash the
React root or display a plausible but unverified board card count while the
independent #108/#110 marker/tactical overlays had already failed closed.

`verifiedPublicBoardCardCount(state)` now returns a **number** only if
`boardActivities` is a real array with non-null object records, each
carrying a distinct canonical printed board slot, a nonempty string card ID
and a nonempty category. It uses the existing versioned board's `slotById`,
not visual geometry or any client-invented game state. Invalid data produces
`null`, meaning **unverified / hide the count** — deliberately not zero.
An actual empty array is valid and displays **0**. The React roster remains
mounted when count is unavailable; independently valid player/controlled lot
markers and server-confirmed turn commands are unchanged. This does not
authorize a purchase, infer card setup completeness, adjust wallet or add
Production APIs.

Regression coverage: seven Playwright real TypeScript/browser-loaded tests
for valid 2/4/8 cards, 11 forged variants per size, and malformed/non-array
payloads versus a genuine empty array. An additional full mocked browser
scenario with public `cardId:42` confirms the city stays mounted, the
unverified card badge is hidden, a separate genuine controlled lot remains
visible, and command permissions/revision are untouched. Existing tests,
timeouts, retries, two-worker mock and single-worker real .NET suites remain
mandatory. Close [#111](https://github.com/KeyserDSoze/Game.Edonism/issues/111)
only after **3/3 completed/success on the exact final main SHA**.
