# Runtime safety of the public city marker projection (#108)

The Development city receives a server-authenticated **public JSON snapshot**,
but TypeScript annotations do not validate JSON payloads at runtime.
`App.tsx` draws player and controlled-lot markers during rendering, before
the separate #105/#107 fail-closed gross salary projection. An unexpected
`player: null`, `card: null` or numeric `cardId` must never crash React or
silently turn into a genuine map marker.

`playerMarkerPlacements` skips malformed/non-array player positions and
unknown printed roads; existing stable alphabetical ordering, matching
canonical board geometry, pawn colors and same-street spacing are unchanged.
`controlledLotMarkers` rejects malformed top-level arrays and unlocatable
card/control records **as a whole** rather than guessing their slots. For a
known printed slot with a bad public card ID/category, owner, posture, or
duplicate card/control entry, that individual lot stays unpainted; independently
valid public lots remain visible. All strings are checked as strings before
calling `.trim()`, so malformed JSON cannot throw in the root render.

The salary quote guard still requires every controlled lot in that same
snapshot to be valid; if a lot is suppressed, **all gross salary quotes** are
hidden rather than displaying an inconsistent projection. Server-confirmed
revisions, commands, actors, private hand, wallets and the real .NET authority
are unchanged.

Regression checks: browser-imported real TS functions with deterministic
**2/4/8** valid fixtures and 15 malformed/tampered records per size; malformed
container/array/null projections; mocked Playwright authenticated match with
numeric `cardId` and supported DOM-only WebGL fallback checks that
React/city remains mounted, the unaffected public lot stays visible,
the corrupted lot and all salaries are hidden, no move/end-turn is sent,
and authorized turn controls remain available. xUnit and the real-.NET
one-worker/two-bearer Playwright gate must remain green **3/3 on exact final
main SHA**, with issue/AGENTS/ledger/patch notes updated.

[Issue #108](https://github.com/KeyserDSoze/Game.Edonism/issues/108)

## #109 — Contradictory duplicate public player IDs

An authenticated JSON payload may still contain internally contradictory
public positions. When the same nonempty `playerId` appears twice (even when
the second row has an unknown/null street), the city must **not** draw one
arbitrary server-confirmed pawn. `playerMarkerPlacements` therefore counts
syntactically valid IDs **before** filtering canonical streets, then paints a
pawn only when an ID occurs **exactly once** and its street is known. Every
copy of a repeated ID is suppressed, while independently valid players remain.
There is no correction/invention of street, no move/attack permission, and no
change to a valid 2–8-seat roster's alphabetical order, colors, geometry or
same-street spacing. The already fail-closed gross salary projection
#105/#107 independently rejects duplicate player IDs.

Playwright imports the real TypeScript implementation in Vite's browser
module (not Node/JSON). Deterministic 2/4/8-seat tests verify order-stable
normal and shared-street spacing, plus duplicate same/conflicting/unknown/null
street, duplicate two owners, second actor duplicate and unrelated malformed
record. Existing mocked browser actor and two-bearer real-.NET tests must
remain green. [Issue #109](https://github.com/KeyserDSoze/Game.Edonism/issues/109).
Close only after **3/3 CI on the exact final main SHA**.
