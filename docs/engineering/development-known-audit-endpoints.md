# Known first-round public audit event endpoint shapes (#135)

## Server contract / scope

The .NET 10 `MatchAuditReplay.Verify` accepts exactly the known first-round
`free-move` (valid source/destination, one canonical edge) and
`turn-ended` / `round-settlement-pending` (both street endpoints null),
after one reserved system-authored genesis. Its authoritative replay
checks the current actor, legal graph edge, phase, revision, full
positions and free-move flags.

The Development browser's public ingress already verifies record shape,
canonical membership (#125), event actor membership (#126), consecutive
revisions (#119), and unique genesis (#134). It must additionally reject
a known event with impossible public wire endpoints. Otherwise a forged
HTTP 200 could advance a local revision and ETag while the independent
audit renderer silently hides the invalid record.

## Narrow browser guarantee

In the existing `hasValidDevelopmentPublicAuditChronology` ONLY:

- `free-move`: two non-null, distinct endpoints on the shared canonical
  streets (the broad envelope already ensures membership).
- `turn-ended` and `round-settlement-pending`: both endpoints `null`.
- The exact genesis remains null/null. Unknown future well-formed kinds
  remain transport-compatible and are not trusted for display or actions.

The validator is NOT a gameplay replay, route solver, phase/turn validator,
card engine or permission source. Never grant a movement or rewrite a
server-provided player position based on browser event interpretation.

All Development create/join/poll/command pathways call this guard before
public state, private hand, actor or conditional polling ETag may change.
Malformed HTTP 200 remains invisible, and the next genuine revision
is still accepted.

## Tests

- `MatchAuditReplayTests` Theory 2/4/8 checks valid Domain moves, ends
  and pending settlement and rejects null/missing move endpoints, same
  street movement and unexpected end/pending street data, without partial
  history.
- Real-Vite Playwright guard imports the actual TS module for negative
  free-move/turn-ended/settlement mutations and immutable fixtures.
- Mocked full-React Playwright models plausible forged next-revision HTTP 200
  and ETag in three endpoint-shape cases. Verify state, turn and private
  hand do not change; an honest subsequent `end-turn` still advances once.
- Real React + .NET Playwright keeps the existing end-to-end contract green.

Target 0.0.2, direct main; close only with all 3 CI jobs successful
on the exact HEAD. See [#135](https://github.com/KeyserDSoze/Game.Edonism/issues/135).
