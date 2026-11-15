# Canonical Development public audit street endpoints (#125)

## Why
First-round public HTTP snapshots previously required typed audit event records, a contiguous timeline and canonical player locations, but accepted any string or null in an event's fromStreetId and toStreetId. An otherwise plausible forged 200 can claim a journey involving an invented road, contaminate the public history and induce incorrect revision/conditional-ETag state.

## Contract and authority
The existing **narrow** `hasValidDevelopmentPublicEnvelope` now requires every non-null event fromStreetId/toStreetId to belong to the seven case-exact street identifiers in the same imported versioned shared board JSON used for boardVersion and player locations (#122/#123). Null remains valid for genesis and nonmovement events, and unknown well-typed future public event kinds remain transport compatible if their provided streets belong to the board. The entire malformed snapshot is rejected before creator/join/poll/command session, revision and ETag changes.

This is NOT client replay, adjacency checking, an event-state verifier, a new turn action or Production security. Legal moves and public audit correctness remain exclusively in `.NET GameMatch`/`MatchAuditReplay`. Card/control/quote view projections remain independently guarded, not globally suppressed.

## Verification
- Six real Vite-loaded TypeScript Playwright tests (2/4/8 seats) accept every canonical audit endpoint, null endpoints and unknown future event kinds, reject forged/blank/case/padded/numeric/array/object street IDs in from/to separately or together, check chronology parity and preserve input immutability.
- One full mocked React browser Playwright test injects a plausible higher-revision audit HTTP 200 with a nonexistent road and ETag. The browser must preserve revision, actor, private hand, public audit and command options; a real subsequent end-turn is still accepted and the foreign ETag must never be reused.
- Three Domain xUnit theory cases (2/4/8 seats) check canonical event endpoint IDs and authoritative free-move source/destination before and after each end-turn, pending settlement and checkpoint restore.
- All three CI jobs must be green on final main HEAD before issue closure.

Tracking: https://github.com/KeyserDSoze/Game.Edonism/issues/125
