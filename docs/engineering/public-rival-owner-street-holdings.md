# Audited public rival ownership-by-street breakdown (#98)

## Source and authority
This Development-only PvP scouting refinement builds on #88's complete, actor-bound atomic tactical overview, the seven canonical streets from #97, owner filters (#89), street filters (#94), posture (#93), and focus (#90/#92). It is tracked by [#98](https://github.com/KeyserDSoze/Game.Edonism/issues/98). The public list includes only other-seat IDs returned by the **same validated public `otherPlayers.others` projection**, never an inferred faction, hostility, attack range, money, private card or permission.

The browser first validates **all** nested #88 scopes (match/actor/token/round/revision) and canonical route/path/owner/posture parity. Invalid, stale or forged data fail closed. For each of the seven public board street IDs, take the complete *unfiltered* public `opponentControlledLots.routes` and group by a public verified other-seat ID. Display only positive owner/street groupings, with total, standing (0), fallen (1) numbers. The sum across all public other owners must match each street's total, and every owner's standing+fallen equals that owner's total. No owner is emitted for Main Square because it has no controllable lots. Counts do not change under any browser-only display preference.

## Combined quick selection
The per-owner row is a real labeled button, accessible on keyboard, narrow viewport, Italian/English and without WebGL:
- Initial selection of a (street, owner) pair sets **both** existing owner and street display predicates. Preserve nearby and standing/fallen choices.
- Selecting the same pair again resets **only** owner and street to all, leaving proximity/posture untouched. Selecting a different pair replaces the two selected values.
- Every change clears the old city map tactical focus. Canonical route order and per-rival nearest visible lot remain server-verified; the separately public rival-player position remains available even if no held lot survives other filters.
- The seven street total rows remain intact; a street with zero public opponent lots shows an explicit localized empty state. No new HTTP request, mutation, React persistence or authorization is introduced.

## Tests and release gate
- **xUnit .NET 10, 2/4/8 actors:** complete street-by-owner counts and standing/fallen totals equal canonical public controlled-activity snapshot; no self holdings, no synthetic IDs or paths, unchanged checkpoint and audit.
- **Mocked Playwright, 2/8:** localized row and empty-state labels, keyboard Enter/pressed-state, selecting and deselecting exact owner+street, preserving nearby/posture, 7 streets and roster, seat/token reset, mobile no-overflow, no-WebGL accessibility, tamper rejection and no extra GET.
- **Live Playwright + real .NET:** Alice and Bob independently verify the grouped counts against their distinct authenticated tactical-overview responses, exercise paired selection and reset, preserve match/revision/public audit and one tactical browser GET each.
- **CI**: Do not close issue #98 until the full xUnit, mocked React Playwright and real-.NET Playwright jobs have finished `success` on the **exact current main SHA**. Obsolete canceled runs under #96 do not count.

Printed rules #4 and Production identity #13 remain unresolved and deliberately unchanged.
