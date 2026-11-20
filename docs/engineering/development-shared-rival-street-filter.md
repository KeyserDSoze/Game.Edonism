# #185 — Filter jointly verified public rivals by co-owned city streets

## Scope and source of truth

The Development-only #181 public rival dossier is created only when the entire
actor/seat/token/match/revision-scoped tactical route graph and the independently
.NET-verified public territory report both agree with one canonical board
snapshot. The #180 verified `sharedStreetIds` array means that the **current
actor and that rival both publicly control at least one property on the same
canonical printed city street**. It is NOT based on both character tokens
standing on one street, a tactical movement route, an attack distance, a hostile
faction or a win condition.

This issue adds a browser-only **all rivals / shared-controlled-street rivals**
toggle to the fully verified dossier. No new network request, backend
contract, matchmaking, combat/ownership authority or private game data.

## Invariants

- Render the native button only inside the complete, verified #181 dossier,
  with IT/EN text, `aria-controls` for the list and truthful `aria-pressed`.
- **All rivals** is default and includes every 2–8 public seat, including
  zero-controlled-lot rivals. **Shared controlled street** mode only includes
  rows whose already verified `sharedStreetIds.length > 0`. Never derive
  the filter from the current actor street, mere one-edge proximity, display
  text, unverified HTTP or optimistic assumptions.
- First apply the #184 display sort of the entire audited dossier; then filter
  copies/read-only rows, keeping that selected ordering stable and never
  mutating verifier output. The #182 independent public lot-owner filter and
  #183 read-only map path focus are unaffected by toggle changes.
- Present a `visible / total` public rival count under both modes. When
  no shared-controlled-street rival exists, present a specific **empty filtered
  result** and an active toggle, never «no other players» or a victory claim.
  Switching back to all restores all certified rows.
- On match switch, actor switch, bearer rotation, state revision or exit,
  reset toggle to all. On forged, stale, over-wide, incomplete or otherwise
  invalid .NET HTTP 200, the whole #181 dossier and toggle remain hidden.
- No private cards, tokens, wallet contents, new PvP command or persistence
  in local/session storage.

## Test matrix and issue workflow

- Mocked Vite React Playwright: 2/4/8 players with authentic-looking but
  server-consistent *public* fixture where Alice and Bob jointly control
  one Gauss Avenue street. Verify exact filtered player IDs, button keyboard,
  IT/EN, independent #182 filter/#183 map focus, #184 sorting, mobile 390px,
  actor switch and bearer rotation without game commands. 2/8 control cases
  with zero shared controlled streets display honest empty state, and recover
  the original full rival list. Existing forged territory and tactical 200
  fail-closed/actor recovery tests assert the toggle is hidden until a fresh
  independently verified current actor report arrives.
- Live browser vs real .NET API for 2/8 players checks the visible rival IDs
  and visible/total count against the audited `data-shared-streets` attached
  to each correctly validated dossier row, and restores original full order.
  No server implementation changed; retain the full .NET xUnit gate.
- GitHub [#185](https://github.com/KeyserDSoze/Game.Edonism/issues/185)
  is the issue-first record. Prepare this patch *without publishing it*
  while [#184](https://github.com/KeyserDSoze/Game.Edonism/issues/184)
  exact-main CI is pending. Commit directly to main only after #184 3/3
  success, and close #185 only after its own exact latest-main xUnit,
  mocked React Playwright and real React+.NET Playwright 3/3 success.
- This does not resolve #4 canonical rules, #6 official gameplay, #8 factions
  or #13 Production identity.

Target version: `0.0.2`.
