# Public rival-controlled-lot distribution by street (#97)

## Public data and threat-model boundary
Edonism is PvP-first, but the Development lab does not implement combat, movement rights, attacking, faction authority or Production login. This feature summarizes only the public ownership and posture facts that the authoritative .NET match already returns in the **same fully audited atomic tactical overview** as #88. See [issue #97](https://github.com/KeyserDSoze/Game.Edonism/issues/97), downstream of #85/#89/#90/#92/#93/#94/#95.

The UI first verifies the complete actor/token/match/round/revision-bound `tactical-overview` payload, including route street IDs, canonical paths, public owners, exact posture 0/1, and sort order. If any nested projection fails these guards, **all** tactical widgets—including the street distribution—are unavailable. There is no fallback reconstruction from client positions, stale responses, private hands, geometry, account roles or unmatched revisions.

The distribution iterates exactly the seven `cityBoard.streets` IDs, in public board order. For each street it counts all `opponentControlledLots.routes` whose `streetId` matches, counts `posture === 0` standing and `posture === 1` fallen, and renders the canonical street name. The Main Square has **0 activity lots** and still appears in the list. Total per-street count equals standing plus fallen; summing the seven counts equals all verified rival-controlled-lot routes. These values are deliberately **unfiltered** so that a selected owner, nearby, posture or street filter never misrepresents the overall public territorial distribution. The UI says so explicitly in both languages.

## One click per street
Each street row is a semantic keyboard-accessible button. It toggles the selected public street ID via the **same** existing #94 local selector, without bypassing owner (#89), nearby (#85) or posture (#93) predicates. The active street remains `aria-pressed`; choosing another street replaces it, choosing the currently selected one returns to all. Every change calls `onTacticalFocus(null)`. The canonical ordered lot list, nearest visible lot per rival (#90), separate verified public rival-player position (#92), IT/EN active-filter summary and one-click reset (#95) remain unchanged.

No new request, endpoint, audit event, rule, gameplay action, personal data, localStorage token, scoring model or inference of hostility/attack permission is introduced. Mobile and non-WebGL clients see the same readable counts and controls.

## Mandatory verification
- **xUnit .NET 10, 2/4/8 seats:** compare each canonical street group's rival-owned lots and standing/fallen counts with the authoritative match's public controlled-activity snapshot, verify every route's canonical street path, zero lots in Main Square, exact total and unchanged checkpoint/audit.
- **Mocked Playwright, 2/8 seats:** seven rows, real canonical names and counts, unfiltered invariants under simultaneous owner/nearby/street/posture choices, keyboard toggling, clearing stale focus, IT/EN, narrow mobile screens, no WebGL, token/seat switching, forged street projection, zero additional tactical GETs.
- **Live Playwright vs .NET:** Alice and Bob with distinct bearer capabilities each verify all seven count/standing/fallen rows against the real actor-scoped atomic overview; use one tactical browser GET per seat and assert unchanged game revision, public snapshot and audit. Existing scene/focus tests remain active.

**Close #97 only when all three GitHub Actions jobs complete successfully on the exact latest main SHA**; record the counts and run URL in the issue and ledger. Do not proceed to unresolved printed rules #4 or Production identity #13 based on these display-only counts.
