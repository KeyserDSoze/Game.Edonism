# Development first-round unique public audit genesis (#134)

## Source of truth and failure mode

.NET `MatchAuditReplay.Verify` requires the public audit genesis to be revision 0,
round 1, `kind: "match-created"`, `actorId: "system"`, with null street endpoints.
Every subsequent command event is attributed to the current real seat, not to the
reserved technical actor. It rejects a second `match-created` kind. The reserved
technical ID is already forbidden as a player seat by #128.

The React `hasValidDevelopmentPublicEnvelope` from #126 intentionally checks
broad event actor membership (roster or technical actor). Before #134 the narrower
`hasValidDevelopmentPublicAuditChronology` from #119 checked exact genesis and
contiguous first-round revision/round, but did not reject the second appearance
of the genesis actor/kind. A forged HTTP 200 could therefore pollute the current
public audit or advance a local revision and conditional ETag even though .NET
could never produce that post-genesis event.

## Ingress contract

The first-round chronology validator accepts one exact genesis at array index 0.
For every later index, require the already checked runtime shape, consecutive
revision and round 1, **and** disallow both `actorId === "system"` and
`kind === "match-created"`. This happens before Development create/join/poll/command
responses may bind session state or ETags. Do not weaken the existing #126 broad
envelope to pretend it is a gameplay replay; other future well-formed public
event kinds authored by a real roster seat remain shape-compatible.

These are transport/uniqueness checks only. Adjacency, actor turn legality,
movement, ownership, money, powers, history replay, Production identity and
private credentials remain authoritative exclusively in .NET.

## Verification

- xUnit: genuine first-round command event accepted, after-genesis impersonation
  rejected with `event_out_of_turn`, repeated genesis kind rejected with
  `unknown_event_kind`; 2, 4 and 8 seats; no partial verified frames.
- Real Vite browser: the #119 chronology rejects the tamper cases for 2/4/8
  seats without mutating its inputs, while valid genesis and future-shaped
  real-seat events remain admitted.
- #126 browser regression explicitly distinguishes the broader public envelope
  from the stricter chronology for non-genesis `system`.
- Full mocked React: forged public HTTP 200 at a plausible next revision with
  either tamper cannot advance public revision, ETag or private hand; a genuine
  following end-turn remains successful.
- Full-stack Playwright against actual .NET Development API must continue passing.

Target 0.0.2, direct main. Track final green SHA, job counts and closure on
[issue #134](https://github.com/KeyserDSoze/Game.Edonism/issues/134).
