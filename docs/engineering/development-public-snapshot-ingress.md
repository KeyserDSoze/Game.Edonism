# Development public snapshot ingress envelope (#112)

The React Development lab reads JSON snapshots with a TypeScript cast
(`responseJson<T>`), not runtime validation. Previously, `acceptServerState`
compared only match ID and revision before mutating `currentRevision.current`,
scheduling session state and invoking `publishPublicPositions`, which calls
`state.players.map`. A forged higher-revision public response with a missing
or null player list could advance the revision then throw. Later genuine
lower-revision commands or polls could appear stale, while the client
temporarily held a corrupted session.

`hasValidDevelopmentPublicEnvelope(value, expectedMatchId)` is a pure,
**narrow** runtime guard called BEFORE any poll/command refresh updates
the current revision, session or ETag. It checks matching IDs, nonnegative
safe revision, positive round, known Development phase, active seat type,
2–8 uniquely named non-null public players with string street and boolean
free-move flag; turn order and proposed next order are exact permutations
of those seats; all required public containers (events, cards, controls,
gross quotes) must be **arrays**. Creator and join/bootstrap require this
same envelope before accepting a session or capability-derived fields.

Crucially, this is **not** a client gameplay/audit verifier and cannot
override domain match authority. It does not infer legal moves, inspect
secrets, validate deck composition or credit atoms. Individual malformed
card/control/quote fields still pass the envelope **as arrays** so existing
#105/#108/#110/#111 read-only projections can suppress only the affected
UI content without disabling unrelated genuine public/player/command state.

Playwright regression: browser-imported real TS guard with valid **2/4/8**
seats and forged 21-case matrix per size, plus malformed containers and
independent numeric card ID. A mocked full browser injects a valid-match
but fake revision **99** with `players:null` on the first public poll,
verifies the actor, current displayed revision, private hand and command
permissions remain at **0**, then confirms the legitimate end-turn update
to revision **1** is still accepted. No mock worker/retry/timeout changes,
and xUnit plus the real .NET one-worker/two-bearer gate remain mandatory.
Close [#112](https://github.com/KeyserDSoze/Game.Edonism/issues/112)
only after **3/3 completed/success on exact final main HEAD**.
