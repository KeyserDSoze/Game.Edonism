# Verified public posture filter for rival-held lots (#93)

## Scope and authority
Development-only public PvP reconnaissance, downstream of #85/#88/#89/#90/#92. The server already returns the `MatchOpponentControlledLotRoute.Posture` enum in the **audited, actor-scoped atomic tactical overview**. It is public only in the sense that the verified snapshot exposes it; this feature does **not** infer attacks, influence, factions, buying, movement permissions or private hand/deck data.

The UI checks the complete #88 tactical projection before displaying **any** public tactical routes. Its `visibleOpponentLots` is an ordered intersection:
1. Public owner must be absent (all) or match a verified `otherPlayers.others[].otherPlayerId` (#89).
2. Optional nearby filter allows only `streetSteps <= 1` (#85).
3. Optional posture filter allows exactly `posture === 0` (Standing) or `posture === 1` (Fallen), using values already checked against the authoritative public snapshot.

All other known public rival seats remain in the nearest-lot roster regardless of whether they own a visible lot. The #90 nearest lot is the first route left by these predicates; no alternate order, synthetic route or new HTTP response. The #92 paired rival **player-position** focus remains independently usable even when the selected posture hides all held lots. The existing `verifiedTacticalFocus` validation checks a selected canonical player/lot path against the current public revision. Changing any display filter clears the previous city focus. Match, actor or token changes reset the browser-only posture and other view preferences; no Web Storage persistence.

## Display and test evidence
The selector and public posture labels are in Italian and English, keyboard accessible and styled with semantic Tailwind tokens for responsive layout and light/dark themes. A non-WebGL browser still has the same DOM filter and focus controls. The option count is derived only from the filtered public canonical list; the total authoritative count remains unchanged.

- **xUnit .NET 10 (2/4/8 seats):** filtered owner/posture/nearby intersections equal the original audited controlled-lot state, preserve canonical street paths and order, and never change checkpoint/audit.
- **Mocked Playwright:** standing and fallen, two/eight seats, independent owner+nearby+posture filters, nearest/empty rival, player focus after lot becomes hidden, keyboard/mobile IT/EN, fallback WebGL, capability rotation/seat reset, forged posture rejected atomically, no extra tactical GET or revision mutation.
- **Playwright live with real .NET API:** two independent bearer seats use the public `posture` values to check each possible selector choice, matched against server-filtered lot rows and nearest per owner. Reads, public snapshot, audit and revision remain unchanged.

Rules #4, game engine #6 and Production login #13 remain unresolved and are not altered by this feature. [Issue #93](https://github.com/KeyserDSoze/Game.Edonism/issues/93) remains open until **all three GitHub Actions gates pass on the exact final `main` SHA**.
