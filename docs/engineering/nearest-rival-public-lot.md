# Nearest audited rival-controlled lot per public seat (#90)

This Development-only view is **public reconnaissance, not gameplay**. It follows the server-authorized tactical overview (#87), all-or-nothing browser validation (#88), owner filter (#89), and optional nearby view (#85). The printed regulation (#4), five visually inferred map edges and Production identity (#13) are unchanged.

## Algorithm and authority

1. Read `tactical-overview` exactly once per actor/revision using the in-memory bearer; never call an additional endpoint for this summary.
2. Show nothing until the existing #88 checks validate all three subprojections, public owner/slot/posture, exact canonical paths and sort order for the current match/actor/round/revision/origin.
3. Take **only** `otherPlayers.others` as the set of authenticated public rival seats (excludes caller). Compose #89 selected `ownerPlayerId` and #85 `streetSteps <= 1` display predicates on `opponentControlledLots.routes`.
4. For each known rival, choose the **first** remaining lot with matching owner. This is the canonical minimum by verified `streetSteps, ownerPlayerId, slotId` sorting, including deterministic slot-ID tie-break. If none remains, show a translated empty state; never invent a card/lot or treat that emptiness as a tactical permission.
5. A map-focus control copies that accepted route into the existing public map highlight without changing the authoritative match or sending a command. Invalid, revoked, switched and stale responses yield no targets. Owner/nearby changes reset map focus.

The per-rival summary always lists verified public *other seats*, including those with no currently visible lot. Labels and buttons are keyboard accessible, localized in Italian and English, and support mobile/fallback.

## Test guarantees

- xUnit 2/4/8 different actor perspectives vs independent `BoardDefinition.ShortestStreetPath`, per-owner minimum and stable slot tie-break, nearby intersection and nonmutating checkpoint/audit; movement and restore require the new revision.
- Playwright mocked two-/eight-seat, zero-visible-owner cases, 0–1 edge selection, owner filter, IT/EN keyboard map focus, forged nested scope, token rotation/seat switch/exit and no extra authenticated tactical GET.
- Playwright with real .NET: two browser seats using independent credentials, payload-derived nearest route/path rendered on the board, selection clears focus, no extra reads, public snapshot and audit remain identical.

#90 is subordinate to core #6 and requires 3/3 GitHub Actions gates green on the exact final `main` HEAD before closing.
